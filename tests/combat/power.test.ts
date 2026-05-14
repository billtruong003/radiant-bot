import { describe, expect, it } from 'vitest';
import type { CongPhap } from '../../src/db/types.js';
import { computeCombatPower, computeCombatPowerBreakdown } from '../../src/modules/combat/power.js';

/**
 * Phase 12 Lát 1 — lực chiến formula.
 *
 *   combat_power = 100 + level×10 + rankIdx×50 + (sub_title ? 50 : 0) + cong_phap_bonus
 */

function mkCongPhap(combatPower: number): CongPhap {
  return {
    id: 'cp-test',
    slug: 'test',
    name: 'Test',
    description: 'test',
    rarity: 'common',
    cost_pills: 0,
    cost_contribution: 0,
    stat_bonuses: { combat_power: combatPower },
    min_rank_required: null,
    created_at: 0,
  };
}

describe('computeCombatPower', () => {
  it('fresh Phàm Nhân (level 0, no sub_title, no công pháp) = 100', () => {
    const cp = computeCombatPower(
      { level: 0, cultivation_rank: 'pham_nhan', sub_title: null },
      null,
    );
    expect(cp).toBe(100);
  });

  it('Luyện Khí level 5 = 100 + 50 + 50 = 200', () => {
    // base 100 + level 5×10=50 + Luyện Khí (idx 1) ×50 = 50
    const cp = computeCombatPower(
      { level: 5, cultivation_rank: 'luyen_khi', sub_title: null },
      null,
    );
    expect(cp).toBe(200);
  });

  it('Trúc Cơ level 10 with sub_title = 100 + 100 + 100 + 50 = 350', () => {
    const cp = computeCombatPower(
      { level: 10, cultivation_rank: 'truc_co', sub_title: 'Kiếm Tu' },
      null,
    );
    expect(cp).toBe(350);
  });

  it('Độ Kiếp level 160 with sub_title + 200 CP công pháp', () => {
    // base 100 + 1600 + (idx 9 × 50 = 450) + 50 + 200 = 2400
    const cp = computeCombatPower(
      { level: 160, cultivation_rank: 'do_kiep', sub_title: 'Trận Pháp Sư' },
      mkCongPhap(200),
    );
    expect(cp).toBe(2400);
  });

  it('Tiên Nhân (admin grant) = highest rank index = 10', () => {
    const cp = computeCombatPower(
      { level: 100, cultivation_rank: 'tien_nhan', sub_title: 'Kiếm Tu' },
      null,
    );
    expect(cp).toBe(100 + 1000 + 10 * 50 + 50);
  });

  it('breakdown attributes correctly', () => {
    const b = computeCombatPowerBreakdown(
      { level: 20, cultivation_rank: 'kim_dan', sub_title: 'Đan Sư' },
      mkCongPhap(75),
    );
    expect(b.base).toBe(100);
    expect(b.levelBonus).toBe(200);
    expect(b.rankBonus).toBe(150); // Kim Đan = idx 3
    expect(b.subTitleBonus).toBe(50);
    expect(b.congPhapBonus).toBe(75);
    expect(b.total).toBe(575);
  });

  it('no equipped công pháp → 0 bonus from that slot', () => {
    const b = computeCombatPowerBreakdown(
      { level: 0, cultivation_rank: 'pham_nhan', sub_title: null },
      null,
    );
    expect(b.congPhapBonus).toBe(0);
  });

  it('null sub_title → 0 sub_title bonus', () => {
    const b = computeCombatPowerBreakdown(
      { level: 0, cultivation_rank: 'pham_nhan', sub_title: null },
      null,
    );
    expect(b.subTitleBonus).toBe(0);
  });
});
