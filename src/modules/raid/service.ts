import { rankIndex } from '../../config/cultivation.js';
import { getStore } from '../../db/index.js';
import type { SectEvent } from '../../db/types.js';
import { logger } from '../../utils/logger.js';
import { resolveEquippedSlots } from '../combat/equipment-resolver.js';
import { computeCombatPower } from '../combat/power.js';
import { incrementProgress, vnDayStart } from '../quests/daily-quest.js';
import {
  CLEAR_RATIO,
  IDLE_CAP_MS,
  MAX_COMPANIONS,
  RAID_DAILY_CAP,
  type RaidLoot,
  bossDamage,
  capLoot,
  killsFor,
  killsPerHour,
  lootFor,
  monsterPower,
  partyPower,
  zoneIndex,
} from './engine.js';
import { FLOORS, ZONES, type ZoneDef, zoneById } from './zones.js';

/**
 * Bí cảnh state per member and the weekly boss, kept in the events
 * collection (ids `raid:<discordId>` and `boss:<week>`), so restarts and
 * snapshots carry them without a new collection.
 */

export interface RaidMeta {
  kind: 'raid';
  discord_id: string;
  zone: string;
  floor: number;
  /** Highest floor cleared per zone (the next one is open). */
  best: Record<string, number>;
  /** When the current run started counting (last claim or change). */
  since: number;
  companions: string[];
  /** VN day the `taken` totals belong to. */
  day: number;
  taken: RaidLoot;
  total_kills: number;
}

export interface BossMeta {
  kind: 'boss';
  week: number;
  name: string;
  max_hp: number;
  hp: number;
  contributors: Record<string, number>;
  killed_at: number | null;
}

export const BOSS_HP = 200_000;
export const BOSS_NAMES = ['Cửu Vĩ Yêu Hồ', 'Hắc Long Vương', 'Huyết Ma Tôn', 'Thạch Cự Nhân'];
export const BOSS_REWARD = { xp: 300, pills: 5, coins: 100 } as const;
/** Share of the boss's HP a member must have dealt to be rewarded. */
export const BOSS_MIN_SHARE = 0.01;

const raidId = (discordId: string) => `raid:${discordId}`;

function powerOf(discordId: string): number {
  const user = getStore().users.get(discordId);
  if (!user) return 0;
  const s = resolveEquippedSlots(discordId);
  return computeCombatPower(user, s.congPhap, s.phapKhi, s.nhan, s.weapon);
}

export function openZones(discordId: string): ZoneDef[] {
  const rank = getStore().users.get(discordId)?.cultivation_rank ?? 'pham_nhan';
  return ZONES.filter((z) => rankIndex(rank) >= rankIndex(z.minRank));
}

export function getRaid(discordId: string, now = Date.now()): RaidMeta {
  const e = getStore().events.get(raidId(discordId));
  const m = e?.metadata as RaidMeta | null | undefined;
  if (m?.kind === 'raid') return m;
  return {
    kind: 'raid',
    discord_id: discordId,
    zone: ZONES[0]?.id ?? 'thanh-moc-lam',
    floor: 1,
    best: {},
    since: now,
    companions: [],
    day: vnDayStart(now),
    taken: { xp: 0, pills: 0, coins: 0 },
    total_kills: 0,
  };
}

async function saveRaid(m: RaidMeta, now: number): Promise<void> {
  const store = getStore();
  const id = raidId(m.discord_id);
  const e = store.events.get(id);
  const ev: SectEvent = e ?? {
    id,
    name: 'Bí cảnh',
    type: 'custom',
    started_at: now,
    ended_at: null,
    metadata: null,
  };
  await store.events.set({ ...ev, metadata: { ...m } });
}

export interface RaidView {
  meta: RaidMeta;
  zone: ZoneDef;
  zoneIndex: number;
  leaderPower: number;
  power: number;
  monsterPower: number;
  ratio: number;
  killsPerHour: number;
  elapsedMs: number;
  idleCapped: boolean;
  pendingKills: number;
  pendingLoot: RaidLoot;
  dayCapped: boolean;
  canUp: boolean;
  canDown: boolean;
  companions: { id: string; name: string; power: number }[];
}

export function raidView(discordId: string, now = Date.now()): RaidView {
  const meta = getRaid(discordId, now);
  const zone = zoneById(meta.zone) ?? (ZONES[0] as ZoneDef);
  const zi = zoneIndex(zone.id);
  const leader = powerOf(discordId);
  const store = getStore();
  const companions = meta.companions
    .map((id) => {
      const u = store.users.get(id);
      return u ? { id, name: u.display_name ?? u.username, power: powerOf(id) } : null;
    })
    .filter((c): c is { id: string; name: string; power: number } => c !== null);
  const power = partyPower(
    leader,
    companions.map((c) => c.power),
  );
  const mp = monsterPower(zone, meta.floor);
  const ratio = mp > 0 ? power / mp : 0;
  const elapsed = Math.max(0, now - meta.since);
  const kills = killsFor(ratio, elapsed);
  const taken = meta.day === vnDayStart(now) ? meta.taken : { xp: 0, pills: 0, coins: 0 };
  const { paid, capped } = capLoot(lootFor(zi, meta.floor, kills), taken);
  return {
    meta,
    zone,
    zoneIndex: zi,
    leaderPower: leader,
    power,
    monsterPower: mp,
    ratio,
    killsPerHour: killsPerHour(ratio),
    elapsedMs: Math.min(elapsed, IDLE_CAP_MS),
    idleCapped: elapsed >= IDLE_CAP_MS,
    pendingKills: kills,
    pendingLoot: paid,
    dayCapped: capped,
    canUp: meta.floor < FLOORS && meta.floor <= (meta.best[zone.id] ?? 0),
    canDown: meta.floor > 1,
    companions,
  };
}

export interface ClaimReport {
  kills: number;
  loot: RaidLoot;
  dayCapped: boolean;
  elapsedMs: number;
  zone: ZoneDef;
  floor: number;
  clearedFloor: boolean;
  boss: { name: string; damage: number; hp: number; maxHp: number; killedNow: boolean } | null;
}

type BossHook = (boss: BossMeta, rewarded: string[]) => Promise<void> | void;
const bossHooks: BossHook[] = [];
export function onBossKilled(h: BossHook): void {
  bossHooks.push(h);
}

/** Collects what the idle run earned so far and restarts the count. */
export async function claimRaid(discordId: string, now = Date.now()): Promise<ClaimReport> {
  const v = raidView(discordId, now);
  const meta = { ...v.meta };
  const today = vnDayStart(now);
  if (meta.day !== today) {
    meta.day = today;
    meta.taken = { xp: 0, pills: 0, coins: 0 };
  }
  meta.taken = {
    xp: meta.taken.xp + v.pendingLoot.xp,
    pills: meta.taken.pills + v.pendingLoot.pills,
    coins: meta.taken.coins + v.pendingLoot.coins,
  };
  meta.total_kills += v.pendingKills;
  meta.since = now;
  const cleared = v.pendingKills > 0 && v.ratio >= CLEAR_RATIO;
  if (cleared)
    meta.best = { ...meta.best, [v.zone.id]: Math.max(meta.best[v.zone.id] ?? 0, meta.floor) };
  await saveRaid(meta, now);

  const store = getStore();
  const user = store.users.get(discordId);
  if (user && (v.pendingLoot.pills || v.pendingLoot.coins)) {
    await store.users.set({
      ...user,
      pills: (user.pills ?? 0) + v.pendingLoot.pills,
      contribution_points: (user.contribution_points ?? 0) + v.pendingLoot.coins,
    });
  }
  if (user && v.pendingLoot.xp > 0) {
    const { awardXp } = await import('../leveling/tracker.js');
    await awardXp({
      discordId,
      username: user.username,
      displayName: user.display_name,
      amount: v.pendingLoot.xp,
      source: 'event',
      metadata: { raid: v.zone.id, floor: meta.floor, kills: v.pendingKills },
    });
  }
  if (v.pendingKills > 0) await incrementProgress(discordId, 'slay_monsters', v.pendingKills, now);

  let boss: ClaimReport['boss'] = null;
  if (v.pendingKills > 0) {
    const dmg = bossDamage(v.zoneIndex, meta.floor, v.pendingKills);
    boss = await hitBoss(discordId, dmg, now);
  }
  logger.info(
    {
      discord_id: discordId,
      zone: v.zone.id,
      floor: meta.floor,
      kills: v.pendingKills,
      ...v.pendingLoot,
    },
    'raid: claimed',
  );
  return {
    kills: v.pendingKills,
    loot: v.pendingLoot,
    dayCapped: v.dayCapped,
    elapsedMs: v.elapsedMs,
    zone: v.zone,
    floor: meta.floor,
    clearedFloor: cleared,
    boss,
  };
}

export type RaidChangeError = 'zone-locked' | 'floor-locked' | 'bad-companion';

/** Moves the party; collects first so nothing earned is lost. */
export async function changeRaid(
  discordId: string,
  change: { zone?: string; floor?: number; companions?: string[] },
  now = Date.now(),
): Promise<{ ok: true; report: ClaimReport } | { ok: false; error: RaidChangeError }> {
  const current = getRaid(discordId, now);
  const zone = change.zone ? zoneById(change.zone) : zoneById(current.zone);
  if (!zone || !openZones(discordId).some((z) => z.id === zone.id))
    return { ok: false, error: 'zone-locked' };
  const best = current.best[zone.id] ?? 0;
  const floor = change.floor ?? (change.zone && change.zone !== current.zone ? 1 : current.floor);
  if (!Number.isInteger(floor) || floor < 1 || floor > Math.min(FLOORS, best + 1))
    return { ok: false, error: 'floor-locked' };
  let companions = current.companions;
  if (change.companions) {
    const store = getStore();
    const uniq = [...new Set(change.companions)];
    if (uniq.length > MAX_COMPANIONS || uniq.some((id) => id === discordId || !store.users.get(id)))
      return { ok: false, error: 'bad-companion' };
    companions = uniq;
  }
  const report = await claimRaid(discordId, now);
  const after = getRaid(discordId, now);
  await saveRaid({ ...after, zone: zone.id, floor, companions, since: now }, now);
  return { ok: true, report };
}

// ---------------------------------------------------------------- weekly boss

/** Monday 00:00 VN of the week holding `now`, as a day number. */
export function weekOf(now: number): number {
  // vnDayStart is VN midnight (17:00 UTC the day before); +7 h lands on the VN date.
  const day = Math.round((vnDayStart(now) + 7 * 3_600_000) / 86_400_000);
  // 1970-01-01 was a Thursday: shift so weeks start on Monday.
  return day - ((day + 3) % 7);
}

export function getBoss(now = Date.now()): BossMeta {
  const week = weekOf(now);
  const e = getStore().events.get(`boss:${week}`);
  const m = e?.metadata as BossMeta | null | undefined;
  if (m?.kind === 'boss') return m;
  return {
    kind: 'boss',
    week,
    name: BOSS_NAMES[week % BOSS_NAMES.length] ?? 'Yêu Vương',
    max_hp: BOSS_HP,
    hp: BOSS_HP,
    contributors: {},
    killed_at: null,
  };
}

async function hitBoss(
  discordId: string,
  damage: number,
  now: number,
): Promise<ClaimReport['boss']> {
  const boss = getBoss(now);
  if (boss.killed_at !== null || damage <= 0)
    return { name: boss.name, damage: 0, hp: boss.hp, maxHp: boss.max_hp, killedNow: false };
  const dealt = Math.min(damage, boss.hp);
  const next: BossMeta = {
    ...boss,
    hp: boss.hp - dealt,
    contributors: {
      ...boss.contributors,
      [discordId]: (boss.contributors[discordId] ?? 0) + dealt,
    },
  };
  const killedNow = next.hp <= 0;
  if (killedNow) next.killed_at = now;
  const store = getStore();
  const id = `boss:${boss.week}`;
  const e = store.events.get(id);
  await store.events.set({
    ...(e ?? {
      id,
      name: `Boss tuần: ${boss.name}`,
      type: 'custom',
      started_at: now,
      ended_at: null,
      metadata: null,
    }),
    ended_at: killedNow ? now : null,
    metadata: { ...next },
  });
  if (killedNow) await rewardBoss(next);
  return { name: next.name, damage: dealt, hp: next.hp, maxHp: next.max_hp, killedNow };
}

async function rewardBoss(boss: BossMeta): Promise<void> {
  const store = getStore();
  const rewarded = Object.entries(boss.contributors)
    .filter(([, dmg]) => dmg >= boss.max_hp * BOSS_MIN_SHARE)
    .map(([id]) => id);
  const { awardXp } = await import('../leveling/tracker.js');
  for (const id of rewarded) {
    const u = store.users.get(id);
    if (!u) continue;
    await store.users.set({
      ...u,
      pills: (u.pills ?? 0) + BOSS_REWARD.pills,
      contribution_points: (u.contribution_points ?? 0) + BOSS_REWARD.coins,
    });
    await awardXp({
      discordId: id,
      username: u.username,
      displayName: u.display_name,
      amount: BOSS_REWARD.xp,
      source: 'event',
      metadata: { boss: boss.week },
    });
  }
  logger.info({ week: boss.week, rewarded: rewarded.length }, 'raid: weekly boss killed');
  for (const h of bossHooks) {
    try {
      await h(boss, rewarded);
    } catch (err) {
      logger.error({ err }, 'raid: boss hook failed');
    }
  }
}

export { RAID_DAILY_CAP };
