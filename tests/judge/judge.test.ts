import { describe, expect, it } from 'vitest';
import { judgeProblem, loadJudgeBank } from '../../src/config/judge-problems.js';
import { buildProgram, parseRun, starterCode } from '../../src/modules/judge/harness.js';
import { canonical, grade } from '../../src/modules/judge/judge.js';

describe('judge problem bank', () => {
  it('has every problem with 15+ hidden tests and a docs lesson', () => {
    const { problems } = loadJudgeBank();
    expect(problems.length).toBeGreaterThanOrEqual(19);
    for (const p of problems) {
      expect(p.tests.length, p.slug).toBeGreaterThanOrEqual(15);
      expect(p.docs).toBe(`/docs/algorithms/${p.slug}/`);
    }
  });

  it('never puts expected answers into the program', () => {
    const p = judgeProblem('two-sum');
    if (!p) throw new Error('missing');
    const cases = [{ a: [[1, 2, 3], 5], e: 'EXPECTED-MARKER' }];
    for (const lang of ['python', 'javascript', 'csharp'] as const) {
      const prog = buildProgram(p, lang, starterCode(p, lang), cases, 'n1', 200);
      expect(prog).not.toContain('EXPECTED-MARKER');
    }
  });
});

describe('grading', () => {
  const p = judgeProblem('top-k-pho-bien');
  if (!p) throw new Error('missing');
  const cases = [
    { a: [[1, 1, 2], 1], e: [1] },
    { a: [[1, 1, 2, 2, 2, 3], 2], e: [2, 1] },
  ];
  const run = (output: string) => ({ ok: true, output, ms: 10, provider: 'local' as const });

  it('accepts any order for sorted problems and ignores other prints', () => {
    const r = grade(p, cases, run('hello\n@@Rab 0 [1]\n@@Rab 1 [1,2]'), 'ab', false);
    expect(r.verdict).toBe('accepted');
  });

  it('ignores result lines with another nonce and hides hidden test data', () => {
    const r = grade(p, cases, run('@@Rzz 0 [1]\n@@Rab 0 [1]\n@@Rab 1 [3,1]'), 'ab', false);
    expect(r).toMatchObject({ verdict: 'wrong', passed: 1, failedAt: 2 });
    expect(r.detail).toBeUndefined();
  });

  it('reports runtime errors and missing output', () => {
    expect(grade(p, cases, run('@@Eab 0 IndexError: boom'), 'ab', true).verdict).toBe(
      'runtime-error',
    );
    expect(
      grade(p, cases, run('  File "main.py", line 1\nSyntaxError: invalid syntax'), 'ab', true)
        .verdict,
    ).toBe('compile-error');
    expect(grade(p, cases, run('@@Rab 0 [1]\n[timeout]'), 'ab', true).verdict).toBe('timeout');
    expect(
      grade(
        p,
        cases,
        { ok: false, output: '', ms: null, provider: 'none', error: 'offline' },
        'ab',
        true,
      ).verdict,
    ).toBe('offline');
  });

  it('compares groups regardless of order', () => {
    expect(canonical([['b', 'a'], ['c']], 'groups')).toBe(canonical([['c'], ['a', 'b']], 'groups'));
  });

  it('parses only well-formed result lines', () => {
    const r = parseRun('@@Rab 0 1\n@@Rab x 2\nnoise', 'ab');
    expect([...r.results.keys()]).toEqual([0]);
    expect(r.other).toContain('noise');
  });
});
