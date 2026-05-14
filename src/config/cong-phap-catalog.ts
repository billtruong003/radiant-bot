import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { CongPhap, CongPhapRarity, CultivationRankId } from '../db/types.js';

const itemSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  rarity: z.enum(['common', 'rare', 'epic', 'legendary']),
  cost_pills: z.number().int().nonnegative(),
  cost_contribution: z.number().int().nonnegative(),
  combat_power: z.number().int().positive(),
  min_rank_required: z.string().nullable(),
});

const catalogSchema = z.object({
  $schema: z.string(),
  items: z.array(itemSchema),
});

export type CongPhapCatalogEntry = CongPhap;

let cached: CongPhapCatalogEntry[] | null = null;

export async function loadCongPhapCatalog(): Promise<CongPhapCatalogEntry[]> {
  if (cached) return cached;
  const url = new URL('./cong-phap-catalog.json', import.meta.url);
  const raw = await readFile(fileURLToPath(url), 'utf-8');
  const parsed = catalogSchema.parse(JSON.parse(raw));
  const now = Date.now();
  cached = parsed.items.map(
    (it, idx): CongPhap => ({
      id: `seed-${it.slug}`,
      slug: it.slug,
      name: it.name,
      description: it.description,
      rarity: it.rarity as CongPhapRarity,
      cost_pills: it.cost_pills,
      cost_contribution: it.cost_contribution,
      stat_bonuses: { combat_power: it.combat_power },
      min_rank_required: it.min_rank_required as CultivationRankId | null,
      created_at: now + idx,
    }),
  );
  return cached;
}

export function __resetCongPhapCatalogCacheForTesting(): void {
  cached = null;
}
