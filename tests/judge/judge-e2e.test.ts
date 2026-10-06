import { describe, expect, it, vi } from 'vitest';

// Runs real programs with the local python / node / dotnet, so it is opt-in:
//   JUDGE_E2E=1 npx vitest run tests/judge/judge-e2e.test.ts --pool=forks
vi.hoisted(() => {
  process.env.JUDGE_LOCAL = '1';
});

import { judgeProblem } from '../../src/config/judge-problems.js';
import type { JudgeLang } from '../../src/modules/judge/harness.js';
import { judge } from '../../src/modules/judge/judge.js';
import { BAD, SOLUTIONS } from './solutions/solutions.js';

const RUN = process.env.JUDGE_E2E === '1';
const LANGS = (process.env.JUDGE_E2E_LANGS ?? 'python,javascript,csharp').split(',') as JudgeLang[];

describe.skipIf(!RUN)('judge end to end (local runners)', () => {
  for (const [slug, sol] of Object.entries(SOLUTIONS))
    for (const lang of LANGS)
      it(`${slug} / ${lang} is accepted`, async () => {
        const p = judgeProblem(slug);
        if (!p) throw new Error(slug);
        const r = await judge(p, lang, sol[lang], 'hidden');
        expect(r, JSON.stringify(r)).toMatchObject({ verdict: 'accepted' });
        expect(r.passed).toBe(r.total);
      }, 120_000);

  it('reports wrong, crash, syntax and forged result lines', async () => {
    const p = judgeProblem('sap-xep-co-ban');
    if (!p) throw new Error('missing');
    expect((await judge(p, 'python', BAD.wrong, 'examples')).verdict).toBe('wrong');
    expect((await judge(p, 'python', BAD.crash, 'examples')).verdict).toBe('runtime-error');
    expect((await judge(p, 'python', BAD.syntax, 'examples')).verdict).toBe('compile-error');
    expect((await judge(p, 'python', BAD.forgedLine, 'examples')).verdict).toBe('wrong');
  }, 60_000);
});
