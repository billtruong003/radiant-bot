import type { AvatarLook } from '../avatar/catalog.js';
import { type Ctx, label, panel, rect, text } from '../pixel/canvas.js';
import { drawCharacterOnGround } from '../pixel/character.js';
import {
  lightning,
  particles,
  pillar,
  rays,
  rings,
  screenFlash,
  shards,
  stormClouds,
} from '../pixel/fx.js';
import { drawIcon } from '../pixel/icons.js';
import { type Rendered, renderGif } from '../pixel/output.js';
import { PX } from '../pixel/palette.js';
import { fmt } from './profile-data.js';

const W = 960;
const H = 440;
const GROUND = 380;
const CX = 220;

function sky(ctx: Ctx, t: number, calm = false): void {
  rect(ctx, 0, 0, W, H, calm ? '#1b1a2c' : '#12142a');
  stormClouds(ctx, W, t, calm ? '#2e2c48' : '#262b52', calm ? '#45406a' : '#3a4a7a', 5, 80);
  rect(ctx, 0, GROUND, W, H - GROUND, '#17151f');
  rect(ctx, 0, GROUND - 4, W, 4, PX.lineDim);
}

/** Lôi Kiếp opens: storm overhead, bolts walking in, the question posted. */
export function renderTribulationIntro(o: {
  name: string;
  look: AvatarLook | null;
  rankName: string;
  /** Math question, or null for the reaction game. */
  question: string | null;
  seconds: number;
  passXp: number;
  failXp: number;
}): Promise<Rendered> {
  return renderGif(
    W,
    H,
    async (ctx, t) => {
      sky(ctx, t);
      lightning(ctx, CX - 130, 40, GROUND, t, { seed: 3, phase: 0 });
      lightning(ctx, CX + 140, 40, GROUND, t, { seed: 8, phase: 0.5 });
      screenFlash(ctx, W, H, t);
      await drawCharacterOnGround(ctx, o.look, CX, GROUND, 5);
      label(ctx, `THIÊN KIẾP · ${o.rankName.toUpperCase()}`, 440, 96, 22, '#9fb8ff');
      text(ctx, o.name, 440, 120, { size: 40, bold: true, color: PX.inkBright, maxWidth: 500 });
      panel(ctx, 440, 176, 496, 120, { fill: '#0e1022', border: '#3a4a7a', t: 3 });
      if (o.question) {
        label(ctx, 'Giải bài toán', 460, 186, 20, PX.muted);
        text(ctx, o.question, 688, 214, {
          size: 56,
          bold: true,
          color: PX.white,
          align: 'center',
          maxWidth: 460,
        });
      } else {
        label(ctx, 'Phản xạ', 460, 186, 20, PX.muted);
        text(ctx, 'Bấm Thiên Long trong đám', 460, 216, { size: 28, bold: true, color: PX.white });
        text(ctx, 'yêu thú trước khi sét đánh!', 460, 248, {
          size: 28,
          bold: true,
          color: PX.white,
        });
      }
      text(ctx, `${o.seconds} giây`, 440, 310, { size: 26, bold: true, color: PX.goldBright });
      text(ctx, `Qua: +${fmt(o.passXp)} XP, +5 đan · Trượt: -${fmt(o.failXp)} XP`, 440, 342, {
        size: 21,
        color: PX.muted,
      });
    },
    'loi-kiep',
    { frames: 12, delayMs: 120, stillT: 0.12 },
  );
}

/** The bolt lands. Pass: a golden pillar and the breakthrough. Fail: ash. */
export function renderTribulationOutcome(o: {
  name: string;
  look: AvatarLook | null;
  /** e.g. "Phong Kiếp"; defaults to the generic Thiên Kiếp label. */
  tierName?: string;
  outcome: 'pass' | 'fail' | 'timeout';
  xpDelta: number;
  pills: number;
}): Promise<Rendered> {
  const pass = o.outcome === 'pass';
  return renderGif(
    W,
    H,
    async (ctx, t) => {
      sky(ctx, t, pass);
      // Every outcome opens with the strike; what is left after it differs.
      lightning(ctx, CX, 30, GROUND - 120, t, {
        seed: 11,
        s: 6,
        forks: 4,
        color: pass ? '#ffe8a0' : '#9fb8ff',
      });
      screenFlash(ctx, W, H, t, pass ? '#fff2c0' : '#cfe0ff');
      if (pass) {
        pillar(ctx, CX, 0, GROUND, PX.goldBright, t, 120);
        rays(ctx, CX, GROUND - 120, PX.goldBright, t, {
          n: 18,
          length: 280,
          width: 5,
          alpha: 0.22,
          inner: 70,
        });
        rings(ctx, CX, GROUND - 120, PX.goldBright, t, { n: 3, step: 30, start: 80 });
        particles(ctx, 21, 30, CX - 160, 80, 320, 300, [PX.goldBright, PX.white], t);
        await drawCharacterOnGround(ctx, o.look, CX, GROUND, 5);
      } else {
        await drawCharacterOnGround(ctx, o.look, CX, GROUND, 5, { alpha: 0.55 });
        shards(ctx, [
          [CX - 80, GROUND - 60, '#5a5a6a'],
          [CX + 70, GROUND - 90, '#9fb8ff'],
          [CX + 40, GROUND - 30, '#5a5a6a'],
        ]);
        particles(ctx, 23, 18, CX - 100, GROUND - 200, 200, 200, ['#5a5a6a', '#3a3a48'], t);
      }
      label(
        ctx,
        (o.tierName ?? 'Thiên Kiếp').toUpperCase(),
        440,
        96,
        22,
        pass ? PX.goldBright : '#9fb8ff',
      );
      text(
        ctx,
        pass
          ? 'Đột phá thành công'
          : o.outcome === 'timeout'
            ? 'Không kịp trở tay'
            : 'Bị lôi kiếp đánh lui',
        440,
        120,
        { size: 48, bold: true, color: pass ? PX.goldBright : PX.red, maxWidth: 500 },
      );
      text(ctx, o.name, 440, 180, { size: 28, color: PX.inkBright, maxWidth: 500 });
      const sign = o.xpDelta >= 0 ? '+' : '';
      const w = text(ctx, `${sign}${fmt(o.xpDelta)} XP`, 440, 236, {
        size: 36,
        bold: true,
        color: pass ? PX.greenSoft : PX.red,
      });
      if (o.pills) {
        await drawIcon(ctx, 'pill32', 440 + w + 20, 240, 32);
        text(ctx, `+${o.pills}`, 440 + w + 58, 238, { size: 30, color: PX.inkBright });
      }
      text(
        ctx,
        pass
          ? 'Tu vi tiến một bước, cảnh giới rộng mở.'
          : 'Thiên đạo vô tình. XP không rơi dưới ngưỡng cảnh giới.',
        440,
        300,
        { size: 22, color: PX.muted, maxWidth: 500 },
      );
    },
    'ket-qua-kiep',
    { frames: 12, delayMs: 120, stillT: 0.2 },
  );
}
