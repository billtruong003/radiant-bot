/**
 * Math puzzle generator for tribulation events. Difficulty scales by
 * the member's current level:
 *   - level <  20  : easy   "a + b"            (a, b in [1, 50])
 *   - level <  50  : medium "a + b × c"        (a in [1, 30], b/c in [1, 12])
 *   - level >= 50  : hard   "(a + b) × c - d"  (a, b in [1, 30], c in [2, 9], d in [1, 50])
 *
 * Returns multiple-choice options (4 total) so the embed can present
 * 4 buttons and not require a modal input. The correct answer is
 * always included; distractors are within ±20 of the answer.
 */

export interface MathPuzzle {
  question: string;
  expected: string;
  options: readonly string[];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i] as T;
    a[i] = a[j] as T;
    a[j] = tmp;
  }
  return a;
}

/**
 * Pure helper, exported for tests. Builds 4 unique options including
 * `correct`; distractors within ±20 of correct (clamped to ≥ 0).
 */
export function makeOptions(correct: string): readonly string[] {
  const correctNum = Number.parseInt(correct, 10);
  const set = new Set<string>([correct]);
  let attempts = 0;
  while (set.size < 4 && attempts < 50) {
    const delta = (Math.random() < 0.5 ? -1 : 1) * randInt(1, 20);
    const candidate = correctNum + delta;
    if (candidate >= 0) set.add(String(candidate));
    attempts++;
  }
  // Safety: if we couldn't build 4 distinct options (very small correct),
  // pad with sequential numbers.
  let pad = 100;
  while (set.size < 4) {
    set.add(String(pad++));
  }
  return shuffle([...set]);
}

export function generateMathPuzzle(level: number): MathPuzzle {
  if (level < 20) {
    const a = randInt(1, 50);
    const b = randInt(1, 50);
    const expected = String(a + b);
    return { question: `${a} + ${b} = ?`, expected, options: makeOptions(expected) };
  }
  if (level < 50) {
    const a = randInt(1, 30);
    const b = randInt(1, 12);
    const c = randInt(1, 12);
    const expected = String(a + b * c);
    return {
      question: `${a} + ${b} × ${c} = ?`,
      expected,
      options: makeOptions(expected),
    };
  }
  const a = randInt(1, 30);
  const b = randInt(1, 30);
  const c = randInt(2, 9);
  const d = randInt(1, 50);
  const expected = String((a + b) * c - d);
  return {
    question: `(${a} + ${b}) × ${c} - ${d} = ?`,
    expected,
    options: makeOptions(expected),
  };
}
