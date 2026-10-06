import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  type Canvas,
  type CanvasRenderingContext2D,
  type Image,
  createCanvas,
  loadImage,
} from 'canvas';
import { PX } from './palette.js';

/**
 * Drawing primitives shared by every cultivation card: one pixel font (VT323),
 * hard-edged panels and bars, and images drawn without smoothing so pixel art
 * stays sharp.
 *
 * Text is drawn from bitmap atlases (scripts/build-font-atlas.py) rather than
 * through node-canvas fonts: those fail to load on Windows, and pixel text
 * must never be smoothed. Call `ensureFont()` once before drawing.
 */

export const ASSET_DIR = path.join(process.cwd(), 'assets');
export const CULT_DIR = path.join(ASSET_DIR, 'cultivation');

export type Ctx = CanvasRenderingContext2D;

interface AtlasMeta {
  size: number;
  line: number;
  ascent: number;
  /** char → [x, width, advance, left offset] */
  glyphs: Record<string, [number, number, number, number]>;
}
const ATLAS_DIR = path.join(ASSET_DIR, 'fonts', 'atlas');
let meta: Record<string, AtlasMeta> | null = null;
let sizes: number[] = [];
const atlases = new Map<number, Image>();
const tinted = new Map<string, Canvas>();

/** Loads the font atlases once. */
export async function ensureFont(): Promise<void> {
  if (meta) return;
  const m = JSON.parse(readFileSync(path.join(ATLAS_DIR, 'vt.json'), 'utf8')) as Record<
    string,
    AtlasMeta
  >;
  sizes = Object.keys(m)
    .map(Number)
    .sort((a, b) => a - b);
  await Promise.all(
    sizes.map(async (s) => atlases.set(s, await loadImage(path.join(ATLAS_DIR, `vt${s}.png`)))),
  );
  meta = m;
}

function atlasFor(size: number): AtlasMeta {
  if (!meta) throw new Error('call ensureFont() before drawing text');
  const pick = [...sizes].reverse().find((s) => s <= size) ?? sizes[0] ?? 22;
  return meta[String(pick)] as AtlasMeta;
}

function tint(size: number, color: string): Canvas {
  const key = `${size}|${color}`;
  let c = tinted.get(key);
  if (!c) {
    const img = atlases.get(size);
    if (!img) throw new Error(`no font atlas for ${size}px`);
    c = createCanvas(img.width, img.height);
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color;
    x.fillRect(0, 0, img.width, img.height);
    tinted.set(key, c);
  }
  return c;
}

export function newCanvas(
  w: number,
  h: number,
  bg: string | null = PX.bg,
): { canvas: Canvas; ctx: Ctx } {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
  }
  return { canvas, ctx };
}

const images = new Map<string, Promise<Image>>();
/** Loads an image under assets/ once and keeps it. */
export function asset(rel: string): Promise<Image> {
  let p = images.get(rel);
  if (!p) {
    p = loadImage(path.join(ASSET_DIR, rel));
    images.set(rel, p);
  }
  return p;
}

export interface TextOpts {
  size?: number;
  color?: string;
  /** Pixel-bold: the glyphs are drawn again one or two pixels to the right. */
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  baseline?: 'top' | 'alphabetic' | 'middle' | 'bottom';
  maxWidth?: number;
  alpha?: number;
}

function glyph(a: AtlasMeta, ch: string): [number, number, number, number] {
  return a.glyphs[ch] ?? a.glyphs['?'] ?? [0, 0, 0, 0];
}

export function measure(_ctx: Ctx | null, value: string, size = 22): number {
  const a = atlasFor(size);
  let w = 0;
  for (const ch of value) w += glyph(a, ch)[2];
  return w;
}

/** Cuts text with an ellipsis to fit a width. */
function fit(value: string, maxWidth: number, size: number): string {
  if (measure(null, value, size) <= maxWidth) return value;
  let s = value;
  while (s.length > 1 && measure(null, `${s}…`, size) > maxWidth) s = s.slice(0, -1);
  return `${s}…`;
}

/** Draws text in the pixel font; returns its width. */
export function text(ctx: Ctx, value: string, x: number, y: number, o: TextOpts = {}): number {
  const a = atlasFor(o.size ?? 22);
  const s = o.maxWidth !== undefined ? fit(value, o.maxWidth, a.size) : value;
  const w = measure(null, s, a.size);
  let cx = Math.round(o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x);
  const base = o.baseline ?? 'top';
  const top = Math.round(
    base === 'top'
      ? y
      : base === 'middle'
        ? y - a.line / 2
        : base === 'bottom'
          ? y - a.line
          : y - a.ascent,
  );
  const src = tint(a.size, o.color ?? PX.ink);
  const passes = o.bold ? 1 + Math.max(1, Math.floor(a.size / 32)) : 1;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
  for (const ch of s) {
    const [gx, gw, adv, left] = glyph(a, ch);
    if (gw > 0)
      for (let p = 0; p < passes; p++)
        ctx.drawImage(src, gx, 0, gw, a.line, cx + left + p, top, gw, a.line);
    cx += adv;
  }
  ctx.restore();
  return w;
}

/** Wraps text into lines that fit a width. */
export function wrap(_ctx: Ctx | null, value: string, maxWidth: number, size = 22): string[] {
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (measure(null, next, size) > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export function rect(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  alpha = 1,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = fill;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  ctx.restore();
}

/** A hard border drawn inside the box. */
export function frame(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  t = 2,
  alpha = 1,
): void {
  rect(ctx, x, y, w, t, color, alpha);
  rect(ctx, x, y + h - t, w, t, color, alpha);
  rect(ctx, x, y, t, h, color, alpha);
  rect(ctx, x + w - t, y, t, h, color, alpha);
}

export function panel(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  o: { fill?: string; border?: string; t?: number } = {},
): void {
  rect(ctx, x, y, w, h, o.fill ?? PX.panel);
  frame(ctx, x, y, w, h, o.border ?? PX.line, o.t ?? 2);
}

/** Small uppercase-style label in the muted colour. */
export function label(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  size = 20,
  color: string = PX.muted,
): number {
  return text(ctx, value, x, y, { size, color });
}

/** Coloured tag; returns its width. */
export function chip(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  bg: string,
  fg: string = PX.bg,
  size = 21,
): number {
  const w = Math.ceil(measure(ctx, value, size)) + 20;
  const h = size + 5;
  rect(ctx, x, y, w, h, bg);
  text(ctx, value, x + 10, y + 2, { size, color: fg });
  return w;
}

/** Segmented progress bar (the tu vi bar of the mockup). */
export function segBar(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  frac: number,
  o: { n?: number; h?: number; on?: string; off?: string; gap?: number } = {},
): void {
  const n = o.n ?? 20;
  const h = o.h ?? 14;
  const gap = o.gap ?? 3;
  rect(ctx, x, y, w, h + 12, PX.bgDeep);
  frame(ctx, x, y, w, h + 12, PX.line, 2);
  const inner = w - 12;
  const sw = (inner - gap * (n - 1)) / n;
  const k = Math.round(Math.max(0, Math.min(1, frac)) * n);
  for (let i = 0; i < n; i++)
    rect(
      ctx,
      x + 6 + i * (sw + gap),
      y + 6,
      sw,
      h,
      i < k ? (o.on ?? PX.gold) : (o.off ?? '#2a2536'),
    );
}

/** Plain HP-style bar. */
export function fillBar(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  frac: number,
  color: string,
): void {
  rect(ctx, x, y, w, h, PX.bgDeep);
  frame(ctx, x, y, w, h, PX.line, 2);
  const f = Math.max(0, Math.min(1, frac));
  if (f > 0) rect(ctx, x + 2, y + 2, (w - 4) * f, h - 4, color);
}

/** Labelled number box. */
export function statBox(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  name: string,
  value: string,
  color: string,
  sub?: string,
): number {
  const h = sub ? 78 : 62;
  panel(ctx, x, y, w, h);
  text(ctx, name, x + 12, y + 6, { size: 19, color: PX.muted });
  text(ctx, value, x + 12, y + 24, { size: 36, color, bold: true });
  if (sub) text(ctx, sub, x + 12, y + 56, { size: 17, color: '#8a8298' });
  return h;
}
