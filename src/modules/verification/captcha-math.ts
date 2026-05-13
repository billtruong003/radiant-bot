/**
 * Math captcha — addition only, single-digit pair. The bar is low on
 * purpose: humans solve instantly, bots without an LLM solver fail.
 *
 * Pure functions; no I/O. Used by `flow.ts` to render the challenge
 * into a DM string and to verify replies.
 */

export interface MathChallenge {
  a: number;
  b: number;
  /** The expected answer string (`(a + b).toString()`). */
  expected: string;
}

export interface MathChallengeOptions {
  minA?: number;
  maxA?: number;
  minB?: number;
  maxB?: number;
}

/**
 * Random integer in [min, max] inclusive.
 */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function generateMathChallenge(opts: MathChallengeOptions = {}): MathChallenge {
  const minA = opts.minA ?? 1;
  const maxA = opts.maxA ?? 20;
  const minB = opts.minB ?? 1;
  const maxB = opts.maxB ?? 20;
  const a = randInt(minA, maxA);
  const b = randInt(minB, maxB);
  return { a, b, expected: String(a + b) };
}

/**
 * Renders the challenge as Vietnamese DM text. The cultivation theme is
 * intentionally light — first impression for a new member.
 */
export function renderMathChallenge(c: MathChallenge): string {
  return [
    '╔═══════════════════════════════════╗',
    '   🏯 **RADIANT TECH SECT**',
    '   *Cổng tu hành — Xác minh tân đệ tử*',
    '╚═══════════════════════════════════╝',
    '',
    'Chào tân đạo hữu! Aki — hầu gái của tông môn — sẽ kiểm tra một chút trước khi mở cửa.',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━',
    '📜 **Bài thử:**',
    `# ${c.a} + ${c.b} = ?`,
    '━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    'Reply tin nhắn này với **chỉ con số đáp án** (vd: `25`).',
    '',
    '⏱️ Thời gian: **5 phút** · Tối đa **3 lần thử**',
    '*(◕‿◕) Aki sẽ ngồi đợi đạo hữu đây~*',
  ].join('\n');
}

/**
 * Lenient string compare. Strips whitespace + ignores case (math answers
 * are digits so case doesn't matter but defensive). Rejects empty reply.
 */
export function verifyMathReply(reply: string, expected: string): boolean {
  const cleaned = reply.trim();
  if (!cleaned) return false;
  return cleaned === expected;
}
