import { matchMaker } from '@colyseus/core';
import type { Request, Response } from 'express';
import { verifyBody } from '../auth/tokens.js';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { roomCounter } from '../pending-rooms.js';
import { CreateOptionsSchema } from '../rooms/DuelRoom.js';

/**
 * Lát D.3 — POST /admin/create-room handler.
 *
 * Bot side (radiant-bot/src/modules/arena/client.ts) signs the raw JSON body
 * with HMAC-SHA256 keyed by ARENA_TOKEN_SECRET, attaches as `X-Bot-Signature:
 * sha256=<hex>` and POSTs here. Server verifies signature → Zod-parses body
 * → checks room capacity → matchMaker.createRoom('duel', options). Returns
 *
 *   200 { ok: true, room_name: string, ws_url: string }
 *   401 { ok: false, error: 'invalid_signature' }
 *   400 { ok: false, error: 'invalid_body', issues: ... }
 *   503 { ok: false, error: 'ROOM_LIMIT_REACHED', current, max, retry_after_seconds }
 *   500 { ok: false, error: 'internal' }
 *
 * Capacity contract: `roomCounter.tryAcquire` is the gate; if matchMaker
 * throws after acquire, we release back so the slot doesn't leak.
 */

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

const SIGNATURE_HEADER = 'x-bot-signature';

export async function createRoomHandler(req: Request, res: Response): Promise<void> {
  const rawBody = (req as RequestWithRawBody).rawBody;
  if (!rawBody) {
    // Express was misconfigured — raw-body capture cb missing in index.ts.
    logger.error('admin/create-room: rawBody missing — express.json verify cb not wired');
    res.status(500).json({ ok: false, error: 'internal' });
    return;
  }

  const headerValueRaw = req.header(SIGNATURE_HEADER);
  if (!headerValueRaw || !verifyBody(rawBody, headerValueRaw, env.ARENA_TOKEN_SECRET)) {
    logger.warn(
      { hasHeader: Boolean(headerValueRaw), bodyLen: rawBody.length },
      'admin/create-room: signature verification failed',
    );
    res.status(401).json({ ok: false, error: 'invalid_signature' });
    return;
  }

  const parsed = CreateOptionsSchema.safeParse(req.body);
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'admin/create-room: body validation failed');
    res.status(400).json({
      ok: false,
      error: 'invalid_body',
      issues: parsed.error.issues,
    });
    return;
  }
  const options = parsed.data;

  if (!roomCounter.tryAcquire(env.MAX_CONCURRENT_ROOMS)) {
    const current = roomCounter.count();
    logger.warn(
      { current, max: env.MAX_CONCURRENT_ROOMS, session_id: options.session_id },
      'admin/create-room: room limit reached',
    );
    res.status(503).json({
      ok: false,
      error: 'ROOM_LIMIT_REACHED',
      current,
      max: env.MAX_CONCURRENT_ROOMS,
      retry_after_seconds: 30,
    });
    return;
  }

  try {
    const room = await matchMaker.createRoom('duel', options);
    logger.info(
      {
        session_id: options.session_id,
        room_name: room.roomId,
        players: options.players.map((p) => p.discord_id),
      },
      'admin/create-room: room created',
    );
    res.status(200).json({
      ok: true,
      room_name: room.roomId,
      ws_url: env.ARENA_PUBLIC_WS,
    });
  } catch (err) {
    // matchMaker.createRoom can fail if DuelRoom.onCreate throws (e.g. Zod
    // catastrophe after our pre-parse, or Colyseus internal error). Release
    // the slot so capacity doesn't leak; the room was never actually created.
    roomCounter.release();
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      { err: msg, session_id: options.session_id },
      'admin/create-room: matchMaker failed',
    );
    res.status(500).json({ ok: false, error: 'internal' });
  }
}
