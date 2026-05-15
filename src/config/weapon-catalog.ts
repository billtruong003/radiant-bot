import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { CultivationRankId, Weapon, WeaponCategory, WeaponTier } from '../db/types.js';

const statsSchema = z.object({
  power: z.number().min(0.5).max(2.0),
  hitbox: z.number().min(0.5).max(1.5),
  bounce: z.number().min(0).max(1),
  damage_base: z.number().int().positive(),
  pierce_count: z.number().int().nonnegative(),
  crit_chance: z.number().min(0).max(1),
  crit_multi: z.number().min(1).max(3),
});

const skillSchema = z.object({
  skill_id: z.string().min(1),
  trigger: z.enum(['passive', 'on_hit', 'on_crit', 'on_low_hp', 'active', 'on_round_start']),
  magnitude: z.number(),
  cooldown: z.number().nonnegative(),
  fx_key: z.string(),
});

const visualSchema = z.object({
  model_prefab_key: z.string().min(1),
  particle_fx_key: z.string(),
  trail_fx_key: z.string(),
  hue: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

const shopSchema = z.object({
  cost_pills: z.number().int().nonnegative(),
  cost_contribution: z.number().int().nonnegative(),
  unlock_realm: z.string().nullable(),
});

const itemSchema = z.object({
  slug: z.string().min(1),
  display_name: z.string().min(1),
  category: z.enum(['blunt', 'pierce', 'spirit']),
  tier: z.enum(['pham', 'dia', 'thien', 'tien']),
  stats: statsSchema,
  skills: z.array(skillSchema),
  visual: visualSchema,
  lore: z.string().min(1),
  shop: shopSchema.nullable(),
});

const catalogSchema = z.object({
  $schema: z.string(),
  items: z.array(itemSchema),
});

let cached: Weapon[] | null = null;

export async function loadWeaponCatalog(): Promise<Weapon[]> {
  if (cached) return cached;
  const url = new URL('./weapon-catalog.json', import.meta.url);
  const raw = await readFile(fileURLToPath(url), 'utf-8');
  const parsed = catalogSchema.parse(JSON.parse(raw));
  const now = Date.now();
  cached = parsed.items.map(
    (it, idx): Weapon => ({
      slug: it.slug,
      display_name: it.display_name,
      category: it.category as WeaponCategory,
      tier: it.tier as WeaponTier,
      stats: it.stats,
      skills: it.skills,
      visual: it.visual,
      lore: it.lore,
      shop: it.shop
        ? {
            cost_pills: it.shop.cost_pills,
            cost_contribution: it.shop.cost_contribution,
            unlock_realm: it.shop.unlock_realm as CultivationRankId | null,
          }
        : null,
      created_at: now + idx,
    }),
  );
  return cached;
}

export function __resetWeaponCatalogCacheForTesting(): void {
  cached = null;
}
