import { buildApp } from './app';
import { loadConfig } from './config';
import { makePool, runMigrations } from './db/pool';

/** 프로세스 진입점. 설정을 읽고 DB 를 마이그레이션한 뒤 서버를 띄운다. */
const start = async (): Promise<void> => {
  const config = loadConfig();
  const pool = makePool(config.databaseUrl);
  await runMigrations(pool);

  const app = buildApp({
    pool,
    cookieSecret: config.cookieSecret,
    devTools: config.devTools,
  });

  try {
    await app.listen({ port: config.port, host: config.host });
    // eslint-disable-next-line no-console
    console.log(`hello-talk server listening on http://${config.host}:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

void start();
