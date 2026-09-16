import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUserSession, startTestApp, stopTestApp, type TestContext } from './helpers';

describe('auth & session', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestApp();
  });
  afterAll(async () => {
    await stopTestApp(ctx);
  });

  it('creates a user and issues an HttpOnly session cookie', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/session',
      payload: { name: '홍길동' },
    });
    expect(res.statusCode).toBe(201);
    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
    expect(cookieStr).toContain('ht_session=');
    expect(cookieStr.toLowerCase()).toContain('httponly');
    expect(res.json().user.name).toBe('홍길동');
    expect(res.json().user.code).toMatch(/^HT-[A-Z0-9]{4}$/);
  });

  it('GET /api/auth/me returns 401 without a session', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/auth/me round-trips with the session cookie', async () => {
    const { userId, cookie } = await createUserSession(ctx.app, '김철수');
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.id).toBe(userId);
  });

  it('command endpoints reject unauthenticated requests with 401', async () => {
    const endpoints: Array<[string, string]> = [
      ['POST', '/api/friends'],
      ['POST', '/api/chats/direct'],
      ['POST', '/api/chats/c1/messages'],
      ['POST', '/api/chats/c1/read'],
      ['POST', '/api/gifts'],
      ['POST', '/api/gifts/o1/actions'],
      ['GET', '/api/snapshot'],
    ];
    for (const [method, url] of endpoints) {
      const res = await ctx.app.inject({ method: method as 'GET' | 'POST', url, payload: {} });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('sign in as existing user by userId', async () => {
    const { userId } = await createUserSession(ctx.app, '이영희');
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/session',
      payload: { userId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.id).toBe(userId);
  });

  it('DELETE /api/auth/session signs out', async () => {
    const { cookie } = await createUserSession(ctx.app, '박영수');
    const out = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/auth/session',
      headers: { cookie },
    });
    expect(out.statusCode).toBe(200);
    const cleared = Array.isArray(out.headers['set-cookie'])
      ? out.headers['set-cookie'].join(';')
      : String(out.headers['set-cookie']);
    expect(cleared).toContain('ht_session=');
  });

  it('a forged/unsigned cookie is not accepted', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: 'ht_session=some-user-id-without-signature' },
    });
    expect(res.statusCode).toBe(401);
  });
});
