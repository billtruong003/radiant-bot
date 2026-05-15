import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import { getStore } from '../../db/index.js';
import type { UserWeapon, WeaponStats, WeaponVisual } from '../../db/types.js';
import { logger } from '../../utils/logger.js';

/**
 * Phase 13 Lát A — Bản mệnh weapon forge.
 *
 * Deterministic per-Discord-ID weapon generation. Stats and visual seed
 * derived from SHA-256 of the discord_id, mapped into the bản-mệnh range:
 *
 *   power        ∈ [1.00, 1.20]
 *   hitbox       ∈ [1.00, 1.15]
 *   bounce       ∈ [0.45, 0.55]
 *   damage_base  ∈ [18, 22]
 *   pierce_count = 0
 *   crit_chance  ∈ [0.02, 0.08]
 *   crit_multi   = 1.5
 *
 * Stored in `userWeapons` collection with `weapon_slug` =
 * `phap-khi-ban-menh-<discord_id>` and `custom_stats` / `custom_visual`
 * set (catalog lookup will miss — bản mệnh is NOT in weapon_catalog).
 *
 * Idempotent: re-running for the same discord_id returns the existing
 * UserWeapon row (deterministic forge means same stats anyway).
 */

export const BAN_MENH_SLUG_PREFIX = 'phap-khi-ban-menh-';

function hashToInts(discordId: string): number[] {
  // SHA-256 → 32 bytes → 8 × uint32 ints. Plenty of entropy for 7 stat slots.
  const hash = createHash('sha256').update(discordId).digest();
  const out: number[] = [];
  for (let i = 0; i < 8; i++) {
    out.push(hash.readUInt32BE(i * 4));
  }
  return out;
}

/** Map a uint32 to [min, max] inclusive (float). */
function mapRange(value: number, min: number, max: number): number {
  const t = value / 0xffffffff;
  return min + t * (max - min);
}

/** Map a uint32 to [min, max] inclusive (int). */
function mapRangeInt(value: number, min: number, max: number): number {
  return Math.floor(mapRange(value, min, max + 0.9999));
}

function genStats(ints: number[]): WeaponStats {
  return {
    power: Number(mapRange(ints[0] ?? 0, 1.0, 1.2).toFixed(3)),
    hitbox: Number(mapRange(ints[1] ?? 0, 1.0, 1.15).toFixed(3)),
    bounce: Number(mapRange(ints[2] ?? 0, 0.45, 0.55).toFixed(3)),
    damage_base: mapRangeInt(ints[3] ?? 0, 18, 22),
    pierce_count: 0,
    crit_chance: Number(mapRange(ints[4] ?? 0, 0.02, 0.08).toFixed(3)),
    crit_multi: 1.5,
  };
}

function genVisual(discordId: string, ints: number[]): WeaponVisual {
  // Hue picked from 8 distinct ban-mệnh-friendly muted colors.
  const banMenhHues = [
    '#a89bce', // amethyst dream
    '#9c7fbf', // dusk violet
    '#8d9ba8', // steel mist
    '#7c8db5', // dusk indigo
    '#9ec1c4', // misty teal
    '#a89b8d', // driftwood
    '#b09bd3', // iris purple
    '#efb5a3', // blush pink
  ];
  const hueIdx = (ints[5] ?? 0) % banMenhHues.length;
  return {
    model_prefab_key: `weapon_ban_menh_${discordId.slice(-4)}`,
    particle_fx_key: 'fx_ban_menh_aura',
    trail_fx_key: '',
    hue: banMenhHues[hueIdx] ?? '#a89bce',
  };
}

export function deriveBanMenhSlug(discordId: string): string {
  return `${BAN_MENH_SLUG_PREFIX}${discordId}`;
}

/**
 * Deterministic forge. Returns the existing UserWeapon if already
 * forged; otherwise generates + persists.
 */
export async function forgeBanMenh(discordId: string): Promise<UserWeapon> {
  const store = getStore();
  const slug = deriveBanMenhSlug(discordId);

  // Idempotent check: scan userWeapons for existing bản mệnh of this user.
  const existing = store.userWeapons
    .query((uw) => uw.discord_id === discordId && uw.weapon_slug === slug)
    .at(0);
  if (existing) {
    return existing;
  }

  const ints = hashToInts(discordId);
  const stats = genStats(ints);
  const visual = genVisual(discordId, ints);

  const row: UserWeapon = {
    id: ulid(),
    discord_id: discordId,
    weapon_slug: slug,
    custom_stats: stats,
    custom_visual: visual,
    acquired_at: Date.now(),
  };

  await store.userWeapons.set(row);
  logger.info(
    { discord_id: discordId, slug, power: stats.power, damage_base: stats.damage_base },
    'arena: forged bản mệnh weapon',
  );
  return row;
}

/**
 * Compute deterministic stats WITHOUT persisting. Useful for tests and
 * preview UI. forgeBanMenh() is the side-effecting counterpart.
 */
export function previewBanMenh(discordId: string): { stats: WeaponStats; visual: WeaponVisual } {
  const ints = hashToInts(discordId);
  return { stats: genStats(ints), visual: genVisual(discordId, ints) };
}
