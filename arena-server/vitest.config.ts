import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    // Set env BEFORE any test module imports — src/env.ts parses at import
    // time and calls process.exit(1) on missing secrets. Tests may override
    // via process.env.X = '...' in beforeEach.
    env: {
      ARENA_TOKEN_SECRET: 'test_secret_do_not_use_in_prod',
      ARENA_RESULT_SECRET: 'test_result_secret_do_not_use_in_prod',
      ARENA_PORT: '2567',
      ARENA_HOST: 'localhost',
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      ARENA_PUBLIC_WS: 'ws://localhost:2567',
      MAX_CONCURRENT_ROOMS: '5',
    },
  },
});
