import { describe, expect, it } from 'vitest';
import {
  MAX_LEVEL,
  congPhapSuccessRate,
  costToUpgrade,
  rollUpgrade,
  weaponSuccessRate,
} from '../../src/modules/combat/upgrade.js';

describe('costToUpgrade', () => {
  it('linear curve — Phase 14 rebalance (2 + L*3 pills, 200 + L*200 contrib)', () => {
    expect(costToUpgrade(0)).toEqual({ pills: 2, contribution: 200 });
    expect(costToUpgrade(1)).toEqual({ pills: 5, contribution: 400 });
    expect(costToUpgrade(9)).toEqual({ pills: 29, contribution: 2_000 });
  });
  it('returns 0/0 at MAX_LEVEL', () => {
    expect(costToUpgrade(MAX_LEVEL)).toEqual({ pills: 0, contribution: 0 });
  });
});

describe('success rates', () => {
  it('cong_phap is forgiving: 100% at L<4, 20% at L 9→10', () => {
    expect(congPhapSuccessRate(0)).toBe(1);
    expect(congPhapSuccessRate(3)).toBe(1);
    expect(congPhapSuccessRate(9)).toBe(0.2);
  });
  it('weapon is harsh: 95% at L 0, 3% at L 9→10', () => {
    expect(weaponSuccessRate(0)).toBe(0.95);
    expect(weaponSuccessRate(9)).toBe(0.03);
  });
});

describe('rollUpgrade', () => {
  const lowRng = () => 0.0; // always succeed
  const highRng = () => 0.99; // always fail

  it('cong_phap success → +1 level', () => {
    expect(rollUpgrade('cong_phap', 3, lowRng)).toEqual({ result: 'success', newLevel: 4 });
  });
  it('cong_phap fail at L 5 → stay-put (no downgrade)', () => {
    expect(rollUpgrade('cong_phap', 5, highRng)).toEqual({ result: 'fail-stay', newLevel: 5 });
  });
  it('weapon fail at L 6 → stay-put (below 7 threshold)', () => {
    expect(rollUpgrade('weapon', 6, highRng)).toEqual({ result: 'fail-stay', newLevel: 6 });
  });
  it('weapon fail at L 7 → downgrade -1', () => {
    expect(rollUpgrade('weapon', 7, highRng)).toEqual({ result: 'fail-downgrade', newLevel: 6 });
  });
  it('weapon fail at L 9 → downgrade to 8', () => {
    expect(rollUpgrade('weapon', 9, highRng)).toEqual({ result: 'fail-downgrade', newLevel: 8 });
  });
  it('cannot upgrade at MAX_LEVEL', () => {
    expect(rollUpgrade('weapon', MAX_LEVEL, lowRng)).toEqual({
      result: 'fail-stay',
      newLevel: MAX_LEVEL,
    });
  });
});
