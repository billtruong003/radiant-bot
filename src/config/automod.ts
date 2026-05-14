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

/**
 * Link policy (Phase 11.2 post-deploy 2026-05-14 — Bill request):
 *   - 'permissive' (default): users free-post any link. Block only when
 *     the host is in `linkBlacklist`, is a known URL shortener, or its
 *     TLD is in `linkSuspectTlds`. Whitelisted hosts always pass.
 *     Fits a server where the moderation overhead of a strict allowlist
 *     felt heavier than the spam risk.
 *   - 'strict': legacy mode — only whitelisted hosts pass; everything
 *     else is deleted. Use when raid risk spikes.
 *
 * `linkBlacklist`, `linkShorteners`, `linkSuspectTlds` default to a
 * conservative built-in list when the JSON omits them, so an existing
 * config file without these keys still works.
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
  linkPolicy: z.enum(['permissive', 'strict']).default('permissive'),
  linkWhitelist: z.array(z.string()),
  linkBlacklist: z.array(z.string()).default([]),
  linkShorteners: z
    .array(z.string())
    .default([
      'bit.ly',
      'tinyurl.com',
      't.co',
      'ow.ly',
      'is.gd',
      'goo.gl',
      'buff.ly',
      'rebrand.ly',
      'shorturl.at',
      'cutt.ly',
      'rb.gy',
      's.id',
    ]),
  linkSuspectTlds: z
    .array(z.string())
    .default(['tk', 'ml', 'ga', 'cf', 'gq', 'top', 'click', 'download', 'work', 'loan', 'review']),
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
