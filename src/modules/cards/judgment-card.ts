import type { AvatarLook } from '../avatar/catalog.js';
import { type Ctx, ensureFont, label, rect, text, wrap } from '../pixel/canvas.js';
import { drawCharacterOnGround } from '../pixel/character.js';
import { lightning, particles, rays, screenFlash, sprite, stormClouds } from '../pixel/fx.js';
import { type Rendered, renderGif } from '../pixel/output.js';
import { PX } from '../pixel/palette.js';

/** The heavenly eye that opens over the clouds. */
const EYE = [
  '....aaaaaaa....',
  '..aabbbbbbbaa..',
  '.abbbcccccbbba.',
  'abbbccdddccbbba',
  'abbbccdedccbbba',
  'abbbccdddccbbba',
  '.abbbcccccbbba.',
  '..aabbbbbbbaa..',
  '....aaaaaaa....',
];

/**
 * /mod thien-dao — the public verdict: the eye of Thiên Đạo opens, lightning
 * falls on the punished disciple, the verdict and its punishments are read out.
 */
export async function renderJudgmentCard(o: {
  name: string;
  look: AvatarLook | null;
  rankName: string;
  verdict: string;
  punishments: string[];
}): Promise<Rendered> {
  await ensureFont(); // wrap() below measures before rendering starts
  const W = 960;
  const lines = wrap(null, o.verdict, 470, 22).slice(0, 5);
  const H = Math.max(440, 250 + lines.length * 26 + o.punishments.length * 30);
  const ground = H - 50;
  const cx = 230;
  return renderGif(
    W,
    H,
    async (ctx: Ctx, t: number) => {
      rect(ctx, 0, 0, W, H, '#1a0d12');
      stormClouds(ctx, W, t, '#3a1420', '#5a2030', 9, 90);
      rays(ctx, cx, 70, '#e8806e', t, { n: 14, length: 260, width: 4, alpha: 0.18, inner: 50 });
      const open = Math.floor(t * 12) % 12 < 9;
      sprite(
        ctx,
        open
          ? EYE
          : EYE.map((r, i) => (i === 4 ? r.replace(/[b-e]/g, 'a') : r.replace(/[b-e]/g, '.'))),
        { a: '#b23a3a', b: '#f0d060', c: '#e8806e', d: '#15131c', e: '#ffffff' },
        6,
        cx - 45,
        40,
      );
      lightning(ctx, cx, 100, ground - 160, t, {
        seed: 17,
        s: 5,
        color: '#e8806e',
        core: '#fff6c8',
      });
      screenFlash(ctx, W, H, t, '#ffd0c0');
      rect(ctx, 0, ground, W, H - ground, '#120a0e');
      rect(ctx, 0, ground - 4, W, 4, '#3a1420');
      await drawCharacterOnGround(ctx, o.look, cx, ground, 4, { alpha: 0.7 });
      particles(ctx, 29, 14, cx - 120, ground - 200, 240, 200, ['#5a2030', '#e8806e'], t);

      label(ctx, 'THIÊN ĐẠO PHÁN QUYẾT', 440, 40, 22, '#e8806e');
      text(ctx, o.name, 440, 66, { size: 40, bold: true, color: PX.inkBright, maxWidth: 500 });
      text(ctx, o.rankName, 440, 112, { size: 22, color: PX.muted });
      let y = 150;
      for (const l of lines) {
        text(ctx, l, 440, y, { size: 22, color: PX.inkSoft });
        y += 26;
      }
      y += 12;
      if (o.punishments.length === 0) {
        text(ctx, 'Cảnh cáo công khai', 440, y, { size: 24, bold: true, color: PX.gold });
      }
      for (const p of o.punishments) {
        rect(ctx, 440, y + 4, 10, 10, '#e8806e');
        text(ctx, p, 460, y - 2, { size: 24, bold: true, color: '#f0b0a0', maxWidth: 470 });
        y += 30;
      }
    },
    'thien-dao',
    { frames: 12, delayMs: 130, stillT: 0.2 },
  );
}
