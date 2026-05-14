import { describe, expect, it } from 'vitest';
import {
  __for_testing,
  auraFor,
  renderBreakthroughDescription,
  renderPlainLevelUpDescription,
} from '../../src/modules/leveling/aura.js';

describe('aura · per-rank visual tier', () => {
  it('every rank has a defined aura entry', () => {
    const ranks = [
      'pham_nhan',
      'luyen_khi',
      'truc_co',
      'kim_dan',
      'nguyen_anh',
      'hoa_than',
      'luyen_hu',
      'hop_the',
      'dai_thua',
      'do_kiep',
      'tien_nhan',
    ] as const;
    for (const r of ranks) {
      const a = auraFor(r);
      expect(a.topAura.length).toBeGreaterThan(0);
      expect(a.bottomAura.length).toBeGreaterThan(0);
      expect(a.divider.length).toBeGreaterThan(0);
      expect(a.effect.length).toBeGreaterThan(0);
    }
  });

  it('higher tiers (Đại Thừa+) have rainbow cycle', () => {
    expect(auraFor('dai_thua').rainbowCycle.length).toBeGreaterThan(0);
    expect(auraFor('do_kiep').rainbowCycle.length).toBeGreaterThan(0);
    expect(auraFor('tien_nhan').rainbowCycle.length).toBeGreaterThan(0);
  });

  it('lower tiers (Phàm Nhân through Hợp Thể) have NO rainbow', () => {
    expect(auraFor('pham_nhan').rainbowCycle.length).toBe(0);
    expect(auraFor('luyen_khi').rainbowCycle.length).toBe(0);
    expect(auraFor('truc_co').rainbowCycle.length).toBe(0);
    expect(auraFor('kim_dan').rainbowCycle.length).toBe(0);
    expect(auraFor('hop_the').rainbowCycle.length).toBe(0);
  });

  it('higher rank → visually denser aura', () => {
    // length proxy for "denser". Pham Nhan baseline < Tien Nhan top.
    const phamLen = auraFor('pham_nhan').topAura.length;
    const tienLen = auraFor('tien_nhan').topAura.length;
    expect(tienLen).toBeGreaterThan(phamLen);
  });

  it('Tiên Nhân uses divine (gold+iridescent+purple) palette, not generic rainbow', () => {
    // DIVINE_5 contains 0xfff5e6 (iridescent cream) and 0xffd56b (gold)
    expect(auraFor('tien_nhan').rainbowCycle).toEqual(__for_testing.DIVINE_5);
  });
});

describe('aura · renderBreakthroughDescription', () => {
  it('wraps with aura.topAura + aura.bottomAura', () => {
    const r = renderBreakthroughDescription({
      oldRankIcon: '🔵',
      newRankIcon: '🟡',
      oldRankName: 'Trúc Cơ',
      newRankName: 'Kim Đan',
      newRankId: 'kim_dan',
      memberMention: '<@123>',
      chronicle: 'prose about breakthrough',
    });
    const aura = auraFor('kim_dan');
    expect(r).toContain(aura.topAura);
    expect(r).toContain(aura.bottomAura);
    expect(r).toContain('Trúc Cơ');
    expect(r).toContain('Kim Đan');
    expect(r).toContain('prose about breakthrough');
  });

  it('includes the rank-specific effect line', () => {
    const r = renderBreakthroughDescription({
      oldRankIcon: '⚡',
      newRankIcon: '👑',
      oldRankName: 'Độ Kiếp',
      newRankName: 'Tiên Nhân',
      newRankId: 'tien_nhan',
      memberMention: '<@456>',
      chronicle: 'ascending to immortal',
    });
    expect(r).toContain(auraFor('tien_nhan').effect);
  });
});

describe('aura · renderPlainLevelUpDescription', () => {
  it('uses current rank aura (not promoted)', () => {
    const r = renderPlainLevelUpDescription({
      memberMention: '<@123>',
      newLevel: 5,
      currentRankId: 'luyen_khi',
      rankIcon: '🌬️',
    });
    expect(r).toContain('Level 5');
    expect(r).toContain('🌬️');
    expect(r).toContain(auraFor('luyen_khi').topAura);
  });
});
