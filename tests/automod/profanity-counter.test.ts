import { afterEach, describe, expect, it } from 'vitest';
import {
  SWEEP_WINDOW_MS_FOR_TESTING,
  WINDOW_MS_FOR_TESTING,
  getCount,
  recordHit,
  reset,
} from '../../src/modules/automod/profanity-counter.js';

describe('profanity-counter (sliding 60s tier window + 15min sweep window)', () => {
  afterEach(() => {
    reset();
  });

  it('first hit returns count=1 + firstHitMs=now', () => {
    const r = recordHit('u1', 1_000);
    expect(r.count).toBe(1);
    expect(r.firstHitMs).toBe(1_000);
  });

  it('successive hits in tier window accumulate count', () => {
    expect(recordHit('u1', 1_000).count).toBe(1);
    expect(recordHit('u1', 2_000).count).toBe(2);
    expect(recordHit('u1', 3_000).count).toBe(3);
  });

  it('firstHitMs sticks to the oldest hit across recordHit calls', () => {
    recordHit('u1', 1_000);
    recordHit('u1', 5_000);
    const r = recordHit('u1', 10_000);
    expect(r.firstHitMs).toBe(1_000);
  });

  it('hits older than the tier (60s) window drop from count but stay in firstHitMs (15min)', () => {
    recordHit('u1', 1_000);
    // 90s later — outside tier window, still inside sweep window.
    const afterTier = 1_000 + WINDOW_MS_FOR_TESTING + 30_000;
    const r = recordHit('u1', afterTier);
    expect(r.count).toBe(1); // only the new hit is in the 60s window
    expect(r.firstHitMs).toBe(1_000); // but ts=1000 still inside 15min sweep
  });

  it('hits older than the sweep (15min) window drop entirely', () => {
    recordHit('u1', 1_000);
    const afterSweep = 1_000 + SWEEP_WINDOW_MS_FOR_TESTING + 1;
    const r = recordHit('u1', afterSweep);
    expect(r.count).toBe(1);
    expect(r.firstHitMs).toBe(afterSweep); // old ts=1000 pruned, new becomes oldest
  });

  it('drops user from internal map once window fully expires', () => {
    recordHit('u1', 1_000);
    recordHit('u1', 2_000);
    const fullyPast = 2_000 + SWEEP_WINDOW_MS_FOR_TESTING + 1;
    expect(getCount('u1', fullyPast)).toBe(0);
  });

  it('per-user isolation', () => {
    recordHit('u1', 1_000);
    recordHit('u1', 2_000);
    expect(recordHit('u2', 2_500).count).toBe(1);
    expect(getCount('u1', 2_500)).toBe(2);
  });

  it('reset(userId) clears only that user', () => {
    recordHit('u1', 1_000);
    recordHit('u2', 1_000);
    reset('u1');
    expect(getCount('u1', 1_000)).toBe(0);
    expect(getCount('u2', 1_000)).toBe(1);
  });

  it('reset() with no arg clears all', () => {
    recordHit('u1', 1_000);
    recordHit('u2', 1_000);
    reset();
    expect(getCount('u1', 1_000)).toBe(0);
    expect(getCount('u2', 1_000)).toBe(0);
  });

  it('threshold transitions match Phase 11.2 spec (5 = stern, 15 = delete)', () => {
    let count = 0;
    // Hits 1..4 → gentle tier (count < 5)
    for (let i = 1; i <= 4; i++) count = recordHit('u-thr', 1_000 + i).count;
    expect(count).toBe(4);
    // Hit 5 → stern tier starts
    expect(recordHit('u-thr', 1_005).count).toBe(5);
    // Hits 6..14 → still stern (count < 15)
    for (let i = 6; i <= 14; i++) count = recordHit('u-thr', 1_000 + i).count;
    expect(count).toBe(14);
    // Hit 15 → delete tier
    expect(recordHit('u-thr', 1_015).count).toBe(15);
  });
});
