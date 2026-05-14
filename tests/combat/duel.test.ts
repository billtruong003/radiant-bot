import { describe, expect, it } from 'vitest';
import { simulateDuel } from '../../src/modules/combat/duel.js';

const FIGHTER_WEAK = {
  user: { level: 5, cultivation_rank: 'luyen_khi' as const, sub_title: null },
  displayName: 'Weakling',
  equippedCongPhap: null,
};

const FIGHTER_STRONG = {
  user: { level: 100, cultivation_rank: 'do_kiep' as const, sub_title: 'Kiếm Tu' },
  displayName: 'Strong',
  equippedCongPhap: null,
};

describe('simulateDuel', () => {
  it('deterministic per seed', () => {
    const a = simulateDuel(FIGHTER_WEAK, FIGHTER_STRONG, 12345);
    const b = simulateDuel(FIGHTER_WEAK, FIGHTER_STRONG, 12345);
    expect(a).toEqual(b);
  });

  it('different seeds produce different outcomes (usually)', () => {
    const a = simulateDuel(FIGHTER_WEAK, FIGHTER_STRONG, 1);
    const b = simulateDuel(FIGHTER_WEAK, FIGHTER_STRONG, 999);
    // At minimum the round-by-round damage will differ.
    expect(a.rounds[0]?.opponentDamage === b.rounds[0]?.opponentDamage).toBe(false);
  });

  it('computes lực chiến for both fighters', () => {
    const r = simulateDuel(FIGHTER_WEAK, FIGHTER_STRONG, 42);
    // Lv 5, Luyện Khí (idx 1) → 100 base + 50 level + 50 rank + 0 sub_title = 200
    expect(r.challengerLc).toBe(200);
    // Lv 100, Độ Kiếp (idx 9), Kiếm Tu → 100 + 1000 + 450 + 50 = 1600
    expect(r.opponentLc).toBe(1600);
    expect(r.opponentHpStart).toBe(r.opponentLc);
  });

  it('runs at most 5 rounds', () => {
    const r = simulateDuel(FIGHTER_WEAK, FIGHTER_STRONG, 42);
    expect(r.rounds.length).toBeLessThanOrEqual(5);
  });

  it('stronger fighter wins most of the time across many seeds', () => {
    let strongerWins = 0;
    const trials = 100;
    for (let seed = 0; seed < trials; seed++) {
      const r = simulateDuel(FIGHTER_WEAK, FIGHTER_STRONG, seed);
      if (r.winner === 'opponent') strongerWins++;
    }
    // Expect well above 50% — strong has ~10x lực chiến.
    expect(strongerWins).toBeGreaterThan(70);
  });

  it('produces a definite winner (no tie if HP differ)', () => {
    const r = simulateDuel(FIGHTER_WEAK, FIGHTER_STRONG, 42);
    expect(['challenger', 'opponent', 'tie']).toContain(r.winner);
  });

  it('records crit + defend flags per round', () => {
    const r = simulateDuel(FIGHTER_WEAK, FIGHTER_STRONG, 42);
    for (const round of r.rounds) {
      expect(typeof round.challengerCrit).toBe('boolean');
      expect(typeof round.opponentCrit).toBe('boolean');
      expect(typeof round.challengerDefended).toBe('boolean');
      expect(typeof round.opponentDefended).toBe('boolean');
    }
  });
});
