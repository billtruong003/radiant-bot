import { rankById } from '../../config/cultivation.js';
import { type Ctx, label, panel, rect, text } from '../pixel/canvas.js';
import { STRIPS, drawGridMonster, drawStrip } from '../pixel/monsters.js';
import { type Rendered, renderPng } from '../pixel/output.js';
import { PX } from '../pixel/palette.js';
import { lootFor, monsterPower } from '../raid/engine.js';
import { FLOORS, MONSTERS, ZONES } from '../raid/zones.js';
import { fmt } from './profile-data.js';

/** Strip monsters shrink so a 64 px bat or a 128 px knight still fits its slot. */
function stripScale(key: string, scale: number): number {
  const fw = STRIPS[key]?.fw ?? 64;
  return Math.max(1, Math.min(scale - 1, Math.floor(140 / fw)));
}

/** /bi-canh luc — Yêu thú lục: every hunting ground, its monsters and what they pay. */
export function renderBestiaryCard(openZoneIds: string[]): Promise<Rendered> {
  const W = 960;
  const ROW = 116;
  const H = 86 + ZONES.length * ROW;
  return renderPng(
    W,
    H,
    async (ctx: Ctx) => {
      rect(ctx, 0, 0, W, H, PX.bg);
      text(ctx, 'Yêu thú lục', 20, 14, { size: 44, bold: true, color: PX.inkBright });
      text(ctx, 'Lực chiến quái ở tầng 1 → tầng 10, thưởng mỗi con ở tầng 1', W - 20, 30, {
        size: 20,
        color: PX.muted,
        align: 'right',
      });
      for (const [i, z] of ZONES.entries()) {
        const y = 76 + i * ROW;
        const open = openZoneIds.includes(z.id);
        ctx.save();
        if (!open) ctx.globalAlpha = 0.5;
        panel(ctx, 20, y, W - 40, ROW - 10, { fill: z.sky, border: open ? PX.line : '#2a2536' });
        rect(ctx, 24, y + ROW - 34, 330, 20, z.ground);
        let mx = 70;
        for (const id of z.monsters.slice(0, 3)) {
          const m = MONSTERS[id];
          if (!m) continue;
          if (m.art.kind === 'grid')
            drawGridMonster(ctx, m.art.key, mx, y + ROW - 22, Math.max(2, m.scale - 2), {
              flip: true,
            });
          else
            await drawStrip(ctx, m.art.idle, 0, mx, y + ROW - 22, stripScale(m.art.idle, m.scale), {
              flip: true,
            });
          mx += 105;
        }
        text(ctx, z.name, 380, y + 8, { size: 30, bold: true, color: PX.inkBright });
        label(
          ctx,
          open ? `Mở từ ${rankById(z.minRank).name}` : `Khóa · cần ${rankById(z.minRank).name}`,
          380,
          y + 44,
          19,
          open ? PX.green : PX.red,
        );
        text(ctx, z.monsters.map((m) => MONSTERS[m]?.name ?? m).join(', '), 380, y + 66, {
          size: 20,
          color: PX.muted,
          maxWidth: 220,
        });
        text(ctx, `${fmt(monsterPower(z, 1))} → ${fmt(monsterPower(z, FLOORS))}`, W - 40, y + 12, {
          size: 26,
          bold: true,
          color: PX.gold,
          align: 'right',
        });
        const l = lootFor(i, 1, 40);
        text(ctx, `40 con: +${l.xp} XP, +${l.pills} đan, +${l.coins} cống hiến`, W - 40, y + 46, {
          size: 19,
          color: PX.inkSoft,
          align: 'right',
        });
        text(ctx, z.lore, W - 40, y + 72, {
          size: 18,
          color: PX.faint,
          align: 'right',
          maxWidth: 300,
        });
        ctx.restore();
      }
    },
    'yeu-thu-luc',
  );
}
