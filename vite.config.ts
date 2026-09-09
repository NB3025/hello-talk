import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 루프백만 바인딩한다 — 이 호스트는 공용이 아니고, 개발 서버를 외부에 열 이유가 없다.
  server: { host: '127.0.0.1', port: 5273, strictPort: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
