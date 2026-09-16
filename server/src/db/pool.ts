import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const { Pool } = pg;
export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

/**
 * 접속 설정을 만든다. PGHOST 가 유닉스 소켓 디렉터리(슬래시로 시작)면 소켓으로,
 * 아니면 DATABASE_URL(TCP)로 붙는다. 서버 코드는 어느 쪽인지 몰라도 된다.
 */
export const makePool = (databaseUrl: string): Pool => {
  const sockHost = process.env.PGHOST;
  if (sockHost && sockHost.startsWith('/')) {
    return new Pool({
      host: sockHost,
      user: process.env.PGUSER ?? 'postgres',
      database: process.env.PGDATABASE ?? 'postgres',
      max: 10,
    });
  }
  return new Pool({ connectionString: databaseUrl, max: 10 });
};

const currentDir = dirname(fileURLToPath(import.meta.url));

/**
 * 스키마를 적용한다. schema.sql 은 전부 IF NOT EXISTS 라 여러 번 돌려도 안전하다.
 * 부팅 시와 테스트 setup 에서 같은 함수를 쓴다.
 */
export const runMigrations = async (pool: Pool): Promise<void> => {
  const sql = readFileSync(join(currentDir, 'schema.sql'), 'utf8');
  await pool.query(sql);
};
