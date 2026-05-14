/**
 * Cultivation-chronicler narration for rank breakthroughs (Phase 11.2 / A8).
 *
 * When a member crosses a cảnh giới boundary (Phàm Nhân → Luyện Khí,
 * Trúc Cơ → Kim Đan, etc.) we ask the narration LLM to compose a 1–2
 * sentence VN xianxia line celebrating it. The output slots into the
 * existing đột-phá embed in place of the static `rank.description` flavor.
 *
 * Caching: same (oldRank, newRank) pair within 5 minutes returns the
 * cached prose. Rank promotions are rare so the cache mostly serves as
 * a defensive guard against burst events (e.g. multiple users hitting
 * Trúc Cơ in the same hour during a /daily streak day).
 *
 * Cost: ~$0/promo on Groq Qwen 32B free tier. Fallback Gemini also free.
 */

import { rankById } from '../../config/cultivation.js';
import type { CultivationRankId } from '../../db/types.js';
import { llm } from '../llm/index.js';

const SYSTEM_PROMPT = `BẠN LÀ "Chronicler" — sử quan của tông môn Radiant Tech Sect, người ghi chép từng lần đệ tử đột phá cảnh giới. Phong cách: tiểu thuyết tu tiên Việt, trầm hùng, đề cao đạo tâm.

# Nhiệm vụ

Một đệ tử vừa đột phá lên cảnh giới mới. Bạn viết 1–2 câu chúc mừng + thuật lại khoảnh khắc đó theo phong cách xianxia VN.

# Phong cách BẮT BUỘC

- Tiếng Việt thuần, KHÔNG Hán tự (KHÔNG 弟子, KHÔNG 道, KHÔNG bất cứ chữ Trung nào).
- 1–2 câu, tổng cộng 100–240 ký tự. Có nhịp, có hình ảnh, không lan man.
- Tên đệ tử PHẢI xuất hiện đúng 1 lần, bao \`**...**\`. Tên cảnh giới mới PHẢI xuất hiện đúng 1 lần, bao \`**...**\`.
- Có thể chêm: "nội đan", "linh khí", "thiên kiếp", "đạo tâm", "phong vân", "vạn người kính ngưỡng", "chí lớn", "kiếm đạo", "đan đạo".
- KHÔNG dùng emoji ngoài (icon embed đã có). KHÔNG markdown phức tạp ngoài \`**bold**\`.

# Quy tắc cứng

1. Trả về CHỈ câu chuyện — KHÔNG JSON, KHÔNG markdown fence, KHÔNG prefix "Đây là...".
2. CHỈ 1–2 câu. KHÔNG xuống dòng.
3. KHÔNG nói tới "AI", "bot", "Discord", "channel", "level".
4. KHÔNG kết bằng câu hỏi.
5. Phải có cảm giác đột phá, không phải chỉ "chúc mừng".

# Ví dụ

Input: đệ tử "A" — đột phá "Luyện Khí" → "Trúc Cơ".
→ **A** đã tiến đến **Trúc Cơ kỳ**, đạo tâm vững như đá nền, vạn người kính ngưỡng — đường tu hành dài rộng, mong đạo hữu giữ chí lớn.

Input: đệ tử "B" — đột phá "Trúc Cơ" → "Kim Đan".
→ **B** vừa đột phá **Kim Đan kỳ**, nội đan thành hình giữa thiên kiếp — từ đây phong vân chiêu sinh chỉ trong tay áo.

Input: đệ tử "C" — đột phá "Phàm Nhân" → "Luyện Khí".
→ **C** lần đầu hấp thụ linh khí, bước vào **Luyện Khí kỳ** — chặng đường vạn dặm bắt đầu từ hơi thở đầu tiên.`;

interface CacheEntry {
  text: string;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache: Map<string, CacheEntry> = new Map();

function cacheKey(oldRank: CultivationRankId, newRank: CultivationRankId): string {
  return `${oldRank}:${newRank}`;
}

export interface RankNarrationInput {
  userDisplayName: string;
  oldRank: CultivationRankId;
  newRank: CultivationRankId;
}

/**
 * Generate a chronicler line for a rank promotion. Returns 1–2 sentence
 * VN prose with the user + rank names embedded. Falls back to a static
 * template on any LLM error.
 */
export async function narrateRankPromotion(input: RankNarrationInput): Promise<string> {
  const now = Date.now();
  const key = cacheKey(input.oldRank, input.newRank);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    // Swap the cached display name slot so a different user gets their
    // own name even from cached prose. We saved the template with the
    // first user's name; substitute it for this user.
    return cached.text.replace(/__USER__/g, input.userDisplayName);
  }

  const oldRankName = rankById(input.oldRank).name;
  const newRankName = rankById(input.newRank).name;

  const userPrompt = [
    `Đệ tử "__USER__" vừa đột phá từ "${oldRankName}" sang "${newRankName}".`,
    'Hãy viết lời chúc mừng theo phong cách chronicler đã quy định.',
  ].join(' ');

  const result = await llm.complete('narration', {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    maxOutputTokens: 220,
    temperature: 0.85,
    responseFormat: 'text',
  });

  let text: string;
  if (!result) {
    text = staticFallback(input.oldRank, input.newRank);
  } else {
    const cleaned = result.text.trim().replace(/^["'`]+|["'`]+$/g, '');
    text =
      cleaned && cleaned.length >= 30
        ? cleaned.replace(/\s*\n+\s*/g, ' ')
        : staticFallback(input.oldRank, input.newRank);
  }

  // Cache with the literal __USER__ marker so subsequent calls for the
  // same (oldRank, newRank) reuse the same prose with a different name.
  cache.set(key, { text, expiresAt: now + CACHE_TTL_MS });
  return text.replace(/__USER__/g, input.userDisplayName);
}

function staticFallback(oldRank: CultivationRankId, newRank: CultivationRankId): string {
  const newName = rankById(newRank).name;
  const oldName = rankById(oldRank).name;
  return `**__USER__** đã đột phá từ **${oldName}** lên **${newName}** — đạo tâm tăng tiến, đường tu càng vững.`;
}

export function clearCacheForTesting(): void {
  cache.clear();
}

export const __for_testing = {
  SYSTEM_PROMPT,
  cacheKey,
  CACHE_TTL_MS,
  cache,
  staticFallback,
};
