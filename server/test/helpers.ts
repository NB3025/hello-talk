import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { buildApp, resetDatabase, runMigrations } from '../src/app';
import { makePool, type Pool } from '../src/db/pool';

const SOCK_FILE = '/tmp/htpg_test_sock_path';

/** globalSetup 이 띄운 테스트 DB 소켓 경로. */
export const testSocket = (): string => readFileSync(SOCK_FILE, 'utf8').trim();

/** 테스트 DB 에 붙는 pool 을 만든다. PGHOST 를 소켓으로 지정한다. */
export const makeTestPool = (): Pool => {
  process.env.PGHOST = testSocket();
  process.env.PGUSER = 'postgres';
  process.env.PGDATABASE = 'postgres';
  return makePool('unused-when-socket');
};

export const COOKIE_SECRET = 'test-cookie-secret-0123456789abcdef';

export interface TestContext {
  app: FastifyInstance;
  pool: Pool;
}

/** 마이그레이션 후 깨끗한 DB + 앱을 준다. 매 테스트 파일 beforeAll 에서 쓴다. */
export const startTestApp = async (): Promise<TestContext> => {
  const pool = makeTestPool();
  await runMigrations(pool);
  await resetDatabase(pool);
  const app = buildApp({ pool, cookieSecret: COOKIE_SECRET, devTools: true });
  await app.ready();
  return { app, pool };
};

/**
 * 운영 유사 앱(devTools:false, cookieSecure:true, 크로스 오리진 CLIENT_ORIGIN 지정).
 * 기존 DB 는 그대로 쓰되(마이그레이션 재실행 안전) 앱만 다른 설정으로 세운다.
 * 기존 테스트 DB pool 을 재사용하도록 pool 을 인자로 받는다.
 */
export const buildProdLikeApp = (pool: Pool, clientOrigin = 'https://app.example.com'): FastifyInstance =>
  buildApp({
    pool,
    cookieSecret: COOKIE_SECRET,
    devTools: false,
    clientOrigins: [clientOrigin],
    cookieSecure: true,
  });

export const stopTestApp = async (ctx: TestContext): Promise<void> => {
  await ctx.app.close();
  await ctx.pool.end();
};

/** 응답의 Set-Cookie 에서 세션 쿠키 문자열(name=value)을 뽑아 이후 요청에 쓴다. */
export const cookieFromResponse = (setCookie: string | string[] | undefined): string | undefined => {
  if (!setCookie) return undefined;
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  const session = arr.find((c) => c.startsWith('ht_session='));
  if (!session) return undefined;
  return session.split(';')[0];
};

/** 새 사용자를 만들고 세션 쿠키를 돌려준다. */
export const createUserSession = async (
  app: FastifyInstance,
  name: string,
): Promise<{ userId: string; cookie: string }> => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/session',
    payload: { name },
  });
  if (res.statusCode !== 201) throw new Error(`createUser failed: ${res.statusCode} ${res.body}`);
  const cookie = cookieFromResponse(res.headers['set-cookie'] as string | string[] | undefined);
  if (!cookie) throw new Error('no session cookie');
  const userId = res.json().user.id as string;
  return { userId, cookie };
};
