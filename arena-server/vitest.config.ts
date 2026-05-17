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
      // Shorten timers so turn-loop tests run sub-second instead of waiting
      // the real 3s/30s/8s/10s. Production env keeps the spec values.
      // 300ms is large enough to absorb waitForNextPatch latency but small
      // enough to keep total test time under ~2s.
      COUNTDOWN_MS: '300',
      TURN_DEADLINE_MS: '1500',
      ANIMATION_TIMEOUT_MS: '1000',
      RESULT_DISPOSE_DELAY_MS: '200',
    },
    pool: 'threads',
  },
});
