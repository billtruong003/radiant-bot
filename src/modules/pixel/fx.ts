import { type Ctx, frame, rect, text } from './canvas.js';
import { drawIcon } from './icons.js';
import { PX, REALM_COLOR, enchantColor, rgba } from './palette.js';

/**
 * Pixel effects, all hard-edged (no blur) so they survive GIF palettes.
 * Each takes `t` in [0, 1): the position in the loop. A still card passes a
 * fixed t; an animated card draws the same scene for several t values.
 */

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Square wave: true for half of each cycle, shifted by phase. */
const on = (t: number, phase = 0, cycles = 1) => (t * cycles + phase) % 1 < 0.5;

export function sprite(
  ctx: Ctx,
  rows: string[],
  colors: Record<string, string>,
  s: number,
  x: number,
  y: number,
  alpha = 1,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  rows.forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) {
      const c = colors[row[rx] ?? '.'];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(Math.round(x + rx * s), Math.round(y + ry * s), s, s);
    }
  });
  ctx.restore();
}

const SPARK = ['..a..', '..b..', 'abcba', '..b..', '..a..'];
const TWINKLE = ['.a.', 'aba', '.a.'];
const FLAME = [
  '...a...',
  '..aba..',
  '..abba.',
  '.abcba.',
  '.abccba',
  'abccba.',
  'abcccba',
  '.abcba.',
];
export const SHARD = ['aab.', 'abb.', '.ab.', '..a.'];

export function spark(
  ctx: Ctx,
  x: number,
  y: number,
  t: number,
  color: string = PX.white,
  mid?: string,
  s = 4,
  phase = 0,
): void {
  if (!on(t, phase, 2)) return;
  sprite(ctx, SPARK, { a: color, b: mid ?? color, c: '#ffffff' }, s, x, y);
}

export function twinkle(
  ctx: Ctx,
  x: number,
  y: number,
  t: number,
  color = '#ffffff',
  s = 3,
  phase = 0,
): void {
  if (!on(t, phase, 2)) return;
  sprite(ctx, TWINKLE, { a: color, b: '#ffffff' }, s, x, y);
}

export function flame(
  ctx: Ctx,
  x: number,
  y: number,
  t: number,
  s = 4,
  outer = '#e8806e',
  mid = '#f0b84a',
  core = '#fff6c8',
): void {
  const lift = on(t, x * 0.013, 4) ? s : 0;
  sprite(ctx, FLAME, { a: outer, b: mid, c: core }, s, x, y - lift);
}

export function shards(ctx: Ctx, pts: [number, number, string][], s = 8): void {
  for (const [x, y, c] of pts) sprite(ctx, SHARD, { a: c, b: '#ffffff' }, s, x, y);
}

/** Motes that rise and fade, each on its own phase. */
export function particles(
  ctx: Ctx,
  seed: number,
  n: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  colors: string[],
  t: number,
  rise = 48,
  sizes = [3, 4, 6],
): void {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = x0 + r() * w;
    const y = y0 + r() * h;
    const s = sizes[Math.floor(r() * sizes.length)] ?? 4;
    const c = colors[Math.floor(r() * colors.length)] ?? PX.white;
    const ph = (t + r()) % 1;
    const step = Math.floor(ph * 10) / 10;
    const a = step < 0.15 ? step / 0.15 : 1 - step;
    rect(ctx, Math.round(x), Math.round(y - step * rise), s, s, c, Math.max(0, a));
  }
}

/** Concentric hard rings (diamonds by default) that pulse. */
export function rings(
  ctx: Ctx,
  cx: number,
  cy: number,
  color: string,
  t: number,
  o: {
    n?: number;
    step?: number;
    start?: number;
    thick?: number;
    diamond?: boolean;
    alphas?: number[];
  } = {},
): void {
  const n = o.n ?? 3;
  const alphas = o.alphas ?? [0.55, 0.35, 0.18, 0.1];
  for (let i = 0; i < n; i++) {
    const pulse = 1 + 0.07 * (Math.floor(((t + i * 0.25) % 1) * 4) % 2);
    const r = ((o.start ?? 40) + i * (o.step ?? 22)) * pulse;
    ctx.save();
    ctx.translate(cx, cy);
    if (o.diamond ?? true) ctx.rotate(Math.PI / 4);
    ctx.globalAlpha = alphas[Math.min(i, alphas.length - 1)] ?? 0.1;
    ctx.strokeStyle = color;
    ctx.lineWidth = o.thick ?? 4;
    ctx.strokeRect(-r, -r, 2 * r, 2 * r);
    ctx.restore();
  }
}

/** A fan of light rays turning slowly around a centre. */
export function rays(
  ctx: Ctx,
  cx: number,
  cy: number,
  color: string,
  t: number,
  o: {
    n?: number;
    length?: number;
    width?: number;
    alpha?: number;
    inner?: number;
    offset?: number;
  } = {},
): void {
  const n = o.n ?? 12;
  const len = o.length ?? 220;
  const inner = o.inner ?? 40;
  const turn = (Math.floor(t * 12) / 12) * ((Math.PI * 2) / n) + (o.offset ?? 0);
  ctx.save();
  ctx.translate(cx, cy);
  for (let i = 0; i < n; i++) {
    ctx.save();
    ctx.rotate((Math.PI * 2 * i) / n + turn);
    const g = ctx.createLinearGradient(inner, 0, len, 0);
    g.addColorStop(0, rgba(color, o.alpha ?? 0.35));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    const w = o.width ?? 6;
    ctx.fillRect(inner, -w / 2, len - inner, w);
    ctx.restore();
  }
  ctx.restore();
}

/** Column of light made of three hard stripes, breathing. */
export function pillar(
  ctx: Ctx,
  cx: number,
  top: number,
  bottom: number,
  color: string,
  t: number,
  w = 60,
): void {
  const breathe = 0.55 + 0.45 * (Math.floor(((t * 2) % 1) * 4) % 2 ? 0.6 : 1);
  for (const [ww, a] of [
    [w, 0.12],
    [(w * 2) / 3, 0.18],
    [w / 3, 0.3],
  ] as const)
    rect(ctx, cx - ww / 2, top, ww, bottom - top, color, a * breathe);
}

function pixLine(
  ctx: Ctx,
  pts: [number, number][],
  s: number,
  color: string,
  alpha: number,
  grow: number,
): void {
  for (let k = 0; k < pts.length - 1; k++) {
    const [x0, y0] = pts[k] as [number, number];
    const [x1, y1] = pts[k + 1] as [number, number];
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / s + 1;
    for (let i = 0; i <= n; i++) {
      let x = x0 + ((x1 - x0) * i) / n;
      let y = y0 + ((y1 - y0) * i) / n;
      x -= x % s;
      y -= y % s;
      rect(ctx, x - grow * s, y, s * (1 + 2 * grow), s, color, alpha);
    }
  }
}

/**
 * Jagged pixel lightning with forks, three layers of glow and a burst where
 * it lands. Visible during `window` of the loop (default: a double flash).
 */
export function lightning(
  ctx: Ctx,
  x: number,
  y0: number,
  y1: number,
  t: number,
  o: {
    color?: string;
    core?: string;
    seed?: number;
    s?: number;
    forks?: number;
    impact?: boolean;
    phase?: number;
    always?: boolean;
  } = {},
): void {
  const tt = (t + (o.phase ?? 0)) % 1;
  const visible = o.always || (tt >= 0.09 && tt < 0.16) || (tt >= 0.18 && tt < 0.4);
  if (!visible) return;
  const s = o.s ?? 4;
  const color = o.color ?? '#9fb8ff';
  const core = o.core ?? '#ffffff';
  const r = rng(o.seed ?? 1);
  const main: [number, number][] = [[x, y0]];
  let cx = x;
  let cy = y0;
  while (cy < y1) {
    cy = Math.min(y1, cy + 12 + Math.floor(r() * 12));
    cx += Math.floor(r() * 37) - 18;
    main.push([cx, cy]);
  }
  pixLine(ctx, main, s, color, 0.18, 3);
  pixLine(ctx, main, s, color, 0.35, 2);
  pixLine(ctx, main, s, color, 0.8, 1);
  pixLine(ctx, main, s, core, 1, 0);
  for (let f = 0; f < (o.forks ?? 3); f++) {
    const start = main[1 + Math.floor(r() * Math.max(1, main.length - 3))] ?? main[0];
    if (!start) continue;
    let [fx, fy] = start;
    const fork: [number, number][] = [[fx, fy]];
    const dir = r() < 0.5 ? -1 : 1;
    const len = 3 + Math.floor(r() * 3);
    for (let k = 0; k < len; k++) {
      fx += dir * (8 + Math.floor(r() * 11));
      fy += 8 + Math.floor(r() * 9);
      fork.push([fx, fy]);
    }
    pixLine(ctx, fork, s, color, 0.5, 0);
    pixLine(ctx, fork.slice(0, 3), s, core, 0.9, 0);
  }
  if (o.impact ?? true) {
    const end = main[main.length - 1] ?? [x, y1];
    rings(ctx, end[0], end[1], color, 0, { n: 2, step: 14, start: 16, thick: s });
    sprite(ctx, SPARK, { a: core, b: color, c: '#ffffff' }, 5, end[0] - 12, end[1] - 12);
  }
}

export function stormClouds(
  ctx: Ctx,
  w: number,
  t: number,
  color = '#2a2f55',
  edge = '#3a4a7a',
  seed = 5,
  h = 70,
): void {
  const r = rng(seed);
  const drift = -Math.floor(((t * 2) % 1) * 6) * 2;
  let x = -20;
  while (x < w) {
    const cw = 80 + Math.floor(r() * 80);
    const ch = 30 + Math.floor(r() * (h - 30));
    rect(ctx, x + drift, -ch / 3, cw, ch, color);
    rect(ctx, x + drift, -ch / 3 + ch, cw, 6, edge);
    x += cw - 20 - Math.floor(r() * 20);
  }
}

export function screenFlash(ctx: Ctx, w: number, h: number, t: number, color = '#cfe0ff'): void {
  if (t >= 0.09 && t < 0.12) rect(ctx, 0, 0, w, h, color, 0.35);
  else if (t >= 0.18 && t < 0.21) rect(ctx, 0, 0, w, h, color, 0.15);
}

/** Curved sword trail. */
export function slash(
  ctx: Ctx,
  x: number,
  y: number,
  t: number,
  o: { length?: number; color?: string; edge?: string; s?: number; slope?: number } = {},
): void {
  if (!on(t, 0.1, 1)) return;
  const len = o.length ?? 220;
  const s = o.s ?? 6;
  const slope = o.slope ?? -0.6;
  for (let i = 0; i < len; i += s) {
    const yy = y + Math.round(i * slope + (i * i) / (len * 2.2));
    const w = i < len * 0.15 || i > len * 0.85 ? s : s * 2;
    rect(ctx, x + i, yy + s, s, w, o.edge ?? PX.red);
    rect(ctx, x + i, yy, s, w, o.color ?? PX.white);
  }
}

/** Damage number that floats up, outlined. */
export function dmgNumber(
  ctx: Ctx,
  x: number,
  y: number,
  value: string,
  t: number,
  color: string = PX.inkBright,
  size = 40,
): void {
  const step = Math.floor(t * 8) / 8;
  const dy = Math.round(10 - step * 26);
  const alpha = step > 0.85 ? 0.4 : 1;
  for (const [dx, dyy] of [
    [-3, 0],
    [3, 0],
    [0, -3],
    [0, 3],
    [-3, -3],
    [3, 3],
    [-3, 3],
    [3, -3],
  ] as const)
    text(ctx, value, x + dx, y + dy + dyy, { size, color: PX.bg, alpha });
  text(ctx, value, x, y + dy, { size, color, alpha, bold: true });
}

/**
 * An item icon with its upgrade level drawn over it:
 * +1..3 badge · +4..6 glowing frame and corner sparks · +7..9 aura and rising
 * motes · +10 flames and a gold frame.
 */
export async function drawEnchanted(
  ctx: Ctx,
  icon: string,
  level: number,
  frameColor: string,
  x: number,
  y: number,
  box: number,
  size: 32 | 64 | 128,
  t: number,
  o: { badge?: boolean; seed?: number } = {},
): Promise<void> {
  const ec = enchantColor(level);
  if (level >= 7 && ec && box >= 70)
    rings(ctx, x + box / 2, y + box / 2, ec, t, {
      n: 2,
      step: Math.max(6, Math.round(box / 14)),
      start: Math.round(box * 0.38),
      thick: 3,
      alphas: [0.5, 0.25],
    });
  rect(ctx, x, y, box, box, PX.bgDeep);
  if (level >= 4 && ec) {
    frame(ctx, x + 3, y + 3, box - 6, box - 6, ec, 3, 0.33);
    const glow = Math.floor(((t + (o.seed ?? 0) * 0.13) % 1) * 3) !== 1;
    if (glow) frame(ctx, x - 9, y - 9, box + 18, box + 18, ec, 3);
  }
  frame(ctx, x, y, box, box, level >= 10 ? '#f0b84a' : frameColor, 3);
  const pad = Math.floor((box - size) / 2);
  await drawIcon(ctx, icon, x + pad, y + pad, size);
  if (level >= 4 && ec) {
    for (const [cx, cy] of [
      [x + 6, y + 6],
      [x + box - 15, y + 6],
      [x + 6, y + box - 15],
      [x + box - 15, y + box - 15],
    ] as const)
      twinkle(ctx, cx, cy, t, ec, 3, (cx + cy) * 0.01);
  }
  if (level >= 7 && ec)
    particles(
      ctx,
      (o.seed ?? 1) + 7,
      8,
      x + 8,
      y + 2,
      box - 20,
      box / 2,
      [ec, '#ffffff'],
      t,
      24,
      [3, 4],
    );
  if (level >= 10) {
    flame(ctx, x + 4, y + box - 36, t, 3);
    flame(ctx, x + box - 26, y + box - 36, t, 3);
  }
  if (level > 0 && (o.badge ?? true) && ec) {
    const label = `+${level}`;
    const bw = label.length * 11 + 8;
    rect(ctx, x + box - bw + 6, y + box - 16, bw, 24, PX.bg);
    frame(ctx, x + box - bw + 6, y + box - 16, bw, 24, ec, 2);
    text(ctx, label, x + box - bw + 10, y + box - 15, { size: 24, color: ec, bold: true });
  }
}

/** Realm aura behind a character: more layers as the realm rises. */
export function aura(
  ctx: Ctx,
  cx: number,
  cy: number,
  color: string,
  tier: number,
  t: number,
  seed = 7,
): void {
  rings(ctx, cx, cy, color, t, { n: Math.min(1 + tier, 4), step: 26, start: 70 });
  if (tier >= 2)
    particles(ctx, seed, 10 + tier * 6, cx - 150, cy - 170, 300, 300, [color, '#ffffff'], t);
  if (tier >= 3)
    rays(ctx, cx, cy, color, t, { n: 16, length: 240, width: 4, alpha: 0.25, inner: 90 });
}

export const REALM_ORDER = [
  'pham_nhan',
  'luyen_khi',
  'truc_co',
  'kim_dan',
  'nguyen_anh',
  'hoa_than',
  'luyen_hu',
  'hop_the',
  'dai_thua',
  'do_kiep',
  'tien_nhan',
] as const;
const REALM_BG = [
  '#17151d',
  '#171a20',
  '#141c17',
  '#1f1a12',
  '#121a26',
  '#11201f',
  '#120f1f',
  '#1f1019',
  '#21130f',
  '#0a0b18',
  '#1c1a26',
];
const RAINBOW = ['#e8806e', '#f0d060', '#8fd18a', '#7fd0d8', '#5fa8e8', '#b48ef0', '#e070b0'];

/**
 * Background and effects for breaking through to realm `i` (0 = Phàm Nhân).
 * Each realm keeps the lower realms' layers and adds its own.
 * (cx, cy) is the character's centre; k scales sizes.
 */
export function realmScene(
  ctx: Ctx,
  i: number,
  w: number,
  h: number,
  cx: number,
  cy: number,
  t: number,
  k = 1,
  seed = 0,
): void {
  const col = REALM_COLOR[REALM_ORDER[i] ?? 'kim_dan'] ?? PX.gold;
  const s = (v: number) => Math.max(1, Math.round(v * k));
  rect(ctx, 0, 0, w, h, REALM_BG[i] ?? PX.bg);
  if (i >= 6)
    particles(
      ctx,
      seed + 1,
      s(60),
      0,
      0,
      w,
      h * 0.7,
      ['#3a3060', '#5a4a8a', '#ffffff'],
      t,
      6,
      [2, 3],
    );
  if (i === 9) stormClouds(ctx, w, t, '#1a1c30', '#2a2f55', seed + 3, s(70));
  if (i >= 3) pillar(ctx, cx, 0, h, i === 10 ? '#ffffff' : col, t, s(90 + i * 14));
  if (i === 10)
    RAINBOW.forEach((c, j) =>
      rays(ctx, cx, cy, c, t, {
        n: 6,
        length: s(520),
        width: s(8),
        alpha: 0.28,
        inner: s(100),
        offset: (j * 8 * Math.PI) / 180,
      }),
    );
  else if (i >= 3)
    rays(ctx, cx, cy, col, t, {
      n: 12 + i * 2,
      length: s(240 + i * 30),
      width: s(6),
      alpha: 0.18 + i * 0.012,
      inner: s(80),
    });
  if (i >= 1)
    rings(ctx, cx, cy, col, t, {
      n: Math.min(1 + Math.floor(i / 2), 5),
      step: s(26),
      start: s(70),
      thick: s(4),
      diamond: i !== 2,
    });
  if (i === 1)
    for (let j = 0; j < 6; j++) {
      const ph = (t + j / 6) % 1;
      rect(
        ctx,
        cx - s(150) + j * s(50),
        cy + s(60) - j * s(18) - Math.floor(ph * 8) * s(4),
        s(60),
        s(4),
        col,
        0.5,
      );
    }
  particles(
    ctx,
    seed + 2,
    s(8 + i * 7),
    cx - s(220),
    cy - s(200),
    s(440),
    s(360),
    i === 10 ? [col, '#ffffff', ...RAINBOW] : [col, '#ffffff'],
    t,
  );
  if (i === 2)
    for (const dx of [-120, -60, 40, 100])
      sprite(ctx, ['aab', 'abb'], { a: '#6fbf73', b: '#3f7f4a' }, s(6), cx + s(dx), cy + s(130));
  if (i === 3)
    sprite(
      ctx,
      ['.aaa.', 'abbba', 'abcba', 'abbba', '.aaa.'],
      { a: '#d4a94a', b: '#f0d060', c: '#ffffff' },
      s(6),
      cx - s(15),
      cy - s(220) - (on(t, 0, 2) ? s(4) : 0),
    );
  if (i === 5)
    for (let j = 0; j < 8; j++) {
      const a = (j / 8) * Math.PI * 2;
      flame(
        ctx,
        Math.round(cx + Math.cos(a) * s(150)) - s(14),
        Math.round(cy + Math.sin(a) * s(110)),
        t,
        s(4),
        '#3f8f9a',
        '#7fd0d8',
        '#ffffff',
      );
    }
  if (i === 6)
    shards(
      ctx,
      [
        [cx - s(170), cy - s(80), '#b48ef0'],
        [cx + s(150), cy - s(120), '#b48ef0'],
        [cx - s(130), cy + s(60), '#7a5ab0'],
        [cx + s(170), cy + s(40), '#b48ef0'],
        [cx + s(40), cy - s(200), '#7a5ab0'],
      ],
      s(8),
    );
  if (i === 8)
    for (const side of [-1, 1])
      for (let j = 0; j < 5; j++)
        flame(
          ctx,
          cx + side * s(70 + j * 34) - s(14),
          cy - s(60) - j * s(18),
          t,
          s(5),
          '#b23a3a',
          '#e8806e',
          '#f0d060',
        );
  if (i >= 8) {
    spark(ctx, cx - s(90), cy - s(140), t, col, '#ffffff', s(5));
    spark(ctx, cx + s(80), cy - s(160), t, col, '#ffffff', s(5), 0.5);
  }
  if (i === 9) {
    screenFlash(ctx, w, h, t, '#fff6c8');
    [0.06, 0.2, 0.8, 0.94].forEach((x0, j) =>
      lightning(ctx, Math.round(w * x0), s(20), s(250), t, {
        color: '#f0d060',
        seed: seed + j * 7 + 3,
        forks: 2,
        s: Math.max(2, s(5)),
        phase: j * 0.25,
      }),
    );
  }
  if (i === 10) {
    ctx.save();
    ctx.strokeStyle = '#fff6c8';
    ctx.lineWidth = s(5);
    ctx.beginPath();
    ctx.ellipse(cx, cy - s(140), s(60), s(12), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    for (const [x0, y0] of [
      [0.1, 0.9],
      [0.26, 0.94],
      [0.74, 0.93],
      [0.9, 0.89],
    ] as const) {
      const x = Math.round(w * x0) - s(55);
      const y = Math.round(h * y0);
      rect(ctx, x, y, s(110), s(22), '#ffffff', 0.14);
      rect(ctx, x + s(30), y - s(14), s(110), s(22), '#ffffff', 0.14);
    }
    RAINBOW.forEach((c, j) =>
      rect(ctx, (w / RAINBOW.length) * j, 0, w / RAINBOW.length + 1, s(6), c),
    );
  }
}
