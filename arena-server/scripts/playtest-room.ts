import 'dotenv/config';
import { signBody, signToken } from '../src/auth/tokens.js';

/**
 * Playtest helper — create a room + mint 2 join tokens for 2-instance
 * ParrelSync smoke. Prints full ArenaConnectWindow paste values.
 *
 * Pre: `npm run dev` running. Same .env loaded.
 *
 * Usage:
 *   npm run playtest
 *   npm run playtest -- --session=my_session_id
 *
 * Run, then in two Unity Editor instances (ParrelSync):
 *   Window > Radiant Arena > Connect → paste values printed below.
 */

const PORT = Number(process.env.ARENA_PORT ?? 2567);
const HOST =
  process.env.ARENA_HOST === '0.0.0.0' ? 'localhost' : (process.env.ARENA_HOST ?? 'localhost');
const SECRET = process.env.ARENA_TOKEN_SECRET ?? '';

if (!SECRET) {
  console.error('[playtest] ARENA_TOKEN_SECRET missing in env.');
  process.exit(1);
}

const sessionArg = process.argv.find((a) => a.startsWith('--session='));
const SESSION_ID = sessionArg ? sessionArg.slice('--session='.length) : `playtest_${Date.now()}`;
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1h — long enough for a playtest sitting

const base = `http://${HOST}:${PORT}`;

const PLAYER_A = 'smoke_player_a';
const PLAYER_B = 'smoke_player_b';

const body = {
  session_id: SESSION_ID,
  stake: 0,
  join_deadline_at: Date.now() + 5 * 60 * 1000,
  players: [
    {
      discord_id: PLAYER_A,
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
    {
      discord_id: PLAYER_B,
      display_name: 'Player B',
      available_weapons: [
        {
          slug: 'weapon_chuy_01',
          display_name: 'Chuỳ Đồng',
          category: 'blunt',
          tier: 'dia',
          stats: {
            power: 1,
            hitbox: 1.1,
            bounce: 0.6,
            damage_base: 25,
            pierce_count: 0,
            crit_chance: 0.08,
            crit_multi: 1.55,
          },
          visual: {
            model_prefab_key: 'weapon_chuy_01',
            particle_fx_key: '',
            trail_fx_key: '',
            hue: '#b87333',
          },
          skills: [],
        },
        {
          slug: 'weapon_di_hoa_01',
          display_name: 'Dị Hoả',
          category: 'spirit',
          tier: 'thien',
          stats: {
            power: 1,
            hitbox: 0.9,
            bounce: 0.4,
            damage_base: 18,
            pierce_count: 2,
            crit_chance: 0.15,
            crit_multi: 1.8,
          },
          visual: {
            model_prefab_key: 'weapon_di_hoa_01',
            particle_fx_key: '',
            trail_fx_key: '',
            hue: '#ff5544',
          },
          skills: [],
        },
      ],
    },
  ],
};

async function main(): Promise<void> {
  console.info(`[playtest] Creating room: session_id=${SESSION_ID}`);
  const bodyJson = JSON.stringify(body);
  const bodyBuf = Buffer.from(bodyJson, 'utf-8');
  const sig = signBody(bodyBuf, SECRET);

  const res = await fetch(`${base}/admin/create-room`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bot-signature': sig },
    body: bodyJson,
  });
  const json = (await res.json()) as { ok?: boolean; room_name?: string; ws_url?: string };
  if (!json.ok || !json.room_name) {
    console.error(`[playtest] room creation failed: status=${res.status}`, json);
    process.exit(2);
  }

  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const tokenA = signToken(
    { session_id: SESSION_ID, discord_id: PLAYER_A, expires_at: expiresAt },
    SECRET,
  );
  const tokenB = signToken(
    { session_id: SESSION_ID, discord_id: PLAYER_B, expires_at: expiresAt },
    SECRET,
  );

  const line = '─'.repeat(76);
  console.info(`\n${line}`);
  console.info('  PLAYTEST ROOM READY — paste into Window > Radiant Arena > Connect');
  console.info(line);
  console.info(`  WS URL       : ${json.ws_url}`);
  console.info(`  Room ID      : ${json.room_name}`);
  console.info(`  Session ID   : ${SESSION_ID}`);
  console.info(`  Token TTL    : ${Math.floor(TOKEN_TTL_MS / 60_000)} min`);
  console.info(`${line}`);
  console.info('  INSTANCE A (the original Unity Editor)');
  console.info(`  Discord ID   : ${PLAYER_A}`);
  console.info('  Token        :');
  console.info(`  ${tokenA}`);
  console.info(line);
  console.info('  INSTANCE B (ParrelSync clone)');
  console.info(`  Discord ID   : ${PLAYER_B}`);
  console.info('  Token        :');
  console.info(`  ${tokenB}`);
  console.info(`${line}\n`);
  console.info('Next: in each Unity Editor, enter Play mode, open the Connect window,');
  console.info('paste WS URL + Room ID + Session ID + Discord ID + Token, click Connect.');
  console.info("Both clients should reach phase='lobby'. Pick weapons + Ready to proceed.");
}

main().catch((err) => {
  console.error('[playtest] error:', err);
  process.exit(1);
});
