import { randomBytes } from 'node:crypto';

/**
 * 서버 설정은 환경변수에서 온다. 자격증명은 소스 기본값을 두지 않는다.
 *
 * DB 접속은 두 형태를 받는다:
 *  - 운영: DATABASE_URL (TCP, postgres://...) — 표준 경로.
 *  - 로컬 Docker: DB_PASSWORD 로 루프백 접속 문자열을 조립한다.
 *  - 테스트: PGHOST 에 유닉스 소켓 디렉터리를 주면 소켓으로 붙는다.
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

/** 콤마로 구분된 오리진 목록을 정리해 배열로 만든다. */
const parseOrigins = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);

const localDatabaseUrl = (password: string): string =>
  `postgres://postgres:${encodeURIComponent(password)}@127.0.0.1:5432/hello_talk`;

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): ServerConfig => {
  const rawPort = env.PORT?.trim();
  const port = rawPort ? Number(rawPort) : 5311;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT 는 1~65535 사이의 정수여야 합니다.');
  }

  const isProd = env.NODE_ENV === 'production';
  const clientOrigins = parseOrigins(env.CLIENT_ORIGIN);
  const cookieSecure =
    env.COOKIE_SECURE === '1' ? true : env.COOKIE_SECURE === '0' ? false : isProd;
  if (clientOrigins.length > 0 && !cookieSecure) {
    throw new Error('CLIENT_ORIGIN 을 쓰려면 COOKIE_SECURE=1 이 필요합니다.');
  }

  const databaseUrl =
    env.DATABASE_URL?.trim() ||
    (env.DB_PASSWORD?.trim() ? localDatabaseUrl(env.DB_PASSWORD.trim()) : undefined);
  const usesSocket = env.PGHOST?.startsWith('/') === true;
  if (!databaseUrl && !usesSocket) {
    throw new Error('DATABASE_URL 또는 로컬 개발용 DB_PASSWORD 가 필요합니다.');
  }

  const configuredCookieSecret = env.COOKIE_SECRET?.trim();
  if (isProd && !configuredCookieSecret) {
    throw new Error('운영에서는 COOKIE_SECRET 환경변수가 필요합니다.');
  }
  if (configuredCookieSecret && configuredCookieSecret.length < 32) {
    throw new Error('COOKIE_SECRET 은 32자 이상이어야 합니다.');
  }

  return {
    port,
    host: env.HOST ?? '127.0.0.1',
    // 소켓 접속에서는 makePool 이 PGHOST 를 우선하므로 이 값은 사용되지 않는다.
    databaseUrl: databaseUrl ?? 'postgresql://local-socket',
    // 로컬 개발에서 미지정하면 프로세스마다 새 무작위 키를 만들어 재시작 시 세션을 폐기한다.
    cookieSecret: configuredCookieSecret ?? randomBytes(32).toString('hex'),
    devTools: env.DEV_TOOLS === '1' || env.NODE_ENV === 'test',
    clientOrigins,
    cookieSecure,
  };
};
