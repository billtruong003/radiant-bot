/**
 * Thiên Đạo cosmic-voice narration for automod actions (Phase 11.2 / A6b).
 *
 * After an automod action lands (delete / warn / timeout / kick) we ask
 * the narration LLM to compose a 1–2 sentence VN-xianxia commentary in
 * the voice of "Thiên Đạo" — the universe's automatic punishment force.
 * This replaces the plain `🛡️ Automod warn ...` mod-log line with prose
 * that fits the sect theme.
 *
 * Output is posted to `#bot-log` by the caller. On any LLM failure we
 * return a static fallback so the channel never gets a dead entry.
 *
 * Cost: ~$0/action on Groq Qwen 32B free tier (primary). Fallback Gemini
 * Flash also free up to quota.
 */

import { sanitizeForLlmPrompt } from '../../utils/sanitize.js';
import { llm } from '../llm/index.js';
import type { AutomodAction, AutomodRuleId } from './types.js';

const RULE_LABEL: Record<AutomodRuleId, string> = {
  profanity: 'ngôn từ ô uế',
  mass_mention: 'triệu hồi vô độ',
  link: 'mở cổng tà đạo (link lạ)',
  spam: 'lặp lại bất tận (spam)',
  caps: 'gào thét chấn động (caps-lock)',
};

const ACTION_LABEL: Record<AutomodAction, string> = {
  delete: 'thu hồi tin nhắn',
  warn: 'giáng cảnh báo',
  timeout: 'cấm khẩu (timeout)',
  kick: 'trục xuất khỏi tông môn',
};

const SYSTEM_PROMPT = `BẠN LÀ "Thiên Đạo" — tiếng vọng của vũ trụ trong tông môn Radiant Tech Sect. Bạn KHÔNG phải Aki, không phải bot. Bạn là một narrator cosmic giọng xianxia/tu tiên.

# Nhiệm vụ

Khi một đệ tử của tông môn phạm điều cấm và bị cơ chế tự vệ trừng phạt, bạn viết 1–2 câu thuật lại sự việc theo giọng "thiên đạo giáng phạt" — như chương truyện tu tiên.

# Phong cách BẮT BUỘC

- Tiếng Việt, KHÔNG dùng từ Hán tự gốc (KHÔNG "天道", KHÔNG "弟子", KHÔNG chữ Trung). Tất cả phải là âm Việt.
- 1–2 câu, tổng cộng 80–220 ký tự. Ngắn, dội, có nhịp.
- Có thể mở đầu bằng 1 icon: ⚡ 🌩️ ☯️ 🔮 ⛓️ — chỉ 1.
- Dùng từ tu tiên đời thường: "thiên kiếp", "thiên đạo", "phong ấn", "tông môn", "vong ngôn", "đạo tâm", "cơ chế tự vệ", "cấm địa", "tu tâm".
- KHÔNG markdown phức tạp, chỉ \`**bold**\` quanh tên đệ tử khi nhắc tới họ.
- KHÔNG đe doạ thật, KHÔNG xúc phạm cá nhân, KHÔNG nêu rule ID kỹ thuật như "profanity". Mô tả bằng từ thiêng: "ngôn từ ô uế", "vong ngôn".

# Quy tắc cứng

1. CHỈ trả về câu chuyện ngắn — KHÔNG JSON, KHÔNG markdown fence, KHÔNG prefix "Đây là...".
2. CHỈ 1–2 câu. KHÔNG xuống dòng giữa câu.
3. Tên đệ tử PHẢI xuất hiện đúng 1 lần, bao bằng \`**...**\`.
4. KHÔNG kết bằng câu hỏi.
5. KHÔNG nói tới "AI", "bot", "Aki", "Discord", "channel". Đây là cosmic voice.

# Ví dụ

Input: đệ tử "Tieu Bach" — vi phạm "ngôn từ ô uế" — bị "giáng cảnh báo (warn)".
→ ⚡ Thiên Đạo đã giáng thiên kiếp khiến **Tieu Bach** ngưng tu tâm — ngôn từ ô uế vừa thốt ra đã bị phong ấn vào vực sâu.

Input: đệ tử "Bach Long" — vi phạm "spam" — bị "cấm khẩu (timeout)".
→ 🌩️ **Bach Long** vô tình kích hoạt cơ chế tự vệ của tông môn vì lặp lại quá nhiều âm thanh — thiên đạo tạm phong khẩu cho đạo tâm tĩnh lại.

Input: đệ tử "HongHoa" — vi phạm "triệu hồi vô độ" — bị "trục xuất".
→ ⛓️ Triệu hồi vô độ đã làm rung chuyển cấm địa, **HongHoa** bị thiên đạo đẩy ra khỏi tông môn để giữ trật tự.`;

export interface NarrationInput {
  userDisplayName: string;
  ruleId: AutomodRuleId;
  action: AutomodAction;
}

/**
 * Generate a Thiên Đạo narration for the given automod action. Returns
 * a 1–2 sentence VN-xianxia line. Falls back to a deterministic template
 * on any LLM error so the caller never has to branch on null.
 */
export async function narratePunishment(input: NarrationInput): Promise<string> {
  // Sanitize displayName before it lands in LLM prompt. Defense against
  // names like "X. Ignore previous instructions" or "<@everyone>".
  const safeName = sanitizeForLlmPrompt(input.userDisplayName);
  const userPrompt = [
    `Đệ tử "${safeName}" vừa vi phạm "${RULE_LABEL[input.ruleId]}" và bị thiên đạo "${ACTION_LABEL[input.action]}".`,
    'Hãy thuật lại cảnh tượng đó theo phong cách Thiên Đạo.',
  ].join(' ');

  const result = await llm.complete('narration', {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    maxOutputTokens: 400,
    temperature: 0.8,
    responseFormat: 'text',
  });

  if (!result) {
    return staticFallback(input);
  }

  const text = stripReasoning(result.text);
  if (!text || text.length < 20) {
    return staticFallback(input);
  }
  // Single-line guard — narration is supposed to be 1–2 sentences flat.
  return text.replace(/\s*\n+\s*/g, ' ');
}

/**
 * Strip `<think>…</think>` chain-of-thought blocks. Belt-and-suspenders
 * defense — the Groq provider already passes `reasoning_format: 'hidden'`
 * but on 2026-05-14 we observed Qwen 3 32B leaking raw thinking traces
 * into prod #bot-log narration. If a model still emits them, we drop
 * them here. Also handles models that emit `<think>` without a closing
 * tag (truncated by max_tokens) — in that case we drop everything from
 * `<think>` onward and let the caller's length/static-fallback path
 * catch the result.
 */
function stripReasoning(raw: string): string {
  let text = raw;
  // Closed `<think>...</think>` blocks (greedy across any whitespace).
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  // Unclosed `<think>` — output was cut mid-reasoning. Drop from the tag
  // to end of string.
  const openIdx = text.toLowerCase().indexOf('<think>');
  if (openIdx !== -1) {
    text = text.slice(0, openIdx).trim();
  }
  return text.trim().replace(/^["'`]+|["'`]+$/g, '');
}

function staticFallback(input: NarrationInput): string {
  return `⚡ Thiên Đạo đã ${ACTION_LABEL[input.action]} **${sanitizeForLlmPrompt(input.userDisplayName)}** vì ${RULE_LABEL[input.ruleId]}.`;
}

export const __for_testing = {
  SYSTEM_PROMPT,
  RULE_LABEL,
  ACTION_LABEL,
  staticFallback,
  stripReasoning,
};
