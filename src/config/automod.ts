import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * Automod config — list-based + threshold-based rule tuning. Lives in
 * `automod.json` so edits don't require redeploy. Cached after first
 * read; restart picks up changes.
 *
 * Word lists are intentionally short out-of-the-box — full moderation
 * list is a Phase 9 polish task with iteration based on real traffic.
 */

const automodSchema = z.object({
  thresholds: z.object({
    massMentionCount: z.number().int().positive(),
    capsRatioThreshold: z.number().min(0).max(1),
    capsMinLength: z.number().int().positive(),
    spamDuplicates: z.number().int().positive(),
    spamWindowMs: z.number().int().positive(),
    timeoutDurationMs: z.number().int().positive(),
  }),
  linkWhitelist: z.array(z.string()),
  profanityWords: z.array(z.string()),
});

export type AutomodConfig = z.infer<typeof automodSchema>;

let cached: AutomodConfig | null = null;

export async function loadAutomodConfig(): Promise<AutomodConfig> {
  if (cached) return cached;
  const url = new URL('./automod.json', import.meta.url);
  const raw = await readFile(fileURLToPath(url), 'utf-8');
  cached = automodSchema.parse(JSON.parse(raw));
  return cached;
}

/**
 * Test-only escape hatch to inject a config without reading from disk.
 * Call with `null` to reset.
 */
export function __setAutomodConfigForTesting(config: AutomodConfig | null): void {
  cached = config;
}
