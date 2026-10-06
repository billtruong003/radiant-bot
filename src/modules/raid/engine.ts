import { FLOOR_STEP, ZONES, type ZoneDef } from './zones.js';

/**
 * Pure numbers for the bí cảnh. The fight is not simulated hit by hit on
 * the server: given the party's power and the floor's monster power, the
 * kill rate is a closed formula, so an idle run of up to 8 hours is worked
 * out in one step when the player comes back. The web page only animates.
 */

export const IDLE_CAP_MS = 8 * 60 * 60 * 1000;
/** Below this power ratio the party cannot hold the floor: no kills. */
export const STALL_RATIO = 0.8;
/** At least this ratio on a floor unlocks the next one. */
export const CLEAR_RATIO = 1;
export const COMPANION_SHARE = 0.5;
export const MAX_COMPANIONS = 2;

/** Daily raid income cap per member (VN day); tuned in docs/ECONOMY.md. */
export const RAID_DAILY_CAP = { xp: 400, pills: 2, coins: 40 } as const;

export function monsterPower(zone: ZoneDef, floor: number): number {
  return Math.round(zone.basePower * FLOOR_STEP ** (floor - 1));
}

export function partyPower(leaderLc: number, companionLcs: number[]): number {
  const helpers = [...companionLcs].sort((a, b) => b - a).slice(0, MAX_COMPANIONS);
  return Math.round(leaderLc + COMPANION_SHARE * helpers.reduce((s, v) => s + v, 0));
}

export function killsPerHour(ratio: number): number {
  if (ratio < STALL_RATIO) return 0;
  return Math.round(36 * Math.min(ratio, 3) ** 0.6);
}

export function killsFor(ratio: number, elapsedMs: number): number {
  const ms = Math.max(0, Math.min(elapsedMs, IDLE_CAP_MS));
  return Math.floor((killsPerHour(ratio) * ms) / 3_600_000);
}

export interface RaidLoot {
  xp: number;
  pills: number;
  coins: number;
}

/** Loot before the daily cap. Deeper zones and floors pay more per kill. */
export function lootFor(zoneIndex: number, floor: number, kills: number): RaidLoot {
  return {
    xp: Math.floor(kills * (2 + zoneIndex + floor * 0.5)),
    pills: Math.floor((kills * (1 + zoneIndex * 0.2)) / 40),
    coins: Math.floor((kills * (1 + zoneIndex * 0.5)) / 2),
  };
}

/** What is left of today's cap after `taken`. */
export function capLoot(loot: RaidLoot, taken: RaidLoot): { paid: RaidLoot; capped: boolean } {
  const paid = {
    xp: Math.max(0, Math.min(loot.xp, RAID_DAILY_CAP.xp - taken.xp)),
    pills: Math.max(0, Math.min(loot.pills, RAID_DAILY_CAP.pills - taken.pills)),
    coins: Math.max(0, Math.min(loot.coins, RAID_DAILY_CAP.coins - taken.coins)),
  };
  return {
    paid,
    capped: paid.xp < loot.xp || paid.pills < loot.pills || paid.coins < loot.coins,
  };
}

/** Damage a claim deals to the weekly boss. */
export function bossDamage(zoneIndex: number, floor: number, kills: number): number {
  return kills * (zoneIndex + 1) * floor * 2;
}

export const zoneIndex = (id: string): number => ZONES.findIndex((z) => z.id === id);
