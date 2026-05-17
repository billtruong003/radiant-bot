import 'dotenv/config';
import { signBody } from '../src/auth/tokens.js';

/**
 * Lát D.3 smoke — pretend to be the bot.
 *
 * Probes /health, then POSTs a valid create-room body signed with
 * ARENA_TOKEN_SECRET. Asserts 200 + room_name + ws_url. Logs the result.
 *
 * Pre-conditions:
 *   1. `npm run dev` running in another terminal (server on ARENA_PORT).
 *   2. ARENA_TOKEN_SECRET set in .env (matches server's value).
 *
 * Exit codes:
 *   0   smoke passed
 *   1   misconfigured (env / pre-condition)
 *   2   server unreachable (health probe failed)
 *   3   handler rejected our request (signature / body / capacity)
 *   4   handler accepted but returned malformed response
 */

const PORT = Number(process.env.ARENA_PORT ?? 2567);
const HOST =
  process.env.ARENA_HOST === '0.0.0.0' ? 'localhost' : (process.env.ARENA_HOST ?? 'localhost');
const SECRET = process.env.ARENA_TOKEN_SECRET ?? '';

if (!SECRET) {
  console.error('[smoke] ARENA_TOKEN_SECRET missing in env. Copy .env.example → .env and fill in.');
  process.exit(1);
}

const base = `http://${HOST}:${PORT}`;

async function probeHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${base}/health`, { method: 'GET' });
    if (!res.ok) return false;
    const json = (await res.json()) as { ok?: boolean };
    return json?.ok === true;
  } catch {
    return false;
  }
}

function buildBody(): unknown {
  return {
    session_id: `smoke-${Date.now()}`,
    stake: 0,
    join_deadline_at: Date.now() + 5 * 60 * 1000,
    players: [
      {
        discord_id: 'smoke_player_a',
        display_name: 'Smoke A',
        available_weapons: [
          {
            slug: 'weapon_kiem_01',
            display_name: 'Kiếm Sương',
            category: 'pierce',
            tier: 'thien',
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
              particle_fx_key: 'fx_kiem',
              trail_fx_key: 'trail_kiem',
              hue: '#88ccff',
            },
            skills: [],
          },
        ],
      },
      {
        discord_id: 'smoke_player_b',
        display_name: 'Smoke B',
        available_weapons: [
          {
            slug: 'weapon_thiet_con_01',
            display_name: 'Thiết Côn',
            category: 'blunt',
            tier: 'pham',
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
              particle_fx_key: 'fx_thiet_con',
              trail_fx_key: 'trail_thiet_con',
              hue: '#c0c0c0',
            },
            skills: [],
          },
        ],
      },
    ],
  };
}

async function main(): Promise<void> {
  console.info(`[smoke] probing ${base}/health ...`);
  if (!(await probeHealth())) {
    console.error(`[smoke] /health unreachable at ${base}. Start the server first: npm run dev`);
    process.exit(2);
  }
  console.info('[smoke] health OK');

  const body = buildBody();
  const bodyJson = JSON.stringify(body);
  const bodyBuf = Buffer.from(bodyJson, 'utf-8');
  const sig = signBody(bodyBuf, SECRET);

  console.info(`[smoke] POST ${base}/admin/create-room (body ${bodyBuf.length} bytes)`);
  const res = await fetch(`${base}/admin/create-room`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-bot-signature': sig,
    },
    body: bodyJson,
  });

  const text = await res.text();
  let json: { ok?: boolean; room_name?: string; ws_url?: string; error?: string } = {};
  try {
    json = JSON.parse(text);
  } catch {
    // leave json empty; we'll print raw text below
  }

  if (!res.ok || !json.ok) {
    console.error(`[smoke] handler rejected: status=${res.status} body=${text}`);
    process.exit(3);
  }

  if (!json.room_name || typeof json.room_name !== 'string' || !json.ws_url) {
    console.error('[smoke] handler accepted but response malformed:', json);
    process.exit(4);
  }

  console.info(`[smoke] ✓ room created: room_name=${json.room_name} ws_url=${json.ws_url}`);
  console.info('[smoke] PASS');
}

main().catch((err) => {
  console.error('[smoke] unexpected error:', err);
  process.exit(1);
});
