import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase } from '../src/app';
import { createUserSession, startTestApp, stopTestApp, type TestContext } from './helpers';

const openDirect = (ctx: TestContext, cookie: string, targetId: string) =>
  ctx.app.inject({
    method: 'POST',
    url: '/api/chats/direct',
    headers: { cookie },
    payload: { targetId },
  });

describe('chats & messaging & read state', () => {
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

  it('openDirectChat is idempotent for the same pair', async () => {
    const a = await createUserSession(ctx.app, '홍길동');
    const b = await createUserSession(ctx.app, '김철수');
    const r1 = await openDirect(ctx, a.cookie, b.userId);
    const r2 = await openDirect(ctx, a.cookie, b.userId);
    // 반대 방향에서 열어도 같은 방이어야 한다.
    const r3 = await openDirect(ctx, b.cookie, a.userId);
    expect(r1.json().chatId).toBe(r2.json().chatId);
    expect(r1.json().chatId).toBe(r3.json().chatId);

    const snap = await ctx.app.inject({ method: 'GET', url: '/api/snapshot', headers: { cookie: a.cookie } });
    expect(snap.json().db.chats.length).toBe(1);
  });

  it('concurrent openDirectChat calls converge to one room', async () => {
    const a = await createUserSession(ctx.app, '홍길동');
    const b = await createUserSession(ctx.app, '김철수');
    const results = await Promise.all([
      openDirect(ctx, a.cookie, b.userId),
      openDirect(ctx, a.cookie, b.userId),
      openDirect(ctx, b.cookie, a.userId),
      openDirect(ctx, a.cookie, b.userId),
    ]);
    const ids = new Set(results.map((r) => r.json().chatId));
    expect(ids.size).toBe(1);
    const snap = await ctx.app.inject({ method: 'GET', url: '/api/snapshot', headers: { cookie: a.cookie } });
    expect(snap.json().db.chats.length).toBe(1);
  });

  it('enforces membership on sendMessage', async () => {
    const a = await createUserSession(ctx.app, '홍길동');
    const b = await createUserSession(ctx.app, '김철수');
    const outsider = await createUserSession(ctx.app, '이영희');
    const chatId = (await openDirect(ctx, a.cookie, b.userId)).json().chatId as string;

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages`,
      headers: { cookie: outsider.cookie },
      payload: { text: '끼어들기' },
    });
    expect(res.json().ok).toBe(false);
    const snap = await ctx.app.inject({ method: 'GET', url: '/api/snapshot', headers: { cookie: a.cookie } });
    expect(snap.json().db.messages.length).toBe(0);
  });

  it('does not create read state for a non-member', async () => {
    const a = await createUserSession(ctx.app, '홍길동');
    const b = await createUserSession(ctx.app, '김철수');
    const outsider = await createUserSession(ctx.app, '이영희');
    const chatId = (await openDirect(ctx, a.cookie, b.userId)).json().chatId as string;

    await ctx.app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages`,
      headers: { cookie: a.cookie },
      payload: { text: '멤버만 읽을 수 있음' },
    });
    const read = await ctx.app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/read`,
      headers: { cookie: outsider.cookie },
    });
    expect(read.statusCode).toBe(200);

    const stored = await ctx.pool.query(
      'SELECT 1 FROM reads WHERE chat_id = $1 AND user_id = $2',
      [chatId, outsider.userId],
    );
    expect(stored.rowCount).toBe(0);
  });

  it('computes unread from lastReadAt; own message is not unread; markRead clears', async () => {
    const a = await createUserSession(ctx.app, '홍길동');
    const b = await createUserSession(ctx.app, '김철수');
    const chatId = (await openDirect(ctx, a.cookie, b.userId)).json().chatId as string;

    // a 가 두 통 보낸다.
    await ctx.app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages`,
      headers: { cookie: a.cookie },
      payload: { text: '안녕' },
    });
    await ctx.app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/messages`,
      headers: { cookie: a.cookie },
      payload: { text: '잘 지내?' },
    });

    // b 관점: 안읽음 2. a 관점: 자기 메시지라 안읽음 0.
    const unread = (snapJson: unknown, chat: string, viewer: string): number => {
      const db = (snapJson as { db: { messages: Array<{ chatId: string; senderId: string; createdAt: number }>; reads: Array<{ chatId: string; userId: string; lastReadAt: number }> } }).db;
      const since = db.reads.find((r) => r.chatId === chat && r.userId === viewer)?.lastReadAt ?? 0;
      return db.messages.filter((m) => m.chatId === chat && m.senderId !== viewer && m.createdAt > since).length;
    };

    const snapB = (await ctx.app.inject({ method: 'GET', url: '/api/snapshot', headers: { cookie: b.cookie } })).json();
    expect(unread(snapB, chatId, b.userId)).toBe(2);
    expect(unread(snapB, chatId, a.userId)).toBe(0);

    // b 가 읽는다.
    const read = await ctx.app.inject({
      method: 'POST',
      url: `/api/chats/${chatId}/read`,
      headers: { cookie: b.cookie },
    });
    expect(read.statusCode).toBe(200);
    const snapB2 = (await ctx.app.inject({ method: 'GET', url: '/api/snapshot', headers: { cookie: b.cookie } })).json();
    expect(unread(snapB2, chatId, b.userId)).toBe(0);
  });

  it('idempotent message send does not duplicate on retry', async () => {
    const a = await createUserSession(ctx.app, '홍길동');
    const b = await createUserSession(ctx.app, '김철수');
    const chatId = (await openDirect(ctx, a.cookie, b.userId)).json().chatId as string;

    const send = () =>
      ctx.app.inject({
        method: 'POST',
        url: `/api/chats/${chatId}/messages`,
        headers: { cookie: a.cookie },
        payload: { text: '한 번만', clientKey: 'msg-key-1' },
      });
    const r1 = await send();
    const r2 = await send();
    expect(r1.json().messageId).toBe(r2.json().messageId);

    const snap = await ctx.app.inject({ method: 'GET', url: '/api/snapshot', headers: { cookie: a.cookie } });
    expect(snap.json().db.messages.length).toBe(1);
  });
});
