import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['./test/globalSetup.ts'],
    // 테스트 파일들이 같은 DB 를 공유하므로 한 프로세스에서 순차 실행한다.
    // (파일마다 자기 스코프의 데이터를 만들어 격리하되, TRUNCATE 경쟁을 피한다.)
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
