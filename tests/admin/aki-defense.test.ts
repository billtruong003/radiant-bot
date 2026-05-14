import { afterEach, describe, expect, it } from 'vitest';
import {
  __for_testing,
  detectAkiInsult,
  isOnCooldown,
  recordWrath,
  reset,
} from '../../src/modules/admin/aki-defense.js';

describe('aki-defense · detectAkiInsult heuristic', () => {
  it('fires on "Aki gà"', () => {
    const r = detectAkiInsult('Aki gà');
    expect(r.isInsult).toBe(true);
    expect(r.matchedName).toBe('aki');
    expect(r.matchedInsult).toBe('gà');
  });

  it('fires on "Aki ngu" with VN diacritics', () => {
    expect(detectAkiInsult('Aki ngu').isInsult).toBe(true);
  });

  it('fires on diacritic-stripped form "Aki dở"', () => {
    expect(detectAkiInsult('Aki do').isInsult).toBe(true);
  });

  it('fires on alt NPC names: Akira', () => {
    expect(detectAkiInsult('Akira dumb').isInsult).toBe(true);
  });

  it('fires on alt NPC names: Meifeng', () => {
    expect(detectAkiInsult('Meifeng useless').isInsult).toBe(true);
  });

  it('does NOT fire without insult token', () => {
    expect(detectAkiInsult('Aki xinh quá').isInsult).toBe(false);
    expect(detectAkiInsult('Hỏi Aki cách lên cảnh giới').isInsult).toBe(false);
  });

  it('does NOT fire without Aki name', () => {
    expect(detectAkiInsult('thằng kia gà quá').isInsult).toBe(false);
    expect(detectAkiInsult('cái này dở vl').isInsult).toBe(false);
  });

  it('does NOT fire on substring matches (akimichu, etc.)', () => {
    expect(detectAkiInsult('akimichu là tên hay vl').isInsult).toBe(false);
    // "akira" IS a whole word but "bad" alone isn't in the insult list
    // (only "bad bot" compound is). So this stays a non-match — proves
    // the whole-word insult matcher doesn't over-fire on single-word
    // adjectives like "bad" / "good".
    expect(detectAkiInsult('the akira anime is bad').isInsult).toBe(false);
  });

  it('does NOT fire on empty / whitespace input', () => {
    expect(detectAkiInsult('').isInsult).toBe(false);
    expect(detectAkiInsult('   ').isInsult).toBe(false);
  });

  it('case-insensitive on both name + insult', () => {
    expect(detectAkiInsult('AKI GA').isInsult).toBe(true);
    expect(detectAkiInsult('aki STUPID').isInsult).toBe(true);
  });

  it('EN insults fire too', () => {
    expect(detectAkiInsult('Aki is dumb').isInsult).toBe(true);
    expect(detectAkiInsult('aki sucks').isInsult).toBe(true);
    expect(detectAkiInsult('bad bot Aki').isInsult).toBe(true);
  });
});

describe('aki-defense · cooldown', () => {
  afterEach(() => {
    reset();
  });

  it('fresh user not on cooldown', () => {
    expect(isOnCooldown('u1', 1_000_000)).toBe(false);
  });

  it('record + on cooldown immediately', () => {
    recordWrath('u1', 1_000_000);
    expect(isOnCooldown('u1', 1_000_500)).toBe(true);
  });

  it('expires after 1h', () => {
    recordWrath('u1', 1_000_000);
    // 1h = 3600000ms
    expect(isOnCooldown('u1', 1_000_000 + 3_600_000 + 1)).toBe(false);
  });

  it('per-user isolation', () => {
    recordWrath('u1', 1_000_000);
    expect(isOnCooldown('u2', 1_000_500)).toBe(false);
  });

  it('reset clears all', () => {
    recordWrath('u1', 1_000_000);
    reset();
    expect(isOnCooldown('u1', 1_000_001)).toBe(false);
  });
});

describe('aki-defense · normalize helper', () => {
  it('strips Vietnamese diacritics', () => {
    expect(__for_testing.normalizeForMatch('Trần Đỗ')).toBe('tran do');
  });
  it('lowercases', () => {
    expect(__for_testing.normalizeForMatch('AKI')).toBe('aki');
  });
});
