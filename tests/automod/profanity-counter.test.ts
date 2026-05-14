import { afterEach, describe, expect, it } from 'vitest';
import {
  WINDOW_MS_FOR_TESTING,
  getCount,
  recordHit,
  reset,
} from '../../src/modules/automod/profanity-counter.js';

describe('profanity-counter (sliding 60s window)', () => {
  afterEach(() => {
    reset();
  });

  it('first hit returns 1', () => {
    expect(recordHit('u1', 1_000)).toBe(1);
  });

  it('successive hits in window accumulate', () => {
    expect(recordHit('u1', 1_000)).toBe(1);
    expect(recordHit('u1', 2_000)).toBe(2);
    expect(recordHit('u1', 3_000)).toBe(3);
  });

  it('hits older than the window are pruned', () => {
    recordHit('u1', 1_000);
    recordHit('u1', 5_000);
    // Move forward past the 60s window relative to ts=1000.
    const afterWindow = 1_000 + WINDOW_MS_FOR_TESTING + 100;
    // ts=5000 is still inside the window (5000 + 60000 = 65100 > 61100),
    // so we expect count=1 (just the t=5000 hit), then +1 for the new hit.
    expect(recordHit('u1', afterWindow)).toBe(2);
  });

  it('drops user from internal map once window fully expires', () => {
    recordHit('u1', 1_000);
    recordHit('u1', 2_000);
    const fullyPast = 2_000 + WINDOW_MS_FOR_TESTING + 1;
    expect(getCount('u1', fullyPast)).toBe(0);
  });

  it('per-user isolation', () => {
    recordHit('u1', 1_000);
    recordHit('u1', 2_000);
    expect(recordHit('u2', 2_500)).toBe(1);
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
    for (let i = 1; i <= 4; i++) count = recordHit('u-thr', 1_000 + i);
    expect(count).toBe(4);
    // Hit 5 → stern tier starts
    expect(recordHit('u-thr', 1_005)).toBe(5);
    // Hits 6..14 → still stern (count < 15)
    for (let i = 6; i <= 14; i++) count = recordHit('u-thr', 1_000 + i);
    expect(count).toBe(14);
    // Hit 15 → delete tier
    expect(recordHit('u-thr', 1_015)).toBe(15);
  });
});
