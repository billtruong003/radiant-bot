import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { loadAutomodConfig } from '../config/automod.js';
import { automodEngine } from '../modules/automod/index.js';

/**
 * /automod-config — admin-only readout of the active automod rules +
 * current thresholds + whitelist counts. Doesn't allow editing
 * (that's done by editing `src/config/automod.json` directly and
 * restarting the bot). View-only command per SPEC §5 Phase 5 task.
 */

export const data = new SlashCommandBuilder()
  .setName('automod-config')
  .setDescription('Xem cấu hình automod hiện tại (admin only)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

const ACTION_EMOJI = {
  delete: '🗑️',
  warn: '⚠️',
  timeout: '🔇',
  kick: '👢',
} as const;

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const config = await loadAutomodConfig();
  const rules = automodEngine.list();

  const ruleLines = rules.map((r) => {
    const emoji = ACTION_EMOJI[r.action];
    return `${emoji} **${r.name}** \`${r.id}\` — action: \`${r.action}\`, severity: ${r.severity}`;
  });

  const thresholdLines = [
    `• Mass mention: ≥ **${config.thresholds.massMentionCount}** mentions`,
    `• Caps-lock: ≥ **${(config.thresholds.capsRatioThreshold * 100).toFixed(0)}%** caps & ≥ **${config.thresholds.capsMinLength}** chars`,
    `• Spam: ≥ **${config.thresholds.spamDuplicates}** duplicates trong **${Math.floor(config.thresholds.spamWindowMs / 60_000)} phút**`,
    `• Timeout duration: **${Math.floor(config.thresholds.timeoutDurationMs / 60_000)} phút**`,
  ];

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('🛡️ Automod Config')
    .setDescription(
      [
        '**Rules (severity desc):**',
        ...ruleLines,
        '',
        '**Thresholds:**',
        ...thresholdLines,
        '',
        `**Profanity word list:** ${config.profanityWords.length} từ`,
        `**Link whitelist:** ${config.linkWhitelist.length} domain`,
        '',
        '_Edit `src/config/automod.json` + restart bot để thay đổi._',
      ].join('\n'),
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

export const command = { data, execute };
export default command;
