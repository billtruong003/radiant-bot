import express, { type Request } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock '@colyseus/core' module so matchMaker.createRoom is stubbable.
// vi.spyOn cannot patch the real matchMaker because its members are
// non-configurable getters on the exported singleton. Use importOriginal
// to keep the rest of the module (Room, Client, etc. — DuelRoom.ts uses them).
const createRoomMock = vi.fn();
vi.mock('@colyseus/core', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    matchMaker: {
      createRoom: createRoomMock,
    },
  };
});

// Imports below must come AFTER vi.mock — handler imports matchMaker.
const { createRoomHandler } = await import('../src/admin/create-room.js');
const { signBody } = await import('../src/auth/tokens.js');
const { roomCounter } = await import('../src/pending-rooms.js');

/**
 * Lát D.3 — admin /create-room handler tests.
 *
 * Builds an Express app matching src/index.ts wiring (raw-body capture cb
 * + handler) so supertest exercises the real request path. `matchMaker.createRoom`
 * is stubbed via vi.spyOn — tests assert handler shape + capacity gate without
 * spinning up a real Colyseus room.
 */

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

const SECRET = 'test_secret_do_not_use_in_prod';

const validBody = {
  session_id: 'test_session_001',
  stake: 0,
  join_deadline_at: Date.now() + 5 * 60 * 1000,
  players: [
    {
      discord_id: 'p_a',
      display_name: 'Player A',
      available_weapons: [
        {
          slug: 'weapon_kiem_01',
          display_name: 'Kiếm Sương',
          category: 'pierce' as const,
          tier: 'thien' as const,
          stats: {
            power: 1.0,
            hitbox: 1.0,
            bounce: 0.5,
            damage_base: 22,
            pierce_count: 1,
            crit_chance: 0.1,
            crit_multi: 1.6,
          },
          visual: {
            model_prefab_key: 'weapon_kiem_01',
            particle_fx_key: '',
            trail_fx_key: '',
            hue: '#88ccff',
          },
          skills: [],
        },
      ],
    },
    {
      discord_id: 'p_b',
      display_name: 'Player B',
      available_weapons: [
        {
          slug: 'weapon_thiet_con_01',
          display_name: 'Thiết Côn',
          category: 'blunt' as const,
          tier: 'pham' as const,
          stats: {
            power: 1.0,
            hitbox: 1.0,
            bounce: 0.55,
            damage_base: 20,
            pierce_count: 0,
            crit_chance: 0.05,
            crit_multi: 1.5,
          },
          visual: {
            model_prefab_key: 'weapon_thiet_con_01',
            particle_fx_key: '',
            trail_fx_key: '',
            hue: '#c0c0c0',
          },
          skills: [],
        },
      ],
    },
  ],
};

function buildApp() {
  const app = express();
  app.use(
    express.json({
      limit: '64kb',
      verify: (req, _res, buf) => {
        (req as RequestWithRawBody).rawBody = buf;
      },
    }),
  );
  app.post('/admin/create-room', createRoomHandler);
  return app;
}

describe('POST /admin/create-room', () => {
  beforeEach(() => {
    // Ensure each test starts with empty counter + sane env secret.
    roomCounter.__reset();
    process.env.ARENA_TOKEN_SECRET = SECRET;
    process.env.ARENA_PUBLIC_WS = 'ws://localhost:2567';
    process.env.MAX_CONCURRENT_ROOMS = '5';
  });

  afterEach(() => {
    createRoomMock.mockReset();
    roomCounter.__reset();
  });

  it('returns 200 with room_name + ws_url on valid signed body', async () => {
    createRoomMock.mockResolvedValueOnce({ roomId: 'mockROOM01' });

    const app = buildApp();
    const bodyJson = JSON.stringify(validBody);
    const sig = signBody(Buffer.from(bodyJson, 'utf-8'), SECRET);

    const res = await request(app)
      .post('/admin/create-room')
      .set('content-type', 'application/json')
      .set('x-bot-signature', sig)
      .send(bodyJson);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      room_name: 'mockROOM01',
      ws_url: 'ws://localhost:2567',
    });
    expect(createRoomMock).toHaveBeenCalledTimes(1);
    expect(createRoomMock).toHaveBeenCalledWith(
      'duel',
      expect.objectContaining({ session_id: 'test_session_001' }),
    );
  });

  it('returns 401 invalid_signature when X-Bot-Signature is wrong', async () => {
    const app = buildApp();
    const bodyJson = JSON.stringify(validBody);

    const res = await request(app)
      .post('/admin/create-room')
      .set('content-type', 'application/json')
      .set('x-bot-signature', `sha256=${'0'.repeat(64)}`)
      .send(bodyJson);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ ok: false, error: 'invalid_signature' });
    expect(createRoomMock).not.toHaveBeenCalled();
  });

  it('returns 503 ROOM_LIMIT_REACHED when capacity is saturated', async () => {
    // Saturate counter to MAX (5 from vitest env above).
    for (let i = 0; i < 5; i++) roomCounter.tryAcquire(5);
    expect(roomCounter.count()).toBe(5);

    const app = buildApp();
    const bodyJson = JSON.stringify(validBody);
    const sig = signBody(Buffer.from(bodyJson, 'utf-8'), SECRET);

    const res = await request(app)
      .post('/admin/create-room')
      .set('content-type', 'application/json')
      .set('x-bot-signature', sig)
      .send(bodyJson);

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      ok: false,
      error: 'ROOM_LIMIT_REACHED',
      current: 5,
      max: 5,
    });
    expect(createRoomMock).not.toHaveBeenCalled();
  });

  it('returns 400 invalid_body when body fails Zod parse (only 1 player)', async () => {
    const badBody = { ...validBody, players: [validBody.players[0]] };
    const app = buildApp();
    const bodyJson = JSON.stringify(badBody);
    const sig = signBody(Buffer.from(bodyJson, 'utf-8'), SECRET);

    const res = await request(app)
      .post('/admin/create-room')
      .set('content-type', 'application/json')
      .set('x-bot-signature', sig)
      .send(bodyJson);

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('invalid_body');
  });
});
