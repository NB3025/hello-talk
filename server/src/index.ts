import { buildApp } from './app';
import { loadConfig } from './config';

/** 프로세스 진입점. 설정을 읽어 서버를 실제 포트에 띄운다. */
const start = async (): Promise<void> => {
  const config = loadConfig();
  const app = buildApp();

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
