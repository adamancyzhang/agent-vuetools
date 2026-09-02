import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 120_000,
    fileParallelism: false,
  },
  resolve: {
    // esbuild embeds probe.js as a text constant (loader: {'.js': 'text'});
    // vitest gets the same effect via vite's ?raw query. The alias key is
    // the exact specifier used in src/probe/index.ts.
    alias: {
      './probe': resolve('src/probe/probe.js') + '?raw',
    },
  },
});
