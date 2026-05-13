import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../../src/utils/rate-limiter.js';

describe('RateLimiter', () => {
  it('first call passes, immediate repeat blocked', () => {
    const rl = new RateLimiter(60_000);
    expect(rl.tryConsume('user-1', 1000)).toBe(true);
    expect(rl.tryConsume('user-1', 1001)).toBe(false);
  });

  it('separate keys do not affect each other', () => {
    const rl = new RateLimiter(60_000);
    expect(rl.tryConsume('a', 1000)).toBe(true);
    expect(rl.tryConsume('b', 1000)).toBe(true);
    expect(rl.tryConsume('a', 1001)).toBe(false);
    expect(rl.tryConsume('b', 1001)).toBe(false);
  });

  it('passes again after cooldown elapses', () => {
    const rl = new RateLimiter(1000);
    expect(rl.tryConsume('u', 1_000)).toBe(true);
    expect(rl.tryConsume('u', 1_999)).toBe(false);
    expect(rl.tryConsume('u', 2_000)).toBe(true);
  });

  it('remainingMs returns 0 when allowed, positive when cooling down', () => {
    const rl = new RateLimiter(1000);
    expect(rl.remainingMs('u', 1_000)).toBe(0);
    rl.tryConsume('u', 1_000);
    expect(rl.remainingMs('u', 1_500)).toBe(500);
    expect(rl.remainingMs('u', 2_000)).toBe(0);
  });

  it('reset clears a single key', () => {
    const rl = new RateLimiter(60_000);
    rl.tryConsume('u', 1000);
    rl.reset('u');
    expect(rl.tryConsume('u', 1001)).toBe(true);
  });

  it('sweep removes expired entries, keeps active ones', () => {
    const rl = new RateLimiter(1000);
    rl.tryConsume('expired', 1000);
    rl.tryConsume('active', 5000);
    expect(rl.size()).toBe(2);
    const removed = rl.sweep(5500);
    expect(removed).toBe(1);
    expect(rl.size()).toBe(1);
  });
});
