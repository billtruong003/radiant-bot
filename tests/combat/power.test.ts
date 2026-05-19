import { describe, expect, it } from 'vitest';
import type { CongPhap } from '../../src/db/types.js';
import { computeCombatPower, computeCombatPowerBreakdown } from '../../src/modules/combat/power.js';

/**
 * Phase 14 round 3 lực chiến formula — see src/modules/combat/power.ts.
 *
 *   total = 100 (base)
 *         + level × 5
 *         + rankIdx × 30
 *         + (sub_title ? 30 : 0)
 *         + stat_alloc.dmg × 8 + hp × 5 + def × 3 + spd × 4
 *         + sum(cong_phap_slots[i].cp × (1 + level[i] × 0.10))
 *         + phap_khi.cp × (1 + level × 0.10)
 *         + sum(nhan_slots[i].cp)
 *         + weapon.damage_base × 10 × (1 + weapon_level × 0.15)
 *
 * Multi-slot công pháp + pháp khí + nhẫn arrays sum into total.
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
  it('fresh Phàm Nhân (level 0, no sub_title, no slots) = 100', () => {
    const cp = computeCombatPower({ level: 0, cultivation_rank: 'pham_nhan', sub_title: null });
    expect(cp).toBe(100);
  });

  it('Luyện Khí level 5 = 100 + 25 + 30 = 155', () => {
    const cp = computeCombatPower({ level: 5, cultivation_rank: 'luyen_khi', sub_title: null });
    expect(cp).toBe(155);
  });

  it('Trúc Cơ level 10 with sub_title = 100 + 50 + 60 + 30 = 240', () => {
    const cp = computeCombatPower({
      level: 10,
      cultivation_rank: 'truc_co',
      sub_title: 'Kiếm Tu',
    });
    expect(cp).toBe(240);
  });

  it('Độ Kiếp level 160 with sub_title + 200 CP công pháp (single slot)', () => {
    const cp = computeCombatPower(
      { level: 160, cultivation_rank: 'do_kiep', sub_title: 'Trận Pháp Sư' },
      [{ item: mkCongPhap(200), level: 0 }],
    );
    expect(cp).toBe(1400);
  });

  it('Tiên Nhân (admin grant) = highest rank index = 10', () => {
    const cp = computeCombatPower({
      level: 100,
      cultivation_rank: 'tien_nhan',
      sub_title: 'Kiếm Tu',
    });
    expect(cp).toBe(100 + 500 + 10 * 30 + 30);
  });

  it('breakdown attributes correctly', () => {
    const b = computeCombatPowerBreakdown(
      { level: 20, cultivation_rank: 'kim_dan', sub_title: 'Đan Sư' },
      [{ item: mkCongPhap(75), level: 0 }],
    );
    expect(b.base).toBe(100);
    expect(b.levelBonus).toBe(100);
    expect(b.rankBonus).toBe(90);
    expect(b.subTitleBonus).toBe(30);
    expect(b.congPhapBonus).toBe(75);
    expect(b.phapKhiBonus).toBe(0);
    expect(b.nhanBonus).toBe(0);
    expect(b.statBonus).toBe(0);
    expect(b.weaponBonus).toBe(0);
    expect(b.total).toBe(395);
  });

  it('no equipped slots → 0 contribution from slot fields', () => {
    const b = computeCombatPowerBreakdown({
      level: 0,
      cultivation_rank: 'pham_nhan',
      sub_title: null,
    });
    expect(b.congPhapBonus).toBe(0);
    expect(b.phapKhiBonus).toBe(0);
    expect(b.nhanBonus).toBe(0);
    expect(b.weaponBonus).toBe(0);
  });

  it('null sub_title → 0 sub_title bonus', () => {
    const b = computeCombatPowerBreakdown({
      level: 0,
      cultivation_rank: 'pham_nhan',
      sub_title: null,
    });
    expect(b.subTitleBonus).toBe(0);
  });

  it('stat_alloc contributes per weight (dmg×8, hp×5, def×3, spd×4)', () => {
    const b = computeCombatPowerBreakdown({
      level: 0,
      cultivation_rank: 'pham_nhan',
      sub_title: null,
      stat_alloc: { dmg: 10, hp: 10, def: 10, spd: 10 },
    });
    expect(b.statBonus).toBe(200);
    expect(b.total).toBe(300);
  });

  it('weapon contribution scales with level (damage_base × 10 × (1 + lv × 0.15))', () => {
    const b = computeCombatPowerBreakdown(
      { level: 0, cultivation_rank: 'pham_nhan', sub_title: null },
      [],
      null,
      [],
      { damage_base: 30, level: 4 },
    );
    expect(b.weaponBonus).toBe(480);
  });

  it('công pháp level scales bonus by 10% per level', () => {
    const b = computeCombatPowerBreakdown(
      { level: 0, cultivation_rank: 'pham_nhan', sub_title: null },
      [{ item: mkCongPhap(100), level: 5 }],
      null,
      [],
      null,
    );
    expect(b.congPhapBonus).toBe(150);
  });

  it('multi-slot công pháp — sums all 3 slots', () => {
    const b = computeCombatPowerBreakdown(
      { level: 0, cultivation_rank: 'hoa_than', sub_title: null },
      [
        { item: mkCongPhap(100), level: 0 },
        { item: mkCongPhap(150), level: 2 },
        { item: mkCongPhap(200), level: 0 },
      ],
    );
    // 100 + 150*(1+0.2) + 200 = 100 + 180 + 200 = 480
    expect(b.congPhapBonus).toBe(480);
  });

  it('pháp khí scales like công pháp; nhẫn is flat', () => {
    const b = computeCombatPowerBreakdown(
      { level: 0, cultivation_rank: 'pham_nhan', sub_title: null },
      [],
      {
        item: {
          id: 'pk',
          slug: 'pk',
          name: 'PK',
          icon: '✨',
          type: 'bao',
          description: '',
          lore: '',
          passive_text: '',
          rarity: 'epic',
          cost_pills: 0,
          cost_contribution: 0,
          stat_bonuses: { combat_power: 200 },
          min_rank_required: null,
          visual_aura: null,
          created_at: 0,
        },
        level: 3,
      },
      [
        {
          id: 'n1',
          slug: 'n1',
          name: 'N1',
          icon: '💍',
          description: '',
          lore: '',
          rarity: 'rare',
          cost_pills: 0,
          cost_contribution: 0,
          stat_bonuses: { combat_power: 80 },
          min_rank_required: null,
          created_at: 0,
        },
        {
          id: 'n2',
          slug: 'n2',
          name: 'N2',
          icon: '💍',
          description: '',
          lore: '',
          rarity: 'rare',
          cost_pills: 0,
          cost_contribution: 0,
          stat_bonuses: { combat_power: 120 },
          min_rank_required: null,
          created_at: 0,
        },
      ],
    );
    // phap khi: 200 * (1 + 3*0.10) = 260
    // nhan: 80 + 120 = 200
    expect(b.phapKhiBonus).toBe(260);
    expect(b.nhanBonus).toBe(200);
  });
});
