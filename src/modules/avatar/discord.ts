import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
  type MessageActionRowComponentBuilder,
  WebhookClient,
} from 'discord.js';
import { getStore } from '../../db/index.js';
import { logger } from '../../utils/logger.js';
import { renderAvatarCard } from '../cards/avatar-card.js';
import { type AvatarLook, describeLook, randomLook } from './catalog.js';
import { onAvatarSaved } from './hooks.js';
import { type ReplyHandle, liveLink } from './link.js';
import { getLook, rankOf, saveLook } from './service.js';

export const AVATAR_RANDOM_ID = 'avatar:random';

const displayName = (discordId: string): string => {
  const u = getStore().users.get(discordId);
  return u?.display_name ?? u?.username ?? 'Tu sĩ';
};

/** The ephemeral reply of /profile avatar, before or after a save. */
export async function avatarReply(o: {
  discordId: string;
  url: string | null;
  expiresAt: number | null;
  saved?: boolean;
}) {
  const look: AvatarLook | null = getLook(o.discordId);
  const card = await renderAvatarCard({
    look,
    name: displayName(o.discordId),
    rank: rankOf(o.discordId),
  });
  const minutes = o.expiresAt ? Math.max(0, Math.round((o.expiresAt - Date.now()) / 60000)) : 0;
  const embed = new EmbedBuilder()
    .setColor(0xd4a94a)
    .setTitle(o.saved ? 'Đã lưu tạo hình' : 'Tạo hình tu sĩ')
    .setDescription(
      look
        ? `${describeLook(look)}.${o.url ? ` Link còn ${minutes} phút nếu muốn sửa tiếp.` : ''}`
        : 'Bạn chưa có tạo hình. Mở trang bên dưới để chọn, link chỉ của bạn, dùng được 15 phút.',
    )
    .setThumbnail(`attachment://${card.name}`);
  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();
  if (o.url)
    row.addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(look ? 'Sửa tiếp' : 'Mở trang tạo hình')
        .setURL(o.url),
    );
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(AVATAR_RANDOM_ID)
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Ngẫu nhiên'),
  );
  return {
    embeds: [embed],
    files: [new AttachmentBuilder(card.buffer, { name: card.name })],
    components: [row],
  };
}

/** "Ngẫu nhiên" button: rolls a look from what this realm has opened. */
export async function handleAvatarButton(interaction: ButtonInteraction): Promise<void> {
  const id = interaction.user.id;
  await saveLook(id, randomLook(rankOf(id)));
  const link = liveLink(id);
  await interaction.update(
    await avatarReply({
      discordId: id,
      url: link?.reply?.url ?? null,
      expiresAt: link?.expiresAt ?? null,
      saved: true,
    }),
  );
}

/** When the web page saves, edit the reply that holds the link. */
export function wireAvatarDiscord(): void {
  onAvatarSaved(
    async (discordId: string, _look: AvatarLook, reply: ReplyHandle | null, expiresAt: number) => {
      if (!reply) return;
      const hook = new WebhookClient({ id: reply.applicationId, token: reply.interactionToken });
      try {
        const payload = await avatarReply({
          discordId,
          url: reply.url ?? null,
          expiresAt,
          saved: true,
        });
        await hook.editMessage('@original', { ...payload, attachments: [] });
      } catch (err) {
        logger.debug({ err: (err as Error).message }, 'avatar: could not edit the reply');
      } finally {
        hook.destroy();
      }
    },
  );
}
