import { rankIndex } from '../../config/cultivation.js';
import { type Ctx, frame, label, panel, rect, segBar, statBox, text } from '../pixel/canvas.js';
import { drawCharacterOnGround } from '../pixel/character.js';
import { aura, drawEnchanted } from '../pixel/fx.js';
import { money } from '../pixel/icons.js';
import { type Rendered, renderGif } from '../pixel/output.js';
import { PX, REALM_COLOR, enchantColor } from '../pixel/palette.js';
import { auraTier } from './avatar-card.js';
import { type GearView, type ProfileData, fmt } from './profile-data.js';

const LOCK = ['.aaa.', 'a...a', 'a...a', 'aaaaa', 'aaaaa', 'aaaaa'];

/** The cultivator portrait: aura, ground, seal, character standing on the line. */
export async function portrait(
  ctx: Ctx,
  d: Pick<ProfileData, 'look' | 'rank' | 'rankName'>,
  x: number,
  y: number,
  w: number,
  h: number,
  t: number,
  scale = 6,
): Promise<void> {
  const col = REALM_COLOR[d.rank] ?? PX.gold;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  rect(ctx, x, y, w, h, PX.panel);
  const ground = y + h - 52;
  if (d.look) aura(ctx, x + w / 2, ground - 24 * scale, col, auraTier(d.rank), t, 7);
  rect(ctx, x, ground, w, 52, '#2a2536');
  rect(ctx, x, ground - 4, w, 4, PX.line);
  await drawCharacterOnGround(
    ctx,
    d.look,
    x + w / 2,
    ground + 24,
    scale,
    d.look ? {} : { silhouette: '#4a4658' },
  );
  ctx.restore();
  frame(ctx, x, y, w, h, PX.gold, 4);
  frame(ctx, x + 4, y + 4, w - 8, h - 8, PX.bg, 4);
  frame(ctx, x + 8, y + 8, w - 16, h - 16, '#5a4a2a', 2);
  if (scale >= 5) {
    // Realm seal in the top-right corner.
    const sx = x + w - 62;
    const sy = y + 14;
    rect(ctx, sx - 3, sy - 3, 54, 54, PX.bg);
    frame(ctx, sx - 5, sy - 5, 58, 58, PX.crimson, 2);
    rect(ctx, sx, sy, 48, 48, PX.crimson);
    const words = d.rankName.split(' ');
    words.slice(0, 2).forEach((wd, i) => {
      text(ctx, wd, sx + 24, sy + 6 + i * 18, { size: 19, align: 'center', color: PX.inkBright });
    });
  }
}

async function gearSlot(
  ctx: Ctx,
  g: GearView | null,
  lockedAt: string | null,
  x: number,
  y: number,
  w: number,
  t: number,
  seed: number,
): Promise<void> {
  panel(ctx, x, y, w, 100);
  const bx = x + 8;
  const by = y + 8;
  if (lockedAt) {
    rect(ctx, bx, by, 84, 84, PX.bgDeep);
    for (let i = 0; i < 84; i += 8) {
      rect(ctx, bx + i, by, 4, 3, PX.line);
      rect(ctx, bx + i, by + 81, 4, 3, PX.line);
      rect(ctx, bx, by + i, 3, 4, PX.line);
      rect(ctx, bx + 81, by + i, 3, 4, PX.line);
    }
    LOCK.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++)
        if (row[rx] === 'a') rect(ctx, bx + 32 + rx * 4, by + 30 + ry * 4, 4, 4, PX.faint);
    });
    text(ctx, 'Khóa', x + 106, y + 22, { size: 18, color: PX.muted });
    text(ctx, `Mở ở ${lockedAt}`, x + 106, y + 42, {
      size: 24,
      color: PX.faint,
      bold: true,
      maxWidth: w - 116,
    });
    return;
  }
  if (!g) {
    rect(ctx, bx, by, 84, 84, PX.bgDeep);
    frame(ctx, bx, by, 84, 84, PX.line, 3);
    text(ctx, 'Trống', x + 106, y + 36, { size: 22, color: PX.faint });
    return;
  }
  await drawEnchanted(ctx, g.icon, g.level, g.color, bx, by, 84, 64, t, { seed });
  text(ctx, g.slot, x + 106, y + 16, { size: 18, color: PX.muted });
  text(ctx, g.name, x + 106, y + 36, { size: 24, bold: true, maxWidth: w - 116 });
  text(ctx, g.grade, x + 106, y + 62, { size: 18, color: g.color });
}

export function renderProfileCard(d: ProfileData): Promise<Rendered> {
  const W = 960;
  const H = 600;
  const col = REALM_COLOR[d.rank] ?? PX.gold;
  return renderGif(
    W,
    H,
    async (ctx, t) => {
      await portrait(ctx, d, 20, 20, 300, 340, t);
      text(ctx, d.name, 20, 372, { size: 34, bold: true, color: PX.inkBright, maxWidth: 300 });
      const sub = [d.subTitle, d.title].filter(Boolean).join(' · ');
      if (sub) text(ctx, sub, 20, 408, { size: 22, color: PX.gold, maxWidth: 300 });
      const mw = await money(ctx, 20, 438, fmt(d.pills), fmt(d.coins));
      if (d.streak > 0)
        text(ctx, `streak ${d.streak} ngày`, 20 + mw + 16, 442, {
          size: 24,
          color: PX.red,
          bold: true,
        });

      const X = 340;
      const RW = 600;
      label(ctx, 'CẢNH GIỚI', X, 26);
      text(ctx, `${d.rankName} · Lv ${d.level}`, X, 46, { size: 48, color: col, bold: true });
      text(ctx, 'LỰC CHIẾN', X + RW, 26, { size: 20, color: PX.muted, align: 'right' });
      text(ctx, fmt(d.power.total), X + RW, 42, {
        size: 60,
        color: PX.inkBright,
        bold: true,
        align: 'right',
      });
      rect(ctx, X, 104, RW, 4, PX.lineDim);
      text(ctx, 'Tu vi', X, 116, { size: 22 });
      const nextLine =
        d.nextRealm && rankIndex(d.rank) < 10
          ? ` · ${d.nextRealm.name} ở Lv ${d.nextRealm.level}`
          : '';
      text(
        ctx,
        `${fmt(d.xpInLevel)} / ${fmt(d.xpNeeded)} XP tới Lv ${d.level + 1}${nextLine}`,
        X + RW,
        116,
        {
          size: 22,
          color: PX.muted,
          align: 'right',
        },
      );
      segBar(ctx, X, 142, RW, d.xpNeeded > 0 ? d.xpInLevel / d.xpNeeded : 1);
      const bw = (RW - 30) / 4;
      const stats: [string, number, string, number][] = [
        ['SÁT THƯƠNG', d.alloc.dmg, PX.red, 8],
        ['SINH LỰC', d.alloc.hp, '#e06070', 5],
        ['PHÒNG NGỰ', d.alloc.def, '#7fb2e8', 3],
        ['TỐC ĐỘ', d.alloc.spd, PX.greenSoft, 4],
      ];
      stats.forEach(([n, v, c, m], i) =>
        statBox(ctx, X + i * (bw + 10), 182, bw, n, String(v), c, `+${v * m} LC`),
      );
      const gw = (RW - 10) / 2;
      await gearSlot(ctx, d.weapon, null, X, 274, gw, t, 4);
      await gearSlot(
        ctx,
        d.phapKhi,
        !d.phapKhi && rankIndex(d.rank) < rankIndex('kim_dan') ? 'Kim Đan' : null,
        X + gw + 10,
        274,
        gw,
        t,
        5,
      );
      await gearSlot(ctx, d.rings[0] ?? null, d.ringLocked[0] ?? null, X, 384, gw, t, 6);
      await gearSlot(ctx, d.rings[1] ?? null, d.ringLocked[1] ?? null, X + gw + 10, 384, gw, t, 7);
      text(ctx, `CÔNG PHÁP ${d.congPhap.length}/5`, X, 524, { size: 20, color: PX.muted });
      for (let i = 0; i < 5; i++) {
        const cx = X + 116 + i * 74;
        const c = d.congPhap[i];
        if (c) {
          await drawEnchanted(ctx, c.icon, c.level, c.color, cx, 500, 56, 32, t, {
            badge: false,
            seed: 11 + i,
          });
          if (c.level > 0)
            text(ctx, `+${c.level}`, cx + 28, 562, {
              size: 18,
              align: 'center',
              color: enchantColor(c.level) ?? PX.muted,
              bold: true,
            });
        } else {
          for (let k = 0; k < 56; k += 8) {
            rect(ctx, cx + k, 500, 4, 3, PX.line);
            rect(ctx, cx + k, 553, 4, 3, PX.line);
            rect(ctx, cx, 500 + k, 3, 4, PX.line);
            rect(ctx, cx + 53, 500 + k, 3, 4, PX.line);
          }
          text(ctx, 'trống', cx + 28, 562, { size: 18, align: 'center', color: PX.faint });
        }
      }
    },
    'tu-si',
    { frames: 8 },
  );
}
