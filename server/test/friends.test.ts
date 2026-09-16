import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase } from '../src/app';
import { createUserSession, startTestApp, stopTestApp, type TestContext } from './helpers';

/** 세션 사용자의 code 를 조회한다(친구 추가 테스트에 상대 코드가 필요하다). */
const codeOf = async (ctx: TestContext, cookie: string): Promise<string> => {
  const res = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
  return res.json().user.code as string;
};

describe('friends', () => {
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

  it('adds a friend by code (success)', async () => {
    const me = await createUserSession(ctx.app, '홍길동');
    const other = await createUserSession(ctx.app, '김철수');
    const otherCode = await codeOf(ctx, other.cookie);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/friends',
      headers: { cookie: me.cookie },
      payload: { code: otherCode },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().friend.id).toBe(other.userId);
  });

  it('rejects empty code', async () => {
    const me = await createUserSession(ctx.app, '홍길동');
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/friends',
      headers: { cookie: me.cookie },
      payload: { code: '   ' },
    });
    expect(res.json()).toEqual({ ok: false, reason: '친구 코드를 입력해 주세요.' });
  });

  it('rejects own code', async () => {
    const me = await createUserSession(ctx.app, '홍길동');
    const myCode = await codeOf(ctx, me.cookie);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/friends',
      headers: { cookie: me.cookie },
      payload: { code: myCode },
    });
    expect(res.json()).toEqual({
      ok: false,
      reason: '내 코드입니다. 상대의 코드를 받아 입력해 주세요.',
    });
  });

  it('rejects unknown code', async () => {
    const me = await createUserSession(ctx.app, '홍길동');
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/friends',
      headers: { cookie: me.cookie },
      payload: { code: 'HT-ZZZZ' },
    });
    expect(res.json()).toEqual({ ok: false, reason: 'HT-ZZZZ 코드를 쓰는 사람이 없습니다.' });
  });

  it('rejects duplicate friend', async () => {
    const me = await createUserSession(ctx.app, '홍길동');
    const other = await createUserSession(ctx.app, '김철수');
    const otherCode = await codeOf(ctx, other.cookie);
    await ctx.app.inject({
      method: 'POST',
      url: '/api/friends',
      headers: { cookie: me.cookie },
      payload: { code: otherCode },
    });
    const dup = await ctx.app.inject({
      method: 'POST',
      url: '/api/friends',
      headers: { cookie: me.cookie },
      payload: { code: otherCode },
    });
    expect(dup.json()).toEqual({ ok: false, reason: '김철수 님은 이미 친구입니다.' });
  });

  it('is directional: adding does not create the reverse friendship', async () => {
    const me = await createUserSession(ctx.app, '홍길동');
    const other = await createUserSession(ctx.app, '김철수');
    const otherCode = await codeOf(ctx, other.cookie);
    await ctx.app.inject({
      method: 'POST',
      url: '/api/friends',
      headers: { cookie: me.cookie },
      payload: { code: otherCode },
    });
    const snap = await ctx.app.inject({
      method: 'GET',
      url: '/api/snapshot',
      headers: { cookie: other.cookie },
    });
    const friendships = snap.json().db.friendships as Array<{ ownerId: string; friendId: string }>;
    // me -> other 만 있어야 하고, other -> me 는 없어야 한다.
    expect(friendships).toContainEqual(
      expect.objectContaining({ ownerId: me.userId, friendId: other.userId }),
    );
    expect(
      friendships.some((f) => f.ownerId === other.userId && f.friendId === me.userId),
    ).toBe(false);
  });

  it('toggles favorite and removes a friend', async () => {
    const me = await createUserSession(ctx.app, '홍길동');
    const other = await createUserSession(ctx.app, '김철수');
    const otherCode = await codeOf(ctx, other.cookie);
    await ctx.app.inject({
      method: 'POST',
      url: '/api/friends',
      headers: { cookie: me.cookie },
      payload: { code: otherCode },
    });

    await ctx.app.inject({
      method: 'POST',
      url: `/api/friends/${other.userId}/favorite`,
      headers: { cookie: me.cookie },
    });
    let snap = await ctx.app.inject({ method: 'GET', url: '/api/snapshot', headers: { cookie: me.cookie } });
    let fs = snap.json().db.friendships as Array<{ friendId: string; favorite: boolean }>;
    expect(fs.find((f) => f.friendId === other.userId)?.favorite).toBe(true);

    // 다시 토글하면 false 로 돌아간다.
    await ctx.app.inject({
      method: 'POST',
      url: `/api/friends/${other.userId}/favorite`,
      headers: { cookie: me.cookie },
    });
    snap = await ctx.app.inject({ method: 'GET', url: '/api/snapshot', headers: { cookie: me.cookie } });
    fs = snap.json().db.friendships as Array<{ friendId: string; favorite: boolean }>;
    expect(fs.find((f) => f.friendId === other.userId)?.favorite).toBe(false);

    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/friends/${other.userId}`,
      headers: { cookie: me.cookie },
    });
    snap = await ctx.app.inject({ method: 'GET', url: '/api/snapshot', headers: { cookie: me.cookie } });
    const remaining = snap.json().db.friendships as Array<{ friendId: string }>;
    expect(remaining.some((f) => f.friendId === other.userId)).toBe(false);
  });
});
