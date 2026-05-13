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

  /** Google Gemini API key (for /ask filter stage). Empty disables filter — all questions go straight to Grok. */
  GEMINI_API_KEY: z.string().default(''),
  /** Gemini Flash model for the cheap filter. */
  AKI_FILTER_MODEL: z.string().default('gemini-2.0-flash'),
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
