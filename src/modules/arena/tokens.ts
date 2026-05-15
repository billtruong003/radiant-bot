import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Phase 13 Lát A — HMAC join-token protocol for Arena Colyseus rooms.
 *
 * Token format (URL-safe):
 *   payload     = JSON { session_id, discord_id, expires_at }
 *   payload_b64 = base64url(JSON.stringify(payload))
 *   signature   = HMAC-SHA256(payload_b64, secret) → hex
 *   token       = `${payload_b64}.${signature}`
 *
 * Verified at Colyseus DuelRoom.onAuth with the same secret. We keep the
 * separator `.` and base64url encoding (not base64) so the whole token is
 * safe in URL query string (e.g. `?t=<token>` in the arena play URL).
 *
 * Reused at bot side for outbound (sign) and at /api/arena/result for
 * verifying Colyseus's call-back signature (separate body-HMAC, see
 * `health.ts`).
 */

export interface ArenaTokenPayload {
  session_id: string;
  discord_id: string;
  expires_at: number;
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(s: string): Buffer | null {
  try {
    let pad = s.replace(/-/g, '+').replace(/_/g, '/');
    while (pad.length % 4 !== 0) pad += '=';
    return Buffer.from(pad, 'base64');
  } catch {
    return null;
  }
}

export function signToken(payload: ArenaTokenPayload, secret: string): string {
  if (!secret) {
    throw new Error('arena/tokens: secret must be non-empty');
  }
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload), 'utf-8'));
  const sig = createHmac('sha256', secret).update(payloadB64).digest('hex');
  return `${payloadB64}.${sig}`;
}

/**
 * Verify token signature + expiry. Returns the parsed payload on success
 * or null on any failure (bad shape, bad signature, expired). Never
 * throws — caller checks for null and returns 401.
 */
export function verifyToken(
  token: string,
  secret: string,
  nowMs = Date.now(),
): ArenaTokenPayload | null {
  if (!secret) return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = createHmac('sha256', secret).update(payloadB64).digest('hex');
  // timingSafeEqual requires equal-length buffers.
  if (sig.length !== expected.length) return null;
  const sigBuf = Buffer.from(sig, 'utf-8');
  const expectedBuf = Buffer.from(expected, 'utf-8');
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

  const raw = base64UrlDecode(payloadB64);
  if (!raw) return null;
  let payload: ArenaTokenPayload;
  try {
    const parsed = JSON.parse(raw.toString('utf-8')) as unknown;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as ArenaTokenPayload).session_id !== 'string' ||
      typeof (parsed as ArenaTokenPayload).discord_id !== 'string' ||
      typeof (parsed as ArenaTokenPayload).expires_at !== 'number'
    ) {
      return null;
    }
    payload = parsed as ArenaTokenPayload;
  } catch {
    return null;
  }

  if (payload.expires_at <= nowMs) return null;
  return payload;
}

/**
 * Body-HMAC for inbound Colyseus → bot result POST. Used in
 * `health.ts` /api/arena/result. Mirrors the GitHub webhook format
 * `X-Hub-Signature-256: sha256=<hex>` for consistency with /api/contribute.
 */
export function signBody(rawBody: Buffer, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

export function verifyBody(rawBody: Buffer, headerValue: string, secret: string): boolean {
  if (!secret || !headerValue) return false;
  const expected = signBody(rawBody, secret);
  if (headerValue.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(headerValue), Buffer.from(expected));
  } catch {
    return false;
  }
}
