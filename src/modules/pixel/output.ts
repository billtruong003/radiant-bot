import * as gifencNs from 'gifenc';
import { type Ctx, ensureFont, newCanvas } from './canvas.js';
import { PX } from './palette.js';

// gifenc's ESM build has named exports; its CommonJS build (what tsx and
// Node pick) only has a default object. Take whichever has the functions.
type GifLib = typeof gifencNs.default;
const lib: GifLib =
  typeof (gifencNs as unknown as GifLib).GIFEncoder === 'function'
    ? (gifencNs as unknown as GifLib)
    : gifencNs.default;
const { GIFEncoder, applyPalette, quantize } = lib;

/**
 * Turns a drawing function into what Discord shows: a PNG for still cards,
 * a looping GIF for animated ones. Discord does not play SVG or CSS.
 */

export interface Rendered {
  buffer: Buffer;
  name: string;
  animated: boolean;
}

export type Draw = (ctx: Ctx, t: number) => Promise<void> | void;

/** Still card: one frame at a fixed loop position. */
export async function renderPng(
  w: number,
  h: number,
  draw: Draw,
  name: string,
  t = 0.3,
): Promise<Rendered> {
  await ensureFont();
  const { canvas, ctx } = newCanvas(w, h, PX.bg);
  await draw(ctx, t);
  return { buffer: canvas.toBuffer('image/png'), name: `${name}.png`, animated: false };
}

export const GIF_MAX_BYTES = 3 * 1024 * 1024;

/**
 * Animated card: `frames` evenly spaced loop positions, `delayMs` each.
 * Falls back to a PNG when the GIF would be too big for a quick upload.
 */
export function renderGif(
  w: number,
  h: number,
  draw: Draw,
  name: string,
  o: { frames?: number; delayMs?: number; stillT?: number } = {},
): Promise<Rendered> {
  return inRenderQueue(() => encodeGif(w, h, draw, name, o));
}

/**
 * GIF encoding is CPU work on the bot's only thread. One GIF at a time, in
 * arrival order, and a yield between frames, so Discord heartbeats and
 * button clicks are still answered while a card is being drawn.
 */
let queue: Promise<unknown> = Promise.resolve();
let waiting = 0;
export const renderQueueDepth = (): number => waiting;

function inRenderQueue<T>(job: () => Promise<T>): Promise<T> {
  waiting += 1;
  const run = queue.then(job, job);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run.finally(() => {
    waiting -= 1;
  });
}

const yieldToLoop = (): Promise<void> => new Promise((r) => setImmediate(r));

async function encodeGif(
  w: number,
  h: number,
  draw: Draw,
  name: string,
  o: { frames?: number; delayMs?: number; stillT?: number },
): Promise<Rendered> {
  await ensureFont();
  const frames = o.frames ?? 12;
  const gif = GIFEncoder();
  for (let i = 0; i < frames; i++) {
    const { ctx } = newCanvas(w, h, PX.bg);
    await draw(ctx, i / frames);
    const { data } = ctx.getImageData(0, 0, w, h);
    const palette = quantize(data, 256, { format: 'rgb565' });
    const index = applyPalette(data, palette, 'rgb565');
    gif.writeFrame(index, w, h, { palette, delay: o.delayMs ?? 110, repeat: 0 });
    await yieldToLoop();
  }
  gif.finish();
  const bytes = gif.bytes();
  if (bytes.byteLength > GIF_MAX_BYTES) return renderPng(w, h, draw, name, o.stillT ?? 0.3);
  return { buffer: Buffer.from(bytes), name: `${name}.gif`, animated: true };
}
