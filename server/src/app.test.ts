import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, stopTestApp, type TestContext } from '../test/helpers';

describe('GET /health', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestApp();
  });
  afterAll(async () => {
    await stopTestApp(ctx);
  });

  it('returns 200 with {status:"ok"}', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
