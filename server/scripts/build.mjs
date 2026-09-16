import { copyFile, mkdir, rm } from 'node:fs/promises';
import { build } from 'esbuild';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  target: 'node22',
  outfile: 'dist/server.js',
  sourcemap: true,
});

await copyFile('src/db/schema.sql', 'dist/schema.sql');
