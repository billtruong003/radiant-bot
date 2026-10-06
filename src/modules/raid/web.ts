import type { IncomingMessage, ServerResponse } from 'node:http';
import { rankById } from '../../config/cultivation.js';
import { getStore } from '../../db/index.js';
import { BACK_NONE, DEFAULT_LOOK } from '../avatar/catalog.js';
import { getLook } from '../avatar/service.js';
import { GRID_MONSTERS, STRIPS } from '../pixel/monsters.js';
import { readJsonBody, sendHtml, sendJson } from '../web/router.js';
import { messagePage, page } from '../web/shell.js';
import { CHANGE_ERROR, readRaidToken } from './discord.js';
import { IDLE_CAP_MS, RAID_DAILY_CAP, monsterPower } from './engine.js';
import { changeRaid, claimRaid, getBoss, openZones, raidView } from './service.js';
import { FLOORS, MONSTERS, ZONES } from './zones.js';

/**
 * /raid — the bí cảnh page. The browser animates the fight with the same
 * sprites; every number comes from the server (raidView), and claiming or
 * moving goes through the same service as the Discord buttons.
 */

const GONE = messagePage(
  'Link bí cảnh hết hạn',
  'Link chỉ dùng được 6 giờ. Quay lại Discord gõ <b>/bi-canh xem</b> để lấy link mới.',
);

const ART = {
  strips: STRIPS,
  grids: GRID_MONSTERS,
  backNone: BACK_NONE,
};

function stateOf(discordId: string, now = Date.now()) {
  const v = raidView(discordId, now);
  const u = getStore().users.get(discordId);
  const boss = getBoss(now);
  const open = new Set(openZones(discordId).map((z) => z.id));
  return {
    ok: true,
    now,
    name: u?.display_name ?? u?.username ?? 'Tu sĩ',
    rankName: rankById(u?.cultivation_rank ?? 'pham_nhan').name,
    look: getLook(discordId) ?? DEFAULT_LOOK,
    companions: v.companions.map((c) => ({
      name: c.name,
      power: c.power,
      look: getLook(c.id) ?? DEFAULT_LOOK,
    })),
    zone: { ...v.zone, monsters: v.zone.monsters.map((m) => MONSTERS[m]).filter(Boolean) },
    floor: v.meta.floor,
    floors: FLOORS,
    best: v.meta.best[v.zone.id] ?? 0,
    power: v.power,
    leaderPower: v.leaderPower,
    monsterPower: v.monsterPower,
    killsPerHour: v.killsPerHour,
    since: v.meta.since,
    idleCapMs: IDLE_CAP_MS,
    pendingKills: v.pendingKills,
    pendingLoot: v.pendingLoot,
    dayCapped: v.dayCapped,
    dayCap: RAID_DAILY_CAP,
    taken: v.meta.taken,
    canUp: v.canUp,
    canDown: v.canDown,
    totalKills: v.meta.total_kills,
    boss: {
      name: boss.name,
      hp: boss.hp,
      maxHp: boss.max_hp,
      mine: boss.contributors[discordId] ?? 0,
    },
    zones: ZONES.map((z) => ({
      id: z.id,
      name: z.name,
      open: open.has(z.id),
      need: rankById(z.minRank).name,
      power1: monsterPower(z, 1),
    })),
    art: ART,
  };
}

/** Slow down button mashing: one claim / move per member every 2 s. */
const lastAction = new Map<string, number>();

export async function handleRaidWeb(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const p = url.pathname;
  if (req.method === 'GET' && (p === '/raid' || p === '/raid/')) {
    if (!readRaidToken(url.searchParams.get('t') ?? '')) return sendHtml(res, 410, GONE);
    sendHtml(
      res,
      200,
      page({ title: 'Bí cảnh', body: '<div id="app" class="wrap"></div>', script: 'raid' }),
    );
    return;
  }
  if (req.method === 'GET' && p === '/raid/api/state') {
    const who = readRaidToken(url.searchParams.get('t') ?? '');
    if (!who) return sendJson(res, 410, { ok: false, error: 'Link đã hết hạn.' });
    return sendJson(res, 200, stateOf(who));
  }
  if (req.method !== 'POST') return sendJson(res, 404, { ok: false, error: 'not found' });
  let body: Record<string, unknown>;
  try {
    body = ((await readJsonBody(req, 4096)) ?? {}) as Record<string, unknown>;
  } catch {
    return sendJson(res, 400, { ok: false, error: 'Dữ liệu gửi lên không đọc được.' });
  }
  const who = typeof body.t === 'string' ? readRaidToken(body.t) : null;
  if (!who) return sendJson(res, 410, { ok: false, error: 'Link đã hết hạn.' });
  const now = Date.now();
  if (now - (lastAction.get(who) ?? 0) < 2000)
    return sendJson(res, 429, { ok: false, error: 'Chậm lại chút, đợi 2 giây.' });
  lastAction.set(who, now);

  if (p === '/raid/api/claim') {
    const report = await claimRaid(who, now);
    return sendJson(res, 200, { ...stateOf(who), report });
  }
  if (p === '/raid/api/move') {
    const zone = typeof body.zone === 'string' ? body.zone : undefined;
    const floor = typeof body.floor === 'number' ? body.floor : undefined;
    const r = await changeRaid(who, { zone, floor }, now);
    if (!r.ok) return sendJson(res, 409, { ok: false, error: CHANGE_ERROR[r.error] });
    return sendJson(res, 200, { ...stateOf(who), report: r.report.kills > 0 ? r.report : null });
  }
  sendJson(res, 404, { ok: false, error: 'not found' });
}
