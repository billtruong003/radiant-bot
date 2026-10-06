import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Private links to the avatar customizer. A link is signed, lasts 15
 * minutes (as long as Discord lets the bot edit its reply) and can save
 * many times. Asking for a new link retires the old one. Links live in
 * memory only: a restart retires them all, which just means typing
 * /profile avatar again.
 */

export const LINK_TTL_MS = 15 * 60 * 1000;
export const SAVES_PER_MINUTE = 10;

/** The reply that holds the link, so a save can update it in Discord. */
export interface ReplyHandle {
  applicationId: string;
  interactionToken: string;
}

interface LiveLink {
  nonce: string;
  expiresAt: number;
  reply: ReplyHandle | null;
}

const live = new Map<string, LiveLink>();
const saves = new Map<string, number[]>();

const sign = (payload: string, secret: string): string =>
  createHmac('sha256', secret).update(`avatar:${payload}`).digest('base64url');

export function createAvatarLink(
  discordId: string,
  secret: string,
  reply: ReplyHandle | null,
  now = Date.now(),
): { token: string; expiresAt: number } {
  const nonce = randomBytes(9).toString('base64url');
  const expiresAt = now + LINK_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ d: discordId, e: expiresAt, n: nonce })).toString(
    'base64url',
  );
  live.set(discordId, { nonce, expiresAt, reply });
  for (const [id, link] of live) if (link.expiresAt < now) live.delete(id);
  return { token: `${payload}.${sign(payload, secret)}`, expiresAt };
}

/** Who the link belongs to, or null if it is forged, expired or replaced by a newer one. */
export function readAvatarLink(
  token: string,
  secret: string,
  now = Date.now(),
): { discordId: string; expiresAt: number; reply: ReplyHandle | null } | null {
  const [payload, mac] = token.split('.');
  if (!payload || !mac || !secret) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let body: { d?: unknown; e?: unknown; n?: unknown };
  try {
    body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof body.d !== 'string' || typeof body.e !== 'number' || typeof body.n !== 'string')
    return null;
  const current = live.get(body.d);
  if (body.e < now || !current || current.nonce !== body.n) return null;
  return { discordId: body.d, expiresAt: body.e, reply: current.reply };
}

/** True when this member may save again; records the attempt. */
export function takeSaveSlot(discordId: string, now = Date.now()): boolean {
  const recent = (saves.get(discordId) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= SAVES_PER_MINUTE) {
    saves.set(discordId, recent);
    return false;
  }
  recent.push(now);
  saves.set(discordId, recent);
  return true;
}

/** Test helper: forget every link and save count. */
export function resetAvatarLinks(): void {
  live.clear();
  saves.clear();
}
