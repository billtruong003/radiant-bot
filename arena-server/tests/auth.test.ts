import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  type ArenaTokenPayload,
  signBody,
  signToken,
  verifyBody,
  verifyToken,
} from '../src/auth/tokens.js';

const SECRET = 'a'.repeat(64);
const OTHER_SECRET = 'b'.repeat(64);

function makePayload(overrides: Partial<ArenaTokenPayload> = {}): ArenaTokenPayload {
  return {
    session_id: 'sess-abc',
    discord_id: '111222333',
    expires_at: Date.now() + 60_000,
    ...overrides,
  };
}

describe('verifyToken', () => {
  it('round-trip returns the original payload', () => {
    const payload = makePayload();
    const token = signToken(payload, SECRET);
    const got = verifyToken(token, SECRET);
    expect(got).toEqual(payload);
  });

  it('rejects tampered signature', () => {
    const token = signToken(makePayload(), SECRET);
    const [body, sig] = token.split('.');
    const tampered = `${body}.${sig?.replace(/[0-9a-f]$/, (c) => (c === 'f' ? '0' : 'f'))}`;
    expect(verifyToken(tampered, SECRET)).toBeNull();
  });

  it('rejects token signed with a different secret', () => {
    const token = signToken(makePayload(), OTHER_SECRET);
    expect(verifyToken(token, SECRET)).toBeNull();
  });

  it('rejects expired token', () => {
    const past = makePayload({ expires_at: Date.now() - 1 });
    const token = signToken(past, SECRET);
    expect(verifyToken(token, SECRET)).toBeNull();
  });

  it('rejects token with malformed payload shape (missing discord_id)', () => {
    const badPayloadB64 = Buffer.from(JSON.stringify({ session_id: 'x' }), 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const properSig = createHmac('sha256', SECRET).update(badPayloadB64).digest('hex');
    expect(verifyToken(`${badPayloadB64}.${properSig}`, SECRET)).toBeNull();
  });

  it('rejects token without a dot separator', () => {
    expect(verifyToken('notavalidtoken', SECRET)).toBeNull();
  });

  it('rejects empty secret', () => {
    expect(verifyToken('whatever.deadbeef', '')).toBeNull();
  });
});

describe('verifyBody', () => {
  it('round-trip returns true for matching body+sig', () => {
    const body = Buffer.from(JSON.stringify({ session_id: 'x', outcome: 'win' }), 'utf-8');
    const sig = signBody(body, SECRET);
    expect(verifyBody(body, sig, SECRET)).toBe(true);
  });

  it('returns false when body is tampered', () => {
    const body = Buffer.from(JSON.stringify({ outcome: 'win' }), 'utf-8');
    const sig = signBody(body, SECRET);
    const tampered = Buffer.from(JSON.stringify({ outcome: 'lose' }), 'utf-8');
    expect(verifyBody(tampered, sig, SECRET)).toBe(false);
  });

  it('returns false when sig header is empty', () => {
    expect(verifyBody(Buffer.from('{}'), '', SECRET)).toBe(false);
  });

  it('returns false when secret is empty', () => {
    expect(verifyBody(Buffer.from('{}'), 'sha256=xx', '')).toBe(false);
  });

  it('returns false when sig header has wrong length', () => {
    expect(verifyBody(Buffer.from('{}'), 'sha256=short', SECRET)).toBe(false);
  });
});
