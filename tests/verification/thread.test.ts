import type { GuildMember } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { __for_testing } from '../../src/modules/verification/flow.js';

/**
 * Phase 11 A2: per-user verify thread naming.
 *
 * Discord thread-name constraints:
 *   - Max 100 chars
 *   - Lower-case alphanumeric + dash recommended
 *   - We add the `verify-` prefix (7 chars) so the slug portion has
 *     93 chars max. threadNameFor truncates to 50 to leave headroom.
 */

const { threadNameFor } = __for_testing;

function mockMember(opts: { username?: string; tag?: string; id?: string } = {}): GuildMember {
  return {
    id: opts.id ?? '123456789012345678',
    user: {
      username: opts.username ?? 'aliceDev',
      tag: opts.tag ?? `${opts.username ?? 'aliceDev'}#0001`,
    },
  } as unknown as GuildMember;
}

describe('threadNameFor', () => {
  it('uses username slugified', () => {
    expect(threadNameFor(mockMember({ username: 'aliceDev' }))).toBe('verify-alicedev');
    expect(threadNameFor(mockMember({ username: 'BillTruong' }))).toBe('verify-billtruong');
  });

  it('replaces non-alphanumeric with single dashes', () => {
    expect(threadNameFor(mockMember({ username: 'alice.dev_2024' }))).toBe('verify-alice-dev-2024');
    expect(threadNameFor(mockMember({ username: 'alice  dev' }))).toBe('verify-alice-dev');
  });

  it('strips trailing/leading dashes', () => {
    expect(threadNameFor(mockMember({ username: '_alice_' }))).toBe('verify-alice');
  });

  it('truncates very long usernames to 50 chars in the slug portion', () => {
    const long = 'a'.repeat(80);
    const name = threadNameFor(mockMember({ username: long }));
    expect(name).toMatch(/^verify-a{50}$/);
    expect(name.length).toBeLessThanOrEqual(100); // discord limit
  });

  it('falls back to last 6 of discord id when username has no alphanumerics', () => {
    const id = '987654321098765432';
    const name = threadNameFor(mockMember({ id, username: '@@@' }));
    expect(name).toBe(`verify-${id.slice(-6)}`);
  });

  it('handles unicode-only usernames by falling back to id', () => {
    const id = '111222333444555666';
    const name = threadNameFor(mockMember({ id, username: '🔥🔥🔥' }));
    expect(name).toBe(`verify-${id.slice(-6)}`);
  });

  it('is deterministic for the same input', () => {
    const m = mockMember({ username: 'alice' });
    expect(threadNameFor(m)).toBe(threadNameFor(m));
  });

  it('produces a valid Discord thread name (lowercase + alphanumeric + dash)', () => {
    const name = threadNameFor(mockMember({ username: 'Some.Mixed_User-123' }));
    expect(name).toMatch(/^[a-z0-9-]+$/);
  });
});
