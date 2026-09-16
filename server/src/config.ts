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
  /**
   * 브라우저에서 크로스 오리진으로 붙는 프런트엔드 주소(들). 클라이언트가
   * credentials:'include' 로 요청하므로 CORS 는 반드시 오리진을 명시해야 한다.
   * 비어 있으면(로컬 동일 오리진) CORS 를 열지 않는다.
   */
  clientOrigins: string[];
  /**
   * 세션 쿠키에 secure 를 붙일지. 운영(HTTPS)에서는 반드시 true.
   * 로컬 dev(http)에서는 false 여야 쿠키가 실려 온다.
   */
  cookieSecure: boolean;
}

const DEFAULT_DATABASE_URL = 'postgres://postgres:postgres@127.0.0.1:5432/hello_talk';

/** 콤마로 구분된 오리진 목록을 정리해 배열로 만든다. */
const parseOrigins = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): ServerConfig => {
  const port = Number(env.PORT ?? 5311);
  const isProd = env.NODE_ENV === 'production';
  // 명시적 플래그가 우선한다. 없으면 운영 환경에서만 secure 를 켠다.
  const cookieSecure =
    env.COOKIE_SECURE === '1' ? true : env.COOKIE_SECURE === '0' ? false : isProd;
  return {
    port: Number.isFinite(port) ? port : 5311,
    host: env.HOST ?? '127.0.0.1',
    databaseUrl: env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    // 세션 쿠키 서명용. 운영에서는 반드시 환경변수로 주입한다.
    cookieSecret: env.COOKIE_SECRET ?? 'dev-only-insecure-cookie-secret-change-me',
    devTools: env.DEV_TOOLS === '1' || env.NODE_ENV === 'test',
    clientOrigins: parseOrigins(env.CLIENT_ORIGIN),
    cookieSecure,
  };
};
