import Fastify, { type FastifyInstance } from 'fastify';

/**
 * Fastify 인스턴스를 조립한다. 라우트 등록을 여기 모아 두면 테스트가 서버를
 * 실제 포트에 띄우지 않고도 `app.inject` 로 요청을 흉내낼 수 있다.
 *
 * 지금은 헬스체크 하나뿐이다. 비즈니스 엔드포인트·DB 스키마·인증은 FEAT-002 에서 붙인다.
 */
export const buildApp = (): FastifyInstance => {
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
};
