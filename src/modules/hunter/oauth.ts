import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * GitHub OAuth for /hunter register. The state carries the Discord id and an
 * expiry, signed with HUNTER_STATE_SECRET, so a callback can only link the
 * member who asked for the link. Each state works once.
 */

const STATE_TTL_MS = 10 * 60 * 1000;
const used = new Map<string, number>();

const sign = (payload: string, secret: string): string =>
  createHmac('sha256', secret).update(payload).digest('base64url');

export function createState(discordId: string, secret: string, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ d: discordId, e: now + STATE_TTL_MS, n: randomBytes(8).toString('hex') }),
  ).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

/** The Discord id the state was made for, or null if it is forged, expired or already used. */
export function readState(state: string, secret: string, now = Date.now()): string | null {
  const [payload, mac] = state.split('.');
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let body: { d?: unknown; e?: unknown };
  try {
    body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof body.d !== 'string' || typeof body.e !== 'number' || body.e < now || used.has(state))
    return null;
  for (const [key, expiry] of used) if (expiry < now) used.delete(key);
  used.set(state, body.e);
  return body.d;
}

export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  // No scope: only the public profile is needed to prove who the account belongs to.
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    allow_signup: 'false',
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

/** Exchanges the callback code for the GitHub account it belongs to. The token is used once and dropped. */
export async function githubAccountFor(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<{ login: string; id: number }> {
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const token = (await tokenRes.json()) as { access_token?: string; error_description?: string };
  if (!token.access_token)
    throw new Error(token.error_description ?? 'GitHub did not return a token');
  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'radiant-bot',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!userRes.ok) throw new Error(`GitHub answered ${userRes.status}`);
  const user = (await userRes.json()) as { login: string; id: number };
  return { login: user.login, id: user.id };
}
