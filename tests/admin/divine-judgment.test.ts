import { describe, expect, it } from 'vitest';
import { __for_testing } from '../../src/modules/admin/divine-judgment.js';

const { parseLlmJson, previousRank, clamp } = __for_testing;

describe('divine-judgment · parseLlmJson', () => {
  it('parses well-formed verdict + punishments', () => {
    const raw = JSON.stringify({
      verdict: 'Thiên đạo phong ấn vong ngôn.',
      punishments: [
        { id: 'xp_deduct', severity: 500 },
        { id: 'public_shame', severity: 1 },
      ],
    });
    const r = parseLlmJson(raw);
    expect(r?.verdict).toContain('phong ấn');
    expect(r?.punishments).toHaveLength(2);
  });

  it('strips markdown fence', () => {
    const raw = '```json\n{"verdict":"v","punishments":[{"id":"public_shame","severity":1}]}\n```';
    expect(parseLlmJson(raw)?.punishments).toHaveLength(1);
  });

  it('strips <think> reasoning leak', () => {
    const raw =
      '<think>let me decide</think>\n{"verdict":"X","punishments":[{"id":"pill_confiscate","severity":2}]}';
    expect(parseLlmJson(raw)?.verdict).toBe('X');
  });

  it('filters out malformed punishment entries', () => {
    const raw = JSON.stringify({
      verdict: 'v',
      punishments: [
        { id: 'xp_deduct', severity: 100 },
        { id: 123, severity: 100 }, // bad id type
        { severity: 100 }, // missing id
        { id: 'pill_confiscate', severity: 'high' }, // bad severity type
        { id: 'public_shame', severity: 1 }, // valid
      ],
    });
    const r = parseLlmJson(raw);
    expect(r?.punishments).toHaveLength(2);
    expect(r?.punishments.map((p) => p.id)).toEqual(['xp_deduct', 'public_shame']);
  });

  it('rejects entirely malformed JSON', () => {
    expect(parseLlmJson('not json')).toBeNull();
    expect(parseLlmJson('{')).toBeNull();
    expect(parseLlmJson(JSON.stringify({ verdict: 'v' }))).toBeNull(); // missing punishments
    expect(parseLlmJson(JSON.stringify({ punishments: [] }))).toBeNull(); // missing verdict
  });
});

describe('divine-judgment · previousRank', () => {
  it('Luyện Khí → Phàm Nhân', () => {
    expect(previousRank('luyen_khi')).toBe('pham_nhan');
  });
  it('Kim Đan → Trúc Cơ', () => {
    expect(previousRank('kim_dan')).toBe('truc_co');
  });
  it('Độ Kiếp → Đại Thừa', () => {
    expect(previousRank('do_kiep')).toBe('dai_thua');
  });
  it('Phàm Nhân has no previous (floor)', () => {
    expect(previousRank('pham_nhan')).toBeNull();
  });
  it('Tiên Nhân has no previous (admin-grant only)', () => {
    expect(previousRank('tien_nhan')).toBeNull();
  });
});

describe('divine-judgment · clamp', () => {
  it('clamps within range', () => {
    expect(clamp(50, 0, 100)).toBe(50);
    expect(clamp(-5, 0, 100)).toBe(0);
    expect(clamp(999, 0, 100)).toBe(100);
  });
  it('rounds to integer', () => {
    expect(clamp(50.7, 0, 100)).toBe(51);
    expect(clamp(50.3, 0, 100)).toBe(50);
  });
});
