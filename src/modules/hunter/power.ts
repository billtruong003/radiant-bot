import type { HunterProfile, HunterStat } from '../../db/types.js';

/**
 * Hunter power turns a member's GitHub stats (from Git Profile Awaken) into
 * duel numbers. It works on percentiles, not raw counts: someone with 50,000
 * commits is stronger than someone with 500, but not a hundred times stronger.
 *
 * Each stat becomes a score from 0 to 100 on the same log scale Awaken draws
 * its rank ladder with: 0 at the bottom of regular players, about 77 at the
 * top 0.05% (EX), 100 at the top 0.005%.
 */
export function statScore(percentile: number): number {
  const top = Math.max(0.005, (1 - percentile) * 100);
  const pos = Math.log10(100 / top) / Math.log10(100 / 0.005);
  return Math.round(Math.min(1, Math.max(0, pos)) * 100);
}

export interface HunterCombat {
  hp: number;
  atk: number;
  /** Damage taken is multiplied by 100 / (100 + def). */
  def: number;
  /** Who strikes first, and the chance of a second strike in a round. */
  spd: number;
  /** Percent. */
  crit: number;
  /** Percent. */
  evade: number;
  power: number;
}

const scoreOf = (stats: HunterStat[], code: HunterStat['code']): number =>
  statScore(stats.find((s) => s.code === code)?.percentile ?? 0);

/** STR hits, VIT lasts, INT blocks, AGI acts first, LUK crits, CHA dodges. */
export function combatFrom(profile: HunterProfile): HunterCombat {
  const s = (code: HunterStat['code']) => scoreOf(profile.stats, code);
  const hp = 300 + s('VIT') * 6;
  const atk = 30 + s('STR');
  const def = Math.round(s('INT') * 0.8);
  const spd = s('AGI');
  const crit = Math.round(5 + s('LUK') * 0.3);
  const evade = Math.round(3 + s('CHA') * 0.2);
  const power = Math.round(hp * 0.5 + atk * 4 + def * 3 + spd * 2 + crit * 6 + evade * 6);
  return { hp, atk, def, spd, crit, evade, power };
}
