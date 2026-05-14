import type { CongPhap, User } from '../../db/types.js';
import { computeCombatPower } from './power.js';

/**
 * Phase 12 Lát 6 — PvP /duel combat resolution.
 *
 * Simplified vs the spec sketch (no per-round buttons): we simulate all
 * 5 rounds atomically from a seeded RNG so the slash command produces
 * one rich embed instead of waiting for button collectors. This avoids
 * the state-machine complexity of multi-message interactions while
 * preserving the strategic "lực chiến matters but variance exists" feel.
 *
 * Round damage model:
 *   - Each fighter has HP = lực_chiến (so weaker fighter starts behind)
 *   - Per round: both attack simultaneously
 *   - Attack = own_LC × move_multiplier × random(0.7, 1.2)
 *   - Defense reduces incoming by 40% the round it's chosen
 *   - 5% chance crit (×1.8)
 *   - 5 rounds max; whoever has lower HP at end loses (ties = challenger wins)
 *
 * For non-interactive sim, both fighters use "balanced" strategy
 * (90% attack, 10% defend), which makes the higher-LC fighter win ~75%
 * of the time but leaves room for upset.
 */

export interface DuelFighter {
  user: Pick<User, 'level' | 'cultivation_rank' | 'sub_title'>;
  displayName: string;
  equippedCongPhap: CongPhap | null;
}

export interface DuelRound {
  round: number;
  challengerDamage: number;
  opponentDamage: number;
  challengerHpAfter: number;
  opponentHpAfter: number;
  challengerCrit: boolean;
  opponentCrit: boolean;
  challengerDefended: boolean;
  opponentDefended: boolean;
}

export interface DuelResult {
  challengerLc: number;
  opponentLc: number;
  challengerHpStart: number;
  opponentHpStart: number;
  challengerHpEnd: number;
  opponentHpEnd: number;
  rounds: DuelRound[];
  winner: 'challenger' | 'opponent' | 'tie';
}

const MAX_ROUNDS = 5;
const DEFEND_REDUCTION = 0.4;
const CRIT_CHANCE = 0.05;
const CRIT_MULT = 1.8;

/** Mulberry32 PRNG — deterministic from a 32-bit seed. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBetween(rng: () => number, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}

/**
 * Simulate a duel. Pure: takes two fighters + a seed, returns the full
 * round-by-round result. Caller persists XP/pills changes from result.
 */
export function simulateDuel(
  challenger: DuelFighter,
  opponent: DuelFighter,
  seed: number = Date.now() & 0xffffffff,
): DuelResult {
  const challengerLc = computeCombatPower(challenger.user, challenger.equippedCongPhap);
  const opponentLc = computeCombatPower(opponent.user, opponent.equippedCongPhap);
  const challengerHpStart = challengerLc;
  const opponentHpStart = opponentLc;

  const rng = makeRng(seed);
  let cHp = challengerHpStart;
  let oHp = opponentHpStart;
  const rounds: DuelRound[] = [];

  for (let i = 1; i <= MAX_ROUNDS; i++) {
    // 90% attack / 10% defend per fighter.
    const cDefend = rng() < 0.1;
    const oDefend = rng() < 0.1;
    const cCrit = !cDefend && rng() < CRIT_CHANCE;
    const oCrit = !oDefend && rng() < CRIT_CHANCE;

    const cMult = cDefend ? 0.3 : cCrit ? CRIT_MULT : 1.0;
    const oMult = oDefend ? 0.3 : oCrit ? CRIT_MULT : 1.0;

    const cBase = challengerLc * cMult * randomBetween(rng, 0.7, 1.2);
    const oBase = opponentLc * oMult * randomBetween(rng, 0.7, 1.2);

    // Defense reduces INCOMING damage.
    const oToCChallenger = oDefend ? oBase : oBase;
    const cToOOpponent = cDefend ? cBase : cBase;
    // Apply defense to incoming (not outgoing).
    const dmgToC = (1 - (cDefend ? DEFEND_REDUCTION : 0)) * oToCChallenger;
    const dmgToO = (1 - (oDefend ? DEFEND_REDUCTION : 0)) * cToOOpponent;

    cHp = Math.max(0, cHp - dmgToC);
    oHp = Math.max(0, oHp - dmgToO);

    rounds.push({
      round: i,
      challengerDamage: Math.round(dmgToO),
      opponentDamage: Math.round(dmgToC),
      challengerHpAfter: Math.round(cHp),
      opponentHpAfter: Math.round(oHp),
      challengerCrit: cCrit,
      opponentCrit: oCrit,
      challengerDefended: cDefend,
      opponentDefended: oDefend,
    });

    if (cHp <= 0 || oHp <= 0) break;
  }

  const winner: DuelResult['winner'] =
    cHp > oHp ? 'challenger' : oHp > cHp ? 'opponent' : 'challenger';

  return {
    challengerLc,
    opponentLc,
    challengerHpStart,
    opponentHpStart,
    challengerHpEnd: Math.round(cHp),
    opponentHpEnd: Math.round(oHp),
    rounds,
    winner,
  };
}

export const __for_testing = { makeRng, MAX_ROUNDS };
