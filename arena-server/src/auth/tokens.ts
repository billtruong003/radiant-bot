import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC join-token protocol — verbatim port from bot's src/modules/arena/tokens.ts.
 *
 * Token format (URL-safe):
 *   payload     = JSON { session_id, discord_id, expires_at }
 *   payload_b64 = base64url(JSON.stringify(payload))
 *   signature   = HMAC-SHA256(payload_b64, secret) → hex
 *   token       = `${payload_b64}.${signature}`
 *
 * Both sides MUST agree on ARENA_TOKEN_SECRET. Bot signs at /arena duel,
 * server verifies in DuelRoom.onAuth.
 *
 * signBody/verifyBody used for the body-HMAC on /admin/create-room (bot→server)
 * and /api/arena/result (server→bot) — header `X-Bot-Signature` /
 * `X-Arena-Signature` carries `sha256=<hex>`.
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
