import { afterEach, describe, expect, it } from 'vitest';
import {
  getCooldownMs,
  getRemainingCooldownMs,
  isOnCooldown,
  recordFailedVerifyKick,
  reset,
  setCooldownMs,
} from '../../src/modules/verification/rejoin-cooldown.js';

/**
 * B6 — verify re-attempt cooldown. In-memory map, lazy pruning.
 */
describe('verify rejoin cooldown', () => {
  afterEach(() => {
    reset();
  });

  it('default cooldown is 1 hour', () => {
    expect(getCooldownMs()).toBe(60 * 60 * 1000);
  });

  it('fresh user has no cooldown', () => {
    expect(isOnCooldown('u1', 1_000_000)).toBe(false);
    expect(getRemainingCooldownMs('u1', 1_000_000)).toBeNull();
  });

  it('record sets cooldown expiring at now + cooldownMs', () => {
    setCooldownMs(10_000);
    recordFailedVerifyKick('u1', 1_000_000);
    expect(getRemainingCooldownMs('u1', 1_000_500)).toBe(9_500);
    expect(isOnCooldown('u1', 1_000_500)).toBe(true);
  });

  it('cooldown expires after window', () => {
    setCooldownMs(10_000);
    recordFailedVerifyKick('u1', 1_000_000);
    expect(isOnCooldown('u1', 1_010_001)).toBe(false);
    // Lazy prune dropped the entry
    expect(getRemainingCooldownMs('u1', 1_010_001)).toBeNull();
  });

  it('per-user isolation', () => {
    setCooldownMs(10_000);
    recordFailedVerifyKick('u1', 1_000_000);
    expect(isOnCooldown('u2', 1_000_500)).toBe(false);
    expect(isOnCooldown('u1', 1_000_500)).toBe(true);
  });

  it('re-recording overwrites with fresh window', () => {
    setCooldownMs(10_000);
    recordFailedVerifyKick('u1', 1_000_000);
    recordFailedVerifyKick('u1', 1_005_000);
    expect(getRemainingCooldownMs('u1', 1_005_500)).toBe(9_500);
  });

  it('reset clears all + restores default cooldown', () => {
    setCooldownMs(123_456);
    recordFailedVerifyKick('u1', 1_000_000);
    reset();
    expect(getCooldownMs()).toBe(60 * 60 * 1000);
    expect(isOnCooldown('u1', 1_000_001)).toBe(false);
  });
});
