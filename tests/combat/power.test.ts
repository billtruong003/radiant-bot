import { describe, expect, it } from 'vitest';
import type { CongPhap } from '../../src/db/types.js';
import { computeCombatPower, computeCombatPowerBreakdown } from '../../src/modules/combat/power.js';

/**
 * Phase 14 lực chiến formula — see src/modules/combat/power.ts.
 *
 *   total = 100 (base)
 *         + level × 5
 *         + rankIdx × 30
 *         + (sub_title ? 30 : 0)
 *         + stat_alloc.dmg × 8 + hp × 5 + def × 3 + spd × 4
 *         + cong_phap_bonus × (1 + cp_level × 0.10)
 *         + weapon.damage_base × 10 × (1 + weapon_level × 0.15)
 *
 * Phase 14 lowered LEVEL_BONUS 10→5 and RANK_BONUS_STEP 50→30 to make
 * room for stat allocation. Old Phase 12 fixtures are updated below.
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

  it('Luyện Khí level 5 = 100 + 25 + 30 = 155', () => {
    // base 100 + level 5×5=25 + Luyện Khí (idx 1) ×30 = 30
    const cp = computeCombatPower(
      { level: 5, cultivation_rank: 'luyen_khi', sub_title: null },
      null,
    );
    expect(cp).toBe(155);
  });

  it('Trúc Cơ level 10 with sub_title = 100 + 50 + 60 + 30 = 240', () => {
    const cp = computeCombatPower(
      { level: 10, cultivation_rank: 'truc_co', sub_title: 'Kiếm Tu' },
      null,
    );
    expect(cp).toBe(240);
  });

  it('Độ Kiếp level 160 with sub_title + 200 CP công pháp', () => {
    // base 100 + 800 + (idx 9 × 30 = 270) + 30 + 200 = 1400
    const cp = computeCombatPower(
      { level: 160, cultivation_rank: 'do_kiep', sub_title: 'Trận Pháp Sư' },
      mkCongPhap(200),
    );
    expect(cp).toBe(1400);
  });

  it('Tiên Nhân (admin grant) = highest rank index = 10', () => {
    const cp = computeCombatPower(
      { level: 100, cultivation_rank: 'tien_nhan', sub_title: 'Kiếm Tu' },
      null,
    );
    expect(cp).toBe(100 + 500 + 10 * 30 + 30);
  });

  it('breakdown attributes correctly', () => {
    const b = computeCombatPowerBreakdown(
      { level: 20, cultivation_rank: 'kim_dan', sub_title: 'Đan Sư' },
      mkCongPhap(75),
    );
    expect(b.base).toBe(100);
    expect(b.levelBonus).toBe(100); // 20 × 5
    expect(b.rankBonus).toBe(90); // Kim Đan = idx 3 × 30
    expect(b.subTitleBonus).toBe(30);
    expect(b.congPhapBonus).toBe(75);
    expect(b.statBonus).toBe(0);
    expect(b.weaponBonus).toBe(0);
    expect(b.total).toBe(395);
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

  it('stat_alloc contributes per weight (dmg×8, hp×5, def×3, spd×4)', () => {
    const b = computeCombatPowerBreakdown(
      {
        level: 0,
        cultivation_rank: 'pham_nhan',
        sub_title: null,
        stat_alloc: { dmg: 10, hp: 10, def: 10, spd: 10 },
      },
      null,
    );
    // 10×8 + 10×5 + 10×3 + 10×4 = 200
    expect(b.statBonus).toBe(200);
    expect(b.total).toBe(300); // 100 base + 200 stat
  });

  it('weapon contribution scales with level (damage_base × 10 × (1 + lv × 0.15))', () => {
    const b = computeCombatPowerBreakdown(
      { level: 0, cultivation_rank: 'pham_nhan', sub_title: null },
      null,
      0,
      { damage_base: 30, level: 4 },
    );
    // 30 × 10 × (1 + 4 × 0.15) = 300 × 1.6 = 480
    expect(b.weaponBonus).toBe(480);
  });

  it('công pháp level scales bonus by 10% per level', () => {
    const b = computeCombatPowerBreakdown(
      { level: 0, cultivation_rank: 'pham_nhan', sub_title: null },
      mkCongPhap(100),
      5,
      null,
    );
    // 100 × (1 + 5 × 0.10) = 150
    expect(b.congPhapBonus).toBe(150);
  });
});
