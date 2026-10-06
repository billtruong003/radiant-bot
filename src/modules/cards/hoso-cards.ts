import { CULTIVATION_RANKS, TIEN_NHAN, rankIndex } from '../../config/cultivation.js';
import {
  type Ctx,
  frame,
  label,
  measure,
  panel,
  rect,
  segBar,
  statBox,
  text,
  wrap,
} from '../pixel/canvas.js';
import { dmgNumber, drawEnchanted, particles, spark, twinkle } from '../pixel/fx.js';
import { type Rendered, renderGif, renderPng } from '../pixel/output.js';
import { PX, REALM_COLOR, enchantColor } from '../pixel/palette.js';
import { portrait } from './profile-card.js';
import { type ProfileData, fmt } from './profile-data.js';

const LOCK = ['.aaa.', 'a...a', 'a...a', 'aaaaa', 'aaaaa', 'aaaaa'];
function lockIcon(ctx: Ctx, x: number, y: number, color: string, s = 3): void {
  LOCK.forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++)
      if (row[rx] === 'a') rect(ctx, x + rx * s, y + ry * s, s, s, color);
  });
}

/** /profile rank — level progress and the eleven-step realm ladder. */
export function renderRankCard(d: ProfileData): Promise<Rendered> {
  const W = 960;
  const H = 600;
  const col = REALM_COLOR[d.rank] ?? PX.gold;
  const realms = [...CULTIVATION_RANKS, TIEN_NHAN];
  const cur = rankIndex(d.rank);
  return renderGif(
    W,
    H,
    async (ctx, t) => {
      await portrait(ctx, d, 20, 20, 150, 170, t, 3);
      label(ctx, 'CẢNH GIỚI HIỆN TẠI', 190, 32);
      text(ctx, `${d.rankName} · Level ${d.level}`, 190, 52, { size: 52, color: col, bold: true });
      text(ctx, `Tiến độ đến Level ${d.level + 1}`, 190, 124, { size: 22 });
      const pct = d.xpNeeded > 0 ? d.xpInLevel / d.xpNeeded : 1;
      text(
        ctx,
        `${fmt(d.xpInLevel)} / ${fmt(d.xpNeeded)} XP · ${Math.round(pct * 100)}%`,
        940,
        124,
        {
          size: 22,
          color: PX.muted,
          align: 'right',
        },
      );
      segBar(ctx, 190, 150, 750, pct, { n: 16, on: col });
      const bw = (920 - 30) / 4;
      statBox(ctx, 20, 206, bw, 'TỔNG XP', fmt(d.totalXp), PX.inkBright);
      statBox(ctx, 20 + (bw + 10), 206, bw, 'ĐAN DƯỢC', fmt(d.pills), '#e06070');
      statBox(ctx, 20 + 2 * (bw + 10), 206, bw, 'CỐNG HIẾN', fmt(d.coins), PX.gold);
      statBox(ctx, 20 + 3 * (bw + 10), 206, bw, 'LỰC CHIẾN', fmt(d.power.total), PX.inkBright);
      const left = d.nextRealm ? Math.max(0, d.nextRealm.level - d.level) : 0;
      label(
        ctx,
        d.nextRealm
          ? `CON ĐƯỜNG TU TIÊN · còn ${left} level tới ${d.nextRealm.name}`
          : 'CON ĐƯỜNG TU TIÊN',
        20,
        290,
      );
      const cw = (920 - 10 * 6) / 11;
      realms.forEach((r, i) => {
        const x = 20 + i * (cw + 6);
        const h = 44 + i * 12;
        const y = 540 - h;
        const c = REALM_COLOR[r.id] ?? PX.muted;
        const done = i < cur;
        const now = i === cur;
        rect(ctx, x, y, cw, h, done || now ? c : PX.panel);
        frame(ctx, x, y, cw, h, now ? c : PX.line, 2);
        if (now) {
          frame(ctx, x - 5, y - 5, cw + 10, h + 10, c, 3);
          spark(ctx, x - 6, y - 22, t, c);
          particles(ctx, 9, 6, x, y - 40, cw, 30, [c, '#ffffff'], t);
        }
        text(ctx, r.name, x + cw / 2, 548, {
          size: 18,
          align: 'center',
          color: done || now ? c : PX.faint,
          maxWidth: cw + 4,
        });
        text(ctx, i < 10 ? `Lv ${r.minLevel}` : 'sau Độ Kiếp', x + cw / 2, 570, {
          size: 16,
          align: 'center',
          color: PX.faint,
        });
      });
    },
    'canh-gioi',
    { frames: 6 },
  );
}

/** /profile stat — where lực chiến comes from, and the equipped công pháp. */
export async function renderStatCard(
  d: ProfileData,
  nextUnlock: string | null,
  nextUpgrade: string | null,
): Promise<Rendered> {
  const W = 960;
  const H = 460;
  const p = d.power;
  const parts: [string, number, string][] = [
    ['Nền', p.base, '#6e6780'],
    ['Cấp độ', p.levelBonus, '#9aa3ad'],
    ['Cảnh giới', p.rankBonus, PX.gold],
    ['Phong hiệu', p.subTitleBonus, PX.greenSoft],
    ['Chỉ số phân', p.statBonus, PX.red],
    ['Công pháp', p.congPhapBonus, PX.purple],
    ['Pháp khí', p.phapKhiBonus, PX.cyan],
    ['Nhẫn', p.nhanBonus, PX.pink],
    ['Vũ khí', p.weaponBonus, PX.blue],
  ];
  const total = Math.max(
    1,
    parts.reduce((s, [, v]) => s + v, 0),
  );
  return renderPng(
    W,
    H,
    async (ctx, t) => {
      label(ctx, `HỒ SƠ CHIẾN ĐẤU · ${d.name}`, 20, 18);
      text(ctx, `Lực chiến ${fmt(p.total)}`, 20, 38, { size: 52, bold: true, color: PX.inkBright });
      text(ctx, `${d.rankName} · Lv ${d.level}`, 940, 42, {
        size: 22,
        color: PX.muted,
        align: 'right',
      });
      if (d.title)
        text(ctx, `Danh hiệu: ${d.title}`, 940, 66, { size: 22, color: PX.muted, align: 'right' });
      rect(ctx, 20, 98, 920, 4, PX.lineDim);
      let x = 20;
      rect(ctx, 20, 112, 920, 28, PX.bgDeep);
      for (const [, v, c] of parts) {
        const w = (v / total) * 916;
        if (w >= 1) {
          rect(ctx, x + 2, 114, w - 2, 24, c);
          x += w;
        }
      }
      frame(ctx, 20, 112, 920, 28, PX.line, 2);
      label(ctx, 'NGUỒN LỰC CHIẾN', 20, 156);
      parts.forEach(([n, v, c], i) => {
        const y = 182 + i * 26;
        rect(ctx, 20, y + 5, 14, 14, c);
        text(ctx, n, 44, y, { size: 21, color: PX.inkSoft });
        text(ctx, fmt(v), 320, y, { size: 22, align: 'right', bold: true });
      });
      label(ctx, `CÔNG PHÁP ĐANG TRANG BỊ · ${d.congPhap.length}/5`, 344, 156);
      for (let i = 0; i < d.congPhap.length; i++) {
        const c = d.congPhap[i];
        if (!c) continue;
        const cx = 344 + (i % 2) * 300;
        const cy = 182 + Math.floor(i / 2) * 66;
        await drawEnchanted(ctx, c.icon, c.level, c.color, cx, cy, 56, 32, t, {
          badge: false,
          seed: 20 + i,
        });
        text(ctx, c.name, cx + 68, cy + 6, { size: 22, bold: true, maxWidth: 190 });
        if (c.level > 0)
          text(ctx, `+${c.level}`, cx + 68 + Math.min(190, measure(null, c.name, 22)) + 6, cy + 6, {
            size: 22,
            bold: true,
            color: enchantColor(c.level) ?? PX.muted,
          });
        text(ctx, `${c.slot} · ${c.grade}`, cx + 68, cy + 30, { size: 18, color: c.color });
      }
      if (nextUnlock || nextUpgrade) {
        panel(ctx, 344, 376, 596, 66);
        if (nextUnlock) {
          const w = text(ctx, 'Mở khóa kế: ', 356, 384, { size: 21, color: PX.greenSoft });
          text(ctx, nextUnlock, 356 + w, 384, { size: 21, maxWidth: 570 - w });
        }
        if (nextUpgrade) {
          const w = text(ctx, 'Cường hóa kế: ', 356, 410, { size: 21, color: PX.gold });
          text(ctx, nextUpgrade, 356 + w, 410, { size: 21, maxWidth: 570 - w });
        }
      }
    },
    'chien-luc',
  );
}

export type AllocKey = 'dmg' | 'hp' | 'def' | 'spd';

/** /profile alloc — four stat bars; the one just raised lights up. */
export function renderAllocCard(
  d: Pick<ProfileData, 'name' | 'alloc' | 'unspent'>,
  fresh: AllocKey | null,
): Promise<Rendered> {
  const W = 960;
  const H = 440;
  const rows: [AllocKey, string, number, string][] = [
    ['dmg', 'SÁT THƯƠNG', 8, PX.red],
    ['hp', 'SINH LỰC', 5, '#e06070'],
    ['def', 'PHÒNG NGỰ', 3, '#7fb2e8'],
    ['spd', 'TỐC ĐỘ · CHÍ MẠNG', 4, PX.greenSoft],
  ];
  const spent = d.alloc.dmg + d.alloc.hp + d.alloc.def + d.alloc.spd;
  const lc = d.alloc.dmg * 8 + d.alloc.hp * 5 + d.alloc.def * 3 + d.alloc.spd * 4;
  const draw = (ctx: Ctx, t: number) => {
    label(ctx, `PHÂN BỐ CHỈ SỐ · ${d.name}`, 20, 18);
    text(ctx, d.unspent > 0 ? `Còn ${d.unspent} điểm chưa phân` : 'Đã phân hết điểm', 20, 38, {
      size: 40,
      bold: true,
      color: d.unspent > 0 ? PX.greenSoft : PX.inkBright,
    });
    text(ctx, `Đã phân ${spent} · mỗi level +2 điểm`, 940, 26, {
      size: 21,
      color: PX.muted,
      align: 'right',
    });
    const w = text(ctx, `+${lc}`, 940, 52, { size: 26, bold: true, align: 'right' });
    text(ctx, 'Tổng LC từ chỉ số ', 940 - w, 54, { size: 21, color: PX.muted, align: 'right' });
    rows.forEach(([key, name, mult, c], i) => {
      const y = 92 + i * 82;
      const isFresh = key === fresh;
      panel(ctx, 20, y, 920, 70, { border: isFresh ? PX.green : PX.line });
      text(ctx, name, 36, y + 10, { size: 26, color: c, bold: true });
      text(ctx, `mỗi điểm +${mult} LC`, 36, y + 38, { size: 18, color: '#8a8298' });
      const pts = d.alloc[key];
      const segW = 14;
      for (let s = 0; s < 30; s++) {
        const sx = 270 + s * (segW + 2);
        const lit = s < pts;
        rect(ctx, sx, y + 26, segW, 18, lit ? c : '#2a2536');
        if (isFresh && s === pts - 1) {
          const blink = Math.floor(t * 4) % 2 === 0;
          frame(ctx, sx - 2, y + 24, segW + 4, 22, blink ? '#fff6c8' : c, 2);
        }
      }
      if (pts > 30) text(ctx, `+${pts - 30}`, 270 + 30 * 16 + 6, y + 22, { size: 20, color: c });
      text(ctx, String(pts), 830, y + 14, { size: 34, bold: true, align: 'right' });
      text(ctx, ` · +${pts * mult} LC`, 834, y + 22, { size: 20, color: PX.muted });
      if (isFresh)
        dmgNumber(ctx, 270 + Math.max(0, pts - 1) * 16 - 6, y - 14, '+1', t, PX.greenSoft, 30);
    });
    text(ctx, 'Nút +1 và Reset (miễn phí) nằm dưới ảnh · ảnh tự vẽ lại sau mỗi lần bấm', 20, 418, {
      size: 19,
      color: PX.faint,
    });
  };
  return fresh ? renderGif(W, H, draw, 'chi-so', { frames: 6 }) : renderPng(W, H, draw, 'chi-so');
}

export interface TitleView {
  name: string;
  description: string;
  state: 'on' | 'got' | 'lock';
}

/** /title danh-hieu — every honour title, worn / earned / locked. */
export function renderTitlesCard(name: string, titles: TitleView[]): Promise<Rendered> {
  const W = 960;
  const rowsN = Math.ceil(titles.length / 4);
  const H = 96 + rowsN * 96;
  const got = titles.filter((x) => x.state !== 'lock').length;
  return renderGif(
    W,
    H,
    (ctx, t) => {
      text(ctx, `Danh hiệu · ${name}`, 20, 18, {
        size: 40,
        bold: true,
        color: PX.inkBright,
        maxWidth: 700,
      });
      text(ctx, `${got} / ${titles.length} đã đạt`, 940, 28, {
        size: 26,
        color: PX.muted,
        align: 'right',
        bold: true,
      });
      const cw = (920 - 36) / 4;
      titles.forEach((tt, i) => {
        const x = 20 + (i % 4) * (cw + 12);
        const y = 76 + Math.floor(i / 4) * 96;
        const c = tt.state === 'on' ? PX.gold : tt.state === 'got' ? PX.green : PX.line;
        ctx.save();
        if (tt.state === 'lock') ctx.globalAlpha = 0.5;
        panel(ctx, x, y, cw, 84, { border: c });
        if (tt.state === 'on') {
          frame(ctx, x - 5, y - 5, cw + 10, 94, PX.gold, 2);
          spark(ctx, x + cw - 24, y - 20, t, PX.gold);
          twinkle(ctx, x + 10, y - 14, t, PX.white);
        }
        text(ctx, tt.name, x + 12, y + 8, {
          size: 23,
          bold: true,
          color: tt.state === 'lock' ? PX.muted : PX.inkBright,
          maxWidth: cw - 20,
        });
        const lines = wrap(null, tt.description, cw - 24, 19);
        text(ctx, lines[0] ?? '', x + 12, y + 34, { size: 19, color: PX.muted, maxWidth: cw - 20 });
        const tag = tt.state === 'on' ? 'Đang đeo' : tt.state === 'got' ? 'Đã đạt' : 'Chưa đạt';
        if (tt.state === 'lock') lockIcon(ctx, x + 12, y + 60, '#8a8298', 3);
        text(ctx, tag, x + (tt.state === 'lock' ? 34 : 12), y + 56, {
          size: 18,
          color: tt.state === 'lock' ? '#8a8298' : c,
        });
        ctx.restore();
      });
    },
    'danh-hieu',
    { frames: 4 },
  );
}

export interface SubTitleView {
  name: string;
  theme: string;
  icon: string;
  color: string;
  on: boolean;
}

/** /title phong-hieu — the four sub-title roles. */
export function renderSubTitleCard(subs: SubTitleView[]): Promise<Rendered> {
  return renderGif(
    960,
    330,
    async (ctx, t) => {
      text(ctx, 'Phong hiệu', 20, 18, { size: 40, bold: true, color: PX.inkBright });
      text(ctx, 'Mỗi phong hiệu là một role trong server', 940, 30, {
        size: 21,
        color: PX.muted,
        align: 'right',
      });
      const cw = (920 - 36) / 4;
      for (const [i, s] of subs.entries()) {
        const x = 20 + i * (cw + 12);
        panel(ctx, x, 76, cw, 230, { border: s.on ? s.color : PX.line });
        ctx.save();
        if (!s.on) ctx.globalAlpha = 0.7;
        await drawEnchanted(
          ctx,
          s.icon,
          s.on ? 7 : 0,
          s.on ? s.color : PX.line,
          x + cw / 2 - 42,
          96,
          84,
          64,
          t,
          { badge: false, seed: 30 + i },
        );
        text(ctx, s.name, x + cw / 2, 196, {
          size: 28,
          bold: true,
          align: 'center',
          color: s.color,
        });
        text(ctx, s.theme, x + cw / 2, 232, {
          size: 20,
          align: 'center',
          color: PX.muted,
          maxWidth: cw - 16,
        });
        text(ctx, s.on ? 'Đang mang · +30 LC' : 'Chưa nhận', x + cw / 2, 266, {
          size: 20,
          align: 'center',
          bold: s.on,
          color: s.on ? PX.greenSoft : PX.faint,
        });
        ctx.restore();
      }
    },
    'phong-hieu',
    { frames: 6 },
  );
}
