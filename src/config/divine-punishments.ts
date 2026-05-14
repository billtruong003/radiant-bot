import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const punishmentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  severity_min: z.number().int().nonnegative(),
  severity_max: z.number().int().positive(),
  description: z.string().min(1),
});

const menuSchema = z.object({
  $schema: z.string(),
  punishments: z.array(punishmentSchema),
  max_punishments_per_judgment: z.number().int().positive().default(3),
});

export type DivinePunishment = z.infer<typeof punishmentSchema>;
export type DivinePunishmentMenu = z.infer<typeof menuSchema>;

let cached: DivinePunishmentMenu | null = null;

export async function loadPunishmentMenu(): Promise<DivinePunishmentMenu> {
  if (cached) return cached;
  const url = new URL('./divine-punishments.json', import.meta.url);
  const raw = await readFile(fileURLToPath(url), 'utf-8');
  cached = menuSchema.parse(JSON.parse(raw));
  return cached;
}

export function __resetMenuCacheForTesting(): void {
  cached = null;
}

export type PunishmentId =
  | 'xp_deduct'
  | 'pill_confiscate'
  | 'contribution_deduct'
  | 'rank_demote_one'
  | 'timeout_minutes'
  | 'cong_phap_strip'
  | 'public_shame';
