import type { AvatarLook } from '../avatar/catalog.js';
import { type Ctx, panel, rect, text } from '../pixel/canvas.js';
import { drawCharacterOnGround } from '../pixel/character.js';
import { particles, rays, sprite, twinkle } from '../pixel/fx.js';
import { type Rendered, renderGif } from '../pixel/output.js';
import { PX } from '../pixel/palette.js';

export interface BoardEntry {
  name: string;
  look: AvatarLook | null;
  rankName: string;
  rankColor: string;
  /** Already formatted, e.g. "48,920 XP" or "+2,140 XP tuần". */
  score: string;
}

const CROWN = ['a.a.a', 'aaaaa', 'abaxa', 'aaaaa'];
const PODIUM: { place: number; x: number; h: number; color: string }[] = [
  { place: 2, x: 250, h: 70, color: '#cfd6e0' },
  { place: 1, x: 480, h: 110, color: PX.goldBright },
  { place: 3, x: 710, h: 46, color: '#d08a4a' },
];

/**
 * /leaderboard and the Sunday post — the top three stand on a podium,
 * places four to ten follow as rows.
 */
export function renderLeaderboardCard(o: {
  title: string;
  subtitle: string;
  entries: BoardEntry[];
}): Promise<Rendered> {
  const W = 960;
  const rest = o.entries.slice(3, 10);
  const top = 530;
  const H = top + Math.max(0, rest.length) * 48 + (rest.length ? 24 : 0);
  return renderGif(
    W,
    H,
    async (ctx: Ctx, t: number) => {
      rect(ctx, 0, 0, W, H, PX.bg);
      rays(ctx, 480, 250, PX.goldBright, t, {
        n: 16,
        length: 260,
        width: 5,
        alpha: 0.16,
        inner: 70,
      });
      particles(ctx, 12, 16, 120, 90, 720, 260, [PX.goldBright, PX.white], t);
      text(ctx, o.title, W / 2, 14, { size: 44, bold: true, color: PX.inkBright, align: 'center' });
      text(ctx, o.subtitle, W / 2, 62, { size: 22, color: PX.muted, align: 'center' });

      const ground = 430;
      for (const p of PODIUM) {
        const e = o.entries[p.place - 1];
        const y = ground - p.h;
        rect(ctx, p.x - 90, y, 180, p.h, PX.panel);
        rect(ctx, p.x - 90, y, 180, 6, p.color);
        text(ctx, String(p.place), p.x, y + 10, {
          size: 40,
          bold: true,
          color: p.color,
          align: 'center',
        });
        if (!e) continue;
        await drawCharacterOnGround(ctx, e.look, p.x, y, 4);
        if (p.place === 1) {
          sprite(ctx, CROWN, { a: PX.goldBright, b: PX.red, x: PX.blue }, 6, p.x - 15, y - 196);
          twinkle(ctx, p.x - 70, y - 160, t, PX.goldBright, 3, 0);
          twinkle(ctx, p.x + 60, y - 120, t, PX.goldBright, 3, 0.5);
        }
        text(ctx, e.name, p.x, ground + 6, {
          size: 24,
          bold: true,
          color: PX.inkBright,
          align: 'center',
          maxWidth: 176,
        });
        text(ctx, e.rankName, p.x, ground + 34, { size: 19, color: e.rankColor, align: 'center' });
        text(ctx, e.score, p.x, ground + 58, {
          size: 21,
          color: PX.gold,
          align: 'center',
          maxWidth: 200,
        });
      }

      for (const [i, e] of rest.entries()) {
        const y = top + i * 48;
        panel(ctx, 40, y, W - 80, 42, { fill: i % 2 ? PX.panelDim : PX.panel });
        text(ctx, `#${i + 4}`, 56, y + 8, { size: 24, bold: true, color: PX.muted });
        text(ctx, e.name, 130, y + 8, { size: 24, bold: true, color: PX.inkBright, maxWidth: 360 });
        text(ctx, e.rankName, 520, y + 10, { size: 21, color: e.rankColor });
        text(ctx, e.score, W - 60, y + 8, { size: 24, color: PX.gold, align: 'right' });
      }
    },
    'bang-xep-hang',
    { frames: 8 },
  );
}
