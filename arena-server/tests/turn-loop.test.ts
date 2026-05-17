import type { CreateOptions } from '../src/rooms/DuelRoom.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Lazy imports — top-level `import { boot } from '@colyseus/testing'` confuses
// vitest's worker-IPC serializer (Buffer.from on Object error). Loading
// dynamically inside beforeAll avoids the bug.
type BootFn = typeof import('@colyseus/testing').boot;
type ColyseusTestServer = Awaited<ReturnType<BootFn>>;

/**
 * Lát D.4 — turn loop integration tests.
 *
 * Uses @colyseus/testing harness: boots an in-memory Colyseus server, creates
 * a DuelRoom via matchMaker, connects mock WS clients with valid tokens, then
 * exercises the message handler state machine.
 *
 * Timers (countdown, turn, animation, dispose) all flow through room.clock,
 * which the harness lets us advance synchronously — no real wall-clock waits.
 */

const TOKEN_SECRET = process.env.ARENA_TOKEN_SECRET ?? 'test_secret_do_not_use_in_prod';

const baseOptions: CreateOptions = {
  session_id: 'turn_loop_session',
  stake: 0,
  join_deadline_at: Date.now() + 5 * 60 * 1000,
  players: [
    {
      discord_id: 'pa',
      display_name: 'Player A',
      available_weapons: [
        {
          slug: 'weapon_kiem_01',
          display_name: 'Kiếm Sương',
          category: 'pierce',
          tier: 'thien',
          stats: {
            power: 1,
            hitbox: 1,
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
      discord_id: 'pb',
      display_name: 'Player B',
      available_weapons: [
        {
          slug: 'weapon_thiet_con_01',
          display_name: 'Thiết Côn',
          category: 'blunt',
          tier: 'pham',
          stats: {
            power: 1,
            hitbox: 1,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mintToken(
  signFn: typeof import('../src/auth/tokens.js').signToken,
  discordId: string,
): string {
  return signFn(
    {
      session_id: baseOptions.session_id,
      discord_id: discordId,
      expires_at: Date.now() + 60_000,
    },
    TOKEN_SECRET,
  );
}

describe('DuelRoom turn loop (Lát D.4)', () => {
  let colyseus: ColyseusTestServer;
  let DuelRoomCls: typeof import('../src/rooms/DuelRoom.js').DuelRoom;
  let signTokenFn: typeof import('../src/auth/tokens.js').signToken;
  let roomCounterRef: typeof import('../src/pending-rooms.js').roomCounter;

  beforeAll(async () => {
    const testing = await import('@colyseus/testing');
    const duelMod = await import('../src/rooms/DuelRoom.js');
    const tokensMod = await import('../src/auth/tokens.js');
    const counterMod = await import('../src/pending-rooms.js');
    DuelRoomCls = duelMod.DuelRoom;
    signTokenFn = tokensMod.signToken;
    roomCounterRef = counterMod.roomCounter;

    colyseus = await testing.boot({
      initializeGameServer: (gameServer) => {
        gameServer.define('duel', DuelRoomCls);
      },
    });
  }, 30_000);

  afterAll(async () => {
    await colyseus.shutdown();
  }, 10_000);

  beforeEach(async () => {
    roomCounterRef.__reset();
    await colyseus.cleanup();
  });

  afterEach(async () => {
    await colyseus.cleanup();
  });

  async function createRoomWithTwoClients() {
    const room = await colyseus.createRoom('duel', baseOptions);
    const ca = await colyseus.connectTo(room, { token: mintToken(signTokenFn, 'pa') });
    const cb = await colyseus.connectTo(room, { token: mintToken(signTokenFn, 'pb') });
    // Wait one tick so onJoin runs for both before we read state.
    await room.waitForNextPatch();
    return { room, ca, cb };
  }

  it('two joins flip phase=waiting → phase=lobby', async () => {
    const { room } = await createRoomWithTwoClients();
    expect(room.state.phase).toBe('lobby');
    expect(room.state.players.get('pa')?.connected).toBe(true);
    expect(room.state.players.get('pb')?.connected).toBe(true);
  });

  it('select_weapon sets selected_weapon_slug and resets ready', async () => {
    const { room, ca } = await createRoomWithTwoClients();
    const pa = room.state.players.get('pa');
    expect(pa).toBeDefined();
    pa!.ready = true; // pretend was ready before re-selecting

    ca.send('select_weapon', { slug: 'weapon_kiem_01' });
    await room.waitForNextPatch();

    expect(pa!.selected_weapon_slug).toBe('weapon_kiem_01');
    expect(pa!.ready).toBe(false);
  });

  it('select_weapon with unknown slug emits WEAPON_NOT_OWNED error', async () => {
    const { room, ca } = await createRoomWithTwoClients();
    const errors: Array<{ code: string }> = [];
    ca.onMessage('error', (m: { code: string }) => errors.push(m));

    ca.send('select_weapon', { slug: 'weapon_nope_99' });
    await room.waitForNextPatch();

    expect(errors[0]?.code).toBe('WEAPON_NOT_OWNED');
    expect(room.state.players.get('pa')?.selected_weapon_slug).toBe('');
  });

  it('ready without weapon emits NO_WEAPON_SELECTED', async () => {
    const { room, ca } = await createRoomWithTwoClients();
    const errors: Array<{ code: string }> = [];
    ca.onMessage('error', (m: { code: string }) => errors.push(m));

    ca.send('ready', {});
    await room.waitForNextPatch();

    expect(errors[0]?.code).toBe('NO_WEAPON_SELECTED');
    expect(room.state.players.get('pa')?.ready).toBe(false);
  });

  it('both ready triggers phase=countdown then phase=active after COUNTDOWN_MS', async () => {
    const { room, ca, cb } = await createRoomWithTwoClients();

    ca.send('select_weapon', { slug: 'weapon_kiem_01' });
    cb.send('select_weapon', { slug: 'weapon_thiet_con_01' });
    await room.waitForNextPatch();
    ca.send('ready', {});
    cb.send('ready', {});
    await room.waitForNextPatch();

    expect(room.state.phase).toBe('countdown');

    // Advance Colyseus clock past countdown.
    await room.clock.duration; // poke clock
    await sleep(400); // > COUNTDOWN_MS=300 from vitest env
    await room.waitForNextPatch();

    expect(room.state.phase).toBe('active');
    expect(room.state.turn_player_id).toBe('pa'); // slot 0 first
    expect(room.state.round).toBe(1);
    expect(room.state.players.get('pa')?.weapon.slug).toBe('weapon_kiem_01');
    expect(room.state.players.get('pb')?.weapon.slug).toBe('weapon_thiet_con_01');
  });

  it('unready during countdown aborts back to lobby', async () => {
    const { room, ca, cb } = await createRoomWithTwoClients();

    ca.send('select_weapon', { slug: 'weapon_kiem_01' });
    cb.send('select_weapon', { slug: 'weapon_thiet_con_01' });
    await room.waitForNextPatch();
    ca.send('ready', {});
    cb.send('ready', {});
    await room.waitForNextPatch();
    expect(room.state.phase).toBe('countdown');

    ca.send('unready', {});
    await room.waitForNextPatch();
    expect(room.state.phase).toBe('lobby');
    expect(room.state.players.get('pa')?.ready).toBe(false);
  });

  it('shoot from non-turn player is silently dropped', async () => {
    const { room, ca, cb } = await createRoomWithTwoClients();
    ca.send('select_weapon', { slug: 'weapon_kiem_01' });
    cb.send('select_weapon', { slug: 'weapon_thiet_con_01' });
    await room.waitForNextPatch();
    ca.send('ready', {});
    cb.send('ready', {});
    await room.waitForNextPatch();
    await sleep(400); // > COUNTDOWN_MS=300 from vitest env
    await room.waitForNextPatch();
    expect(room.state.turn_player_id).toBe('pa');

    cb.send('shoot', { angle: 1.5, power: 0.7 });
    await room.waitForNextPatch();
    // Phase unchanged — opponent shot ignored.
    expect(room.state.phase).toBe('active');
    expect(room.state.last_shooter_id).toBe('');
  });

  it('shoot from turn player flips phase=animating + broadcasts shot_resolved', async () => {
    const { room, ca, cb } = await createRoomWithTwoClients();
    ca.send('select_weapon', { slug: 'weapon_kiem_01' });
    cb.send('select_weapon', { slug: 'weapon_thiet_con_01' });
    await room.waitForNextPatch();
    ca.send('ready', {});
    cb.send('ready', {});
    await room.waitForNextPatch();
    await sleep(400); // > COUNTDOWN_MS=300 from vitest env
    await room.waitForNextPatch();

    const shotsA: Array<{ shooter: string; angle: number; power: number }> = [];
    ca.onMessage('shot_resolved', (m: { shooter: string; angle: number; power: number }) => shotsA.push(m));

    ca.send('shoot', { angle: 1.5, power: 0.7 });
    await room.waitForNextPatch();

    expect(room.state.phase).toBe('animating');
    expect(room.state.last_shooter_id).toBe('pa');
    expect(shotsA[0]?.shooter).toBe('pa');
    expect(shotsA[0]?.angle).toBeCloseTo(1.5);
    expect(shotsA[0]?.power).toBeCloseTo(0.7);
  });

  it('both animation_complete advances turn early', async () => {
    const { room, ca, cb } = await createRoomWithTwoClients();
    ca.send('select_weapon', { slug: 'weapon_kiem_01' });
    cb.send('select_weapon', { slug: 'weapon_thiet_con_01' });
    await room.waitForNextPatch();
    ca.send('ready', {});
    cb.send('ready', {});
    await room.waitForNextPatch();
    await sleep(400); // > COUNTDOWN_MS=300 from vitest env
    await room.waitForNextPatch();
    ca.send('shoot', { angle: 0, power: 0.5 });
    await room.waitForNextPatch();
    expect(room.state.phase).toBe('animating');

    ca.send('animation_complete', { round: 1 });
    cb.send('animation_complete', { round: 1 });
    await room.waitForNextPatch();

    expect(room.state.phase).toBe('active');
    expect(room.state.turn_player_id).toBe('pb');
    expect(room.state.round).toBe(2);
  });

  it('concede from active phase ends match with opponent winning', async () => {
    const { room, ca, cb } = await createRoomWithTwoClients();
    ca.send('select_weapon', { slug: 'weapon_kiem_01' });
    cb.send('select_weapon', { slug: 'weapon_thiet_con_01' });
    await room.waitForNextPatch();
    ca.send('ready', {});
    cb.send('ready', {});
    await room.waitForNextPatch();
    await sleep(400); // > COUNTDOWN_MS=300 from vitest env
    await room.waitForNextPatch();

    const endsB: Array<{ winner: string; outcome: string }> = [];
    cb.onMessage('match_ended', (m: { winner: string; outcome: string }) => endsB.push(m));

    ca.send('concede', {});
    await room.waitForNextPatch();

    expect(room.state.phase).toBe('ended');
    expect(room.state.winner_id).toBe('pb');
    expect(room.state.outcome).toBe('concede');
    expect(endsB[0]?.winner).toBe('pb');
    expect(endsB[0]?.outcome).toBe('concede');
  });

  it('ping echoes pong with server_t', async () => {
    const { room, ca } = await createRoomWithTwoClients();
    const pongs: Array<{ t: number; server_t: number }> = [];
    ca.onMessage('pong', (m: { t: number; server_t: number }) => pongs.push(m));

    ca.send('ping', { t: 12345 });
    await room.waitForNextPatch();

    expect(pongs[0]?.t).toBe(12345);
    expect(typeof pongs[0]?.server_t).toBe('number');
    expect(pongs[0]?.server_t).toBeGreaterThan(0);
  });

  it('shoot clamps out-of-range angle + power silently', async () => {
    const { room, ca, cb } = await createRoomWithTwoClients();
    ca.send('select_weapon', { slug: 'weapon_kiem_01' });
    cb.send('select_weapon', { slug: 'weapon_thiet_con_01' });
    await room.waitForNextPatch();
    ca.send('ready', {});
    cb.send('ready', {});
    await room.waitForNextPatch();
    await sleep(400); // > COUNTDOWN_MS=300 from vitest env
    await room.waitForNextPatch();

    const shots: Array<{ angle: number; power: number }> = [];
    ca.onMessage('shot_resolved', (m: { angle: number; power: number }) => shots.push(m));

    ca.send('shoot', { angle: 999, power: 5 });
    await room.waitForNextPatch();

    expect(shots[0]?.angle).toBeLessThanOrEqual(Math.PI * 2);
    expect(shots[0]?.power).toBeLessThanOrEqual(1);
    expect(shots[0]?.power).toBeGreaterThanOrEqual(0);
  });
});
