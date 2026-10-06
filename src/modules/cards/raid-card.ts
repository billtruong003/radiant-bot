import type { AvatarLook } from '../avatar/catalog.js';
import { type Ctx, fillBar, label, panel, rect, segBar, text } from '../pixel/canvas.js';
import { drawCharacterOnGround } from '../pixel/character.js';
import { dmgNumber, particles, slash } from '../pixel/fx.js';
import { money } from '../pixel/icons.js';
import { drawGridMonster, drawStrip } from '../pixel/monsters.js';
import { type Rendered, renderGif } from '../pixel/output.js';
import { PX } from '../pixel/palette.js';
import type { MonsterDef, ZoneDef } from '../raid/zones.js';
import { fmt } from './profile-data.js';

export interface RaidCardData {
  name: string;
  look: AvatarLook | null;
  companions: { name: string; look: AvatarLook | null }[];
  zone: ZoneDef;
  floor: number;
  monsters: MonsterDef[];
  power: number;
  monsterPower: number;
  killsPerHour: number;
  elapsedMs: number;
  idleCapMs: number;
  pendingKills: number;
  loot: { xp: number; pills: number; coins: number };
  dayCapped: boolean;
  boss: { name: string; hp: number; maxHp: number };
  /** Set right after a claim: what was just collected. */
  claimed?: { kills: number; xp: number; pills: number; coins: number; cleared: boolean };
}

const W = 960;
const H = 480;
const GROUND = 300;

async function drawMonster(ctx: Ctx, m: MonsterDef, cx: number, frame: number): Promise<void> {
  if (m.art.kind === 'grid')
    drawGridMonster(ctx, m.art.key, cx, GROUND, m.scale, { flip: true, bob: frame % 2 });
  else await drawStrip(ctx, m.art.idle, frame, cx, GROUND, m.scale, { flip: true });
}

const hours = (ms: number): string => {
  const m = Math.floor(ms / 60_000);
  return `${Math.floor(m / 60)} giờ ${m % 60} phút`;
};

/** /bi-canh — the party holding a floor, what has piled up, the weekly boss. */
export function renderRaidCard(d: RaidCardData): Promise<Rendered> {
  const stalled = d.killsPerHour === 0;
  return renderGif(
    W,
    H,
    async (ctx, t) => {
      const frame = Math.floor(t * 8);
      rect(ctx, 0, 0, W, H, d.zone.sky);
      particles(ctx, 7, 14, 0, 30, W, 240, [PX.faint, d.zone.ground], t);
      rect(ctx, 0, GROUND, W, 40, d.zone.ground);
      rect(ctx, 0, GROUND - 4, W, 4, PX.lineDim);

      label(ctx, `BÍ CẢNH · TẦNG ${d.floor}`, 24, 16, 20);
      text(ctx, d.zone.name, 24, 38, { size: 40, bold: true, color: PX.inkBright });
      text(ctx, d.name, W - 24, 18, { size: 24, bold: true, color: PX.inkBright, align: 'right' });
      text(ctx, `Đội ${fmt(d.power)} · Quái ${fmt(d.monsterPower)}`, W - 24, 46, {
        size: 21,
        color: stalled ? PX.red : PX.gold,
        align: 'right',
      });

      // Party on the left, leader in front.
      const party = [{ look: d.look }, ...d.companions.map((c) => ({ look: c.look }))];
      for (const [i, p] of [...party.entries()].reverse()) {
        await drawCharacterOnGround(ctx, p.look, 210 - i * 70, GROUND - i * 6, i === 0 ? 4 : 3, {
          alpha: i === 0 ? 1 : 0.9,
        });
      }
      // Monsters on the right.
      // Three on the field; zones with fewer kinds repeat them.
      const shown = [0, 1, 2]
        .map((i) => d.monsters[i % d.monsters.length])
        .filter((m): m is MonsterDef => Boolean(m));
      for (const [i, m] of shown.entries()) await drawMonster(ctx, m, 600 + i * 120, frame + i * 2);
      if (!stalled && frame % 4 >= 2) {
        slash(ctx, 470, 220, 0.2, { length: 150, color: PX.white, edge: PX.gold, s: 5 });
        dmgNumber(
          ctx,
          600,
          150,
          `-${fmt(Math.max(1, Math.round(d.power / 10)))}`,
          (frame % 4) / 4,
          PX.goldBright,
          30,
        );
      }
      if (stalled)
        text(ctx, 'Không trụ nổi tầng này: lùi xuống hoặc gọi thêm hộ pháp', 660, 96, {
          size: 22,
          color: PX.red,
          align: 'center',
        });

      // Bottom panel: idle progress, pending loot, boss.
      panel(ctx, 16, GROUND + 50, W - 32, H - GROUND - 66, { fill: PX.panelDim });
      const y = GROUND + 60;
      if (d.claimed) {
        text(ctx, `Thu hoạch: ${fmt(d.claimed.kills)} yêu thú`, 32, y, {
          size: 26,
          bold: true,
          color: PX.greenSoft,
        });
        const w = text(ctx, `+${fmt(d.claimed.xp)} XP`, 32, y + 34, {
          size: 24,
          color: PX.inkBright,
        });
        await money(
          ctx,
          32 + w + 16,
          y + 30,
          `+${d.claimed.pills}`,
          `+${fmt(d.claimed.coins)}`,
          22,
        );
        if (d.claimed.cleared && d.floor < 10)
          text(ctx, `Đã trụ vững tầng ${d.floor}: tầng ${d.floor + 1} đã mở`, 32, y + 70, {
            size: 20,
            color: PX.gold,
          });
      } else {
        text(ctx, stalled ? 'Đội đang bị chặn' : `${d.killsPerHour} yêu thú mỗi giờ`, 32, y, {
          size: 24,
          bold: true,
          color: stalled ? PX.red : PX.inkBright,
        });
        segBar(ctx, 32, y + 32, 380, d.elapsedMs / d.idleCapMs, { n: 16, h: 10 });
        text(ctx, `Treo ${hours(d.elapsedMs)} / 8 giờ`, 32, y + 60, { size: 19, color: PX.muted });
        text(ctx, `Chờ thu: ${fmt(d.pendingKills)} yêu thú`, 440, y, {
          size: 22,
          color: PX.inkSoft,
        });
        const w = text(ctx, `+${fmt(d.loot.xp)} XP`, 440, y + 30, {
          size: 22,
          color: PX.inkBright,
        });
        await money(ctx, 440 + w + 14, y + 26, `+${d.loot.pills}`, `+${fmt(d.loot.coins)}`, 20);
        if (d.dayCapped)
          text(ctx, 'Đã chạm giới hạn thu nhập hôm nay', 440, y + 62, { size: 19, color: PX.red });
      }
      label(ctx, `BOSS TUẦN · ${d.boss.name.toUpperCase()}`, 700, y, 18, PX.red);
      fillBar(ctx, 700, y + 26, 228, 16, d.boss.hp / d.boss.maxHp, PX.red);
      text(
        ctx,
        d.boss.hp > 0 ? `${fmt(d.boss.hp)} / ${fmt(d.boss.maxHp)}` : 'Đã bị hạ',
        700,
        y + 48,
        {
          size: 19,
          color: PX.muted,
        },
      );
    },
    'bi-canh',
    { frames: 8, delayMs: 140, stillT: 0.3 },
  );
}
