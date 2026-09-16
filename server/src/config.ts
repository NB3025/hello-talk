/**
 * 서버 설정은 환경변수에서 온다. 로컬 개발이 별도 설정 없이 바로 돌도록
 * 합리적인 기본값을 둔다. 기본값은 scripts/db.sh 가 띄우는 Postgres 와 맞춘다.
 *
 * DB 접속은 두 형태를 받는다:
 *  - 운영/도커 로컬: DATABASE_URL (TCP, postgres://...) — 표준 경로.
 *  - 테스트: PGHOST 에 유닉스 소켓 디렉터리를 주면 소켓으로 붙는다.
 *    (샌드박스에서 TCP 루프백이 막혀 있어 테스트는 자식 프로세스 + 소켓으로 돈다.)
 */

export interface ServerConfig {
  port: number;
  host: string;
  databaseUrl: string;
  cookieSecret: string;
  /** true 면 dev 전용 seed/reset 엔드포인트를 연다. 운영에서는 반드시 꺼 둔다. */
  devTools: boolean;
}

const DEFAULT_DATABASE_URL = 'postgres://postgres:postgres@127.0.0.1:5432/hello_talk';

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): ServerConfig => {
  const port = Number(env.PORT ?? 5311);
  return {
    port: Number.isFinite(port) ? port : 5311,
    host: env.HOST ?? '127.0.0.1',
    databaseUrl: env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    // 세션 쿠키 서명용. 운영에서는 반드시 환경변수로 주입한다.
    cookieSecret: env.COOKIE_SECRET ?? 'dev-only-insecure-cookie-secret-change-me',
    devTools: env.DEV_TOOLS === '1' || env.NODE_ENV === 'test',
  };
};
