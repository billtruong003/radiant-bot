import { createCanvas } from 'canvas';
import { type AvatarLook, BACK_NONE, DEFAULT_LOOK } from '../avatar/catalog.js';
import { type Ctx, asset } from './canvas.js';

/**
 * Paper-doll cultivator: layers cut from the sprite sheets in
 * assets/cultivation/sprites. Every tile is 32×48; the feet sit on the
 * bottom row, so a character placed with its bottom on a ground line
 * stands on it.
 */

export const TILE_W = 32;
export const TILE_H = 48;

export interface CharOpts {
  flip?: boolean;
  /** Draw as a flat shape in this colour (the "no avatar yet" silhouette). */
  silhouette?: string;
  alpha?: number;
}

async function layers(look: AvatarLook) {
  const [skin, eyes, hair, robe, shoes, back] = await Promise.all(
    ['skin', 'eyes', 'hair', 'robe', 'shoes', 'back'].map((n) =>
      asset(`cultivation/sprites/${n}.png`),
    ),
  );
  const out: { img: NonNullable<typeof skin>; col: number; row: number }[] = [];
  if (look.back !== BACK_NONE && back) out.push({ img: back, col: look.back, row: 0 });
  if (skin) out.push({ img: skin, col: look.skin, row: 0 });
  if (eyes) out.push({ img: eyes, col: look.eyes, row: 0 });
  if (shoes) out.push({ img: shoes, col: 0, row: 0 });
  if (robe) out.push({ img: robe, col: look.robe_color, row: look.robe_style });
  if (hair) out.push({ img: hair, col: look.hair_style, row: look.hair_color });
  return out;
}

/** Renders one 32×48 tile of the look (cached per look). */
const tiles = new Map<string, ReturnType<typeof createCanvas>>();
async function tile(look: AvatarLook) {
  const key = Object.values(look).join('.');
  const hit = tiles.get(key);
  if (hit) return hit;
  const c = createCanvas(TILE_W, TILE_H);
  const cx = c.getContext('2d');
  cx.imageSmoothingEnabled = false;
  for (const l of await layers(look))
    cx.drawImage(l.img, l.col * TILE_W, l.row * TILE_H, TILE_W, TILE_H, 0, 0, TILE_W, TILE_H);
  tiles.set(key, c);
  return c;
}

/** Draws the character with its top-left at (x, y) at a whole-number scale. */
export async function drawCharacter(
  ctx: Ctx,
  look: AvatarLook | null,
  x: number,
  y: number,
  scale: number,
  o: CharOpts = {},
): Promise<void> {
  const src = await tile(look ?? DEFAULT_LOOK);
  let img = src;
  if (o.silhouette) {
    img = createCanvas(TILE_W, TILE_H);
    const sc = img.getContext('2d');
    sc.drawImage(src, 0, 0);
    sc.globalCompositeOperation = 'source-in';
    sc.fillStyle = o.silhouette;
    sc.fillRect(0, 0, TILE_W, TILE_H);
  }
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
  const w = TILE_W * scale;
  const h = TILE_H * scale;
  if (o.flip) {
    ctx.translate(Math.round(x) + w, Math.round(y));
    ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0, w, h);
  } else ctx.drawImage(img, Math.round(x), Math.round(y), w, h);
  ctx.restore();
}

/** Same, positioned by the feet: (cx, groundY) is the bottom centre. */
export function drawCharacterOnGround(
  ctx: Ctx,
  look: AvatarLook | null,
  cx: number,
  groundY: number,
  scale: number,
  o: CharOpts = {},
): Promise<void> {
  return drawCharacter(ctx, look, cx - (TILE_W * scale) / 2, groundY - TILE_H * scale, scale, o);
}
