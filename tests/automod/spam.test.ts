import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spamTracker } from '../../src/modules/automod/rules/spam-detection.js';

/**
 * SpamTracker is module-singleton (shared across messageCreate calls
 * in production), so we reset between tests to keep them isolated.
 */

const WINDOW = 60_000;

describe('SpamTracker', () => {
  beforeEach(() => {
    spamTracker.reset('u1');
    spamTracker.reset('u2');
  });

  afterEach(() => {
    spamTracker.reset('u1');
    spamTracker.reset('u2');
  });

  it('different messages → count stays 1 each', () => {
    expect(spamTracker.record('u1', 'hello', WINDOW, 1_000)).toBe(1);
    expect(spamTracker.record('u1', 'world', WINDOW, 2_000)).toBe(1);
    expect(spamTracker.record('u1', 'again', WINDOW, 3_000)).toBe(1);
  });

  it('same message N times → count grows', () => {
    expect(spamTracker.record('u1', 'spam', WINDOW, 1_000)).toBe(1);
    expect(spamTracker.record('u1', 'spam', WINDOW, 2_000)).toBe(2);
    expect(spamTracker.record('u1', 'spam', WINDOW, 3_000)).toBe(3);
  });

  it('normalization: case + whitespace + punctuation', () => {
    expect(spamTracker.record('u1', 'SPAM', WINDOW, 1_000)).toBe(1);
    expect(spamTracker.record('u1', '  spam  ', WINDOW, 2_000)).toBe(2);
    expect(spamTracker.record('u1', 'spam!', WINDOW, 3_000)).toBe(3);
    expect(spamTracker.record('u1', 'spam   spam', WINDOW, 4_000)).toBe(1); // different normalized
  });

  it('window pruning: old occurrences drop out', () => {
    spamTracker.record('u1', 'spam', WINDOW, 0);
    spamTracker.record('u1', 'spam', WINDOW, 1_000);
    spamTracker.record('u1', 'spam', WINDOW, 2_000);
    // Jump past the window — first three drop out.
    const count = spamTracker.record('u1', 'spam', WINDOW, WINDOW + 5_000);
    expect(count).toBe(1);
  });

  it('different users are isolated', () => {
    spamTracker.record('u1', 'spam', WINDOW, 1_000);
    spamTracker.record('u1', 'spam', WINDOW, 2_000);
    const u2Count = spamTracker.record('u2', 'spam', WINDOW, 3_000);
    expect(u2Count).toBe(1);
  });

  it('reset clears one user without touching others', () => {
    spamTracker.record('u1', 'a', WINDOW, 1_000);
    spamTracker.record('u2', 'b', WINDOW, 2_000);
    spamTracker.reset('u1');
    expect(spamTracker.record('u1', 'a', WINDOW, 3_000)).toBe(1);
    expect(spamTracker.record('u2', 'b', WINDOW, 4_000)).toBe(2);
  });
});
