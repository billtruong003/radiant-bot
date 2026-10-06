import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { ulid } from 'ulid';
import { type JudgeProblem, judgeProblem, loadJudgeBank } from '../../config/judge-problems.js';
import type { TribulationTier } from '../../config/leveling.js';
import { getStore } from '../../db/index.js';
import type { SectEvent } from '../../db/types.js';
import { logger } from '../../utils/logger.js';
import type { JudgeLang } from './harness.js';
import { type JudgeResult, judge } from './judge.js';

/**
 * A Thiên Kiếp Đài trial: one member, one or two problems, a clock that
 * starts when the page is first opened. Stored as a SectEvent so a restart
 * keeps it (and so the tribulation cooldown sees it). Finishing — solved,
 * out of time, given up — calls the hooks registered by the Discord side.
 */

export type TrialMode = 'tribulation' | 'practice';
export type TrialStatus = 'open' | 'passed' | 'failed' | 'expired';

export interface TrialLogEntry {
  at: number;
  slug: string;
  lang: JudgeLang;
  kind: 'run' | 'submit';
  verdict: string;
  passed: number;
  total: number;
  /** Fingerprint of the code, for spotting copied answers; the code itself is not stored. */
  sha: string;
  chars: number;
}

export interface TrialMeta {
  kind: 'judge';
  discord_id: string;
  mode: TrialMode;
  tier: TribulationTier | null;
  problems: string[];
  duration_ms: number;
  link_expires: number;
  opened_at: number | null;
  deadline: number | null;
  solved: string[];
  submits: number;
  runs: number;
  status: TrialStatus;
  log: TrialLogEntry[];
}

export interface Trial {
  id: string;
  meta: TrialMeta;
}

/** How long a sent link stays valid if never opened. */
export const LINK_OPEN_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Late submits are accepted for this long after the clock hits zero (network lag). */
export const DEADLINE_GRACE_MS = 30_000;
export const MAX_SUBMITS = 12;
export const MAX_SERVER_RUNS = 15;
const LOG_CAP = 60;

export const TRIAL_SHAPE: Record<
  'tam_ma' | 'cuu_thien' | 'practice',
  { count: number; pool: JudgeProblem['difficulty'][]; durationMs: number }
> = {
  tam_ma: { count: 1, pool: ['medium'], durationMs: 45 * 60_000 },
  cuu_thien: { count: 2, pool: ['hard', 'medium'], durationMs: 90 * 60_000 },
  practice: { count: 1, pool: ['easy'], durationMs: 30 * 60_000 },
};

/** Problems for a trial; Cửu Thiên always gets at least one hard problem. */
export function pickProblems(
  shape: keyof typeof TRIAL_SHAPE,
  rand: () => number = Math.random,
): string[] {
  const { count, pool } = TRIAL_SHAPE[shape];
  const all = loadJudgeBank().problems;
  const shuffled = (list: JudgeProblem[]) =>
    list
      .map((p) => ({ p, k: rand() }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.p.slug);
  const first = shuffled(all.filter((p) => p.difficulty === pool[0]));
  const rest = shuffled(all.filter((p) => pool.slice(1).includes(p.difficulty)));
  return [...first.slice(0, 1), ...[...first.slice(1), ...rest].slice(0, count - 1)];
}

// ---------------------------------------------------------------- store

function toTrial(e: SectEvent | undefined): Trial | null {
  const m = e?.metadata as TrialMeta | null | undefined;
  return e && m && m.kind === 'judge' ? { id: e.id, meta: m } : null;
}

export function getTrial(id: string): Trial | null {
  return toTrial(getStore().events.get(id));
}

async function save(t: Trial, ended = false): Promise<void> {
  const store = getStore();
  const e = store.events.get(t.id);
  if (!e) return;
  await store.events.set({
    ...e,
    metadata: { ...t.meta },
    ended_at: ended ? Date.now() : e.ended_at,
  });
}

export async function createTrial(o: {
  discordId: string;
  mode: TrialMode;
  tier: TribulationTier | null;
  problems: string[];
  durationMs: number;
  now?: number;
}): Promise<Trial> {
  const now = o.now ?? Date.now();
  const meta: TrialMeta = {
    kind: 'judge',
    discord_id: o.discordId,
    mode: o.mode,
    tier: o.tier,
    problems: o.problems,
    duration_ms: o.durationMs,
    link_expires: now + LINK_OPEN_WINDOW_MS,
    opened_at: null,
    deadline: null,
    solved: [],
    submits: 0,
    runs: 0,
    status: 'open',
    log: [],
  };
  const id = ulid();
  await getStore().events.set({
    id,
    name: o.mode === 'tribulation' ? 'Thiên Kiếp Đài' : 'Luyện đề Tàng Kinh Các',
    type: o.mode === 'tribulation' ? 'tribulation' : 'custom',
    started_at: now,
    ended_at: null,
    metadata: { ...meta },
  });
  return { id, meta };
}

/** Open trials of a member (at most one is expected). */
export function openTrialOf(discordId: string, mode?: TrialMode): Trial | null {
  const all = getStore()
    .events.query((e) => {
      const m = e.metadata as TrialMeta | null;
      return Boolean(m && m.kind === 'judge' && m.discord_id === discordId && m.status === 'open');
    })
    .map((e) => toTrial(e))
    .filter((t): t is Trial => t !== null && (!mode || t.meta.mode === mode));
  return all[0] ?? null;
}

// ---------------------------------------------------------------- links

const sign = (payload: string, secret: string): string =>
  createHmac('sha256', secret).update(`judge:${payload}`).digest('base64url');

export function trialToken(t: Trial, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ i: t.id, d: t.meta.discord_id })).toString(
    'base64url',
  );
  return `${payload}.${sign(payload, secret)}`;
}

/** The trial a link points at, if the signature holds. Status is checked by the caller. */
export function readTrialToken(token: string, secret: string): Trial | null {
  const [payload, mac] = token.split('.');
  if (!payload || !mac || !secret) return null;
  const a = Buffer.from(sign(payload, secret));
  const b = Buffer.from(mac);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      i?: unknown;
      d?: unknown;
    };
    if (typeof body.i !== 'string' || typeof body.d !== 'string') return null;
    const t = getTrial(body.i);
    return t && t.meta.discord_id === body.d ? t : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- lifecycle

type FinishHook = (t: Trial) => Promise<void> | void;
const hooks: FinishHook[] = [];

/** Called once per trial when it ends (passed, failed or expired). */
export function onTrialFinished(h: FinishHook): void {
  hooks.push(h);
}

export function clearTrialHooks(): void {
  hooks.length = 0;
}

async function finish(t: Trial, status: Exclude<TrialStatus, 'open'>): Promise<void> {
  if (t.meta.status !== 'open') return;
  t.meta.status = status;
  await save(t, true);
  logger.info(
    { trial: t.id, discord_id: t.meta.discord_id, status, solved: t.meta.solved.length },
    'judge: trial finished',
  );
  for (const h of hooks) {
    try {
      await h(t);
    } catch (err) {
      logger.error({ err, trial: t.id }, 'judge: finish hook failed');
    }
  }
}

/** First page load starts the clock. Returns the (possibly updated) trial. */
export async function openTrial(t: Trial, now = Date.now()): Promise<Trial> {
  if (t.meta.status === 'open' && t.meta.opened_at === null) {
    if (now > t.meta.link_expires) {
      await finish(t, 'expired');
      return t;
    }
    t.meta.opened_at = now;
    t.meta.deadline = now + t.meta.duration_ms;
    await save(t);
  }
  return t;
}

/** Ends trials whose clock ran out or whose link was never opened. */
export async function sweepTrials(now = Date.now()): Promise<number> {
  const open = getStore()
    .events.query((e) => {
      const m = e.metadata as TrialMeta | null;
      return m?.kind === 'judge' && m.status === 'open';
    })
    .map((e) => toTrial(e))
    .filter((t): t is Trial => t !== null);
  let n = 0;
  for (const t of open) {
    if (t.meta.deadline !== null && now > t.meta.deadline + DEADLINE_GRACE_MS) {
      await finish(t, 'failed');
      n++;
    } else if (t.meta.opened_at === null && now > t.meta.link_expires) {
      await finish(t, 'expired');
      n++;
    }
  }
  return n;
}

export async function forfeitTrial(t: Trial): Promise<void> {
  await finish(t, 'failed');
}

export type ActionRefusal =
  | 'closed'
  | 'not-started'
  | 'time-up'
  | 'unknown-problem'
  | 'no-submits'
  | 'no-runs';

function refuse(t: Trial, slug: string, now: number): ActionRefusal | null {
  if (t.meta.status !== 'open') return 'closed';
  if (t.meta.deadline === null) return 'not-started';
  if (now > t.meta.deadline + DEADLINE_GRACE_MS) return 'time-up';
  if (!t.meta.problems.includes(slug)) return 'unknown-problem';
  return null;
}

const fingerprint = (code: string): string =>
  createHash('sha256').update(code.replace(/\s+/g, '')).digest('hex').slice(0, 16);

/** Server-side example run (used for C#; Python and JS run in the browser). */
export async function runExamples(
  t: Trial,
  slug: string,
  lang: JudgeLang,
  code: string,
  now = Date.now(),
): Promise<{ ok: false; reason: ActionRefusal } | { ok: true; result: JudgeResult }> {
  const r = refuse(t, slug, now);
  if (r) return { ok: false, reason: r };
  if (t.meta.runs >= MAX_SERVER_RUNS) return { ok: false, reason: 'no-runs' };
  const p = judgeProblem(slug);
  if (!p) return { ok: false, reason: 'unknown-problem' };
  t.meta.runs += 1;
  await save(t);
  const result = await judge(p, lang, code, 'examples');
  pushLog(t, {
    at: now,
    slug,
    lang,
    kind: 'run',
    verdict: result.verdict,
    passed: result.passed,
    total: result.total,
    sha: fingerprint(code),
    chars: code.length,
  });
  await save(t);
  return { ok: true, result };
}

function pushLog(t: Trial, e: TrialLogEntry): void {
  t.meta.log = [...t.meta.log, e].slice(-LOG_CAP);
}

/** Full hidden-test submit. Solving every problem passes the trial. */
export async function submitSolution(
  t: Trial,
  slug: string,
  lang: JudgeLang,
  code: string,
  now = Date.now(),
): Promise<{ ok: false; reason: ActionRefusal } | { ok: true; result: JudgeResult; trial: Trial }> {
  const r = refuse(t, slug, now);
  if (r) return { ok: false, reason: r };
  if (t.meta.submits >= MAX_SUBMITS) return { ok: false, reason: 'no-submits' };
  const p = judgeProblem(slug);
  if (!p) return { ok: false, reason: 'unknown-problem' };
  t.meta.submits += 1;
  await save(t);
  const result = await judge(p, lang, code, 'hidden');
  // A runner outage is not the player's fault: give the submit back.
  if (result.verdict === 'offline') t.meta.submits -= 1;
  pushLog(t, {
    at: now,
    slug,
    lang,
    kind: 'submit',
    verdict: result.verdict,
    passed: result.passed,
    total: result.total,
    sha: fingerprint(code),
    chars: code.length,
  });
  if (result.verdict === 'accepted' && !t.meta.solved.includes(slug))
    t.meta.solved = [...t.meta.solved, slug];
  await save(t);
  if (result.verdict === 'accepted') void reportCopies(t, slug, fingerprint(code));
  if (t.meta.problems.every((s) => t.meta.solved.includes(s))) await finish(t, 'passed');
  else if (t.meta.submits >= MAX_SUBMITS) await finish(t, 'failed');
  return { ok: true, result, trial: t };
}

/** Earlier accepted submits of the same problem with the same code fingerprint by someone else. */
export function findCopies(t: Trial, slug: string, sha: string): string[] {
  const others = new Set<string>();
  for (const e of getStore().events.query(
    (ev) => (ev.metadata as TrialMeta | null)?.kind === 'judge',
  )) {
    const m = e.metadata as unknown as TrialMeta;
    if (m.discord_id === t.meta.discord_id) continue;
    if (
      m.log.some(
        (l) => l.kind === 'submit' && l.slug === slug && l.sha === sha && l.verdict === 'accepted',
      )
    )
      others.add(m.discord_id);
  }
  return [...others];
}

async function reportCopies(t: Trial, slug: string, sha: string): Promise<void> {
  const others = findCopies(t, slug, sha);
  if (others.length === 0) return;
  logger.warn(
    { trial: t.id, discord_id: t.meta.discord_id, slug, others },
    'judge: identical accepted code',
  );
  const { postBotLog } = await import('../bot-log.js');
  await postBotLog(
    `🔎 Thiên Kiếp Đài: <@${t.meta.discord_id}> nộp lời giải \`${slug}\` giống hệt (bỏ khoảng trắng) bài đã qua của ${others
      .map((id) => `<@${id}>`)
      .join(', ')}. Có thể là chép bài, xem lại nhật ký nộp (trial ${t.id}).`,
  );
}

let sweeper: NodeJS.Timeout | null = null;

export function startTrialSweeper(): void {
  if (sweeper) return;
  sweeper = setInterval(() => {
    void sweepTrials().catch((err: unknown) => logger.error({ err }, 'judge: sweep failed'));
  }, 30_000);
  sweeper.unref();
}

export function stopTrialSweeper(): void {
  if (sweeper) clearInterval(sweeper);
  sweeper = null;
}
