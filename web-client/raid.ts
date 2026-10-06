import { api, h, token } from './dom';

/**
 * Bí cảnh in the browser. The server decides every number (kills, loot,
 * floors); this page only animates the party fighting the floor's monsters
 * with the same sprites the Discord cards use, and sends Thu hoạch /
 * Lên tầng / Rút lui / đổi bãi.
 */

interface Look {
  skin: number;
  eyes: number;
  hair_style: number;
  hair_color: number;
  robe_style: number;
  robe_color: number;
  back: number;
}
interface Strip {
  file: string;
  frames: number;
  fw: number;
  fh: number;
  footPad: number;
  facesRight?: boolean;
}
interface Monster {
  id: string;
  name: string;
  art:
    | { kind: 'strip'; idle: string; attack?: string; death?: string }
    | { kind: 'grid'; key: string };
  scale: number;
}
interface Loot {
  xp: number;
  pills: number;
  coins: number;
}
interface State {
  ok: boolean;
  error?: string;
  now: number;
  name: string;
  rankName: string;
  look: Look;
  companions: { name: string; power: number; look: Look }[];
  zone: {
    id: string;
    name: string;
    lore: string;
    ground: string;
    sky: string;
    monsters: Monster[];
  };
  floor: number;
  floors: number;
  best: number;
  power: number;
  leaderPower: number;
  monsterPower: number;
  killsPerHour: number;
  since: number;
  idleCapMs: number;
  pendingKills: number;
  pendingLoot: Loot;
  dayCapped: boolean;
  dayCap: Loot;
  taken: Loot;
  canUp: boolean;
  canDown: boolean;
  totalKills: number;
  boss: { name: string; hp: number; maxHp: number; mine: number };
  zones: { id: string; name: string; open: boolean; need: string; power1: number }[];
  art: {
    strips: Record<string, Strip>;
    grids: Record<string, { name: string; rows: string[]; colors: Record<string, string> }>;
    backNone: number;
  };
  report?: {
    kills: number;
    loot: Loot;
    dayCapped: boolean;
    clearedFloor: boolean;
    floor: number;
  } | null;
}

const CSS = `
.stage{position:relative;border:3px solid var(--line);background:#000}
.stage canvas{display:block;width:100%;height:auto;image-rendering:pixelated}
.hud{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.big{font-size:30px;color:var(--bright)}
.bar{height:16px;background:var(--deep);border:2px solid var(--line);position:relative}
.bar>i{position:absolute;left:0;top:0;bottom:0;background:var(--gold)}
.bar.red>i{background:var(--red)}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
select{font-family:VT323,monospace;font-size:22px;background:var(--panel);color:var(--ink);border:3px solid var(--line);min-height:44px;padding:0 8px}
`;
const style = document.createElement('style');
style.textContent = CSS;
document.head.append(style);

const W = 960;
const H = 360;
const GROUND = 300;
const TILE_W = 32;
const TILE_H = 48;

const images = new Map<string, Promise<HTMLImageElement>>();
function img(src: string): Promise<HTMLImageElement> {
  let p = images.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = src;
    });
    images.set(src, p);
  }
  return p;
}

/** Paper-doll tile, same layering as src/modules/pixel/character.ts. */
const tiles = new Map<string, HTMLCanvasElement>();
async function tile(look: Look, backNone: number): Promise<HTMLCanvasElement> {
  const key = Object.values(look).join('.');
  const hit = tiles.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = TILE_W;
  c.height = TILE_H;
  const x = c.getContext('2d') as CanvasRenderingContext2D;
  x.imageSmoothingEnabled = false;
  const [skin, eyes, hair, robe, shoes, back] = await Promise.all(
    ['skin', 'eyes', 'hair', 'robe', 'shoes', 'back'].map((n) => img(`/cult/sprites/${n}.png`)),
  );
  const layers: [HTMLImageElement | undefined, number, number][] = [];
  if (look.back !== backNone) layers.push([back, look.back, 0]);
  layers.push(
    [skin, look.skin, 0],
    [eyes, look.eyes, 0],
    [shoes, 0, 0],
    [robe, look.robe_color, look.robe_style],
    [hair, look.hair_style, look.hair_color],
  );
  for (const [im, col, row] of layers)
    if (im) x.drawImage(im, col * TILE_W, row * TILE_H, TILE_W, TILE_H, 0, 0, TILE_W, TILE_H);
  tiles.set(key, c);
  return c;
}

const app = document.getElementById('app') as HTMLElement;
const t = token();
let state: State;
let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let parties: HTMLCanvasElement[] = [];
let busy = false;
let clockOffset = 0;

// ---------------------------------------------------------------- drawing

function rect(x: number, y: number, w: number, hh: number, c: string, a = 1): void {
  ctx.globalAlpha = a;
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(hh));
  ctx.globalAlpha = 1;
}

function drawGrid(key: string, cx: number, scale: number, alpha: number, bob: number): void {
  const m = state.art.grids[key];
  if (!m) return;
  const width = Math.max(...m.rows.map((r) => r.length));
  const x0 = Math.round(cx - (width * scale) / 2);
  const y0 = Math.round(GROUND - m.rows.length * scale - bob);
  ctx.globalAlpha = alpha;
  m.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = m.colors[row[x] ?? '.'];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x0 + (width - 1 - x) * scale, y0 + y * scale, scale, scale);
    }
  });
  ctx.globalAlpha = 1;
}

async function drawStripFrame(
  key: string,
  frame: number,
  cx: number,
  scale: number,
  alpha: number,
): Promise<void> {
  const s = state.art.strips[key];
  if (!s) return;
  const im = await img(`/cult/monsters/${s.file}.png`);
  const f = ((frame % s.frames) + s.frames) % s.frames;
  const w = s.fw * scale;
  const hh = s.fh * scale;
  const x = Math.round(cx - w / 2);
  const y = Math.round(GROUND - hh + s.footPad * scale);
  ctx.save();
  ctx.globalAlpha = alpha;
  // Enemies face the party (left). Packs drawn facing right get flipped.
  if (s.facesRight) {
    ctx.translate(x + w, y);
    ctx.scale(-1, 1);
    ctx.drawImage(im, f * s.fw, 0, s.fw, s.fh, 0, 0, w, hh);
  } else ctx.drawImage(im, f * s.fw, 0, s.fw, s.fh, x, y, w, hh);
  ctx.restore();
}

interface Pop {
  x: number;
  y: number;
  text: string;
  born: number;
  color: string;
}
const pops: Pop[] = [];
/** One visual kill every few seconds; the real count comes from the server. */
const slotDeath = [0, 0, 0];

async function frame(now: number): Promise<void> {
  if (!state) return;
  const tick = Math.floor(now / 120);
  rect(0, 0, W, H, state.zone.sky);
  for (let i = 0; i < 24; i++) {
    const px = (i * 137 + tick * (i % 3)) % W;
    const py = 30 + ((i * 53 + tick * 2) % 220);
    rect(px, py, 3, 3, i % 2 ? '#6e6780' : state.zone.ground, 0.6);
  }
  rect(0, GROUND, W, H - GROUND, state.zone.ground);
  rect(0, GROUND - 4, W, 4, '#2e2939');

  const fighting = state.killsPerHour > 0;
  const lunge = fighting && tick % 10 < 2 ? 16 : 0;
  for (let i = parties.length - 1; i >= 0; i--) {
    const c = parties[i];
    if (!c) continue;
    const scale = i === 0 ? 4 : 3;
    const x = 210 - i * 70 + (i === 0 ? lunge : 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      c,
      Math.round(x - (TILE_W * scale) / 2),
      GROUND - i * 6 - TILE_H * scale,
      TILE_W * scale,
      TILE_H * scale,
    );
  }

  const ms = state.zone.monsters;
  for (let i = 0; i < 3; i++) {
    const m = ms[i % ms.length];
    if (!m) continue;
    const cx = 600 + i * 120;
    const dying = now - (slotDeath[i] ?? 0) < 700;
    const alpha = dying ? 1 - (now - (slotDeath[i] ?? 0)) / 700 : 1;
    if (m.art.kind === 'grid') drawGrid(m.art.key, cx, m.scale, alpha, tick % 2);
    else await drawStripFrame(m.art.idle, tick + i * 3, cx, m.scale, alpha);
  }

  if (fighting && tick % 10 === 2) {
    // A hit on a random monster, every 1.2 s.
    const i = ((tick / 10) % 3) | 0;
    const dmg = Math.max(1, Math.round(state.power / 10));
    if (!pops.some((p) => now - p.born < 150)) {
      pops.push({ x: 600 + i * 120, y: 150, text: `-${dmg}`, born: now, color: '#f0d060' });
      if (Math.random() < 0.35) slotDeath[i] = now;
    }
    ctx.fillStyle = '#fff6c8';
    for (let k = 0; k < 150; k += 6) ctx.fillRect(460 + k, 230 - k * 0.5 + (k * k) / 330, 6, 10);
  }
  ctx.font = '32px VT323, monospace';
  ctx.textAlign = 'center';
  for (const p of [...pops]) {
    const age = now - p.born;
    if (age > 900) {
      pops.splice(pops.indexOf(p), 1);
      continue;
    }
    ctx.globalAlpha = 1 - age / 900;
    ctx.fillStyle = '#15131c';
    ctx.fillText(p.text, p.x + 2, p.y - age / 30 + 2);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, p.x, p.y - age / 30);
    ctx.globalAlpha = 1;
  }
  if (!fighting) {
    ctx.fillStyle = '#e8806e';
    ctx.font = '26px VT323, monospace';
    ctx.fillText('Đội không trụ nổi tầng này', 660, 100);
  }
}

function loop(now: number): void {
  void frame(now).then(() => requestAnimationFrame(loop));
}

// ---------------------------------------------------------------- page

const fmt = (n: number) => n.toLocaleString('en-US');

function pending(now: number): number {
  const elapsed = Math.min(Math.max(0, now - state.since), state.idleCapMs);
  return Math.floor((state.killsPerHour * elapsed) / 3_600_000);
}

let live: HTMLElement;
function refreshLive(): void {
  if (!state || !live) return;
  // Server clock, so the count matches what Thu hoạch will pay.
  const now = Date.now() + clockOffset;
  const k = pending(now);
  const elapsed = Math.min(Math.max(0, now - state.since), state.idleCapMs);
  const pct = (elapsed / state.idleCapMs) * 100;
  const m = Math.floor(elapsed / 60_000);
  live.replaceChildren(
    h('div', { class: 'big' }, `${fmt(k)} yêu thú chờ thu`),
    h('div', { class: 'bar' }, h('i', { style: `width:${pct.toFixed(1)}%` })),
    h('div', { class: 'muted' }, `Treo ${Math.floor(m / 60)} giờ ${m % 60} phút / 8 giờ`),
  );
}

async function act(path: string, body: Record<string, unknown> = {}): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const r = await api<State>(path, { t, ...body });
    if (!r.data.ok) {
      note(r.data.error ?? 'Không làm được.', false);
      return;
    }
    await setState(r.data);
    const rep = r.data.report;
    if (rep && rep.kills > 0)
      note(
        `Thu hoạch ${fmt(rep.kills)} yêu thú: +${fmt(rep.loot.xp)} XP, +${rep.loot.pills} đan, +${fmt(rep.loot.coins)} cống hiến.${rep.dayCapped ? ' Đã chạm giới hạn hôm nay.' : ''}${rep.clearedFloor && rep.floor < state.floors ? ` Tầng ${rep.floor + 1} đã mở.` : ''}`,
        true,
      );
  } finally {
    busy = false;
  }
}

let noteBox: HTMLElement;
function note(text: string, ok: boolean): void {
  noteBox.replaceChildren(h('div', { class: `notice ${ok ? 'ok' : 'err'}` }, text));
}

async function setState(s: State): Promise<void> {
  state = s;
  clockOffset = s.now - Date.now();
  parties = await Promise.all(
    [s.look, ...s.companions.map((c) => c.look)].map((l) => tile(l, s.art.backNone)),
  );
  render();
}

function render(): void {
  const s = state;
  app.replaceChildren();
  app.append(
    h(
      'div',
      { class: 'head' },
      h(
        'div',
        {},
        h('div', { class: 'kicker' }, `BÍ CẢNH · ${s.name} · ${s.rankName}`),
        h('div', { class: 'h1' }, `${s.zone.name} · tầng ${s.floor}`),
      ),
      h(
        'div',
        { class: 'row' },
        h(
          'span',
          { class: 'pill', style: 'border:2px solid var(--line);padding:0 8px' },
          `Đội ${fmt(s.power)}`,
        ),
        h(
          'span',
          {
            class: 'pill',
            style: `border:2px solid var(--line);padding:0 8px;color:${s.killsPerHour ? 'var(--gold)' : 'var(--red)'}`,
          },
          `Quái ${fmt(s.monsterPower)}`,
        ),
      ),
    ),
  );
  const stage = h('div', { class: 'stage' });
  stage.append(canvas);
  app.append(stage);

  live = h('div', { class: 'panel' });
  const zoneSelect = h(
    'select',
    {
      'aria-label': 'Bãi săn',
      onchange: (e: Event) =>
        void act('/raid/api/move', { zone: (e.target as HTMLSelectElement).value }),
    },
    ...s.zones.map((z) =>
      h(
        'option',
        { value: z.id, selected: z.id === s.zone.id, disabled: !z.open },
        z.open ? z.name : `${z.name} (cần ${z.need})`,
      ),
    ),
  );
  app.append(
    h(
      'div',
      { class: 'hud' },
      live,
      h(
        'div',
        { class: 'panel' },
        h('div', { class: 'big' }, s.killsPerHour ? `${s.killsPerHour} con mỗi giờ` : 'Bị chặn'),
        h('div', { class: 'muted' }, `Đã hạ tổng ${fmt(s.totalKills)} yêu thú`),
        h(
          'div',
          { class: 'muted' },
          `Hôm nay: ${fmt(s.taken.xp)}/${fmt(s.dayCap.xp)} XP · ${s.taken.pills}/${s.dayCap.pills} đan · ${fmt(s.taken.coins)}/${fmt(s.dayCap.coins)} cống hiến`,
        ),
      ),
      h(
        'div',
        { class: 'panel' },
        h('div', { class: 'kicker', style: 'color:var(--red)' }, `BOSS TUẦN · ${s.boss.name}`),
        h(
          'div',
          { class: 'bar red' },
          h('i', { style: `width:${((s.boss.hp / s.boss.maxHp) * 100).toFixed(1)}%` }),
        ),
        h(
          'div',
          { class: 'muted' },
          s.boss.hp > 0
            ? `${fmt(s.boss.hp)} / ${fmt(s.boss.maxHp)} · bạn đã gây ${fmt(s.boss.mine)}`
            : 'Đã bị hạ tuần này',
        ),
      ),
    ),
  );
  app.append(
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn green', onclick: () => void act('/raid/api/claim') }, 'Thu hoạch'),
      h(
        'button',
        {
          class: 'btn',
          disabled: !s.canDown,
          onclick: () => void act('/raid/api/move', { floor: s.floor - 1 }),
        },
        'Rút lui (xuống tầng)',
      ),
      h(
        'button',
        {
          class: 'btn primary',
          disabled: !s.canUp,
          onclick: () => void act('/raid/api/move', { floor: s.floor + 1 }),
        },
        `Lên tầng ${s.floor + 1}`,
      ),
      zoneSelect,
    ),
  );
  noteBox = h('div', {});
  app.append(noteBox);
  app.append(
    h(
      'div',
      { class: 'panel muted' },
      s.zone.lore,
      ' Đội vẫn săn khi bạn rời trang, tối đa 8 giờ; đổi bãi hay đổi tầng sẽ thu hoạch trước. Mời hộ pháp bằng ',
      h('b', {}, '/bi-canh ho-phap'),
      ' trong Discord.',
    ),
  );
  refreshLive();
}

async function boot(): Promise<void> {
  canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = false;
  const r = await api<State>(`/raid/api/state?t=${encodeURIComponent(t)}`);
  if (!r.data.ok) {
    app.replaceChildren(h('div', { class: 'center' }, r.data.error ?? 'Link đã hết hạn.'));
    return;
  }
  await setState(r.data);
  setInterval(refreshLive, 1000);
  requestAnimationFrame(loop);
}

void boot();
