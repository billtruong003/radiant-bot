import { describe, expect, it } from 'vitest';
import { simulateDuel } from '../../src/modules/combat/duel.js';
import {
  type FighterDisplay,
  narrateMieuSat,
  narrateRounds,
} from '../../src/modules/combat/narrate.js';

const C: FighterDisplay = {
  name: 'Bill',
  weapon: { display_name: 'Phá Vân Kiếm', category: 'pierce', tier: 'dia' },
  congPhap: { name: 'Huyền Thiên Kiếm Quyết', icon: '⚔️', school: 'kiem_phap' },
};
const O: FighterDisplay = {
  name: 'Bob',
  weapon: { display_name: 'Thiết Côn', category: 'blunt', tier: 'pham' },
  congPhap: { name: 'Ngũ Hành Quyền', icon: '🌊', school: 'ngu_hanh' },
};
const BARE: FighterDisplay = { name: 'NoGear', weapon: null, congPhap: null };

describe('narrateRounds', () => {
  it('produces one entry per round', () => {
    const r = simulateDuel(
      {
        user: { level: 10, cultivation_rank: 'truc_co', sub_title: null },
        displayName: 'a',
        congPhapSlots: [],
      },
      {
        user: { level: 10, cultivation_rank: 'truc_co', sub_title: null },
        displayName: 'b',
        congPhapSlots: [],
      },
      42,
    );
    const lines = narrateRounds(r.rounds, C, O);
    expect(lines.length).toBe(r.rounds.length);
  });

  it('mentions both fighter names and weapons in each round', () => {
    const r = simulateDuel(
      {
        user: { level: 10, cultivation_rank: 'truc_co', sub_title: null },
        displayName: 'a',
        congPhapSlots: [],
      },
      {
        user: { level: 10, cultivation_rank: 'truc_co', sub_title: null },
        displayName: 'b',
        congPhapSlots: [],
      },
      42,
    );
    const lines = narrateRounds(r.rounds, C, O);
    for (const line of lines) {
      expect(line).toContain('Bill');
      expect(line).toContain('Bob');
      expect(line).toContain('Phá Vân Kiếm');
      expect(line).toContain('Thiết Côn');
    }
  });

  it('falls back to bare-hand phrasing for null weapon', () => {
    const r = simulateDuel(
      {
        user: { level: 10, cultivation_rank: 'truc_co', sub_title: null },
        displayName: 'a',
        congPhapSlots: [],
      },
      {
        user: { level: 10, cultivation_rank: 'truc_co', sub_title: null },
        displayName: 'b',
        congPhapSlots: [],
      },
      42,
    );
    const lines = narrateRounds(r.rounds, BARE, O);
    expect(lines.join('\n')).toContain('vũ khí trần');
  });

  it('crit rounds use CHÍ MẠNG marker', () => {
    const r = simulateDuel(
      {
        user: { level: 10, cultivation_rank: 'truc_co', sub_title: null },
        displayName: 'a',
        congPhapSlots: [],
      },
      {
        user: { level: 10, cultivation_rank: 'truc_co', sub_title: null },
        displayName: 'b',
        congPhapSlots: [],
      },
      42,
    );
    // Force a crit-marked round to verify wording.
    const rounds = r.rounds.map((rd, i) => (i === 0 ? { ...rd, challengerCrit: true } : rd));
    const lines = narrateRounds(rounds, C, O);
    expect(lines[0]).toContain('CHÍ MẠNG');
  });
});

describe('narrateMieuSat', () => {
  it('captures rank gap + winner name', () => {
    const lines = narrateMieuSat(C, O, 3, 'Kim Đan', 'Phàm Nhân');
    const joined = lines.join('\n');
    expect(joined).toContain('Bill');
    expect(joined).toContain('Bob');
    expect(joined).toContain('Kim Đan');
    expect(joined).toContain('Phàm Nhân');
    expect(joined).toContain('3 tầng');
    expect(joined).toContain('MIỂU SÁT');
  });

  it('handles fighters with no công pháp', () => {
    const lines = narrateMieuSat(BARE, O, 2, 'Trúc Cơ', 'Phàm Nhân');
    expect(lines.join('\n')).toContain('khí thế tự thân');
  });
});
