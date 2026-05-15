import { z } from 'zod';

const envSchema = z.object({
  ARENA_PORT: z.coerce.number().int().positive().default(2567),
  ARENA_HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Shared with bot — must be IDENTICAL hex strings
  ARENA_TOKEN_SECRET: z.string().min(1, 'ARENA_TOKEN_SECRET required (must match bot)'),
  ARENA_RESULT_SECRET: z.string().min(1, 'ARENA_RESULT_SECRET required (must match bot)'),

  BOT_RESULT_URL: z.string().default('http://localhost:3030/api/arena/result'),

  MAX_CONCURRENT_ROOMS: z.coerce.number().int().positive().default(5),
  JOIN_DEADLINE_MS: z.coerce.number().int().positive().default(300_000),
  TURN_DEADLINE_MS: z.coerce.number().int().positive().default(30_000),
  COUNTDOWN_MS: z.coerce.number().int().positive().default(3000),
  ANIMATION_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  DISCONNECT_GRACE_MS: z.coerce.number().int().positive().default(30_000),
  RESULT_DISPOSE_DELAY_MS: z.coerce.number().int().positive().default(10_000),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    console.error(`[env] invalid environment:\n${issues}`);
    process.exit(1);
  }
  return parsed.data;
}

export const env: Env = parseEnv();
