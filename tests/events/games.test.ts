import { describe, expect, it } from 'vitest';
import { generateMathPuzzle, makeOptions } from '../../src/modules/events/games/math-puzzle.js';
import { TARGET, generateReactionGame } from '../../src/modules/events/games/reaction-speed.js';

describe('makeOptions (math puzzle)', () => {
  it('returns 4 unique options including the correct answer', () => {
    for (let i = 0; i < 50; i++) {
      const correct = String(50 + i);
      const opts = makeOptions(correct);
      expect(opts).toHaveLength(4);
      expect(new Set(opts).size).toBe(4); // all unique
      expect(opts).toContain(correct);
    }
  });

  it('handles small correct answers without negative distractors', () => {
    const opts = makeOptions('3');
    expect(opts).toHaveLength(4);
    for (const o of opts) {
      expect(Number.parseInt(o, 10)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('generateMathPuzzle', () => {
  it('level < 20 → easy "a + b" form', () => {
    for (let i = 0; i < 20; i++) {
      const p = generateMathPuzzle(10);
      expect(p.question).toMatch(/^\d+ \+ \d+ = \?$/);
      expect(p.options).toHaveLength(4);
      expect(p.options).toContain(p.expected);
      // Verify expected matches the actual sum.
      const m = p.question.match(/^(\d+) \+ (\d+)/);
      expect(m).not.toBeNull();
      if (m) {
        const sum = Number.parseInt(m[1] ?? '0', 10) + Number.parseInt(m[2] ?? '0', 10);
        expect(p.expected).toBe(String(sum));
      }
    }
  });

  it('20 ≤ level < 50 → medium "a + b × c" form', () => {
    for (let i = 0; i < 20; i++) {
      const p = generateMathPuzzle(30);
      expect(p.question).toMatch(/^\d+ \+ \d+ × \d+ = \?$/);
      const m = p.question.match(/^(\d+) \+ (\d+) × (\d+)/);
      if (m) {
        const result =
          Number.parseInt(m[1] ?? '0', 10) +
          Number.parseInt(m[2] ?? '0', 10) * Number.parseInt(m[3] ?? '0', 10);
        expect(p.expected).toBe(String(result));
      }
    }
  });

  it('level ≥ 50 → hard "(a + b) × c - d" form', () => {
    for (let i = 0; i < 20; i++) {
      const p = generateMathPuzzle(80);
      expect(p.question).toMatch(/^\(\d+ \+ \d+\) × \d+ - \d+ = \?$/);
      const m = p.question.match(/^\((\d+) \+ (\d+)\) × (\d+) - (\d+)/);
      if (m) {
        const a = Number.parseInt(m[1] ?? '0', 10);
        const b = Number.parseInt(m[2] ?? '0', 10);
        const c = Number.parseInt(m[3] ?? '0', 10);
        const d = Number.parseInt(m[4] ?? '0', 10);
        expect(p.expected).toBe(String((a + b) * c - d));
      }
    }
  });
});

describe('generateReactionGame', () => {
  it('returns exactly 5 unique options', () => {
    for (let i = 0; i < 50; i++) {
      const g = generateReactionGame();
      expect(g.options).toHaveLength(5);
      expect(new Set(g.options).size).toBe(5);
    }
  });

  it('target 🐉 is always present', () => {
    for (let i = 0; i < 50; i++) {
      const g = generateReactionGame();
      expect(g.target).toBe(TARGET);
      expect(g.target).toBe('🐉');
      expect(g.options).toContain('🐉');
    }
  });

  it('target appears in different positions across calls (shuffled)', () => {
    const positions = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const g = generateReactionGame();
      positions.add(g.options.indexOf(g.target));
    }
    // With 100 shuffles, all 5 positions should appear at least once.
    expect(positions.size).toBeGreaterThanOrEqual(4);
  });
});
