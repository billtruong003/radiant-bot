import { describe, expect, it } from 'vitest';
import {
  cumulativeXpForLevel,
  levelFromXp,
  levelProgress,
  xpToNext,
} from '../../src/modules/leveling/engine.js';

describe('XP engine — formula xpToNext(L) = 5L² + 50L + 100', () => {
  it('xpToNext(0) = 100 (the SPEC §2 "Level 1 = 100 XP" reference)', () => {
    expect(xpToNext(0)).toBe(100);
  });

  it('xpToNext at small levels matches the closed form', () => {
    expect(xpToNext(1)).toBe(155);
    expect(xpToNext(2)).toBe(220);
    expect(xpToNext(5)).toBe(475);
    expect(xpToNext(10)).toBe(1100);
  });

  it('levelFromXp(0) = 0', () => {
    expect(levelFromXp(0)).toBe(0);
  });

  it('levelFromXp returns the floor level (99 XP still level 0)', () => {
    expect(levelFromXp(99)).toBe(0);
    expect(levelFromXp(100)).toBe(1);
    expect(levelFromXp(254)).toBe(1);
    expect(levelFromXp(255)).toBe(2); // 100 + 155
  });

  it('cumulativeXpForLevel matches Mee6-style closed form 5/6*(2L³+27L²+91L)', () => {
    // 5/6*(2*1+27+91) = 5/6*120 = 100
    expect(cumulativeXpForLevel(1)).toBe(100);
    // Mee6 closed form for L=10: 5/6*(2000+2700+910) = 5/6*5610 = 4675
    expect(cumulativeXpForLevel(10)).toBe(4675);
  });

  it('levelFromXp is the inverse of cumulativeXpForLevel at boundaries', () => {
    for (const lvl of [1, 5, 10, 20, 50]) {
      const cum = cumulativeXpForLevel(lvl);
      expect(levelFromXp(cum)).toBe(lvl);
      expect(levelFromXp(cum - 1)).toBe(lvl - 1);
    }
  });

  it('levelProgress reports correct current/needed within a level', () => {
    // At cumulative for level 5 + half of xpToNext(5):
    const base = cumulativeXpForLevel(5);
    const halfway = base + Math.floor(xpToNext(5) / 2);
    const p = levelProgress(halfway);
    expect(p.level).toBe(5);
    expect(p.neededForNext).toBe(xpToNext(5));
    expect(p.currentInLevel).toBe(Math.floor(xpToNext(5) / 2));
  });

  it('reference: reaching level 50 takes ~268k XP, level 100 takes ~1.9M XP', () => {
    // SPEC §2 reference comments say "Level 50 ≈ 110k, Level 100 ≈ 835k" but
    // those numbers don't match the stated formula. The formula's actual
    // closed form (Mee6 5L²+50L+100 cumulative) yields the numbers below.
    // The formula is authoritative; the SPEC comment is approximate/legacy.
    expect(cumulativeXpForLevel(50)).toBe(268_375);
    expect(cumulativeXpForLevel(100)).toBe(1_899_250);
  });
});
