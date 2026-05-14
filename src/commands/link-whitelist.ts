import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { loadAutomodConfig, persistAutomodConfig } from '../config/automod.js';

/**
 * `/link-whitelist add|remove|list` — admin tooling for the link
 * whitelist. Replaces the prior workflow (edit `automod.json` by hand
 * over SSH + restart) so trusted domains can be added in seconds
 * without dropping the bot.
 *
 * Subcommands:
 *   add <domain>    — append to whitelist (deduped, lowercased)
 *   remove <domain> — strip matching entry
 *   list            — paginated readout (single message for now)
 *
 * Persistence: writes back to `src/config/automod.json` via
 * `persistAutomodConfig`, which validates with the zod schema and busts
 * the in-memory cache so the next message goes through the new list
 * immediately. No restart required.
 *
 * Permission: Administrator. Guild-only.
 */

const DOMAIN_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

function normalizeDomain(raw: string): string | null {
  const stripped = raw
    .trim()
    .toLowerCase()
    // Strip scheme + path so user can paste a full URL.
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '');
  if (!DOMAIN_RE.test(stripped)) return null;
  return stripped;
}

export const data = new SlashCommandBuilder()
  .setName('link-whitelist')
  .setDescription('Quản lý whitelist domain (admin only)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addSubcommand((sc) =>
    sc
      .setName('add')
      .setDescription('Thêm 1 domain vào whitelist')
      .addStringOption((o) =>
        o
          .setName('domain')
          .setDescription('Vd: billthedev.com (hoặc paste link đầy đủ — Aki tự strip)')
          .setRequired(true),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName('remove')
      .setDescription('Xoá 1 domain khỏi whitelist')
      .addStringOption((o) =>
        o.setName('domain').setDescription('Domain cần xoá').setRequired(true),
      ),
  )
  .addSubcommand((sc) => sc.setName('list').setDescription('Xem toàn bộ whitelist hiện tại'));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand(true);
  const config = await loadAutomodConfig();

  if (sub === 'list') {
    const lines = config.linkWhitelist.length
      ? config.linkWhitelist.map((d, i) => `${i + 1}. \`${d}\``).join('\n')
      : `_Whitelist trống. Mode hiện tại là \`${config.linkPolicy}\`._`;
    const embed = new EmbedBuilder()
      .setColor(0x5dade2)
      .setTitle('🔗 Link whitelist')
      .setDescription(lines.slice(0, 4000))
      .setFooter({
        text: `${config.linkWhitelist.length} domain · policy=${config.linkPolicy}`,
      });
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  const raw = interaction.options.getString('domain', true);
  const normalized = normalizeDomain(raw);
  if (!normalized) {
    await interaction.reply({
      content: `⚠️ Domain không hợp lệ: \`${raw}\`. Cần dạng \`example.com\` hoặc \`sub.example.com\`.`,
      ephemeral: true,
    });
    return;
  }

  if (sub === 'add') {
    if (config.linkWhitelist.includes(normalized)) {
      await interaction.reply({
        content: `ℹ️ Domain \`${normalized}\` đã có trong whitelist.`,
        ephemeral: true,
      });
      return;
    }
    const next = {
      ...config,
      linkWhitelist: [...config.linkWhitelist, normalized],
    };
    await persistAutomodConfig(next);
    await interaction.reply({
      content: `✅ Đã thêm \`${normalized}\` vào whitelist. Tổng ${next.linkWhitelist.length} domain. Áp dụng ngay không cần restart.`,
      ephemeral: true,
    });
    return;
  }

  if (sub === 'remove') {
    if (!config.linkWhitelist.includes(normalized)) {
      await interaction.reply({
        content: `ℹ️ Domain \`${normalized}\` không có trong whitelist.`,
        ephemeral: true,
      });
      return;
    }
    const next = {
      ...config,
      linkWhitelist: config.linkWhitelist.filter((d) => d !== normalized),
    };
    await persistAutomodConfig(next);
    await interaction.reply({
      content: `🗑️ Đã xoá \`${normalized}\` khỏi whitelist. Còn ${next.linkWhitelist.length} domain.`,
      ephemeral: true,
    });
    return;
  }
}

export const __for_testing = { normalizeDomain };

export const command = { data, execute };
export default command;
