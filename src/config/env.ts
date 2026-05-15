import { z } from 'zod';

const csvIds = z
  .string()
  .default('')
  .transform((s) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter((x) => x.length > 0),
  );

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  DISCORD_CLIENT_ID: z.string().min(1, 'DISCORD_CLIENT_ID is required'),
  DISCORD_GUILD_ID: z.string().min(1, 'DISCORD_GUILD_ID is required'),

  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  DATA_DIR: z.string().default('./data'),
  SNAPSHOT_INTERVAL_MS: z.coerce.number().int().positive().default(3_600_000),
  WAL_FSYNC: z
    .string()
    .default('true')
    .transform((s) => s.toLowerCase() === 'true'),

  ADMIN_USER_IDS: csvIds,

  BACKUP_GITHUB_REPO: z.string().default(''),
  BACKUP_GITHUB_TOKEN: z.string().default(''),

  /** Health-check HTTP port. 0 disables. Default 3030 for prod, 0 for dev. */
  HEALTH_PORT: z.coerce.number().int().nonnegative().default(0),

  // --- Aki AI helper (Phase 10) ---
  /** xAI API key. Empty disables /ask command. Format: xai-... */
  XAI_API_KEY: z.string().default(''),
  /** Model ID. Default: grok-4-1-fast-reasoning ($0.20/$0.50/$0.05 cached per 1M). */
  AKI_MODEL: z.string().default('grok-4-1-fast-reasoning'),
  /** Max output tokens per Aki call. Keep tight for cost — Discord 2000 char limit caps usefulness past ~600 tokens anyway. */
  AKI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(600),
  /** Server-wide cap on Aki cost per VN-calendar-day. Above this, /ask refuses. */
  AKI_DAILY_BUDGET_USD: z.coerce.number().nonnegative().default(2.0),

  /** Google Gemini API key (LLM router fallback provider). Empty = skip in router fallback chain. */
  GEMINI_API_KEY: z.string().default(''),
  /** Legacy: Gemini model for filter. Now per-task in `llm/router.ts`. Kept for Gemini-only single-key mode. */
  AKI_FILTER_MODEL: z.string().default('gemini-2.0-flash'),

  /** Groq API key (LLM router primary provider). Free tier 30 RPM / 14.4K RPD for 8B. Empty = router falls back to Gemini. */
  GROQ_API_KEY: z.string().default(''),

  // --- Phase 12 Lát 9 — docs threads pipeline ---
  /**
   * HMAC secret for POST /api/contribute endpoint. Empty disables the
   * REST endpoint entirely (only /contribute-doc slash works). Bill's
   * personal website signs requests with this secret + sha256.
   */
  DOCS_HMAC_SECRET: z.string().default(''),

  // --- Phase 13 Lát A — Radiant Arena bridge ---
  /**
   * Master feature flag. When false (default), `/arena` slash returns a
   * "not yet enabled" notice, `requestRoom()` returns a mock OK without
   * touching Colyseus, and `/api/arena/result` returns 503. Flip to true
   * only after Colyseus is reachable at ARENA_COLYSEUS_URL.
   */
  ARENA_ENABLED: z
    .string()
    .default('false')
    .transform((s) => s.toLowerCase() === 'true'),
  /** Internal HTTP(S) URL where the Colyseus admin endpoint listens. */
  ARENA_COLYSEUS_URL: z.string().default('http://localhost:2567'),
  /**
   * Shared HMAC secret between bot and Colyseus. Used to sign join tokens
   * (player → Colyseus) AND admin requests (bot → Colyseus). Empty
   * disables outbound calls when ARENA_ENABLED=true (returns error).
   */
  ARENA_TOKEN_SECRET: z.string().default(''),
  /**
   * Shared HMAC secret for inbound result callback (Colyseus → bot's
   * /api/arena/result). Distinct from ARENA_TOKEN_SECRET so a leak on one
   * side doesn't compromise both. Empty disables the endpoint with 503.
   */
  ARENA_RESULT_SECRET: z.string().default(''),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    console.error(`[env] invalid environment variables:\n${issues}`);
    process.exit(1);
  }
  return parsed.data;
}

export const env: Env = parseEnv();
