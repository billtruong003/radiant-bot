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

  // --- Aki AI helper (Phase 10; moved to free-tier models in Phase 15) ---
  /**
   * @deprecated Phase 15 — xAI Grok was cut. Nothing reads this any more;
   * Aki answers via the free-model chains in `llm/router.ts`. Kept only so
   * an existing .env with the key still parses. Safe to delete once every
   * deployment has dropped the line.
   */
  XAI_API_KEY: z.string().default(''),
  /**
   * Max output tokens per Aki answer. Raised from 600 in Phase 15: models
   * are free now, so the budget is sized for usefulness (long
   * explanations, code blocks — replies get chunked across messages past
   * Discord's 2000-char limit) instead of for price. Reasoning models on
   * the hard chain also spend part of this on hidden chain-of-thought.
   */
  AKI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(2000),
  /**
   * Server-wide daily cost cap. Effectively inert since Phase 15 (every
   * call costs 0), kept so the admin/analytics surfaces keep working and
   * a paid model can be re-introduced safely.
   */
  AKI_DAILY_BUDGET_USD: z.coerce.number().nonnegative().default(2.0),

  /** Google Gemini API key (LLM router fallback provider). Empty = skip in router fallback chain. */
  GEMINI_API_KEY: z.string().default(''),

  /** Groq API key (LLM router primary provider). Free tier 30 RPM / 14.4K RPD for 8B. Empty = router falls back to Gemini. */
  GROQ_API_KEY: z.string().default(''),

  /** OpenCode Zen API key (LLM router extra free-model provider, OpenAI-compat). Empty = skip in router fallback chain. */
  OPENCODE_ZEN_API_KEY: z.string().default(''),

  // --- Phase 15: member knowledge base ---
  /**
   * Infer per-member character sketches from recent public chat and post
   * a digest to #bot-log. Off by default — it profiles real people, so it
   * should be an explicit opt-in per deployment.
   */
  MEMBER_PROFILING_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * Cron for the learn-and-infer run, VN timezone. Daily at 09:00 per
   * Bill's call — the knowledge base should track how people actually
   * change. Activity ANALYTICS is the weekly job (see
   * GROUP_ANALYTICS_CRON); this one is the daily learning pass.
   */
  MEMBER_PROFILING_CRON: z.string().default('0 9 * * *'),
  /**
   * Weekly activity analytics digest (who is active, who went quiet, how
   * the group is trending). Sunday 20:00 VN — lands with the weekly
   * leaderboard so the sect leaders get one review moment, not two.
   */
  GROUP_ANALYTICS_CRON: z.string().default('0 20 * * 0'),

  // --- Phase 16: searchable message archive ---
  /**
   * Store message bodies in a SQLite archive so staff can search "what did
   * X say about Y". Off by default — this is chat surveillance of real
   * people and must be an explicit choice per deployment.
   */
  ARCHIVE_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * Days to keep archived messages. Rows older than this are deleted
   * nightly. Keeping chat forever is a liability, not a feature.
   */
  ARCHIVE_RETENTION_DAYS: z.coerce.number().int().positive().default(90),

  // --- Phase 18: web lookup ---
  /**
   * Tavily API key. Empty = Aki has no internet access and simply never
   * runs a web lookup (she still answers from training data + server
   * context). Shared with the Lucy stack.
   */
  TAVILY_API_KEY: z.string().default(''),

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

  // --- Lucy agent control API (Lucy hub điều khiển Aki) ---
  /**
   * HMAC secret cho POST /api/agent/* (Lucy → Aki: post báo cáo vào kênh,
   * tạo kênh/thread). Empty = endpoint tắt (503). Chia sẻ với Lucy hub.
   */
  AGENT_HMAC_SECRET: z.string().default(''),
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
