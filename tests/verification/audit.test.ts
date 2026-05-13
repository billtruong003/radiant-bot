import type { GuildMember } from 'discord.js';
import { describe, expect, it } from 'vitest';
import type { VerificationConfig } from '../../src/config/verification.js';
import { auditMember } from '../../src/modules/verification/audit.js';

const NOW = 1_700_000_000_000; // fixed clock for determinism

const CONFIG: VerificationConfig = {
  thresholds: {
    accountAgeKickDays: 1,
    accountAgeSuspectDays: 7,
    captchaTimeoutMs: 300_000,
    captchaMaxAttempts: 3,
    raidJoinWindowMs: 60_000,
    raidJoinThreshold: 10,
  },
  botUsernamePatterns: [
    String.raw`^[a-z]+\d{4,}$`,
    String.raw`^[A-Z][a-z]+[A-Z][a-z]+\d+$`,
    String.raw`^.{1,3}$`,
    String.raw`^[a-z]{8,}$`,
  ],
  captcha: {
    mathMinA: 1,
    mathMaxA: 20,
    mathMinB: 1,
    mathMaxB: 20,
    imageChars: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
    imageLength: 6,
  },
};

interface FakeMemberOpts {
  ageDays: number;
  username: string;
  hasAvatar: boolean;
}

function fakeMember(opts: FakeMemberOpts): GuildMember {
  const createdTimestamp = NOW - opts.ageDays * 24 * 60 * 60 * 1000;
  return {
    user: {
      username: opts.username,
      avatar: opts.hasAvatar ? 'a-hash-here' : null,
      createdTimestamp,
    },
  } as unknown as GuildMember;
}

describe('auditMember', () => {
  it('< kick threshold → decision=kick', () => {
    const r = auditMember(
      fakeMember({ ageDays: 0.5, username: 'Real_User', hasAvatar: true }),
      CONFIG,
      NOW,
    );
    expect(r.decision).toBe('kick');
    expect(r.reasons[0]).toMatch(/kick threshold/);
  });

  it('< suspect threshold + has avatar + clean username → suspect (age signal)', () => {
    const r = auditMember(
      fakeMember({ ageDays: 3, username: 'Real_User', hasAvatar: true }),
      CONFIG,
      NOW,
    );
    expect(r.decision).toBe('suspect');
    expect(r.reasons.some((s) => s.includes('suspect threshold'))).toBe(true);
    expect(r.isSuspect).toBe(true);
  });

  it('old account + no avatar → suspect (avatar signal)', () => {
    const r = auditMember(
      fakeMember({ ageDays: 365, username: 'Real_User', hasAvatar: false }),
      CONFIG,
      NOW,
    );
    expect(r.decision).toBe('suspect');
    expect(r.reasons).toContain('no custom avatar');
  });

  it('username matches lowercase+digits bot pattern → suspect', () => {
    const r = auditMember(
      fakeMember({ ageDays: 365, username: 'spam1234', hasAvatar: true }),
      CONFIG,
      NOW,
    );
    expect(r.decision).toBe('suspect');
    expect(r.reasons.some((s) => s.startsWith('username matches bot pattern'))).toBe(true);
  });

  it('username matches camel+digits pattern → suspect', () => {
    const r = auditMember(
      fakeMember({ ageDays: 365, username: 'JohnDoe9', hasAvatar: true }),
      CONFIG,
      NOW,
    );
    expect(r.decision).toBe('suspect');
  });

  it('username too short → suspect', () => {
    const r = auditMember(
      fakeMember({ ageDays: 365, username: 'ab', hasAvatar: true }),
      CONFIG,
      NOW,
    );
    expect(r.decision).toBe('suspect');
  });

  it('all-lowercase 8+ chars → suspect (random-string-y)', () => {
    const r = auditMember(
      fakeMember({ ageDays: 365, username: 'qwertyuiop', hasAvatar: true }),
      CONFIG,
      NOW,
    );
    expect(r.decision).toBe('suspect');
  });

  it('old + avatar + non-pattern username (underscore) → clean', () => {
    // NOTE: pattern `^[A-Z][a-z]+[A-Z][a-z]+\d+$` flags CamelCase+digits like
    // "BillTruong003" as suspect — that's the intended SPEC heuristic (false
    // positives become hard-captcha, not kicks). Use an underscore form to
    // dodge all four bot patterns and assert the clean path.
    const r = auditMember(
      fakeMember({ ageDays: 365, username: 'Bill_Truong', hasAvatar: true }),
      CONFIG,
      NOW,
    );
    expect(r.decision).toBe('clean');
    expect(r.reasons).toEqual([]);
    expect(r.isSuspect).toBe(false);
  });

  it('boundary: exactly kick threshold is NOT kicked (strict <)', () => {
    const r = auditMember(
      fakeMember({ ageDays: 1, username: 'Real_User', hasAvatar: true }),
      CONFIG,
      NOW,
    );
    expect(r.decision).not.toBe('kick');
  });

  it('boundary: exactly suspect threshold is NOT suspect (strict <)', () => {
    const r = auditMember(
      fakeMember({ ageDays: 7, username: 'Real_User', hasAvatar: true }),
      CONFIG,
      NOW,
    );
    expect(r.decision).toBe('clean');
  });
});
