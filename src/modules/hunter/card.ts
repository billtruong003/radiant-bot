import path from 'node:path';
import { type CanvasRenderingContext2D, createCanvas, registerFont } from 'canvas';
import type { Hunter, HunterProfile } from '../../db/types.js';
import { combatFrom, statScore } from './power.js';

/**
 * The hunter card, drawn as a PNG because Discord does not show SVG. It
 * follows the Git Profile Awaken look: chamfered panels, the System blue,
 * rank colours that only ever mean rank.
 */

const FONT_DIR = path.join(process.cwd(), 'assets', 'fonts');
// Family names without weight words: pango would read "Bold" in a family name as a weight.
const FAMILY_FILES = {
  'ChakraPetch-Medium.ttf': 'HunterFont500',
  'ChakraPetch-SemiBold.ttf': 'HunterFont600',
  'ChakraPetch-Bold.ttf': 'HunterFont700',
};
let fontsReady = false;
const loadFonts = () => {
  if (fontsReady) return;
  // One family per weight: cairo/pango match weights unreliably across platforms.
  for (const [file, family] of Object.entries(FAMILY_FILES))
    registerFont(path.join(FONT_DIR, file), { family });
  fontsReady = true;
};

const C = {
  void: '#060a14',
  panel: '#0b1426',
  raised: '#111d36',
  line: '#1c2c4f',
  frame: '#3566b8',
  ink: '#e6edf7',
  muted: '#8a9bc0',
  system: '#3d8bff',
};
export const RANK_COLOR: Record<string, string> = {
  E: '#7b8496',
  D: '#a8b6cc',
  C: '#3ecf8e',
  B: '#8a86ff',
  A: '#d77bff',
  S: '#ffc53d',
  SS: '#ff8a3d',
  SSS: '#ff3d5e',
  EX: '#f2fbff',
};
const GLOWS = new Set(['A', 'S', 'SS', 'SSS', 'EX']);

export const topShare = (percentile: number): string => {
  const t = Math.max(0.01, (1 - percentile) * 100);
  return `TOP ${t < 0.1 ? t.toFixed(2) : t < 10 ? t.toFixed(1) : t.toFixed(0)}%`;
};

const font = (weight: 500 | 600 | 700, size: number) => `${size}px "HunterFont${weight}"`;

/** 45° cuts on the top-left and bottom-right corners, as in Awaken. */
function cut(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: number) {
  ctx.beginPath();
  ctx.moveTo(x + c, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - c);
  ctx.lineTo(x + w - c, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + c);
  ctx.closePath();
}

function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  f: string,
  color: string,
  align: 'left' | 'center' | 'right' = 'left',
  maxWidth?: number,
) {
  ctx.font = f;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  let shown = value;
  if (maxWidth)
    while (shown.length > 1 && ctx.measureText(shown).width > maxWidth)
      shown = `${shown.slice(0, -2)}…`;
  ctx.fillText(shown, x, y);
}

function sigil(
  ctx: CanvasRenderingContext2D,
  rank: string,
  x: number,
  y: number,
  w: number,
  h: number,
  size: number,
) {
  const color = RANK_COLOR[rank] ?? C.muted;
  ctx.save();
  if (GLOWS.has(rank)) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
  }
  cut(ctx, x, y, w, h, Math.min(10, h / 4));
  ctx.fillStyle = C.void;
  ctx.fill();
  ctx.lineWidth = rank === 'E' || rank === 'D' ? 1.5 : 2.5;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
  text(
    ctx,
    rank,
    x + w / 2,
    y + h / 2 + size * 0.36,
    font(700, rank.length > 2 ? size * 0.75 : size),
    color,
    'center',
  );
}

export interface CardInput {
  displayName: string;
  hunter: Hunter & { profile: HunterProfile };
}

export function drawHunterCard({ displayName, hunter }: CardInput): Buffer {
  loadFonts();
  const W = 900;
  const H = 470;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const p = hunter.profile;
  const combat = combatFrom(p);

  ctx.fillStyle = C.void;
  ctx.fillRect(0, 0, W, H);
  cut(ctx, 6, 6, W - 12, H - 12, 18);
  ctx.fillStyle = C.panel;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = C.frame;
  ctx.stroke();
  ctx.fillStyle = C.raised;
  ctx.fillRect(24, 7, W - 31, 40);
  text(ctx, '[ HUNTER LICENSE ]', W / 2, 34, font(700, 16), C.system, 'center');

  // Identity
  text(ctx, 'RANK', 86, 82, font(600, 13), C.muted, 'center');
  sigil(ctx, p.overall.rank, 30, 92, 112, 112, 54);
  text(ctx, topShare(p.overall.percentile), 86, 230, font(600, 15), C.ink, 'center');
  text(ctx, displayName, 168, 92, font(700, 28), C.ink, 'left', 420);
  text(ctx, `github.com/${hunter.github_login}`, 168, 120, font(500, 15), C.muted, 'left', 420);
  text(
    ctx,
    `${p.class.name} · ${p.class.element} · LV. ${p.level}`,
    168,
    148,
    font(600, 16),
    C.ink,
    'left',
    420,
  );
  if (p.title) {
    text(ctx, 'TITLE', 168, 176, font(600, 13), C.muted);
    text(ctx, p.title, 222, 176, font(600, 16), C.system, 'left', 360);
  }
  text(
    ctx,
    `DUELS  ${hunter.duel_wins}W · ${hunter.duel_losses}L`,
    168,
    204,
    font(600, 14),
    C.muted,
  );

  // Power
  text(ctx, 'HUNTER POWER', W - 34, 82, font(600, 13), C.muted, 'right');
  ctx.save();
  ctx.shadowColor = C.system;
  ctx.shadowBlur = 16;
  text(ctx, combat.power.toLocaleString('en-US'), W - 34, 132, font(700, 48), C.system, 'right');
  ctx.restore();

  // Six stats, two columns
  const colW = (W - 60 - 24) / 2;
  p.stats.forEach((s, i) => {
    const x = 30 + (i % 2) * (colW + 24);
    const y = 254 + Math.floor(i / 2) * 50;
    if (Math.floor(i / 2) % 2 === 0) {
      ctx.fillStyle = C.raised;
      ctx.fillRect(x, y, colW, 44);
    }
    text(ctx, s.code, x + 12, y + 28, font(600, 14), C.muted);
    sigil(ctx, s.rank, x + 56, y + 7, 52, 30, 18);
    text(
      ctx,
      `${s.value.toLocaleString('en-US')} ${s.source.toLowerCase()}`,
      x + 120,
      y + 21,
      font(500, 14),
      C.ink,
      'left',
      colW - 230,
    );
    const barW = colW - 230;
    ctx.fillStyle = C.void;
    ctx.fillRect(x + 120, y + 30, barW, 4);
    ctx.fillStyle = RANK_COLOR[s.rank] ?? C.muted;
    ctx.fillRect(x + 120, y + 30, (barW * statScore(s.percentile)) / 100, 4);
    text(ctx, topShare(s.percentile), x + colW - 12, y + 28, font(600, 14), C.ink, 'right');
  });

  // Combat numbers
  const chips: [string, string][] = [
    ['HP', String(combat.hp)],
    ['ATK', String(combat.atk)],
    ['DEF', String(combat.def)],
    ['SPD', String(combat.spd)],
    ['CRIT', `${combat.crit}%`],
    ['EVA', `${combat.evade}%`],
  ];
  const chipW = (W - 60 - 5 * 10) / 6;
  chips.forEach(([k, v], i) => {
    const x = 30 + i * (chipW + 10);
    cut(ctx, x, 412, chipW, 34, 6);
    ctx.fillStyle = C.void;
    ctx.fill();
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.stroke();
    text(ctx, k, x + 12, 434, font(600, 13), C.muted);
    text(ctx, v, x + chipW - 12, 434, font(700, 16), C.ink, 'right');
  });

  text(ctx, `SYNCED ${p.synced_at.slice(0, 10)}`, W - 34, 176, font(500, 13), C.muted, 'right');
  text(ctx, 'AMONG REGULAR GITHUB PLAYERS', W - 34, 204, font(500, 13), C.muted, 'right');
  return canvas.toBuffer('image/png');
}
