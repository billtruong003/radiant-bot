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
