import type { CultivationRankId } from '../../db/types.js';
import type { AvatarLook } from '../avatar/catalog.js';
import { type Ctx, label, rect, text } from '../pixel/canvas.js';
import { drawCharacterOnGround } from '../pixel/character.js';
import { REALM_ORDER, realmScene } from '../pixel/fx.js';
import { type Rendered, renderGif } from '../pixel/output.js';
import { PX, REALM_COLOR } from '../pixel/palette.js';

/**
 * The public "đột phá cảnh giới" post. Each realm has its own scene
 * (realmScene): the higher the realm, the louder the breakthrough.
 */
export function renderRealmUpCard(o: {
  name: string;
  look: AvatarLook | null;
  level: number;
  oldRankName: string;
  newRank: CultivationRankId;
  newRankName: string;
}): Promise<Rendered> {
  const W = 960;
  const H = 440;
  const i = Math.max(0, REALM_ORDER.indexOf(o.newRank));
  const col = REALM_COLOR[o.newRank] ?? PX.gold;
  const cx = 250;
  const ground = 400;
  return renderGif(
    W,
    H,
    async (ctx: Ctx, t: number) => {
      realmScene(ctx, i, W, H, cx, ground - 130, t, 0.85, 40 + i);
      rect(ctx, 0, ground, W, H - ground, '#0e0c13', 0.85);
      await drawCharacterOnGround(ctx, o.look, cx, ground, 5);
      // Right side text sits on a dark band so every realm's scene stays readable.
      rect(ctx, 470, 70, 470, 280, PX.bgDeep, 0.72);
      label(ctx, 'ĐỘT PHÁ CẢNH GIỚI', 494, 88, 22, PX.muted);
      text(ctx, o.newRankName, 494, 114, { size: 64, bold: true, color: col, maxWidth: 430 });
      text(ctx, o.name, 494, 192, { size: 32, bold: true, color: PX.inkBright, maxWidth: 430 });
      text(ctx, `${o.oldRankName} → ${o.newRankName} · Level ${o.level}`, 494, 238, {
        size: 24,
        color: PX.inkSoft,
        maxWidth: 430,
      });
      text(ctx, `Cảnh giới thứ ${i + 1} trên 11`, 494, 290, { size: 22, color: PX.muted });
    },
    'dot-pha',
    { frames: 12, delayMs: 120, stillT: 0.3 },
  );
}
