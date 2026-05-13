import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    environment: 'node',
    pool: 'threads',
    testTimeout: 15_000,
    hookTimeout: 15_000,
    fileParallelism: true,
  },
});
