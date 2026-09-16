import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp, resetDatabase, runMigrations } from '../src/app';
import { makeTestPool, COOKIE_SECRET, cookieFromResponse, type TestContext } from './helpers';
import type { FastifyInstance } from 'fastify';

/**
 * WebSocket 실시간. 실제 상태가 바뀐 뮤테이션에서만 신호가 나가고, no-op(예: 읽을 것 없는
 * markRead)에서는 나가지 않아야 한다. app.inject 로는 WS 를 못 붙이므로 실제 포트에 띄운다.
 */
describe('websocket real-time fan-out', () => {
  let ctx: TestContext;
  let app: FastifyInstance;
  let baseUrl: string;
  let wsUrl: string;

  beforeAll(async () => {
    const pool = makeTestPool();
    await runMigrations(pool);
    await resetDatabase(pool);
    app = buildApp({ pool, cookieSecret: COOKIE_SECRET, devTools: true });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    if (!addr || typeof addr === 'string') throw new Error('no address');
    baseUrl = `http://127.0.0.1:${addr.port}`;
    wsUrl = `ws://127.0.0.1:${addr.port}/ws`;
    ctx = { app, pool };
  });

  afterAll(async () => {
    await app.close();
    await ctx.pool.end();
  });

  const createUser = async (name: string): Promise<{ userId: string; cookie: string }> => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/session', payload: { name } });
    const cookie = cookieFromResponse(res.headers['set-cookie'] as string | string[] | undefined)!;
    return { userId: res.json().user.id as string, cookie };
  };

  const openSocket = (cookie: string): Promise<WebSocket> =>
    new Promise((resolve, reject) => {
      const socket = new WebSocket(wsUrl, { headers: { cookie } });
      socket.once('open', () => resolve(socket));
      socket.once('error', reject);
    });

  it('closes an unauthenticated websocket connection with policy code 1008', async () => {
    const closeCode = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(wsUrl);
      socket.once('close', (code) => resolve(code));
      socket.once('error', reject);
      setTimeout(() => reject(new Error('timeout')), 3000);
    });
    // 인증 실패 소켓은 정책 위반 코드(1008)로 닫힌다.
    expect(closeCode).toBe(1008);
  });

  it('broadcasts a change signal on a real mutation but not on a no-op', async () => {
    const a = await createUser('홍길동');
    const b = await createUser('김철수');
    const socket = await openSocket(a.cookie);

    const signals: Array<{ type: string; scope?: string }> = [];
    socket.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'change') signals.push(msg);
    });

    // 실제 변경: 방 열기 -> change 신호가 와야 한다.
    const open = await fetch(`${baseUrl}/api/chats/direct`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: a.cookie },
      body: JSON.stringify({ targetId: b.userId }),
    });
    const chatId = ((await open.json()) as { chatId: string }).chatId;

    await new Promise((r) => setTimeout(r, 300));
    expect(signals.some((s) => s.scope === 'chats')).toBe(true);

    // no-op: 읽을 것이 없는 markRead 는 신호를 내지 않는다.
    const before = signals.length;
    await fetch(`${baseUrl}/api/chats/${chatId}/read`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: a.cookie },
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(signals.length).toBe(before);

    socket.close();
  });
});
