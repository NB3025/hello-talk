import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase } from '../src/app';
import {
  buildProdLikeApp,
  cookieFromResponse,
  createUserSession,
  startTestApp,
  stopTestApp,
  type TestContext,
} from './helpers';
import type { FastifyInstance } from 'fastify';

/**
 * 리뷰가 지적한 보안/스코핑 이슈들에 대한 회귀 테스트.
 *  - {userId} 임의 로그인은 데모/개발(devTools) 에서만 열린다.
 *  - 스코핑된 스냅샷은 비친구의 메시지·선물을 흘리지 않는다.
 *  - 크로스 오리진 CORS + credentials.
 *  - 운영 유사 설정에서 세션 쿠키는 Secure.
 *  - 멱등성은 동시 재시도에도 부수효과를 한 번만 낸다.
 */
describe('review security & scoping fixes', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestApp();
  });
  afterAll(async () => {
    await stopTestApp(ctx);
  });
  beforeEach(async () => {
    await resetDatabase(ctx.pool);
  });

  describe('arbitrary {userId} login is gated by devTools', () => {
    it('devTools app allows sign-in as an existing user by userId (demo path)', async () => {
      const { userId } = await createUserSession(ctx.app, '홍길동');
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/session',
        payload: { userId },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().user.id).toBe(userId);
    });

    it('prod-like app (devTools:false) rejects sign-in by arbitrary userId with 403', async () => {
      const prod: FastifyInstance = buildProdLikeApp(ctx.pool);
      await prod.ready();
      try {
        const created = await prod.inject({
          method: 'POST',
          url: '/api/auth/session',
          payload: { name: '김철수' },
        });
        expect(created.statusCode).toBe(201);
        const targetId = created.json().user.id as string;

        const res = await prod.inject({
          method: 'POST',
          url: '/api/auth/session',
          payload: { userId: targetId },
        });
        expect(res.statusCode).toBe(403);
      } finally {
        await prod.close();
      }
    });

    it('prod-like app still creates a fresh user (new session) via {name}', async () => {
      const prod = buildProdLikeApp(ctx.pool);
      await prod.ready();
      try {
        const res = await prod.inject({
          method: 'POST',
          url: '/api/auth/session',
          payload: { name: '이영희' },
        });
        expect(res.statusCode).toBe(201);
        expect(res.json().user.name).toBe('이영희');
      } finally {
        await prod.close();
      }
    });

    it('dev-only user directory endpoint is closed in prod-like app', async () => {
      const prod = buildProdLikeApp(ctx.pool);
      await prod.ready();
      try {
        const created = await prod.inject({
          method: 'POST',
          url: '/api/auth/session',
          payload: { name: '박영수' },
        });
        const cookie = cookieFromResponse(
          created.headers['set-cookie'] as string | string[] | undefined,
        );
        const res = await prod.inject({
          method: 'GET',
          url: '/api/dev/users',
          headers: cookie ? { cookie } : {},
        });
        expect(res.statusCode).toBe(404);
      } finally {
        await prod.close();
      }
    });

    it('dev user directory populates the demo login list without a session (pre-login)', async () => {
      // 회귀: 로그인 화면의 "이미 있는 사람으로 들어가기" 목록은 아직 세션이 없는 상태에서
      // 채워져야 한다. dev 디렉터리는 세션을 요구하지 않고 전체 로스터를 돌려준다.
      await createUserSession(ctx.app, '홍길동');
      await createUserSession(ctx.app, '김철수');

      // 쿠키를 전혀 붙이지 않는다(로그인 전 상태).
      const res = await ctx.app.inject({ method: 'GET', url: '/api/dev/users' });
      expect(res.statusCode).toBe(200);
      const names = (res.json().users as Array<{ name: string }>).map((u) => u.name).sort();
      expect(names).toEqual(['김철수', '홍길동']);

      // 대조: 스코핑된 스냅샷은 세션이 없으면 401 이라 목록을 채울 수 없다(디렉터리가 필요한 이유).
      const snap = await ctx.app.inject({ method: 'GET', url: '/api/snapshot' });
      expect(snap.statusCode).toBe(401);
    });
  });

  describe('scoped snapshot does not leak non-parties', () => {
    it('a logged-in user cannot read a non-friend/non-chat pair\'s messages or gifts', async () => {
      // A 와 B 가 서로 대화·선물을 주고받는다. C 는 무관한 제3자.
      const a = await createUserSession(ctx.app, '홍길동');
      const b = await createUserSession(ctx.app, '김철수');
      const c = await createUserSession(ctx.app, '이영희');

      const chatId = (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/chats/direct',
          headers: { cookie: a.cookie },
          payload: { targetId: b.userId },
        })
      ).json().chatId as string;

      await ctx.app.inject({
        method: 'POST',
        url: `/api/chats/${chatId}/messages`,
        headers: { cookie: a.cookie },
        payload: { text: '비밀 이야기' },
      });
      await ctx.app.inject({
        method: 'POST',
        url: '/api/gifts',
        headers: { cookie: a.cookie },
        payload: { receiverId: b.userId, productId: 'p-americano', message: 'ㅎㅇ' },
      });

      // C 의 스냅샷에는 A·B 의 방·메시지·선물이 하나도 없어야 한다.
      const snapC = (
        await ctx.app.inject({ method: 'GET', url: '/api/snapshot', headers: { cookie: c.cookie } })
      ).json().db;
      expect(snapC.chats.length).toBe(0);
      expect(snapC.messages.length).toBe(0);
      expect(snapC.giftOrders.length).toBe(0);
      // 스코핑된 사용자 목록에도 A·B 는 없다(본인만).
      expect(snapC.users.map((u: { id: string }) => u.id)).toEqual([c.userId]);

      // 반면 A 는 자기 세계를 정상적으로 본다.
      const snapA = (
        await ctx.app.inject({ method: 'GET', url: '/api/snapshot', headers: { cookie: a.cookie } })
      ).json().db;
      expect(snapA.chats.length).toBe(1);
      expect(snapA.messages.some((m: { text: string }) => m.text === '비밀 이야기')).toBe(true);
      expect(snapA.giftOrders.length).toBe(1);
      // A 는 대화 상대 B 를 볼 수 있다.
      expect(snapA.users.map((u: { id: string }) => u.id).sort()).toEqual(
        [a.userId, b.userId].sort(),
      );
    });

    it('a user sees a friendship where they are the friend (directional, both parties visible)', async () => {
      const a = await createUserSession(ctx.app, '홍길동');
      const b = await createUserSession(ctx.app, '김철수');
      const bCode = (
        await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: b.cookie } })
      ).json().user.code as string;
      await ctx.app.inject({
        method: 'POST',
        url: '/api/friends',
        headers: { cookie: a.cookie },
        payload: { code: bCode },
      });
      // B 관점에서도 A→B 친구관계가 보인다(단, 역방향은 없다).
      const snapB = (
        await ctx.app.inject({ method: 'GET', url: '/api/snapshot', headers: { cookie: b.cookie } })
      ).json().db;
      expect(
        snapB.friendships.some(
          (f: { ownerId: string; friendId: string }) =>
            f.ownerId === a.userId && f.friendId === b.userId,
        ),
      ).toBe(true);
      expect(snapB.users.map((u: { id: string }) => u.id).sort()).toEqual(
        [a.userId, b.userId].sort(),
      );
    });
  });

  describe('CORS with credentials for cross-origin client', () => {
    it('prod-like app echoes the allowlisted origin with credentials:true', async () => {
      const origin = 'https://app.example.com';
      const prod = buildProdLikeApp(ctx.pool, origin);
      await prod.ready();
      try {
        const res = await prod.inject({
          method: 'OPTIONS',
          url: '/api/auth/session',
          headers: {
            origin,
            'access-control-request-method': 'POST',
            'access-control-request-headers': 'content-type',
          },
        });
        expect(res.headers['access-control-allow-origin']).toBe(origin);
        expect(String(res.headers['access-control-allow-credentials'])).toBe('true');
      } finally {
        await prod.close();
      }
    });

    it('prod-like app does not allow a non-allowlisted origin', async () => {
      const prod = buildProdLikeApp(ctx.pool, 'https://app.example.com');
      await prod.ready();
      try {
        const res = await prod.inject({
          method: 'OPTIONS',
          url: '/api/auth/session',
          headers: {
            origin: 'https://evil.example.com',
            'access-control-request-method': 'POST',
          },
        });
        expect(res.headers['access-control-allow-origin']).not.toBe('https://evil.example.com');
      } finally {
        await prod.close();
      }
    });
  });

  describe('session cookie secure flag', () => {
    it('prod-like app marks the session cookie Secure (and SameSite=None for cross-origin)', async () => {
      const prod = buildProdLikeApp(ctx.pool);
      await prod.ready();
      try {
        const res = await prod.inject({
          method: 'POST',
          url: '/api/auth/session',
          payload: { name: '홍길동' },
        });
        const setCookie = res.headers['set-cookie'];
        const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
        expect(cookieStr.toLowerCase()).toContain('secure');
        expect(cookieStr.toLowerCase()).toContain('samesite=none');
      } finally {
        await prod.close();
      }
    });

    it('local dev app (no secure flag) keeps the cookie non-secure over http', async () => {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/session',
        payload: { name: '김철수' },
      });
      const setCookie = res.headers['set-cookie'];
      const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
      expect(cookieStr.toLowerCase()).not.toContain('secure');
    });
  });

  describe('idempotency under concurrent retries', () => {
    it('two simultaneous message retries with the same clientKey create exactly one message', async () => {
      const a = await createUserSession(ctx.app, '홍길동');
      const b = await createUserSession(ctx.app, '김철수');
      const chatId = (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/chats/direct',
          headers: { cookie: a.cookie },
          payload: { targetId: b.userId },
        })
      ).json().chatId as string;

      const send = () =>
        ctx.app.inject({
          method: 'POST',
          url: `/api/chats/${chatId}/messages`,
          headers: { cookie: a.cookie },
          payload: { text: '동시에 두 번', clientKey: 'concurrent-key-1' },
        });

      // 풀 크기(10)를 넘는 요청이 겹쳐도 gate가 mutator와 같은 커넥션을 쓰므로 교착하지 않는다.
      const results = await Promise.all(Array.from({ length: 12 }, () => send()));
      const ids = new Set(results.map((r) => r.json().messageId));
      // 모두 같은 messageId 를 돌려받는다(멱등).
      expect(ids.size).toBe(1);

      const snap = (
        await ctx.app.inject({ method: 'GET', url: '/api/snapshot', headers: { cookie: a.cookie } })
      ).json().db;
      const count = snap.messages.filter(
        (m: { chatId: string; text: string }) => m.chatId === chatId && m.text === '동시에 두 번',
      ).length;
      expect(count).toBe(1);
    });

    it('two simultaneous gift retries with the same clientKey create exactly one order', async () => {
      const a = await createUserSession(ctx.app, '홍길동');
      const b = await createUserSession(ctx.app, '김철수');
      const sendGift = () =>
        ctx.app.inject({
          method: 'POST',
          url: '/api/gifts',
          headers: { cookie: a.cookie },
          payload: {
            receiverId: b.userId,
            productId: 'p-americano',
            message: '커피',
            clientKey: 'concurrent-gift-1',
          },
        });

      const results = await Promise.all([sendGift(), sendGift(), sendGift()]);
      const ids = new Set(results.map((r) => r.json().orderId));
      expect(ids.size).toBe(1);

      const snap = (
        await ctx.app.inject({ method: 'GET', url: '/api/snapshot', headers: { cookie: a.cookie } })
      ).json().db;
      expect(snap.giftOrders.length).toBe(1);
      const giftMsgs = snap.messages.filter((m: { kind?: string }) => m.kind === 'gift');
      expect(giftMsgs.length).toBe(1);
    });
  });
});
