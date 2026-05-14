import { type ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { publishApprovedDoc } from '../modules/docs/publish.js';
import { markContributionPublished, submitContribution } from '../modules/docs/validator.js';
import { logger } from '../utils/logger.js';

/**
 * /contribute-doc — Phase 12 Lát 9 + Phase 12.6/3 doc submission.
 *
 * User pastes title + body (and optional image); Aki validates via LLM,
 * classifies, and on approval auto-publishes as a public thread in
 * `#📚-docs-📚`. The thread starter is a themed embed with score,
 * difficulty, section, tags, author, and the optional image.
 *
 * Body capped at 4000 chars. Longer = paste a Hackmd/GitHub Gist link in
 * the body — the LLM is told to dereference. (Bot doesn't follow the URL
 * itself in v1; user must paste content directly.)
 *
 * Image is optional and must be a Discord-uploaded attachment. We don't
 * accept URLs to avoid SSRF / external CDN dependencies; rejecting `url`
 * input also keeps the surface narrow.
 */

const MAX_BODY = 4000;
const MAX_TITLE = 200;
const ALLOWED_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

export const data = new SlashCommandBuilder()
  .setName('contribute-doc')
  .setDescription('Đóng góp document/article — Aki tự duyệt + đăng thành thread')
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
  )
  .addAttachmentOption((opt) =>
    opt
      .setName('image')
      .setDescription('(Tuỳ chọn) Hình minh hoạ — png/jpeg/webp/gif')
      .setRequired(false),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const title = interaction.options.getString('title', true);
  const body = interaction.options.getString('body', true);
  const image = interaction.options.getAttachment('image');

  let imageUrl: string | null = null;
  if (image) {
    if (!image.contentType || !ALLOWED_IMAGE_MIMES.has(image.contentType)) {
      await interaction.reply({
        content: `⚠️ File đính kèm không hợp lệ — chỉ chấp nhận png/jpeg/webp/gif. (Got: \`${image.contentType ?? 'unknown'}\`)`,
        ephemeral: true,
      });
      return;
    }
    imageUrl = image.url;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const r = await submitContribution({
      authorId: interaction.user.id,
      title,
      body,
      source: 'slash',
      imageUrl,
    });

    if (r.decision === 'llm-failed') {
      await interaction.editReply({
        content:
          '⚠️ Aki không xử lý được lúc này (LLM router down). Bài viết đã lưu ở status pending — staff có thể duyệt thủ công sau.',
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

    // Approved — try to publish as a thread in #docs.
    const c = r.contribution;
    let publishLine = '';
    if (interaction.guild) {
      const publishResult = await publishApprovedDoc(
        interaction.guild,
        c,
        `<@${interaction.user.id}>`,
      );
      if (publishResult.status === 'published' && publishResult.threadId) {
        await markContributionPublished(c.id, publishResult.threadId);
        publishLine = `\n📖 Thread đã đăng: <#${publishResult.threadId}>`;
      } else {
        logger.warn(
          {
            contribution_id: c.id,
            publish_status: publishResult.status,
            detail: publishResult.detail,
          },
          'contribute-doc: publish skipped',
        );
        publishLine = `\n⚠️ Aki duyệt rồi nhưng auto-publish bị skip (\`${publishResult.status}\`). Staff có thể republish thủ công.`;
      }
    }

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
          publishLine,
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
