import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type GuildMember,
  SlashCommandBuilder,
} from 'discord.js';
import { SUB_TITLES } from '../config/cultivation.js';
import { logger } from '../utils/logger.js';

/**
 * /title <subcommand> — slash-command alternative to the reaction-role
 * picker in `#leveling-guide`. Supports:
 *   - /title add <name>     : grant a sub-title role to yourself
 *   - /title remove <name>  : drop a sub-title role you currently have
 *   - /title list           : show available sub-titles + which you have
 *
 * Available choices are auto-generated from `SUB_TITLES` in
 * config/cultivation.ts so adding a new sub-title there exposes it here
 * without editing this file.
 */

const CHOICES = SUB_TITLES.map((s) => ({ name: `${s.emoji} ${s.name}`, value: s.name }));

export const data = new SlashCommandBuilder()
  .setName('title')
  .setDescription('Quản lý sub-title (phong hiệu) của bạn')
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName('add')
      .setDescription('Nhận sub-title')
      .addStringOption((opt) =>
        opt
          .setName('name')
          .setDescription('Sub-title cần nhận')
          .setRequired(true)
          .addChoices(...CHOICES),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('remove')
      .setDescription('Bỏ sub-title')
      .addStringOption((opt) =>
        opt
          .setName('name')
          .setDescription('Sub-title cần bỏ')
          .setRequired(true)
          .addChoices(...CHOICES),
      ),
  )
  .addSubcommand((sub) => sub.setName('list').setDescription('Xem các sub-title hiện có'));

async function handleAdd(
  interaction: ChatInputCommandInteraction,
  member: GuildMember,
  name: string,
): Promise<void> {
  const role = member.guild.roles.cache.find((r) => r.name === name);
  if (!role) {
    await interaction.reply({
      content: `⚠️ Role **${name}** không tồn tại — chạy \`sync-server\` để tạo.`,
      ephemeral: true,
    });
    return;
  }
  if (member.roles.cache.has(role.id)) {
    await interaction.reply({
      content: `Bạn đã có sub-title **${name}** rồi.`,
      ephemeral: true,
    });
    return;
  }
  try {
    await member.roles.add(role, `/title add ${name}`);
    await interaction.reply({
      content: `✅ Đã nhận sub-title **${name}**.`,
      ephemeral: true,
    });
  } catch (err) {
    logger.error({ err, discord_id: member.id, name }, 'title: add failed');
    await interaction.reply({
      content: '❌ Không thể thêm sub-title — kiểm tra quyền của bot.',
      ephemeral: true,
    });
  }
}

async function handleRemove(
  interaction: ChatInputCommandInteraction,
  member: GuildMember,
  name: string,
): Promise<void> {
  const role = member.guild.roles.cache.find((r) => r.name === name);
  if (!role || !member.roles.cache.has(role.id)) {
    await interaction.reply({
      content: `Bạn không có sub-title **${name}**.`,
      ephemeral: true,
    });
    return;
  }
  try {
    await member.roles.remove(role, `/title remove ${name}`);
    await interaction.reply({
      content: `🗑️ Đã bỏ sub-title **${name}**.`,
      ephemeral: true,
    });
  } catch (err) {
    logger.error({ err, discord_id: member.id, name }, 'title: remove failed');
    await interaction.reply({
      content: '❌ Không thể bỏ sub-title — kiểm tra quyền của bot.',
      ephemeral: true,
    });
  }
}

async function handleList(
  interaction: ChatInputCommandInteraction,
  member: GuildMember,
): Promise<void> {
  const owned = new Set([...member.roles.cache.values()].map((r) => r.name));
  const lines = SUB_TITLES.map((s) => {
    const mark = owned.has(s.name) ? '✅' : '⬜';
    return `${mark} ${s.emoji} **${s.name}** — ${s.theme}`;
  });
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('🏷️ Sub-title')
    .setDescription(
      [...lines, '', 'Dùng `/title add <name>` để nhận, `/title remove <name>` để bỏ.'].join('\n'),
    );
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.member) {
    await interaction.reply({ content: '⚠️ Lệnh chỉ dùng trong server.', ephemeral: true });
    return;
  }
  const member = (await interaction.guild?.members.fetch(interaction.user.id)) as GuildMember;
  const sub = interaction.options.getSubcommand(true);

  if (sub === 'list') {
    await handleList(interaction, member);
    return;
  }
  const name = interaction.options.getString('name', true);
  if (sub === 'add') await handleAdd(interaction, member, name);
  else if (sub === 'remove') await handleRemove(interaction, member, name);
}

export const command = { data, execute };
export default command;
