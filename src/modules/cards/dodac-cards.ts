import type { AvatarLook } from '../avatar/catalog.js';
import {
  type Ctx,
  frame,
  label,
  measure,
  panel,
  rect,
  statBox,
  text,
  wrap,
} from '../pixel/canvas.js';
import { drawCharacterOnGround } from '../pixel/character.js';
import {
  dmgNumber,
  drawEnchanted,
  flame,
  particles,
  pillar,
  rays,
  rings,
  shards,
  spark,
} from '../pixel/fx.js';
import { drawIcon, money } from '../pixel/icons.js';
import { type Rendered, renderGif, renderPng } from '../pixel/output.js';
import { PX, TIER_COLOR } from '../pixel/palette.js';
import { fmt } from './profile-data.js';

export interface ItemView {
  icon: string;
  name: string;
  grade: string;
  color: string;
  level: number;
}

// ---------------------------------------------------------------- upgrade

export interface UpgradeView extends ItemView {
  kind: string;
  from: number;
  result: 'success' | 'fail-stay' | 'fail-downgrade';
  to: number;
  rate: number;
  costPills: number;
  costCoins: number;
  /** e.g. "dmg 42 → 47"; optional. */
  detail?: string;
}

/** Result of cường hóa: burst on success, smoke on failure, shards when it drops. */
export function renderUpgradeCard(u: UpgradeView): Promise<Rendered> {
  const W = 960;
  const H = 420;
  const ok = u.result === 'success';
  const heavy = u.result === 'fail-downgrade';
  const ring = ok ? PX.goldBright : heavy ? PX.red : PX.muted;
  return renderGif(
    W,
    H,
    async (ctx, t) => {
      rect(ctx, 0, 0, W, H, ok ? '#1d1a24' : heavy ? '#211618' : '#18171c');
      if (ok) {
        rays(ctx, 200, 210, PX.goldBright, t, {
          n: 20,
          length: 260,
          width: 6,
          alpha: 0.3,
          inner: 80,
        });
        rings(ctx, 200, 210, PX.purple, t, { n: 3, step: 24, start: 96 });
        particles(ctx, 81, 30, 60, 60, 280, 300, [PX.goldBright, PX.white, PX.purple], t);
        spark(ctx, 90, 90, t, PX.white, PX.goldBright);
        spark(ctx, 300, 80, t, PX.goldBright, undefined, 4, 0.5);
        dmgNumber(ctx, 270, 40, `+${u.to}`, t, PX.purple, 56);
      } else if (heavy) {
        shards(ctx, [
          [110, 120, '#cfd6e0'],
          [300, 100, '#9aa3b0'],
          [280, 300, '#cfd6e0'],
          [100, 290, PX.red],
          [330, 200, '#9aa3b0'],
        ]);
        particles(ctx, 83, 30, 80, 80, 260, 260, [PX.red, '#4a4658'], t, 30, [4, 6]);
        dmgNumber(ctx, 270, 40, `−${u.from - u.to}`, t, PX.red, 56);
      } else
        particles(
          ctx,
          82,
          36,
          80,
          80,
          260,
          260,
          ['#4a4658', '#6e6780', '#2a2536'],
          t,
          40,
          [6, 8, 10],
        );
      ctx.save();
      if (!ok) ctx.globalAlpha = heavy ? 0.6 : 0.85;
      await drawEnchanted(ctx, u.icon, u.to, u.color, 134, 144, 132, 128, t, { seed: 84 });
      ctx.restore();
      label(ctx, `CƯỜNG HÓA · ${u.name} · ${u.grade}`, 420, 70);
      text(ctx, ok ? 'Thành công' : heavy ? 'Thất bại nặng' : 'Thất bại', 420, 96, {
        size: 64,
        bold: true,
        color: ring,
      });
      const line = ok
        ? `${u.name} +${u.from} → +${u.to}${u.detail ? ` · ${u.detail}` : ''}`
        : heavy
          ? `Rớt về +${u.to}${u.detail ? ` · ${u.detail}` : ''}`
          : `Giữ nguyên +${u.from} · lần này không mất cấp`;
      text(ctx, line, 420, 170, { size: 28, maxWidth: 520 });
      const w = text(
        ctx,
        `Tỉ lệ +${u.from} → +${u.from + 1}: ${Math.round(u.rate * 100)}%   Đã tốn`,
        420,
        214,
        { size: 22, color: PX.muted },
      );
      await money(ctx, 420 + w + 12, 210, `−${u.costPills}`, `−${fmt(u.costCoins)}`, 22);
      if (u.kind === 'weapon')
        text(ctx, 'Từ +7 trở lên, thất bại sẽ rớt 1 cấp', 420, 254, { size: 20, color: PX.faint });
    },
    'cuong-hoa',
    { frames: 10 },
  );
}

// ---------------------------------------------------------------- item detail

export interface ItemDetail extends ItemView {
  kindLabel: string;
  sub?: string;
  stats: [string, string, string, string?][];
  skill?: string;
  lore?: string;
}

/** /gear … info — one item, big, with its stats and lore. */
export function renderItemCard(d: ItemDetail): Promise<Rendered> {
  const W = 620;
  const lore = d.lore ? wrap(null, d.lore, W - 40, 19).slice(0, 3) : [];
  const skill = d.skill ? wrap(null, d.skill, W - 40, 20).slice(0, 2) : [];
  const H = 300 + skill.length * 22 + lore.length * 21;
  const draw = async (ctx: Ctx, t: number) => {
    panel(ctx, 0, 0, W, H, { border: d.color, t: 3 });
    await drawEnchanted(ctx, d.icon, d.level, d.color, 26, 26, 132, 128, t, { seed: 71 });
    label(ctx, d.kindLabel.toUpperCase(), 182, 34);
    text(ctx, d.level > 0 ? `${d.name} +${d.level}` : d.name, 182, 56, {
      size: 36,
      bold: true,
      color: PX.inkBright,
      maxWidth: W - 200,
    });
    text(ctx, d.grade, 182, 100, { size: 24, color: d.color, bold: true });
    if (d.sub) text(ctx, d.sub, 182, 128, { size: 20, color: PX.muted, maxWidth: W - 200 });
    const n = Math.max(1, d.stats.length);
    const bw = (W - 40 - (n - 1) * 8) / n;
    d.stats.forEach(([name, value, color, sub], i) =>
      statBox(ctx, 20 + i * (bw + 8), 184, bw, name, value, color, sub),
    );
    let y = 274;
    for (const l of skill) {
      text(ctx, l, 20, y, { size: 20, color: PX.inkSoft });
      y += 22;
    }
    for (const l of lore) {
      text(ctx, l, 20, y + 4, { size: 19, color: '#8a8298' });
      y += 21;
    }
  };
  return d.level >= 4
    ? renderGif(W, H, draw, 'vat-pham', { frames: 8 })
    : renderPng(W, H, draw, 'vat-pham');
}

// ---------------------------------------------------------------- inventory

export interface BagItem extends ItemView {
  equipped: boolean;
}

const LADDER: [string, string, string, string][] = [
  ['jian_sword__rusty_stone', 'Phàm Phẩm', 'đá thô, gỗ mộc', TIER_COLOR.pham ?? ''],
  ['jian_sword__forged_iron', 'Địa Phẩm', 'sắt rèn, đồng cổ', TIER_COLOR.dia ?? ''],
  ['jian_sword__icy_frost_steel', 'Thiên Phẩm', 'thép hàn sương', TIER_COLOR.thien ?? ''],
  ['jian_sword__green_jade', 'Thánh Phẩm', 'bích ngọc, thép lôi', TIER_COLOR.thanh ?? ''],
  ['jian_sword__divine_gold_inlaid_wood', 'Thần Phẩm', 'vàng khảm thần mộc', TIER_COLOR.than ?? ''],
  ['staff__meteoric_lava_iron', 'Bản Mệnh', 'rèn riêng theo ID', TIER_COLOR.ban_menh ?? ''],
];

/** /gear inventory — the bag, every owned item with its upgrade mark. */
export function renderInventoryCard(o: {
  tab: string;
  pills: number;
  coins: number;
  items: BagItem[];
}): Promise<Rendered> {
  const W = 960;
  const cols = 6;
  const rowsN = Math.max(3, Math.ceil(o.items.length / cols));
  const H = Math.max(440, 120 + rowsN * 100);
  const animated = o.items.some((i) => i.level >= 4);
  const draw = async (ctx: Ctx, t: number) => {
    text(ctx, 'Phẩm cấp vũ khí', 20, 18, { size: 30, bold: true, color: PX.inkBright });
    for (const [i, [icon, name, mat, col]] of LADDER.entries()) {
      const y = 58 + i * 60;
      panel(ctx, 20, y, 290, 52);
      rect(ctx, 24, y + 4, 44, 44, PX.bgDeep);
      frame(ctx, 24, y + 4, 44, 44, col, 3);
      await drawIcon(ctx, icon, 30, y + 10, 32);
      text(ctx, name, 80, y + 6, { size: 24, color: col, bold: true });
      text(ctx, mat, 80, y + 30, { size: 18, color: PX.muted });
    }
    text(ctx, 'Túi càn khôn', 340, 18, { size: 36, bold: true, color: PX.inkBright });
    const tabs = ['Tổng', 'Công pháp', 'Vũ khí', 'Pháp khí', 'Nhẫn'];
    let tx = 340;
    for (const tb of tabs) {
      const on = tb === o.tab;
      const w = Math.ceil(measure(null, tb, 21)) + 20;
      rect(ctx, tx, 60, w, 26, on ? PX.gold : PX.lineDim);
      text(ctx, tb, tx + 10, 62, { size: 21, color: on ? PX.bg : PX.muted });
      tx += w + 6;
    }
    await money(ctx, 760, 18, fmt(o.pills), fmt(o.coins));
    text(ctx, 'chấm vàng = đang đeo', 940, 62, { size: 19, color: PX.muted, align: 'right' });
    const cw = 84;
    const gap = (600 - cols * cw) / (cols - 1);
    for (let i = 0; i < rowsN * cols; i++) {
      const x = 340 + (i % cols) * (cw + gap);
      const y = 104 + Math.floor(i / cols) * 100;
      const it = o.items[i];
      if (!it) {
        rect(ctx, x, y, cw, cw, PX.bgDeep);
        frame(ctx, x, y, cw, cw, '#2a2536', 3);
        continue;
      }
      await drawEnchanted(ctx, it.icon, it.level, it.color, x, y, cw, 64, t, { seed: 50 + i });
      if (it.equipped) {
        rect(ctx, x + 2, y + 2, 14, 14, PX.bg);
        rect(ctx, x + 4, y + 4, 10, 10, PX.gold);
      }
    }
    if (o.items.length === 0)
      text(ctx, 'Túi trống. Ghé /shop browse mua món đầu tiên.', 640, 220, {
        size: 22,
        color: PX.muted,
        align: 'center',
      });
  };
  return animated
    ? renderGif(W, H, draw, 'tui-do', { frames: 8 })
    : renderPng(W, H, draw, 'tui-do');
}

// ---------------------------------------------------------------- shop

export interface ShopItem extends ItemView {
  stat: string;
  pills: number;
  coins: number;
  state: 'equipped' | 'owned' | 'buy' | 'poor' | 'locked';
  need?: string;
}

/** /shop browse — one tab of Aki's shop. */
export function renderShopCard(o: {
  tab: string;
  rankName: string;
  pills: number;
  coins: number;
  items: ShopItem[];
}): Promise<Rendered> {
  const W = 960;
  const shown = o.items.slice(0, 12);
  const rowsN = Math.max(1, Math.ceil(shown.length / 4));
  const H = 130 + rowsN * 212;
  return renderPng(
    W,
    H,
    async (ctx, t) => {
      text(ctx, 'Đan tiệm của Aki', 20, 14, { size: 40, bold: true, color: PX.inkBright });
      let tx = 20;
      for (const tb of ['Công pháp', 'Vũ khí', 'Pháp khí', 'Nhẫn']) {
        const on = tb === o.tab;
        const w = Math.ceil(measure(null, tb, 21)) + 20;
        rect(ctx, tx, 60, w, 26, on ? PX.gold : PX.lineDim);
        text(ctx, tb, tx + 10, 62, { size: 21, color: on ? PX.bg : PX.muted });
        tx += w + 6;
      }
      text(ctx, `BẠN CÓ · ${o.rankName}`, 940, 18, { size: 20, color: PX.muted, align: 'right' });
      await money(ctx, 760, 46, fmt(o.pills), fmt(o.coins));
      const cw = (920 - 36) / 4;
      for (const [i, it] of shown.entries()) {
        const x = 20 + (i % 4) * (cw + 12);
        const y = 100 + Math.floor(i / 4) * 212;
        const border = it.state === 'equipped' ? PX.gold : it.state === 'buy' ? PX.green : PX.line;
        ctx.save();
        if (it.state === 'locked') ctx.globalAlpha = 0.55;
        panel(ctx, x, y, cw, 200, { border });
        await drawEnchanted(ctx, it.icon, it.level, it.color, x + 8, y + 8, 84, 64, t, {
          seed: 90 + i,
        });
        text(ctx, it.grade, x + 100, y + 24, { size: 19, color: it.color, maxWidth: cw - 108 });
        text(ctx, it.stat, x + 100, y + 48, {
          size: 24,
          color: PX.inkSoft,
          bold: true,
          maxWidth: cw - 108,
        });
        text(ctx, it.name, x + 10, y + 102, { size: 24, bold: true, maxWidth: cw - 20 });
        await money(ctx, x + 10, y + 132, String(it.pills), fmt(it.coins), 22);
        const tag =
          it.state === 'equipped'
            ? ['Đang đeo', PX.gold, PX.bg]
            : it.state === 'owned'
              ? ['Đã có', PX.lineDim, PX.ink]
              : it.state === 'buy'
                ? ['Mua được', PX.green, PX.bg]
                : it.state === 'poor'
                  ? ['Thiếu tiền', '#8a5a4a', PX.ink]
                  : [`Cần ${it.need ?? 'cảnh giới cao hơn'}`, '#2a2536', PX.ink];
        rect(ctx, x + 10, y + 170, cw - 20, 22, tag[1] as string);
        text(ctx, tag[0] as string, x + 18, y + 170, {
          size: 20,
          color: tag[2] as string,
          maxWidth: cw - 36,
        });
        ctx.restore();
      }
      if (o.items.length > 12)
        text(ctx, `… và ${o.items.length - 12} món nữa trong menu Mua`, 20, H - 26, {
          size: 19,
          color: PX.faint,
        });
    },
    'dan-tiem',
  );
}

// ---------------------------------------------------------------- sell to Aki

/** /shop trade sell — Aki buys a công pháp back; the jackpot pays full price. */
export function renderSellCard(
  o: ItemView & { pills: number; coins: number; jackpot: boolean; aki: AvatarLook },
): Promise<Rendered> {
  const W = 960;
  const H = 360;
  return renderGif(
    W,
    H,
    async (ctx, t) => {
      rect(ctx, 0, 0, W, H, o.jackpot ? '#241f14' : PX.bg);
      if (o.jackpot) {
        rays(ctx, 800, 220, PX.goldBright, t, {
          n: 18,
          length: 300,
          width: 6,
          alpha: 0.25,
          inner: 70,
        });
        particles(ctx, 95, 40, 520, 40, 400, 300, [PX.goldBright, PX.white, PX.red], t);
      }
      const coins: [number, number][] = [
        [330, 210],
        [380, 180],
        [430, 230],
        [480, 190],
        [530, 220],
        [580, 200],
      ];
      for (const [k, [x, y]] of coins.entries()) {
        const dy = Math.floor(((t + k * 0.15) % 1) * 4) * -4;
        rect(ctx, x + 4, y + dy, 8, 16, PX.gold);
        rect(ctx, x, y + 4 + dy, 16, 8, PX.gold);
        rect(ctx, x + 4, y + 4 + dy, 8, 8, PX.goldBright);
      }
      rect(ctx, 0, 290, W, 70, PX.panelDim);
      rect(ctx, 0, 286, W, 4, PX.lineDim);
      await drawEnchanted(ctx, o.icon, o.level, o.color, 70, 120, 132, 128, t, { seed: 96 });
      await drawCharacterOnGround(ctx, o.aki, 820, 300, 6, { flip: true });
      label(ctx, 'BÁN CHO AKI', 260, 28);
      text(ctx, o.jackpot ? 'AKI HÔM NAY HÀO PHÓNG!' : 'Aki đã mua', 260, 48, {
        size: 48,
        bold: true,
        color: o.jackpot ? PX.goldBright : PX.inkBright,
      });
      text(ctx, `${o.name}${o.level > 0 ? ` +${o.level}` : ''} · ${o.grade}`, 260, 102, {
        size: 24,
      });
      const w = text(ctx, 'Nhận', 260, 140, { size: 22, color: PX.muted });
      const mw = await money(ctx, 260 + w + 12, 136, `+${o.pills}`, `+${fmt(o.coins)}`, 22);
      text(ctx, o.jackpot ? 'trả đủ giá gốc' : '50% đan · 60% cống hiến', 260 + w + mw + 28, 140, {
        size: 22,
        color: PX.muted,
      });
    },
    'ban-cho-aki',
    { frames: 8 },
  );
}

// ---------------------------------------------------------------- forge bản mệnh

export function renderForgeCard(
  o: ItemView & { element: string; stats: [string, string, string][]; skill: string },
): Promise<Rendered> {
  const W = 960;
  const H = 480;
  return renderGif(
    W,
    H,
    async (ctx, t) => {
      rect(ctx, 0, 0, W, H, '#1f1512');
      pillar(ctx, 230, 0, 480, PX.red, t, 200);
      rings(ctx, 230, 230, PX.red, t, { n: 4, step: 28, start: 90 });
      particles(ctx, 101, 50, 60, 40, 340, 400, [PX.red, '#f0b84a', PX.white], t);
      flame(ctx, 150, 330, t, 6);
      flame(ctx, 268, 340, t, 6);
      flame(ctx, 205, 360, t, 5);
      await drawEnchanted(ctx, o.icon, 10, o.color, 164, 164, 132, 128, t, {
        badge: false,
        seed: 102,
      });
      label(ctx, 'RÈN VŨ KHÍ BẢN MỆNH', 450, 40);
      text(ctx, o.name, 450, 62, { size: 56, bold: true, color: PX.red, maxWidth: 480 });
      text(ctx, `Mạch ${o.element} · rèn theo Discord ID`, 450, 128, {
        size: 24,
        maxWidth: 480,
      });
      const bw = (480 - 16) / 3;
      o.stats
        .slice(0, 3)
        .forEach(([n, v, c], i) => statBox(ctx, 450 + i * (bw + 8), 168, bw, n, v, c));
      panel(ctx, 450, 248, 480, 72);
      const lines = wrap(null, o.skill, 456, 21).slice(0, 2);
      lines.forEach((l, i) => text(ctx, l, 462, 256 + i * 24, { size: 21, color: PX.inkSoft }));
      text(ctx, 'Không mua bán được · đi theo chủ cả đời', 450, 334, {
        size: 19,
        color: '#8a8298',
      });
    },
    'ban-menh',
    { frames: 8 },
  );
}
