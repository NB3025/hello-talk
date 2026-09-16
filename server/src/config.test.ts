import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const SECRET = '0123456789abcdef0123456789abcdef';

describe('loadConfig', () => {
  it('로컬 DB 비밀번호에서 접속 문자열을 조립하되 소스 기본 비밀번호를 두지 않는다', () => {
    const config = loadConfig({ DB_PASSWORD: 'local p@ssword', COOKIE_SECRET: SECRET });

    expect(config.databaseUrl).toBe(
      'postgres://postgres:local%20p%40ssword@127.0.0.1:5432/hello_talk',
    );
  });

  it('DB 접속 정보가 없으면 조용히 localhost 기본값으로 내려가지 않는다', () => {
    expect(() => loadConfig({ COOKIE_SECRET: SECRET })).toThrow(
      'DATABASE_URL 또는 로컬 개발용 DB_PASSWORD 가 필요합니다.',
    );
  });

  it('운영에서 COOKIE_SECRET 이 없거나 짧으면 부팅을 거절한다', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://db/app' })).toThrow(
      '운영에서는 COOKIE_SECRET 환경변수가 필요합니다.',
    );
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://db/app',
        COOKIE_SECRET: 'too-short',
      }),
    ).toThrow('COOKIE_SECRET 은 32자 이상이어야 합니다.');
  });

  it('크로스 오리진 쿠키를 Secure 없이 구성하지 못하게 한다', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgresql://db/app',
        COOKIE_SECRET: SECRET,
        CLIENT_ORIGIN: 'https://chat.example',
        COOKIE_SECURE: '0',
      }),
    ).toThrow('CLIENT_ORIGIN 을 쓰려면 COOKIE_SECURE=1 이 필요합니다.');
  });

  it('테스트의 유닉스 소켓 접속은 DATABASE_URL 없이 허용한다', () => {
    const config = loadConfig({ PGHOST: '/socket', COOKIE_SECRET: SECRET });

    expect(config.databaseUrl).toBe('postgresql://local-socket');
  });
});
