import type { AvatarLook } from '../avatar/catalog.js';
import { type Ctx, fillBar, frame, label, panel, rect, text } from '../pixel/canvas.js';
import { drawCharacterOnGround } from '../pixel/character.js';
import { particles, rays, spark, sprite, twinkle } from '../pixel/fx.js';
import { drawIcon, money } from '../pixel/icons.js';
import { type Rendered, renderGif, renderPng } from '../pixel/output.js';
import { PX } from '../pixel/palette.js';
import { fmt } from './profile-data.js';

// ---------------------------------------------------------------- /daily

const CHECK = ['.....a', '....aa', 'a..aa.', 'aaaa..', '.aa...'];

export interface DailyView {
  name: string;
  look: AvatarLook | null;
  /** Streak after today's claim. */
  streak: number;
  xp: number;
  bonus: number;
  pills: number;
  coins: number;
  /** Milestone days on the 30-day board and what they add. */
  milestones: { day: number; xp: number; pills: number }[];
}

/**
 * /daily — a 30-day board. Days already kept are lit, today's tile glows,
 * milestone days carry a pill jar. Streaks past 30 wrap onto a new board.
 */
export function renderDailyCard(d: DailyView): Promise<Rendered> {
  const W = 960;
  const H = 460;
  const onBoard = ((d.streak - 1) % 30) + 1;
  const round = Math.floor((d.streak - 1) / 30) + 1;
  const big = d.bonus > 0;
  return renderGif(
    W,
    H,
    async (ctx: Ctx, t: number) => {
      rect(ctx, 0, 0, W, H, PX.bg);
      if (big)
        rays(ctx, 130, 250, PX.goldBright, t, {
          n: 14,
          length: 220,
          width: 5,
          alpha: 0.2,
          inner: 50,
        });
      particles(ctx, 31, 18, 20, 60, 220, 300, [PX.goldBright, PX.white], t);
      rect(ctx, 0, 380, 260, 80, PX.panelDim);
      rect(ctx, 0, 376, 260, 4, PX.lineDim);
      await drawCharacterOnGround(ctx, d.look, 130, 384, 6);
      spark(ctx, 60, 120, t, PX.goldBright, undefined, 4, 0);
      spark(ctx, 196, 160, t, PX.goldBright, undefined, 4, 0.5);

      label(ctx, `ĐIỂM DANH${round > 1 ? ` · VÒNG ${round}` : ''}`, 290, 22);
      text(ctx, big ? `Mốc ${d.streak} ngày!` : `Ngày thứ ${d.streak}`, 290, 42, {
        size: 48,
        bold: true,
        color: big ? PX.goldBright : PX.inkBright,
      });
      const w = text(ctx, `+${fmt(d.xp)} XP`, 290, 100, {
        size: 28,
        bold: true,
        color: PX.greenSoft,
      });
      await money(ctx, 290 + w + 18, 98, `+${d.pills}`, `+${d.coins}`, 24);

      // 10 × 3 board.
      const cw = 60;
      const gap = 6;
      const x0 = 290;
      const y0 = 150;
      const mile = new Map(d.milestones.map((m) => [m.day, m]));
      for (let i = 0; i < 30; i++) {
        const day = i + 1;
        const x = x0 + (i % 10) * (cw + gap);
        const y = y0 + Math.floor(i / 10) * (cw + gap + 14);
        const kept = day < onBoard;
        const today = day === onBoard;
        const m = mile.get(day);
        rect(ctx, x, y, cw, cw, kept ? '#3a3020' : today ? '#4a3a18' : PX.bgDeep);
        frame(
          ctx,
          x,
          y,
          cw,
          cw,
          today ? PX.goldBright : kept ? PX.gold : m ? '#6a5a30' : PX.lineDim,
          today ? 3 : 2,
        );
        if (m) {
          await drawIcon(ctx, 'gold_medicine__divine_gold_inlaid_wood', x + 14, y + 6, 32);
          text(ctx, `+${m.xp}`, x + cw / 2, y + cw + 1, {
            size: 16,
            color: PX.gold,
            align: 'center',
          });
        }
        text(ctx, String(day), x + 6, y + cw - 22, {
          size: 18,
          color: kept || today ? PX.inkBright : PX.faint,
        });
        if (kept && !m) sprite(ctx, CHECK, { a: PX.gold }, 4, x + 20, y + 10);
        if (today) {
          twinkle(ctx, x - 6, y - 6, t, PX.goldBright, 3, 0);
          twinkle(ctx, x + cw - 6, y + cw - 10, t, PX.goldBright, 3, 0.5);
        }
      }
      const next = d.milestones.find((m) => m.day > onBoard);
      text(
        ctx,
        next
          ? `Còn ${next.day - onBoard} ngày tới mốc ${next.day}: +${next.xp} XP, +${next.pills} đan`
          : 'Đủ 30 ngày, ngày mai sang vòng mới',
        290,
        H - 34,
        { size: 20, color: PX.muted },
      );
    },
    'diem-danh',
    { frames: 8 },
  );
}

// ---------------------------------------------------------------- /quest

export interface QuestView {
  label: string;
  /** Short group shown above the row, e.g. "Hằng ngày". */
  group: string;
  progress: number;
  target: number;
  done: boolean;
  xp: number;
  pills: number;
  coins: number;
}

/** /quest — one row per quest with its bar and reward. */
export function renderQuestCard(o: {
  name: string;
  quests: QuestView[];
  resetIn: string;
}): Promise<Rendered> {
  const W = 960;
  const rowH = 96;
  const H = 110 + Math.max(1, o.quests.length) * (rowH + 10);
  return renderPng(
    W,
    H,
    async (ctx) => {
      rect(ctx, 0, 0, W, H, PX.bg);
      text(ctx, 'Bảng nhiệm vụ', 20, 14, { size: 40, bold: true, color: PX.inkBright });
      text(ctx, o.name, 20, 60, { size: 22, color: PX.muted });
      text(ctx, `Làm mới sau ${o.resetIn}`, W - 20, 24, {
        size: 20,
        color: PX.muted,
        align: 'right',
      });
      const doneN = o.quests.filter((q) => q.done).length;
      text(ctx, `${doneN}/${o.quests.length} xong`, W - 20, 54, {
        size: 26,
        bold: true,
        color: doneN === o.quests.length ? PX.green : PX.gold,
        align: 'right',
      });
      for (const [i, q] of o.quests.entries()) {
        const y = 100 + i * (rowH + 10);
        panel(ctx, 20, y, W - 40, rowH, { border: q.done ? PX.green : PX.line });
        label(ctx, q.group.toUpperCase(), 36, y + 8, 17);
        text(ctx, q.label, 36, y + 28, {
          size: 26,
          bold: true,
          color: q.done ? PX.greenSoft : PX.inkBright,
          maxWidth: 520,
        });
        fillBar(
          ctx,
          36,
          y + 64,
          420,
          16,
          q.progress / Math.max(1, q.target),
          q.done ? PX.green : PX.gold,
        );
        text(ctx, `${Math.min(q.progress, q.target)}/${q.target}`, 470, y + 60, {
          size: 20,
          color: PX.inkSoft,
        });
        const rw = text(ctx, `+${q.xp} XP`, 620, y + 30, {
          size: 24,
          bold: true,
          color: PX.greenSoft,
        });
        await money(ctx, 620 + rw + 14, y + 28, `+${q.pills}`, `+${q.coins}`, 22);
        if (q.done) {
          rect(ctx, 620, y + 62, 120, 24, PX.green);
          text(ctx, 'Đã nhận', 632, y + 62, { size: 20, color: PX.bg });
        }
      }
    },
    'nhiem-vu',
  );
}
