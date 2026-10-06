import { type ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { env } from '../config/env.js';
import { avatarReply } from '../modules/avatar/discord.js';
import { type ReplyHandle, createAvatarLink } from '../modules/avatar/link.js';
import { webSecret } from '../modules/avatar/web.js';

/**
 * /profile avatar — private link to the web customizer. Saving there edits
 * this reply, so the player sees the new look without leaving Discord.
 */

export const data = new SlashCommandBuilder()
  .setName('avatar')
  .setDescription('Tạo hình nhân vật tu sĩ trên web (link riêng 15 phút)')
  .setDMPermission(false);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!env.PUBLIC_BASE_URL || !webSecret()) {
    await interaction.reply({
      content: '⚙️ Trang tạo hình chưa được bật trên server này. Báo admin nhé.',
      ephemeral: true,
    });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const reply: ReplyHandle = {
    applicationId: interaction.applicationId,
    interactionToken: interaction.token,
  };
  const { token, expiresAt } = createAvatarLink(interaction.user.id, webSecret(), reply);
  const url = `${env.PUBLIC_BASE_URL}/avatar?t=${encodeURIComponent(token)}`;
  // The live link keeps this same object, so a save can rebuild the same buttons.
  reply.url = url;
  await interaction.editReply(
    await avatarReply({ discordId: interaction.user.id, url, expiresAt }),
  );
}

export const command = { data, execute };
export default command;
