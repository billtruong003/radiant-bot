import { type Attachment, type ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { getBudgetStatus, isBudgetExhausted } from '../modules/aki/budget.js';
import { askAki, isAkiEnabled, logRefusal } from '../modules/aki/client.js';
import { tryAcquireAskQuota } from '../modules/aki/rate-limit.js';
import { logger } from '../utils/logger.js';

/**
 * /ask <question> [image?] — call Aki (Grok 4.1 Fast Reasoning).
 *
 * Gating, in order:
 *   1. Service enabled (XAI_API_KEY set) → else "Aki đang ngủ"
 *   2. Question length < 500 chars (Discord option max anyway)
 *   3. Image (optional): image/* + ≤ 10MB
 *   4. Per-user quota: ~5/min, ~50/day
 *   5. Daily budget not exhausted (server-wide cost cap)
 *   6. Call → reply (truncated to Discord 2000 char limit if needed)
 *
 * All refusals log to AkiCallLog (refusal=true) for analytics.
 */

const MAX_QUESTION_LEN = 500;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
const DISCORD_MSG_LIMIT = 2000;

export const data = new SlashCommandBuilder()
  .setName('ask')
  .setDescription('Hỏi Aki (hầu gái của tông môn) — Aki dùng Grok 4.1 Fast Reasoning')
  .setDMPermission(false)
  .addStringOption((opt) =>
    opt
      .setName('question')
      .setDescription('Câu hỏi của bạn (Aki nói tiếng Việt là chính)')
      .setRequired(true)
      .setMaxLength(MAX_QUESTION_LEN),
  )
  .addAttachmentOption((opt) =>
    opt.setName('image').setDescription('(Tùy chọn) Hình ảnh đính kèm — JPG/PNG/WebP ≤ 10MB'),
  );

function validateImage(
  att: Attachment | null,
): { ok: true; url?: string } | { ok: false; reason: string } {
  if (!att) return { ok: true };
  const type = (att.contentType ?? '').toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.includes(type)) {
    return {
      ok: false,
      reason: `Aki chỉ đọc được JPG/PNG/WebP thôi nha (¬_¬), không phải \`${type || 'unknown'}\``,
    };
  }
  if (att.size > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      reason: `Ảnh to quá ${(att.size / 1024 / 1024).toFixed(1)}MB — Aki chỉ xử được ≤ 10MB (；⌣́_⌣́)`,
    };
  }
  return { ok: true, url: att.url };
}

function chunkForDiscord(text: string): string[] {
  if (text.length <= DISCORD_MSG_LIMIT) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > DISCORD_MSG_LIMIT) {
    // Try to split on a paragraph or sentence boundary near the limit.
    let cut = remaining.lastIndexOf('\n\n', DISCORD_MSG_LIMIT);
    if (cut < DISCORD_MSG_LIMIT * 0.5) cut = remaining.lastIndexOf('. ', DISCORD_MSG_LIMIT);
    if (cut < DISCORD_MSG_LIMIT * 0.5) cut = DISCORD_MSG_LIMIT;
    chunks.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const question = interaction.options.getString('question', true);
  const image = interaction.options.getAttachment('image');
  const userId = interaction.user.id;

  // 1. Service enabled?
  if (!isAkiEnabled()) {
    await interaction.reply({
      content: '🌙 Aki đang ngủ... (chủ nhân Bill chưa setup API key)',
      ephemeral: true,
    });
    return;
  }

  // 2. Image validation
  const imgCheck = validateImage(image);
  if (!imgCheck.ok) {
    await logRefusal(userId, question.length, `image: ${imgCheck.reason}`);
    await interaction.reply({ content: `⚠️ ${imgCheck.reason}`, ephemeral: true });
    return;
  }

  // 3. Quota check (count-based, queries akiLogs over sliding window)
  const quota = tryAcquireAskQuota(userId);
  if (!quota.ok) {
    const msg =
      quota.reason === 'minute'
        ? `⏱️ Tiền bối hỏi Aki nhanh quá rồi (${quota.callsThisMinute} câu trong 1 phút), đợi 1 chút (◕‿◕) — Aki cũng cần thở mà.`
        : `😴 Aki phục vụ tiền bối đủ rồi hôm nay (${quota.callsThisDay}/100 lượt/24h). Mai lại nha ٩(◕‿◕)۶`;
    await logRefusal(userId, question.length, `rate-limit: ${quota.reason}`);
    await interaction.reply({ content: msg, ephemeral: true });
    return;
  }

  // 4. Budget check
  if (isBudgetExhausted()) {
    const status = getBudgetStatus();
    await logRefusal(userId, question.length, 'budget-exhausted');
    await interaction.reply({
      content: `💸 Aki hết ngân sách hôm nay rồi (đã xài $${status.todaySpent.toFixed(3)} / $${status.budget}). Mai lại nha — chủ nhân Bill cấp limit để Aki khỏi quá tải ٩(◕‿◕)۶`,
      ephemeral: true,
    });
    return;
  }

  // 5. Defer (Grok call takes 2-10s)
  await interaction.deferReply();

  // 6. Call
  try {
    const result = await askAki({
      discordId: userId,
      question,
      imageUrl: imgCheck.url,
    });

    const chunks = chunkForDiscord(result.reply);
    await interaction.editReply({ content: chunks[0] });
    for (let i = 1; i < chunks.length; i++) {
      await interaction.followUp({ content: chunks[i], ephemeral: false });
    }
  } catch (err) {
    logger.error({ err, discord_id: userId }, 'ask: Grok call failed');
    await interaction
      .editReply({
        content: '😵 Aki gặp lỗi gọi Grok... thử lại sau vài phút nhé (；⌣́_⌣́)',
      })
      .catch(() => undefined);
  }
}

export const command = { data, execute };
export default command;
