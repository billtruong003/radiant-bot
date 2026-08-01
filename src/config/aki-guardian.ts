import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * Guardian config — what Aki punishes, and how hard, on each repeat.
 *
 * The ladder is DELIBERATELY data, not model output. `judgeAndPunish`
 * lets the LLM pick the punishment, which is right for a Tông Chủ typing
 * a free-text sentence but wrong here: the same offence must cost the
 * same thing every time, or "Aki phạt tuỳ hứng" becomes the complaint.
 * The model decides IF someone is guilty; this file decides what happens.
 */

const stepSchema = z.object({
  /** Warning-only rung. Value is the template id shown to the member. */
  warn: z.string().min(1).optional(),
  punishments: z
    .array(z.object({ id: z.string().min(1), severity: z.number().int().positive() }))
    .optional(),
  /** Ban is never automatic — this only asks Bill to confirm. */
  propose_ban: z.boolean().optional(),
});

const categorySchema = z.object({
  name: z.string().min(1),
  ladder: z.array(stepSchema).min(1),
});

const configSchema = z.object({
  $schema: z.string(),
  strike_window_days: z.number().int().positive(),
  /**
   * 0-10. Below this the judge's verdict is discarded. Set high on
   * purpose: in a server where members nickname themselves things like
   * "HẢO HÁN CÓ CÂY HÀNG Ở HÁNG", a false positive costs far more trust
   * than a miss costs safety.
   */
  min_confidence: z.number().int().min(0).max(10),
  categories: z.record(z.string(), categorySchema),
});

export type GuardianStep = z.infer<typeof stepSchema>;
export type GuardianCategory = z.infer<typeof categorySchema>;
export type GuardianConfig = z.infer<typeof configSchema>;

export type GuardianCategoryId = 'insult_owner' | 'weaponise_aki' | 'jailbreak' | 'insult_aki';

export const GUARDIAN_CATEGORY_IDS: readonly GuardianCategoryId[] = [
  'insult_owner',
  'weaponise_aki',
  'jailbreak',
  'insult_aki',
];

let cached: GuardianConfig | null = null;

export async function loadGuardianConfig(): Promise<GuardianConfig> {
  if (cached) return cached;
  const url = new URL('./aki-guardian.json', import.meta.url);
  const raw = await readFile(fileURLToPath(url), 'utf-8');
  cached = configSchema.parse(JSON.parse(raw));
  return cached;
}

/**
 * Rung for the Nth offence (1-based). Past the end of the ladder the last
 * rung repeats — a 9th offence is at least as bad as the 5th.
 */
export function ladderStep(category: GuardianCategory, offenceNumber: number): GuardianStep {
  const idx = Math.min(Math.max(offenceNumber, 1), category.ladder.length) - 1;
  return category.ladder[idx] as GuardianStep;
}

export function __setGuardianConfigForTesting(cfg: GuardianConfig | null): void {
  cached = cfg;
}
