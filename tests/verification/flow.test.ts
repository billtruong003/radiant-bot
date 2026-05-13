import { describe, expect, it } from 'vitest';
import type { VerificationConfig } from '../../src/config/verification.js';
import type { Verification } from '../../src/db/types.js';
import type { AuditResult } from '../../src/modules/verification/audit.js';
import { buildChallenge, verifyReply } from '../../src/modules/verification/flow.js';

const CONFIG: VerificationConfig = {
  thresholds: {
    accountAgeKickDays: 1,
    accountAgeSuspectDays: 7,
    captchaTimeoutMs: 300_000,
    captchaMaxAttempts: 3,
    raidJoinWindowMs: 60_000,
    raidJoinThreshold: 10,
  },
  botUsernamePatterns: [],
  captcha: {
    mathMinA: 1,
    mathMaxA: 20,
    mathMinB: 1,
    mathMaxB: 20,
    imageChars: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
    imageLength: 6,
  },
};

const CLEAN_AUDIT: AuditResult = { decision: 'clean', reasons: [], isSuspect: false };
const SUSPECT_AUDIT: AuditResult = {
  decision: 'suspect',
  reasons: ['no custom avatar'],
  isSuspect: true,
};

function makeVerification(
  overrides: Partial<Verification> & Pick<Verification, 'challenge_type' | 'challenge_data'>,
): Verification {
  return {
    discord_id: '123',
    attempts: 0,
    started_at: 0,
    status: 'pending',
    ...overrides,
  };
}

describe('buildChallenge', () => {
  it('clean audit → math challenge, no image', () => {
    const c = buildChallenge(CLEAN_AUDIT, CONFIG);
    expect(c.challenge_type).toBe('math');
    expect(c.dmImageBuffer).toBeNull();
    expect(c.challenge_data.expected).toMatch(/^\d+$/);
    expect(c.dmContent).toContain('+');
  });

  it('suspect audit → image+math challenge with PNG buffer', () => {
    const c = buildChallenge(SUSPECT_AUDIT, CONFIG);
    expect(c.challenge_type).toBe('image+math');
    expect(c.dmImageBuffer).toBeInstanceOf(Buffer);
    expect((c.dmImageBuffer as Buffer)[0]).toBe(0x89); // PNG magic byte
    // expected is "<imageText> <mathAnswer>"
    expect(c.challenge_data.expected.split(' ')).toHaveLength(2);
    expect(c.challenge_data.image_text).toMatch(/^[A-Z2-9]{6}$/);
    expect(c.challenge_data.math_answer).toMatch(/^\d+$/);
  });

  it('clean audit + forceHard → image+math (raid-mode override)', () => {
    const c = buildChallenge(CLEAN_AUDIT, CONFIG, { forceHard: true });
    expect(c.challenge_type).toBe('image+math');
    expect(c.dmImageBuffer).not.toBeNull();
  });

  it('DM content mentions timeout + attempt limit for hard captcha', () => {
    const c = buildChallenge(SUSPECT_AUDIT, CONFIG);
    expect(c.dmContent).toContain('5 phút'); // 300_000 ms / 60_000
    expect(c.dmContent).toContain('3'); // captchaMaxAttempts
  });
});

describe('verifyReply', () => {
  it('math: correct exact digit answer passes', () => {
    const v = makeVerification({
      challenge_type: 'math',
      challenge_data: { expected: '19' },
    });
    expect(verifyReply(v, '19')).toBe(true);
    expect(verifyReply(v, '  19  ')).toBe(true);
  });

  it('math: wrong answer fails', () => {
    const v = makeVerification({
      challenge_type: 'math',
      challenge_data: { expected: '19' },
    });
    expect(verifyReply(v, '20')).toBe(false);
    expect(verifyReply(v, '')).toBe(false);
    expect(verifyReply(v, 'nineteen')).toBe(false);
  });

  it('image+math: both parts must match (case insensitive on image)', () => {
    const v = makeVerification({
      challenge_type: 'image+math',
      challenge_data: { expected: 'ABCXY2 19', image_text: 'ABCXY2', math_answer: '19' },
    });
    expect(verifyReply(v, 'ABCXY2 19')).toBe(true);
    expect(verifyReply(v, 'abcxy2 19')).toBe(true);
    expect(verifyReply(v, '  ABCXY2  19  ')).toBe(true);
  });

  it('image+math: wrong image text → fail', () => {
    const v = makeVerification({
      challenge_type: 'image+math',
      challenge_data: { expected: 'ABCXY2 19', image_text: 'ABCXY2', math_answer: '19' },
    });
    expect(verifyReply(v, 'ABCXYZ 19')).toBe(false);
  });

  it('image+math: wrong math answer → fail', () => {
    const v = makeVerification({
      challenge_type: 'image+math',
      challenge_data: { expected: 'ABCXY2 19', image_text: 'ABCXY2', math_answer: '19' },
    });
    expect(verifyReply(v, 'ABCXY2 20')).toBe(false);
  });

  it('image+math: missing one token → fail', () => {
    const v = makeVerification({
      challenge_type: 'image+math',
      challenge_data: { expected: 'ABCXY2 19', image_text: 'ABCXY2', math_answer: '19' },
    });
    expect(verifyReply(v, 'ABCXY2')).toBe(false);
    expect(verifyReply(v, '')).toBe(false);
  });
});
