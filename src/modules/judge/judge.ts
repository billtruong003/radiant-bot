import { randomBytes } from 'node:crypto';
import { type JudgeCase, type JudgeProblem, loadJudgeBank } from '../../config/judge-problems.js';
import { type JudgeLang, buildProgram, parseRun } from './harness.js';
import { type RunOutput, runProgram } from './runners.js';

/**
 * One submission: build the program, run it once, compare every printed
 * result with the expected answer. Hidden test data is never sent back to
 * the browser: a failing hidden test is reported by its number only.
 */

export type Verdict =
  | 'accepted'
  | 'wrong'
  | 'runtime-error'
  | 'compile-error'
  | 'timeout'
  | 'too-long'
  | 'offline';

export interface JudgeResult {
  verdict: Verdict;
  passed: number;
  total: number;
  ms: number | null;
  /** Shown for example runs only: the input, expected and actual of the first failure. */
  detail?: { index: number; input: string; expected: string; got: string };
  /** First failing hidden test (1-based), when it is hidden. */
  failedAt?: number;
  /** Error text from the program (compiler errors, exception message, prints). */
  message?: string;
  provider: RunOutput['provider'];
}

export const MAX_CODE_CHARS = 20_000;

/** Normalised text form of a value for comparison, per problem compare mode. */
export function canonical(v: unknown, mode: JudgeProblem['compare']): string {
  if (mode === 'sorted' && Array.isArray(v)) {
    return JSON.stringify(
      [...v].sort((a, b) => (Number(a) > Number(b) ? 1 : Number(a) < Number(b) ? -1 : 0)),
    );
  }
  if (mode === 'groups' && Array.isArray(v)) {
    return JSON.stringify(
      v
        .map((g) => (Array.isArray(g) ? [...g].map(String).sort() : [String(g)]))
        .map((g) => g.join('\u0001'))
        .sort(),
    );
  }
  return JSON.stringify(v);
}

function parseResult(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { __unparsable: raw.slice(0, 80) };
  }
}

/** Cut long text for display. */
const clip = (s: string, n = 600): string => (s.length > n ? `${s.slice(0, n)}…` : s);

export function grade(
  p: JudgeProblem,
  cases: JudgeCase[],
  run: RunOutput,
  nonce: string,
  showDetail: boolean,
): JudgeResult {
  const base = { total: cases.length, ms: run.ms, provider: run.provider };
  if (!run.ok) return { ...base, verdict: 'offline', passed: 0, message: run.error };
  const parsed = parseRun(run.output, nonce);
  const timedOut = /\[timeout\]|timed? ?out|JDoodle - Timeout|Killed/i.test(parsed.other);
  if (parsed.results.size === 0 && parsed.errors.size === 0) {
    const compile =
      /error CS\d+|SyntaxError|IndentationError|TabError|NameError|ReferenceError|is not defined/i.test(
        parsed.other,
      );
    return {
      ...base,
      verdict: timedOut ? 'timeout' : compile ? 'compile-error' : 'runtime-error',
      passed: 0,
      failedAt: 1,
      message: clip(parsed.other || 'Chương trình không in ra kết quả nào.'),
    };
  }
  let passed = 0;
  for (const [i, c] of cases.entries()) {
    const err = parsed.errors.get(i);
    const raw = parsed.results.get(i);
    const fail = (verdict: Verdict, got: string, message?: string): JudgeResult => ({
      ...base,
      verdict,
      passed,
      failedAt: i + 1,
      message,
      detail: showDetail
        ? {
            index: i + 1,
            input: clip(JSON.stringify(c.a), 300),
            expected: clip(JSON.stringify(c.e), 300),
            got: clip(got, 300),
          }
        : undefined,
    });
    if (err !== undefined) return fail('runtime-error', '(lỗi)', clip(err, 300));
    if (raw === undefined)
      return fail(
        timedOut ? 'timeout' : 'runtime-error',
        '(không có)',
        clip(parsed.other, 300) || undefined,
      );
    if (canonical(parseResult(raw), p.compare) !== canonical(c.e, p.compare))
      return fail('wrong', raw);
    passed += 1;
  }
  return { ...base, verdict: 'accepted', passed };
}

/** Run the examples (Chạy thử) or the full hidden set (Nộp bài). */
export async function judge(
  p: JudgeProblem,
  lang: JudgeLang,
  code: string,
  which: 'examples' | 'hidden',
): Promise<JudgeResult> {
  const cases = which === 'examples' ? p.examples : [...p.examples, ...p.tests];
  if (code.length > MAX_CODE_CHARS)
    return { verdict: 'too-long', passed: 0, total: cases.length, ms: null, provider: 'none' };
  const nonce = randomBytes(6).toString('hex');
  const program = buildProgram(p, lang, code, cases, nonce, loadJudgeBank().checksumOver);
  const run = await runProgram(lang, program);
  return grade(p, cases, run, nonce, which === 'examples');
}

export const VERDICT_TEXT: Record<Verdict, string> = {
  accepted: 'Qua hết test',
  wrong: 'Sai kết quả',
  'runtime-error': 'Lỗi khi chạy',
  'compile-error': 'Lỗi biên dịch / cú pháp',
  timeout: 'Quá thời gian',
  'too-long': 'Code quá dài',
  offline: 'Máy chấm đang nghỉ',
};
