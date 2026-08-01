import { describe, expect, it } from 'vitest';
import { todayInVietnam } from '../../src/modules/web/web-search.js';

describe('date anchoring', () => {
  // Aki has no clock. On 2026-08-01 she searched "best AI models 2025"
  // — her training-cutoff year — and reported last year's models as
  // current. Every prompt that can go stale now carries this date.
  it('formats a Vietnam-time date the model can read', () => {
    expect(todayInVietnam(new Date('2026-08-01T03:00:00Z'))).toBe('01/08/2026');
  });

  it('uses Vietnam time, not UTC, near midnight', () => {
    // 23:30 UTC on 31/07 is already 06:30 on 01/08 in Hồ Chí Minh.
    expect(todayInVietnam(new Date('2026-07-31T23:30:00Z'))).toBe('01/08/2026');
  });
});
