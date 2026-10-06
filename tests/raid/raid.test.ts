import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setStoreForTesting } from '../../src/db/index.js';
import { Store } from '../../src/db/store.js';
import type { User } from '../../src/db/types.js';
import { assignDailyQuest, getTodayQuests } from '../../src/modules/quests/daily-quest.js';
import {
  IDLE_CAP_MS,
  RAID_DAILY_CAP,
  capLoot,
  killsFor,
  killsPerHour,
  lootFor,
  partyPower,
} from '../../src/modules/raid/engine.js';
import {
  BOSS_HP,
  changeRaid,
  claimRaid,
  getBoss,
  onBossKilled,
  raidView,
  weekOf,
} from '../../src/modules/raid/service.js';
import { mkTmpDir } from '../helpers/tmp-dir.js';

describe('raid engine', () => {
  it('stalls below 0.8 power ratio and caps idle time at 8 hours', () => {
    expect(killsPerHour(0.79)).toBe(0);
    expect(killsPerHour(1)).toBe(36);
    expect(killsFor(1, IDLE_CAP_MS * 3)).toBe(killsFor(1, IDLE_CAP_MS));
    expect(killsFor(1, 30 * 60_000)).toBe(18);
  });

  it('companions add half their power, at most two', () => {
    expect(partyPower(1000, [400, 600, 800])).toBe(1000 + 0.5 * (800 + 600));
  });

  it('daily cap keeps loot inside the limit', () => {
    const taken = {
      xp: RAID_DAILY_CAP.xp - 50,
      pills: RAID_DAILY_CAP.pills - 1,
      coins: RAID_DAILY_CAP.coins - 10,
    };
    const { paid, capped } = capLoot(lootFor(3, 10, 1000), taken);
    expect(paid).toEqual({ xp: 50, pills: 1, coins: 10 });
    expect(capLoot(lootFor(3, 10, 1000), RAID_DAILY_CAP).paid).toEqual({
      xp: 0,
      pills: 0,
      coins: 0,
    });
    expect(capped).toBe(true);
  });

  it('weeks start on Monday', () => {
    const mon = Date.parse('2026-10-05T10:00:00+07:00');
    const sun = Date.parse('2026-10-11T23:00:00+07:00');
    const nextMon = Date.parse('2026-10-12T01:00:00+07:00');
    expect(weekOf(mon)).toBe(weekOf(sun));
    expect(weekOf(nextMon)).toBe(weekOf(mon) + 7);
  });
});

describe('raid service', () => {
  let store: Store;
  let cleanup: () => Promise<void>;
  const T0 = Date.parse('2026-10-06T08:00:00+07:00');

  const user = (id: string, level: number, rank: string): User =>
    ({
      discord_id: id,
      username: id,
      display_name: null,
      xp: 0,
      level,
      cultivation_rank: rank,
      pills: 0,
      contribution_points: 0,
    }) as unknown as User;

  beforeEach(async () => {
    const tmp = await mkTmpDir('raid');
    cleanup = tmp.cleanup;
    store = new Store({ dataDir: tmp.dir, snapshotIntervalMs: 99_999_999, fsync: false });
    await store.init();
    __setStoreForTesting(store);
    await store.users.set(user('u1', 20, 'truc_co'));
    await store.users.set(user('u2', 30, 'truc_co'));
  });
  afterEach(async () => {
    __setStoreForTesting(null);
    await store.shutdown();
    await cleanup();
  });

  it('earns while away, pays on claim, then starts counting again', async () => {
    await changeRaid('u1', { zone: 'thanh-moc-lam', floor: 1 }, T0);
    const v = raidView('u1', T0 + 2 * 3600_000);
    expect(v.pendingKills).toBeGreaterThan(0);
    const r = await claimRaid('u1', T0 + 2 * 3600_000);
    expect(r.kills).toBe(v.pendingKills);
    expect(store.users.get('u1')?.contribution_points).toBe(r.loot.coins);
    expect(raidView('u1', T0 + 2 * 3600_000).pendingKills).toBe(0);
    expect(r.clearedFloor).toBe(true);
    expect(raidView('u1', T0 + 2 * 3600_000).canUp).toBe(true);
  });

  it('locks zones above the realm and floors above best + 1', async () => {
    expect(await changeRaid('u1', { zone: 'thiet-ky-thanh' }, T0)).toEqual({
      ok: false,
      error: 'zone-locked',
    });
    expect(await changeRaid('u1', { zone: 'lang-coc', floor: 3 }, T0)).toEqual({
      ok: false,
      error: 'floor-locked',
    });
    expect(await changeRaid('u1', { companions: ['u1'] }, T0)).toEqual({
      ok: false,
      error: 'bad-companion',
    });
    expect((await changeRaid('u1', { companions: ['u2'] }, T0)).ok).toBe(true);
    expect(raidView('u1', T0).companions.map((c) => c.id)).toEqual(['u2']);
  });

  it('counts kills toward the slay quest and damages the weekly boss', async () => {
    await assignDailyQuest('u1', T0);
    await changeRaid('u1', { zone: 'thanh-moc-lam', floor: 1 }, T0);
    const r = await claimRaid('u1', T0 + 8 * 3600_000);
    const slay = getTodayQuests('u1', T0 + 8 * 3600_000).find(
      (q) => q.quest_type === 'slay_monsters',
    );
    expect(slay?.progress).toBe(Math.min(r.kills, slay?.target ?? 0));
    expect(getBoss(T0).hp).toBe(BOSS_HP - (r.boss?.damage ?? 0));
  });

  it('rewards contributors once when the boss falls', async () => {
    const killed: string[][] = [];
    onBossKilled((_b, rewarded) => {
      killed.push(rewarded);
    });
    await store.users.set(user('big', 5000, 'tien_nhan'));
    await changeRaid('big', { zone: 'thanh-moc-lam', floor: 1 }, T0);
    const e = store.events.get('raid:big');
    if (!e) throw new Error('no raid');
    await store.events.set({
      ...e,
      metadata: {
        ...(e.metadata ?? {}),
        zone: 'thiet-ky-thanh',
        floor: 10,
        best: { 'thiet-ky-thanh': 10 },
      },
    });
    for (let d = 0; d < 6 && getBoss(T0).killed_at === null; d++)
      await claimRaid('big', T0 + (d + 1) * 8 * 3600_000);
    expect(getBoss(T0).killed_at).not.toBeNull();
    expect(killed).toEqual([['big']]);
  });
});
