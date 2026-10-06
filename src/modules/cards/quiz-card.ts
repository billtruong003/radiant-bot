import { type Ctx, ensureFont, frame, label, panel, rect, text, wrap } from '../pixel/canvas.js';
import { rng } from '../pixel/fx.js';
import { type Rendered, renderPng } from '../pixel/output.js';
import { PX } from '../pixel/palette.js';

const LANG_NAME: Record<string, string> = {
  python: 'Python',
  csharp: 'C#',
  javascript: 'JavaScript',
};
export const LETTERS = ['A', 'B', 'C', 'D'] as const;

export interface QuizView {
  tierName: string;
  name: string;
  index: number;
  total: number;
  correctSoFar: number;
  seconds: number;
  prompt: string;
  code?: string;
  lang?: string;
  options: string[];
  /** Set after the answer: which option was picked (null = time ran out). */
  reveal?: { chosen: number | null; correct: number; explain: string };
}

/** Gusts of wind across the top band: the Phong Kiếp mark. */
function wind(ctx: Ctx, w: number, seed: number): void {
  const r = rng(seed);
  for (let i = 0; i < 26; i++) {
    const y = 8 + Math.floor(r() * 70);
    const x = Math.floor(r() * w);
    const len = 40 + Math.floor(r() * 120);
    rect(ctx, x, y, len, 3, '#7fd0d8', 0.12 + r() * 0.25);
  }
}

/**
 * One Phong Kiếp question (and, after the answer, the same card with the
 * right option lit and a one-line explanation).
 */
export async function renderQuizCard(q: QuizView): Promise<Rendered> {
  await ensureFont(); // wrap() measures before rendering starts
  const W = 960;
  const codeLines = q.code ? q.code.split('\n') : [];
  const codeH = codeLines.length ? 24 + codeLines.length * 26 : 0;
  const optLines = q.options.map((o) => wrap(null, o, 400, 22).slice(0, 2));
  const optH = Math.max(60, ...optLines.map((l) => 22 + l.length * 24));
  const explain = q.reveal ? wrap(null, q.reveal.explain, W - 80, 21).slice(0, 2) : [];
  const H =
    150 +
    codeH +
    (codeH ? 16 : 0) +
    2 * (optH + 12) +
    (q.reveal ? 46 + explain.length * 24 : 0) +
    20;
  return renderPng(
    W,
    H,
    (ctx) => {
      rect(ctx, 0, 0, W, H, '#121a22');
      wind(ctx, W, q.index * 7 + 3);
      label(ctx, `${q.tierName.toUpperCase()} · ${q.name}`, 24, 18, 20, '#7fd0d8');
      text(ctx, `Câu ${q.index}/${q.total}`, W - 24, 14, {
        size: 26,
        bold: true,
        color: PX.inkBright,
        align: 'right',
      });
      text(ctx, `Đúng ${q.correctSoFar} · ${q.seconds} giây mỗi câu`, W - 24, 44, {
        size: 19,
        color: PX.muted,
        align: 'right',
      });
      text(ctx, q.prompt, 24, 52, { size: 34, bold: true, color: PX.inkBright, maxWidth: 640 });
      let y = 110;
      if (codeLines.length) {
        panel(ctx, 24, y, W - 48, codeH, { fill: '#0b0f14', border: '#2a3a48' });
        if (q.lang) label(ctx, LANG_NAME[q.lang] ?? q.lang, W - 40 - 4, y + 6, 17, PX.faint);
        codeLines.forEach((l, i) => {
          text(ctx, l, 44, y + 12 + i * 26, { size: 24, color: '#cfe6d8' });
        });
        y += codeH + 16;
      }
      const cw = (W - 48 - 12) / 2;
      q.options.forEach((_, i) => {
        const x = 24 + (i % 2) * (cw + 12);
        const yy = y + Math.floor(i / 2) * (optH + 12);
        const r = q.reveal;
        const isRight = r && i === r.correct;
        const isWrongPick = r && r.chosen === i && i !== r.correct;
        const border = isRight ? PX.green : isWrongPick ? PX.red : '#2a3a48';
        panel(ctx, x, yy, cw, optH, {
          fill: isRight ? '#16301f' : isWrongPick ? '#341a1a' : '#18222c',
          border,
        });
        if (isRight || isWrongPick) frame(ctx, x, yy, cw, optH, border, 3);
        rect(ctx, x + 10, yy + 12, 34, 34, isRight ? PX.green : isWrongPick ? PX.red : '#2a3a48');
        text(ctx, LETTERS[i] ?? '?', x + 27, yy + 14, {
          size: 26,
          bold: true,
          color: PX.inkBright,
          align: 'center',
        });
        (optLines[i] ?? []).forEach((l, k) => {
          text(ctx, l, x + 56, yy + 14 + k * 24, { size: 22, color: PX.ink });
        });
      });
      y += 2 * (optH + 12);
      if (q.reveal) {
        const ok = q.reveal.chosen === q.reveal.correct;
        const head = q.reveal.chosen === null ? 'Hết giờ.' : ok ? 'Chính xác!' : 'Chưa đúng.';
        text(ctx, head, 24, y + 6, { size: 26, bold: true, color: ok ? PX.green : PX.red });
        explain.forEach((l, k) => {
          text(ctx, l, 24, y + 40 + k * 24, { size: 21, color: PX.inkSoft });
        });
      }
    },
    'phong-kiep',
  );
}
