// Vitest setup: provides fake env vars BEFORE any production module is
// imported so `src/config/env.ts`'s top-level `parseEnv()` doesn't fail.
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = '000000000000000000';
process.env.DISCORD_GUILD_ID = '000000000000000000';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'warn';
process.env.WAL_FSYNC = 'false';
// DATA_DIR defaults to ./data but tests construct their own dirs per-test
// under tests/.tmp/. The default is unused in tests.

// Vitest/Vite loads the repo's real `.env` into process.env, so the LIVE
// provider keys leak into the test process. That made `isFilterEnabled()`
// return true when tests assert the no-keys/disabled path, and it means a
// bug could send real API traffic from a test run. Force every external
// provider credential empty; suites that need a provider mock the module.
process.env.XAI_API_KEY = '';
process.env.GROQ_API_KEY = '';
process.env.GEMINI_API_KEY = '';
process.env.OPENCODE_ZEN_API_KEY = '';
