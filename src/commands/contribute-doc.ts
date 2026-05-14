import { type ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { submitContribution } from '../modules/docs/validator.js';

/**
 * /contribute-doc — Phase 12 Lát 9 doc submission.
 *
 * User pastes title + body; Aki validates via LLM, classifies, and either
 * approves (publish path — currently shown inline; forum thread publish
 * is a follow-up wiring) or rejects with reason.
 *
 * Body capped at 4000 chars. Longer = paste a Hackmd/GitHub Gist link in
 * the body — the LLM will be told to dereference. (Bot doesn't follow
 * the URL itself in v1; user must paste content directly.)
 */

const MAX_BODY = 4000;
const MAX_TITLE = 200;

export const data = new SlashCommandBuilder()
  .setName('contribute-doc')
  .setDescription('Đóng góp document/article — Aki tự duyệt + tag')
  .setDMPermission(false)
  .addStringOption((opt) =>
    opt
      .setName('title')
      .setDescription('Tiêu đề ngắn gọn')
      .setRequired(true)
      .setMaxLength(MAX_TITLE),
  )
  .addStringOption((opt) =>
    opt
      .setName('body')
      .setDescription('Nội dung (≤ 4000 chars; paste link Hackmd nếu dài hơn)')
      .setRequired(true)
      .setMaxLength(MAX_BODY),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const title = interaction.options.getString('title', true);
  const body = interaction.options.getString('body', true);

  await interaction.deferReply({ ephemeral: true });

  try {
    const r = await submitContribution({
      authorId: interaction.user.id,
      title,
      body,
      source: 'slash',
    });

    if (r.decision === 'llm-failed') {
      await interaction.editReply({
        content:
          '⚠️ Aki không xử lý được lúc này (LLM router down). Bài viết đã lưu ở status pending — staff có thể duyệt thủ công sau qua `/doc-override`.',
      });
      return;
    }

    if (r.decision === 'rejected') {
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('❌ Bài viết chưa được duyệt')
        .setDescription(
          [
            `**Tiêu đề**: ${r.contribution.title}`,
            `**Điểm tổng**: ${r.contribution.score}/100 (ngưỡng 60)`,
            '',
            `**Lý do**: ${r.contribution.rejection_reason ?? 'Không đạt ngưỡng chất lượng.'}`,
            '',
            '💡 Sửa lại + submit lần nữa nha.',
          ].join('\n'),
        );
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Approved — show classification + acknowledge publish.
    const c = r.contribution;
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('✅ Bài viết được duyệt!')
      .setDescription(
        [
          `**${c.title}**`,
          '',
          `📊 **Điểm**: ${c.score}/100`,
          `🎯 **Độ khó**: ${c.difficulty}`,
          `📂 **Section**: ${c.section}`,
          `🏷️ **Tags**: ${c.tags.map((t) => `\`${t}\``).join(' ')}`,
          '',
          '_Nội dung sẽ xuất hiện ở forum docs/resources (cấu hình forum channel + auto-publish: roadmap)._',
        ].join('\n'),
      )
      .setFooter({ text: `contribution_id: ${c.id}` });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    await interaction.editReply({
      content: `⚠️ Lỗi xử lý: ${(err as Error).message ?? 'unknown'}`,
    });
  }
}

export const command = { data, execute };
export default command;
