import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const verificationConfigSchema = z.object({
  thresholds: z.object({
    /** 0 = disable auto-kick; everyone goes through captcha. */
    accountAgeKickDays: z.number().nonnegative(),
    accountAgeSuspectDays: z.number().int().positive(),
    captchaTimeoutMs: z.number().int().positive(),
    captchaMaxAttempts: z.number().int().positive(),
    raidJoinWindowMs: z.number().int().positive(),
    raidJoinThreshold: z.number().int().positive(),
  }),
  botUsernamePatterns: z.array(z.string()),
  captcha: z.object({
    mathMinA: z.number().int().nonnegative(),
    mathMaxA: z.number().int().nonnegative(),
    mathMinB: z.number().int().nonnegative(),
    mathMaxB: z.number().int().nonnegative(),
    imageChars: z.string().min(10),
    imageLength: z.number().int().min(4).max(12),
  }),
});

export type VerificationConfig = z.infer<typeof verificationConfigSchema>;

let cached: VerificationConfig | null = null;

export async function loadVerificationConfig(): Promise<VerificationConfig> {
  if (cached) return cached;
  const url = new URL('./verification.json', import.meta.url);
  const raw = await readFile(fileURLToPath(url), 'utf-8');
  const parsed = verificationConfigSchema.parse(JSON.parse(raw));
  // Pre-compile regex patterns to validate syntax at startup.
  for (const pat of parsed.botUsernamePatterns) {
    new RegExp(pat);
  }
  cached = parsed;
  return parsed;
}
