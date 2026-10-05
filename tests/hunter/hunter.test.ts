import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../../src/db/store.js';
import type { Hunter, HunterProfile } from '../../src/db/types.js';
import { simulateHunterDuel } from '../../src/modules/hunter/duel.js';
import { createState, readState } from '../../src/modules/hunter/oauth.js';
import { combatFrom, statScore } from '../../src/modules/hunter/power.js';
import { mkTmpDir } from '../helpers/tmp-dir.js';

const profile = (percentiles: number[]): HunterProfile => ({
  login: 'player-one',
  name: null,
  level: 10,
  overall: { rank: 'A', percentile: 0.9 },
  class: { name: 'Holy Knight', element: 'Light' },
  title: null,
  stats: (['STR', 'AGI', 'INT', 'VIT', 'LUK', 'CHA'] as const).map((code, i) => ({
    code,
    source: code,
    value: 10,
    rank: 'A',
    percentile: percentiles[i] ?? 0.5,
  })),
  synced_at: '2026-10-06T00:00:00Z',
});

describe('hunter power', () => {
  it('scores percentiles on the log ladder: bottom 0, EX about 77, top 100', () => {
    expect(statScore(0)).toBe(0);
    expect(statScore(0.9995)).toBeGreaterThanOrEqual(76);
    expect(statScore(0.9995)).toBeLessThanOrEqual(78);
    expect(statScore(1)).toBe(100);
    expect(statScore(0.9)).toBeLessThan(statScore(0.99));
  });

  it('turns stats into duel numbers with caps', () => {
    const top = combatFrom(profile([1, 1, 1, 1, 1, 1]));
    const low = combatFrom(profile([0, 0, 0, 0, 0, 0]));
    expect(top.crit).toBeLessThanOrEqual(35);
    expect(top.evade).toBeLessThanOrEqual(23);
    expect(top.power).toBeGreaterThan(low.power);
    expect(low).toMatchObject({ hp: 300, atk: 30, def: 0, spd: 0, crit: 5, evade: 3 });
  });
});

describe('hunter duel', () => {
  it('is the same for the same seed and ends with a winner', () => {
    const a = { name: 'a', combat: combatFrom(profile([0.9, 0.5, 0.5, 0.9, 0.5, 0.5])) };
    const b = { name: 'b', combat: combatFrom(profile([0.5, 0.9, 0.9, 0.5, 0.9, 0.9])) };
    const first = simulateHunterDuel(a, b, 42);
    expect(simulateHunterDuel(a, b, 42)).toEqual(first);
    expect([0, 1]).toContain(first.winner);
    expect(first.rounds).toBeLessThanOrEqual(10);
    expect(first.hits.every((h) => h.damage >= 0 && h.hpLeft >= 0)).toBe(true);
  });

  it('lets the much stronger hunter win most duels, not all of them by luck', () => {
    const strong = {
      name: 's',
      combat: combatFrom(profile([0.999, 0.99, 0.99, 0.999, 0.99, 0.99])),
    };
    const weak = { name: 'w', combat: combatFrom(profile([0.3, 0.3, 0.3, 0.3, 0.3, 0.3])) };
    let wins = 0;
    for (let seed = 1; seed <= 200; seed++)
      if (simulateHunterDuel(strong, weak, seed).winner === 0) wins++;
    expect(wins).toBeGreaterThan(180);
  });
});

describe('hunter OAuth state', () => {
  it('reads back the member it was made for, once', () => {
    const state = createState('123', 'secret', 1000);
    expect(readState(state, 'secret', 2000)).toBe('123');
    expect(readState(state, 'secret', 2000)).toBeNull();
  });

  it('rejects forged, tampered and expired states', () => {
    const state = createState('123', 'secret', 1000);
    expect(readState(state, 'other-secret', 2000)).toBeNull();
    expect(readState(`${state}x`, 'secret', 2000)).toBeNull();
    expect(readState(createState('456', 'secret', 1000), 'secret', 1000 + 11 * 60_000)).toBeNull();
    expect(readState('garbage', 'secret', 2000)).toBeNull();
  });
});

describe('hunters collection', () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  beforeEach(async () => {
    ({ dir, cleanup } = await mkTmpDir('hunters'));
  });
  afterEach(async () => {
    await cleanup();
  });

  it('survives a crash through the WAL and a restart through the snapshot', async () => {
    const hunter: Hunter = {
      discord_id: 'd1',
      github_login: 'player-one',
      github_id: 7,
      linked_at: 1,
      profile: profile([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]),
      fetched_at: 1,
      duel_wins: 0,
      duel_losses: 0,
    };
    const make = () => new Store({ dataDir: dir, snapshotIntervalMs: 2_000_000_000, fsync: false });
    const s1 = make();
    await s1.init();
    await s1.hunters.set(hunter);
    await s1.hunters.incr('d1', 'duel_wins', 2);
    // No shutdown: the next store must rebuild from the WAL alone.
    const s2 = make();
    await s2.init();
    expect(s2.hunters.get('d1')?.duel_wins).toBe(2);
    await s2.shutdown();
    const s3 = make();
    await s3.init();
    expect(s3.hunters.get('d1')?.github_login).toBe('player-one');
    await s3.shutdown();
  });

  it('replays guardian strikes from the WAL as well', async () => {
    const make = () => new Store({ dataDir: dir, snapshotIntervalMs: 2_000_000_000, fsync: false });
    const s1 = make();
    await s1.init();
    await s1.guardianStrikes.set({
      discord_id: 'd2',
      display_name: 'x',
      offenses: [],
      ban_proposed_at: null,
    });
    const s2 = make();
    await s2.init();
    expect(s2.guardianStrikes.get('d2')).toBeDefined();
    await s2.shutdown();
  });
});
