import type { HunterCombat } from './power.js';

export interface DuelSide {
  name: string;
  combat: HunterCombat;
}

export interface DuelHit {
  round: number;
  attacker: 0 | 1;
  damage: number;
  crit: boolean;
  evaded: boolean;
  /** HP of the defender after the hit. */
  hpLeft: number;
}

export interface DuelResult {
  winner: 0 | 1;
  hits: DuelHit[];
  hpLeft: [number, number];
  rounds: number;
}

const MAX_ROUNDS = 10;

/** Mulberry32: a small seeded generator so a duel can be replayed from its seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Ten rounds at most. Each round the faster hunter strikes first, the other
 * answers if still standing, and speed beyond the opponent's gives a chance of
 * a second strike. Damage is ATK ±15%, ×1.5 on a crit, reduced by DEF; a hit
 * can be evaded. If both survive, the one with the larger share of HP left wins.
 */
export function simulateHunterDuel(a: DuelSide, b: DuelSide, seed: number): DuelResult {
  const roll = rng(seed);
  const sides = [a.combat, b.combat] as const;
  const hp: [number, number] = [a.combat.hp, b.combat.hp];
  const hits: DuelHit[] = [];

  const strike = (round: number, attacker: 0 | 1) => {
    const defender = (1 - attacker) as 0 | 1;
    const atk = sides[attacker];
    const def = sides[defender];
    const evaded = roll() * 100 < def.evade;
    const crit = !evaded && roll() * 100 < atk.crit;
    const raw = atk.atk * (0.85 + roll() * 0.3) * (crit ? 1.5 : 1);
    const damage = evaded ? 0 : Math.max(1, Math.round((raw * 100) / (100 + def.def)));
    hp[defender] = Math.max(0, hp[defender] - damage);
    hits.push({ round, attacker, damage, crit, evaded, hpLeft: hp[defender] });
  };

  let round = 0;
  while (round < MAX_ROUNDS && hp[0] > 0 && hp[1] > 0) {
    round++;
    const first: 0 | 1 =
      sides[0].spd === sides[1].spd ? (roll() < 0.5 ? 0 : 1) : sides[0].spd > sides[1].spd ? 0 : 1;
    const second = (1 - first) as 0 | 1;
    strike(round, first);
    if (hp[second] > 0) strike(round, second);
    const lead = sides[first].spd - sides[second].spd;
    if (hp[second] > 0 && hp[first] > 0 && roll() * 100 < lead) strike(round, first);
  }

  const share = (i: 0 | 1) => hp[i] / sides[i].hp;
  const winner: 0 | 1 = hp[1] === 0 ? 0 : hp[0] === 0 ? 1 : share(0) >= share(1) ? 0 : 1;
  return { winner, hits, hpLeft: hp, rounds: round };
}
