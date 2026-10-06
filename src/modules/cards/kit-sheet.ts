import { DEFAULT_LOOK } from '../avatar/catalog.js';
import { rect, text } from '../pixel/canvas.js';
import { drawCharacterOnGround } from '../pixel/character.js';
import { drawEnchanted, lightning, realmScene, stormClouds } from '../pixel/fx.js';
import { drawGridMonster, drawStrip } from '../pixel/monsters.js';
import { type Rendered, renderGif } from '../pixel/output.js';
import { PX } from '../pixel/palette.js';

/** Contact sheet of the pixel kit, used to check the art after changes. */
export function renderKitSheet(): Promise<Rendered> {
  return renderGif(
    1200,
    760,
    async (ctx, t) => {
      text(ctx, 'Pixel kit', 20, 12, { size: 40, bold: true, color: PX.inkBright });
      const ground = 240;
      rect(ctx, 0, ground, 1200, 4, PX.lineDim);
      await drawCharacterOnGround(ctx, DEFAULT_LOOK, 80, ground, 4);
      await drawCharacterOnGround(ctx, null, 200, ground, 4, { silhouette: '#4a4658' });
      await drawStrip(ctx, 'wolf_gray_idle', Math.floor(t * 4), 340, ground, 3);
      await drawStrip(ctx, 'bat_idle', Math.floor(t * 9), 500, ground - 40, 2);
      await drawStrip(ctx, 'knight_idle', Math.floor(t * 15), 640, ground, 3);
      await drawStrip(ctx, 'paladin_idle', Math.floor(t * 27), 820, ground, 2);
      drawGridMonster(ctx, 'ho_yeu', 980, ground, 5);
      drawGridMonster(ctx, 'nguu_ma', 1110, ground, 4);
      for (const [i, lv] of [0, 3, 5, 8, 10].entries())
        await drawEnchanted(
          ctx,
          'jian_sword__icy_frost_steel',
          lv,
          '#5fa8e8',
          40 + i * 150,
          290,
          100,
          64,
          t,
          { seed: i },
        );
      for (let i = 0; i < 4; i++) {
        ctx.save();
        ctx.translate(780 + (i % 2) * 210, 280 + Math.floor(i / 2) * 230);
        ctx.beginPath();
        ctx.rect(0, 0, 200, 220);
        ctx.clip();
        realmScene(ctx, [3, 6, 9, 10][i] ?? 3, 200, 220, 100, 140, t, 0.4, i);
        ctx.restore();
      }
      ctx.save();
      ctx.translate(40, 430);
      ctx.beginPath();
      ctx.rect(0, 0, 700, 300);
      ctx.clip();
      rect(ctx, 0, 0, 700, 300, '#191a2e');
      stormClouds(ctx, 700, t);
      lightning(ctx, 200, 20, 260, t, { seed: 4, always: true });
      lightning(ctx, 480, 20, 220, t, { seed: 9, forks: 2, always: true });
      ctx.restore();
    },
    'kit-sheet',
    { frames: 8 },
  );
}
