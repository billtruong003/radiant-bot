import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/modules/judge/judge.js', async (orig) => {
  const real = await orig<typeof import('../../src/modules/judge/judge.js')>();
  return {
    ...real,
    judge: vi.fn(async (_p: unknown, _l: unknown, code: string) => ({
      verdict: code.includes('GOOD') ? 'accepted' : code.includes('DOWN') ? 'offline' : 'wrong',
      passed: code.includes('GOOD') ? 17 : 3,
      total: 17,
      ms: 5,
      provider: 'local',
    })),
  };
});

import { Store, __setStoreForTesting } from '../../src/db/index.js';
import {
  DEADLINE_GRACE_MS,
  MAX_SUBMITS,
  type Trial,
  clearTrialHooks,
  createTrial,
  findCopies,
  forfeitTrial,
  getTrial,
  onTrialFinished,
  openTrial,
  pickProblems,
  readTrialToken,
  submitSolution,
  sweepTrials,
  trialToken,
} from '../../src/modules/judge/trial.js';
import { mkTmpDir } from '../helpers/tmp-dir.js';

let store: Store;
let cleanup: () => Promise<void>;
const finished: Trial[] = [];

beforeAll(async () => {
  const tmp = await mkTmpDir();
  cleanup = tmp.cleanup;
  store = new Store({ dataDir: tmp.dir, snapshotIntervalMs: 2_000_000_000, fsync: false });
  await store.init();
  __setStoreForTesting(store);
});
afterAll(async () => {
  __setStoreForTesting(null);
  await store.shutdown();
  await cleanup();
});
beforeEach(() => {
  finished.length = 0;
  clearTrialHooks();
  onTrialFinished((t) => {
    finished.push(t);
  });
});

const make = (problems = ['two-sum', 'coin-change']) =>
  createTrial({
    discordId: 'u1',
    mode: 'tribulation',
    tier: 'cuu_thien',
    problems,
    durationMs: 60_000,
    now: 1_000,
  });

describe('trial links', () => {
  it('round-trips a signed token and refuses a tampered one', async () => {
    const t = await make();
    const tok = trialToken(t, 's3cret');
    expect(readTrialToken(tok, 's3cret')?.id).toBe(t.id);
    expect(readTrialToken(tok, 'other')).toBeNull();
    expect(readTrialToken(`${tok}x`, 's3cret')).toBeNull();
  });

  it('picks one hard problem first for Cửu Thiên, distinct problems', () => {
    for (let i = 0; i < 20; i++) {
      const ps = pickProblems('cuu_thien');
      expect(ps).toHaveLength(2);
      expect(new Set(ps).size).toBe(2);
      expect(['coin-change', 'bfs-tim-duong-tren-luoi']).toContain(ps[0]);
    }
  });
});

describe('trial lifecycle', () => {
  it('starts the clock on first open only', async () => {
    const t = await make();
    await openTrial(t, 5_000);
    expect(t.meta.deadline).toBe(65_000);
    await openTrial(t, 9_000);
    expect(t.meta.deadline).toBe(65_000);
    expect(getTrial(t.id)?.meta.opened_at).toBe(5_000);
  });

  it('refuses submits before opening and after the deadline', async () => {
    const t = await make();
    expect(await submitSolution(t, 'two-sum', 'python', 'GOOD', 2_000)).toEqual({
      ok: false,
      reason: 'not-started',
    });
    await openTrial(t, 2_000);
    expect(
      await submitSolution(t, 'two-sum', 'python', 'GOOD', 62_000 + DEADLINE_GRACE_MS + 1),
    ).toEqual({
      ok: false,
      reason: 'time-up',
    });
    expect(await submitSolution(t, 'binary-search', 'python', 'GOOD', 3_000)).toEqual({
      ok: false,
      reason: 'unknown-problem',
    });
  });

  it('passes once every problem is solved and calls the hook once', async () => {
    const t = await make();
    await openTrial(t, 2_000);
    await submitSolution(t, 'two-sum', 'python', 'GOOD', 3_000);
    expect(t.meta.status).toBe('open');
    await submitSolution(t, 'coin-change', 'csharp', 'nope', 4_000);
    await submitSolution(t, 'coin-change', 'csharp', 'GOOD', 5_000);
    expect(t.meta.status).toBe('passed');
    expect(finished.map((f) => f.id)).toEqual([t.id]);
    expect(t.meta.log.map((l) => l.verdict)).toEqual(['accepted', 'wrong', 'accepted']);
    expect(t.meta.log[0]?.sha).toHaveLength(16);
    expect(await submitSolution(t, 'two-sum', 'python', 'GOOD', 6_000)).toEqual({
      ok: false,
      reason: 'closed',
    });
  });

  it('gives the submit back when the runner is down', async () => {
    const t = await make();
    await openTrial(t, 2_000);
    await submitSolution(t, 'two-sum', 'python', 'DOWN', 3_000);
    expect(t.meta.submits).toBe(0);
  });

  it('fails after the last submit is used', async () => {
    const t = await make();
    await openTrial(t, 2_000);
    for (let i = 0; i < MAX_SUBMITS; i++)
      await submitSolution(t, 'two-sum', 'python', 'bad', 3_000 + i);
    expect(t.meta.status).toBe('failed');
    expect(finished).toHaveLength(1);
  });

  it('sweeps trials past their deadline and links never opened', async () => {
    const late = await make();
    await openTrial(late, 2_000);
    const unopened = await make();
    await sweepTrials(62_000 + DEADLINE_GRACE_MS + 1);
    expect(getTrial(late.id)?.meta.status).toBe('failed');
    expect(getTrial(unopened.id)?.meta.status).toBe('open');
    await sweepTrials(unopened.meta.link_expires + 1);
    expect(getTrial(unopened.id)?.meta.status).toBe('expired');
  });

  it('forfeit ends the trial', async () => {
    const t = await make();
    await openTrial(t, 2_000);
    await forfeitTrial(t);
    expect(t.meta.status).toBe('failed');
    expect(finished).toHaveLength(1);
  });
});

describe('copy detection', () => {
  it('flags the same accepted code from another member', async () => {
    const a = await createTrial({
      discordId: 'ca',
      mode: 'practice',
      tier: null,
      problems: ['two-sum'],
      durationMs: 60_000,
      now: 1_000,
    });
    const b = await createTrial({
      discordId: 'cb',
      mode: 'practice',
      tier: null,
      problems: ['two-sum'],
      durationMs: 60_000,
      now: 1_000,
    });
    await openTrial(a, 2_000);
    await openTrial(b, 2_000);
    await submitSolution(a, 'two-sum', 'python', 'GOOD  code', 3_000);
    await submitSolution(b, 'two-sum', 'python', 'GOOD code', 3_000);
    const sha = b.meta.log.at(-1)?.sha ?? '';
    expect(findCopies(b, 'two-sum', sha)).toEqual(['ca']);
    expect(findCopies(b, 'coin-change', sha)).toEqual([]);
  });
});
