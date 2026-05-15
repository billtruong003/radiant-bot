import { env } from '../../config/env.js';
import type { Weapon, WeaponStats, WeaponVisual } from '../../db/types.js';
import { logger } from '../../utils/logger.js';
import { signBody } from './tokens.js';

/**
 * Phase 13 Lát A — Bot → Colyseus admin client.
 *
 * Owns the single outbound call needed to spawn a duel room:
 *
 *   POST {ARENA_COLYSEUS_URL}/admin/create-room
 *   Header X-Bot-Signature: sha256=<HMAC over body with ARENA_TOKEN_SECRET>
 *
 * Behaviour gated by `ARENA_ENABLED`:
 *   - false → return mock `{ ok: true, room_name: 'mock-...', ws_url: '' }`
 *     so /arena debug subcommand can exercise the call path without
 *     Colyseus being up yet (Lát A ships before Lát D Colyseus).
 *   - true  → real fetch with 5s timeout.
 */

export interface RoomPlayer {
  discord_id: string;
  display_name: string;
  /** HMAC join token issued by tokens.signToken. */
  token: string;
  /** Weapon catalog entry OR bản mệnh synthesised entry. */
  weapon_data: {
    slug: string;
    display_name: string;
    category: string;
    tier: string;
    stats: WeaponStats;
    visual: WeaponVisual;
  };
}

export interface CreateRoomRequest {
  session_id: string;
  stake: number;
  join_deadline_at: number;
  players: [RoomPlayer, RoomPlayer];
}

export interface CreateRoomOk {
  ok: true;
  room_name: string;
  ws_url: string;
}

export interface CreateRoomErr {
  ok: false;
  error: string;
  current?: number;
  max?: number;
  retry_after_seconds?: number;
}

export type CreateRoomResult = CreateRoomOk | CreateRoomErr;

const REQUEST_TIMEOUT_MS = 5000;

export async function requestRoom(req: CreateRoomRequest): Promise<CreateRoomResult> {
  if (!env.ARENA_ENABLED) {
    logger.debug(
      { session_id: req.session_id },
      'arena/client: ARENA_ENABLED=false, returning mock room',
    );
    return {
      ok: true,
      room_name: `mock-${req.session_id}`,
      ws_url: '',
    };
  }

  const secret = env.ARENA_TOKEN_SECRET;
  if (!secret) {
    return { ok: false, error: 'ARENA_TOKEN_SECRET not set' };
  }

  const url = `${env.ARENA_COLYSEUS_URL.replace(/\/$/, '')}/admin/create-room`;
  const bodyJson = JSON.stringify(req);
  const bodyBuf = Buffer.from(bodyJson, 'utf-8');
  const sig = signBody(bodyBuf, secret);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-bot-signature': sig,
      },
      body: bodyJson,
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      logger.warn({ status: res.status, json }, 'arena/client: room creation rejected');
      return {
        ok: false,
        error: typeof json?.error === 'string' ? json.error : `http_${res.status}`,
        current: typeof json?.current === 'number' ? json.current : undefined,
        max: typeof json?.max === 'number' ? json.max : undefined,
        retry_after_seconds:
          typeof json?.retry_after_seconds === 'number' ? json.retry_after_seconds : undefined,
      };
    }
    return {
      ok: true,
      room_name: String(json?.room_name ?? ''),
      ws_url: String(json?.ws_url ?? ''),
    };
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError';
    logger.warn({ err, aborted }, 'arena/client: request failed');
    return {
      ok: false,
      error: aborted ? 'timeout' : (err as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Health probe — used by /arena debug. Returns latency in ms on success
 * or a string error reason.
 */
export async function probeColyseus(): Promise<
  { ok: true; latency_ms: number } | { ok: false; reason: string }
> {
  if (!env.ARENA_ENABLED) {
    return { ok: false, reason: 'ARENA_ENABLED=false (Colyseus not yet wired)' };
  }
  const url = `${env.ARENA_COLYSEUS_URL.replace(/\/$/, '')}/health`;
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    return { ok: true, latency_ms: Date.now() - t0 };
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError';
    return { ok: false, reason: aborted ? 'timeout' : (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Convert a Weapon catalog entry or bản mệnh UserWeapon into the
 * `weapon_data` shape Colyseus expects.
 */
export function weaponToRoomData(
  w:
    | Weapon
    | {
        weapon_slug: string;
        custom_stats: WeaponStats | null;
        custom_visual: WeaponVisual | null;
      },
  fallbackDisplay?: string,
): RoomPlayer['weapon_data'] | null {
  if ('display_name' in w) {
    return {
      slug: w.slug,
      display_name: w.display_name,
      category: w.category,
      tier: w.tier,
      stats: w.stats,
      visual: w.visual,
    };
  }
  if (!w.custom_stats || !w.custom_visual) return null;
  return {
    slug: w.weapon_slug,
    display_name: fallbackDisplay ?? 'Pháp Khí Bản Mệnh',
    category: 'blunt',
    tier: 'ban_menh',
    stats: w.custom_stats,
    visual: w.custom_visual,
  };
}
