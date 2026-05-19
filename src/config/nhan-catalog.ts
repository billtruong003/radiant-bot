import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { CultivationRankId, Nhan, NhanRarity } from '../db/types.js';

/**
 * Nhẫn (ring) catalog loader. Up to 2 nhẫn equipped concurrently via
 * User.equipped_ring_slugs. Same slug cannot occupy two slots — enforced
 * at equip time, not here.
 */

const itemSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  icon: z.string(),
  description: z.string().min(1),
  lore: z.string().min(1),
  rarity: z.enum(['uncommon', 'rare', 'epic', 'legendary']),
  cost_pills: z.number().int().nonnegative(),
  cost_contribution: z.number().int().nonnegative(),
  combat_power: z.number().int().nonnegative(),
  xp_multiplier: z.number().min(0).max(1).nullable().optional(),
  pill_discount: z.number().min(0).max(1).nullable().optional(),
  min_rank_required: z.string().nullable(),
});

const catalogSchema = z.object({
  $schema: z.string(),
  items: z.array(itemSchema),
});

let cached: Nhan[] | null = null;

export async function loadNhanCatalog(): Promise<Nhan[]> {
  if (cached) return cached;
  const url = new URL('./nhan-catalog.json', import.meta.url);
  const raw = await readFile(fileURLToPath(url), 'utf-8');
  const parsed = catalogSchema.parse(JSON.parse(raw));
  const now = Date.now();
  cached = parsed.items.map(
    (it, idx): Nhan => ({
      id: `nhan-${it.slug}`,
      slug: it.slug,
      name: it.name,
      icon: it.icon,
      description: it.description,
      lore: it.lore,
      rarity: it.rarity as NhanRarity,
      cost_pills: it.cost_pills,
      cost_contribution: it.cost_contribution,
      stat_bonuses: {
        combat_power: it.combat_power,
        xp_multiplier: it.xp_multiplier ?? undefined,
        pill_discount: it.pill_discount ?? undefined,
      },
      min_rank_required: (it.min_rank_required as CultivationRankId | null) ?? null,
      created_at: now + idx,
    }),
  );
  return cached;
}

export function __resetNhanCatalogCacheForTesting(): void {
  cached = null;
}
