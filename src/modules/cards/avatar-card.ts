import { rankById, rankIndex } from '../../config/cultivation.js';
import type { CultivationRankId } from '../../db/types.js';
import type { AvatarLook } from '../avatar/catalog.js';
import { frame, rect, text } from '../pixel/canvas.js';
import { drawCharacterOnGround } from '../pixel/character.js';
import { aura } from '../pixel/fx.js';
import { type Rendered, renderPng } from '../pixel/output.js';
import { PX, REALM_COLOR } from '../pixel/palette.js';

export interface AvatarCardData {
  look: AvatarLook | null;
  name: string;
  rank: CultivationRankId;
}

/** Realm tier → how loud the aura is (matches the profile portrait). */
export function auraTier(rank: CultivationRankId): number {
  const i = rankIndex(rank);
  return i >= 6 ? 3 : i >= 3 ? 2 : i >= 1 ? 1 : 0;
}

/** Portrait used in the /profile avatar reply: the character, or a grey silhouette. */
export function renderAvatarCard(d: AvatarCardData): Promise<Rendered> {
  const W = 300;
  const H = 360;
  const col = REALM_COLOR[d.rank] ?? PX.gold;
  return renderPng(
    W,
    H,
    async (ctx, t) => {
      rect(ctx, 0, 0, W, H, PX.panel);
      if (d.look) aura(ctx, W / 2, 210, col, auraTier(d.rank), t, 3);
      rect(ctx, 0, 286, W, H - 286, '#2a2536');
      rect(ctx, 0, 282, W, 4, PX.line);
      await drawCharacterOnGround(
        ctx,
        d.look,
        W / 2,
        290,
        5,
        d.look ? {} : { silhouette: '#4a4658' },
      );
      frame(ctx, 0, 0, W, H, d.look ? col : PX.line, 4);
      text(ctx, d.name, W / 2, 300, {
        size: 28,
        bold: true,
        align: 'center',
        color: PX.inkBright,
        maxWidth: W - 24,
      });
      text(ctx, d.look ? rankById(d.rank).name : 'Chưa tạo hình', W / 2, 330, {
        size: 21,
        align: 'center',
        color: d.look ? col : PX.muted,
      });
    },
    'avatar',
  );
}
