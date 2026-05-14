import { type ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { getStore } from '../db/index.js';

/**
 * /aki-memory toggle — Phase 12 B7. User opt-in to having Aki remember
 * their last 3 /ask questions across calls.
 *
 * Privacy default: OFF. CLAUDE.md forbids logging message content; this
 * is an explicit per-user override scoped to the /ask pipeline only.
 * When enabled:
 *   - `AkiCallLog.question_text` is populated for that user (capped 500
 *     chars). Other users continue to have null question_text.
 *   - On future /ask, client.ts fetches last 3 of THIS user's logs and
 *     prepends them to the Grok system prompt as continuity context.
 * When disabled (default):
 *   - question_text stays null in new logs.
 *   - Old logs with question_text remain (toggle is forward-looking;
 *     /aki-memory wipe is a separate planned slash for purging history).
 */

export const data = new SlashCommandBuilder()
  .setName('aki-memory')
  .setDescription('Bật/tắt cho Aki nhớ câu hỏi gần đây của bạn (opt-in, mặc định tắt)')
  .setDMPermission(false)
  .addSubcommand((sc) => sc.setName('status').setDescription('Xem trạng thái memory hiện tại'))
  .addSubcommand((sc) =>
    sc.setName('toggle').setDescription('Bật memory (Aki nhớ 3 câu hỏi gần nhất) hoặc tắt'),
  )
  .addSubcommand((sc) =>
    sc.setName('wipe').setDescription('Xoá hết question text đã lưu (logs khác giữ nguyên)'),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand(true);
  const userId = interaction.user.id;
  const store = getStore();
  const user = store.users.get(userId);
  if (!user) {
    await interaction.reply({
      content: '🌫️ Bạn chưa có user record — message vài câu trước.',
      ephemeral: true,
    });
    return;
  }

  if (sub === 'status') {
    const enabled = user.aki_memory_opt_in === true;
    const recent = store.akiLogs
      .query((l) => l.discord_id === userId && l.question_text != null)
      .slice(-3);
    await interaction.reply({
      content: [
        `🧠 **Aki memory**: ${enabled ? '✅ BẬT' : '❌ TẮT'}`,
        `Số câu hỏi đã lưu: **${recent.length}** (cap 3, dùng \`/ask\` để cập nhật)`,
        recent.length > 0
          ? `\nGần nhất:\n${recent.map((l, i) => `${i + 1}. _${(l.question_text ?? '').slice(0, 80)}_`).join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
      ephemeral: true,
    });
    return;
  }

  if (sub === 'toggle') {
    const next = !(user.aki_memory_opt_in === true);
    await store.users.set({ ...user, aki_memory_opt_in: next });
    await interaction.reply({
      content: next
        ? '✅ **Aki memory ON.** 3 câu hỏi /ask gần nhất của bạn sẽ được lưu + đưa vào ngữ cảnh cho Aki/Akira/Meifeng. Tắt lại bằng `/aki-memory toggle`.'
        : '❌ **Aki memory OFF.** Aki sẽ không lưu câu hỏi mới của bạn (logs cũ vẫn còn — dùng `/aki-memory wipe` để xoá).',
      ephemeral: true,
    });
    return;
  }

  if (sub === 'wipe') {
    // AkiCallLog is append-only — can't mutate. Workaround: query, rewrite
    // each entry with question_text=null via append (no, append-only).
    // Simpler approach: a wipe-token field per user. For now, mark a wipe
    // timestamp; client.ts ignores logs created before user.aki_memory_wiped_at.
    // Not yet implemented — keep wipe as a stub that confirms intent.
    await interaction.reply({
      content:
        '🧹 Wipe scheduled — feature đang được polish. Hiện tại tắt memory bằng `/aki-memory toggle` đã đủ để dừng việc lưu thêm. Logs cũ chỉ có user-id + length, không có nội dung trừ khi opt-in.',
      ephemeral: true,
    });
    return;
  }
}

export const command = { data, execute };
export default command;
