import type { AvatarLook } from '../avatar/catalog.js';
import type { DuelResult } from '../combat/duel.js';
import { type Ctx, fillBar, label, panel, rect, text } from '../pixel/canvas.js';
import { drawCharacterOnGround } from '../pixel/character.js';
import {
  dmgNumber,
  drawEnchanted,
  particles,
  rays,
  screenFlash,
  shards,
  slash,
} from '../pixel/fx.js';
import { type Rendered, renderGif, renderPng } from '../pixel/output.js';
import { PX } from '../pixel/palette.js';
import type { ItemView } from './dodac-cards.js';
import { fmt } from './profile-data.js';

/** One side of a duel, as the cards draw it. */
export interface Fighter {
  name: string;
  look: AvatarLook | null;
  rankName: string;
  rankColor: string;
  lc: number;
  weapon: ItemView | null;
}

const W = 960;
const H = 440;
const GROUND = 372;
const LEFT_X = 230;
const RIGHT_X = 730;

function stage(ctx: Ctx, tint = '#1a1622'): void {
  rect(ctx, 0, 0, W, H, tint);
  rect(ctx, 0, GROUND, W, H - GROUND, PX.panelDim);
  rect(ctx, 0, GROUND - 4, W, 4, PX.lineDim);
}

/** Name, realm and lực chiến at the top of one side. */
function header(ctx: Ctx, f: Fighter, right: boolean): void {
  const x = right ? W - 24 : 24;
  const align = right ? 'right' : 'left';
  text(ctx, f.name, x, 16, { size: 34, bold: true, color: PX.inkBright, align, maxWidth: 380 });
  text(ctx, f.rankName, x, 56, { size: 22, color: f.rankColor, align });
  text(ctx, `Lực chiến ${fmt(f.lc)}`, x, 80, { size: 22, color: PX.gold, align });
}

async function weaponBadge(ctx: Ctx, f: Fighter, right: boolean, t: number): Promise<void> {
  if (!f.weapon) return;
  const x = right ? RIGHT_X + 92 : LEFT_X - 176;
  await drawEnchanted(ctx, f.weapon.icon, f.weapon.level, f.weapon.color, x, 250, 84, 64, t, {
    seed: right ? 7 : 3,
  });
}

// ---------------------------------------------------------------- challenge

/** /duel @someone — the throw-down, waiting for the opponent's answer. */
export function renderChallengeCard(c: Fighter, o: Fighter, stake: number): Promise<Rendered> {
  return renderPng(
    W,
    H,
    async (ctx, t) => {
      stage(ctx);
      rays(ctx, W / 2, 210, PX.red, t, { n: 12, length: 200, width: 4, alpha: 0.18, inner: 40 });
      header(ctx, c, false);
      header(ctx, o, true);
      await drawCharacterOnGround(ctx, c.look, LEFT_X, GROUND, 5);
      await drawCharacterOnGround(ctx, o.look, RIGHT_X, GROUND, 5, { flip: true });
      await weaponBadge(ctx, c, false, t);
      await weaponBadge(ctx, o, true, t);
      text(ctx, 'VS', W / 2, 150, { size: 84, bold: true, color: PX.red, align: 'center' });
      label(ctx, 'LỜI THÁCH ĐẤU', W / 2, 120, 20);
      ctx.save();
      text(ctx, `Cược ${stake} đan dược`, W / 2, 250, {
        size: 26,
        color: PX.inkSoft,
        align: 'center',
      });
      text(ctx, 'Đối thủ có 60 giây để nhận lời', W / 2, GROUND + 22, {
        size: 22,
        color: PX.muted,
        align: 'center',
      });
      ctx.restore();
    },
    'thach-dau',
    0.2,
  );
}

// ---------------------------------------------------------------- result

const PER_ROUND = 4;
const HOLD = 8;

/**
 * /duel result — the five rounds play out (HP bars drain, hits land, crits
 * flash), then the winner stands lit and the loser greys out.
 */
export function renderDuelResultCard(
  c: Fighter,
  o: Fighter,
  r: DuelResult,
  stake: number,
): Promise<Rendered> {
  const rounds = r.rounds.length;
  const frames = rounds * PER_ROUND + HOLD;
  return renderGif(
    W,
    H,
    async (ctx, t) => {
      const f = Math.round(t * frames);
      const k = Math.min(rounds, Math.floor(f / PER_ROUND));
      const u = (f % PER_ROUND) / PER_ROUND;
      const done = k >= rounds;
      const round = r.rounds[Math.min(k, rounds - 1)];
      const prev = k > 0 ? r.rounds[k - 1] : null;
      const hp = (side: 'c' | 'o') => {
        const start = side === 'c' ? r.challengerHpStart : r.opponentHpStart;
        const before = prev
          ? side === 'c'
            ? prev.challengerHpAfter
            : prev.opponentHpAfter
          : start;
        if (done || !round) return side === 'c' ? r.challengerHpEnd : r.opponentHpEnd;
        const after = side === 'c' ? round.challengerHpAfter : round.opponentHpAfter;
        return before + (after - before) * Math.min(1, u * 2);
      };
      const won = (side: 'c' | 'o') =>
        side === 'c' ? r.winner === 'challenger' : r.winner === 'opponent';

      stage(ctx);
      if (done && r.winner !== 'tie') {
        rays(ctx, r.winner === 'challenger' ? LEFT_X : RIGHT_X, 250, PX.goldBright, t * 3, {
          n: 14,
          length: 240,
          width: 5,
          alpha: 0.22,
          inner: 60,
        });
      }
      header(ctx, c, false);
      header(ctx, o, true);
      for (const [side, x] of [
        ['c', 24],
        ['o', W - 24 - 360],
      ] as const) {
        const start = side === 'c' ? r.challengerHpStart : r.opponentHpStart;
        const frac = Math.max(0, hp(side)) / Math.max(1, start);
        fillBar(ctx, x, 110, 360, 18, frac, frac > 0.5 ? PX.green : frac > 0.25 ? PX.gold : PX.red);
      }

      // Fighters lunge toward the middle on the first beat of a round.
      const lunge = !done && u < 0.5 ? 26 : 0;
      const dim = (side: 'c' | 'o') => (done && r.winner !== 'tie' && !won(side) ? 0.45 : 1);
      await drawCharacterOnGround(ctx, c.look, LEFT_X + lunge, GROUND, 4, { alpha: dim('c') });
      await drawCharacterOnGround(ctx, o.look, RIGHT_X - lunge, GROUND, 4, {
        flip: true,
        alpha: dim('o'),
      });
      await weaponBadge(ctx, c, false, t);
      await weaponBadge(ctx, o, true, t);

      if (!done && round) {
        text(ctx, `HIỆP ${round.round}/${rounds}`, W / 2, 200, {
          size: 30,
          color: PX.inkSoft,
          align: 'center',
        });
        if (u >= 0.25) {
          // Damage dealt BY the opponent lands on the challenger, and vice versa.
          hit(
            ctx,
            RIGHT_X,
            round.challengerDamage,
            round.challengerCrit,
            round.opponentDefended,
            u,
          );
          hit(ctx, LEFT_X, round.opponentDamage, round.opponentCrit, round.challengerDefended, u);
        }
        if (round.challengerCrit || round.opponentCrit)
          screenFlash(ctx, W, H, (u - 0.25) * 0.5, '#ffe8a0');
      } else {
        const title =
          r.winner === 'tie' ? 'HÒA' : `${(r.winner === 'challenger' ? c : o).name} THẮNG`;
        text(ctx, title, W / 2, 150, {
          size: 52,
          bold: true,
          color: r.winner === 'tie' ? PX.inkSoft : PX.goldBright,
          align: 'center',
          maxWidth: 440,
        });
        text(ctx, r.winner === 'tie' ? 'Không ai mất đan dược' : `+${stake} đan dược`, W / 2, 214, {
          size: 26,
          color: PX.inkSoft,
          align: 'center',
        });
        if (r.winner !== 'tie')
          particles(
            ctx,
            77,
            24,
            r.winner === 'challenger' ? 100 : 600,
            140,
            260,
            220,
            [PX.goldBright, PX.white],
            t,
          );
      }
    },
    'ket-qua-dau',
    { frames, delayMs: 170, stillT: 0.99 },
  );
}

function hit(ctx: Ctx, x: number, dmg: number, crit: boolean, defended: boolean, u: number): void {
  slash(ctx, x - 90, 318, 0.2, {
    length: 170,
    slope: -0.45,
    color: crit ? PX.goldBright : PX.white,
    edge: crit ? PX.red : PX.blue,
  });
  const v = crit ? `-${fmt(dmg)}!` : `-${fmt(dmg)}`;
  dmgNumber(ctx, x - 40, 150, v, (u - 0.25) / 0.75, crit ? PX.goldBright : PX.red, crit ? 46 : 38);
  if (defended) text(ctx, 'THỦ', x + 60, 250, { size: 24, bold: true, color: PX.blue });
  if (crit)
    text(ctx, 'CHÍ MẠNG', x, 132, { align: 'center', size: 22, bold: true, color: PX.goldBright });
}

// ---------------------------------------------------------------- miểu sát

/** Two or more realms apart: one strike, no fight. */
export function renderMieuSatCard(c: Fighter, o: Fighter, gap: number): Promise<Rendered> {
  return renderGif(
    W,
    H,
    async (ctx, t) => {
      stage(ctx, '#120e18');
      const strike = t >= 0.25;
      if (strike)
        rays(ctx, RIGHT_X, 250, c.rankColor, t * 2, {
          n: 18,
          length: 300,
          width: 5,
          alpha: 0.25,
          inner: 50,
        });
      header(ctx, c, false);
      header(ctx, o, true);
      await drawCharacterOnGround(ctx, c.look, strike ? RIGHT_X - 170 : LEFT_X, GROUND, 5);
      await drawCharacterOnGround(ctx, o.look, RIGHT_X, GROUND, 5, {
        flip: true,
        alpha: strike ? 0.4 : 1,
        silhouette: strike && t >= 0.5 ? PX.faint : undefined,
      });
      if (strike && t < 0.6) {
        slash(ctx, RIGHT_X - 160, 200, 0.2, {
          length: 300,
          color: PX.white,
          edge: c.rankColor,
          s: 8,
          slope: 0.5,
        });
        screenFlash(ctx, W, H, (t - 0.25) * 1.2, '#ffffff');
      }
      if (t >= 0.5)
        shards(ctx, [
          [RIGHT_X + 40, GROUND - 120, PX.white],
          [RIGHT_X - 50, GROUND - 160, c.rankColor],
          [RIGHT_X + 70, GROUND - 60, PX.white],
        ]);
      text(ctx, 'MIỂU SÁT', 24, 130, { size: 72, bold: true, color: c.rankColor });
      text(ctx, `Cách ${gap} cảnh giới,`, 24, 206, { size: 24, color: PX.inkSoft });
      text(ctx, 'không cần giao đấu', 24, 232, { size: 24, color: PX.inkSoft });
      panel(ctx, 24, GROUND + 14, 420, 40, { fill: PX.bgDeep });
      text(ctx, 'Không lấy đan dược · 24 giờ mới dùng lại', 36, GROUND + 20, {
        size: 21,
        color: PX.muted,
      });
    },
    'mieu-sat',
    { frames: 12, delayMs: 140, stillT: 0.6 },
  );
}
