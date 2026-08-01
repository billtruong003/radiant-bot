import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { CultivationRankId, PhapKhi, PhapKhiRarity, PhapKhiType } from '../db/types.js';

/**
 * Phap khí (magic treasure) catalog loader. Mirrors weapon-catalog.ts
 * structure: zod-validated, lazy-cached, transforms flat JSON `combat_power`/
 * `duel_damage_bonus` into nested `stat_bonuses` shape per the type contract.
 */

const itemSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  icon: z.string(),
  type: z.enum(['kiem', 'truc', 'canh', 'dinh', 'phan', 'bao']),
  description: z.string().min(1),
  lore: z.string().min(1),
  passive_text: z.string(),
  rarity: z.enum(['rare', 'epic', 'legendary', 'tien_khi']),
  cost_pills: z.number().int().nonnegative(),
  cost_contribution: z.number().int().nonnegative(),
  combat_power: z.number().int().nonnegative(),
  duel_damage_bonus: z.number().int().nonnegative().optional(),
  xp_multiplier: z.number().min(0).max(1).nullable().optional(),
  pill_discount: z.number().min(0).max(1).nullable().optional(),
  min_rank_required: z.string().nullable(),
  visual_aura: z.string().nullable().optional(),
});

const catalogSchema = z.object({
  $schema: z.string(),
  items: z.array(itemSchema),
});

let cached: PhapKhi[] | null = null;

export async function loadPhapKhiCatalog(): Promise<PhapKhi[]> {
  if (cached) return cached;
  const url = new URL('./phap-khi-catalog.json', import.meta.url);
  const raw = await readFile(fileURLToPath(url), 'utf-8');
  const parsed = catalogSchema.parse(JSON.parse(raw));
  const now = Date.now();
  cached = parsed.items.map(
    (it, idx): PhapKhi => ({
      id: `pk-${it.slug}`,
      slug: it.slug,
      name: it.name,
      icon: it.icon,
      type: it.type as PhapKhiType,
      description: it.description,
      lore: it.lore,
      passive_text: it.passive_text,
      rarity: it.rarity as PhapKhiRarity,
      cost_pills: it.cost_pills,
      cost_contribution: it.cost_contribution,
      stat_bonuses: {
        combat_power: it.combat_power,
        xp_multiplier: it.xp_multiplier ?? undefined,
        pill_discount: it.pill_discount ?? undefined,
        duel_damage_bonus: it.duel_damage_bonus,
      },
      min_rank_required: (it.min_rank_required as CultivationRankId | null) ?? null,
      visual_aura: it.visual_aura ?? null,
      created_at: now + idx,
    }),
  );
  return cached;
}

