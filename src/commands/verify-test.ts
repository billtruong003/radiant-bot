import {
  AttachmentBuilder,
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { loadVerificationConfig } from '../config/verification.js';
import {
  type AuditDecision,
  type AuditResult,
  auditMember,
} from '../modules/verification/audit.js';
import { buildChallenge } from '../modules/verification/flow.js';
import { themedEmbed } from '../utils/embed.js';
import { logger } from '../utils/logger.js';

/**
 * /verify-test — admin-only diagnostic for the verification flow.
 *
 * Runs the real Layer 1 audit on the caller's own GuildMember, builds
 * the challenge that would be generated, and replies ephemerally with
 * the audit decision + DM preview + PNG attachment (if hard captcha).
 *
 * Does NOT send a real verification DM, does NOT persist a Verification
 * record, does NOT change roles. Pure preview.
 *
 * Subcommands let admins also test a synthetic profile (e.g. "what if
 * this user had no avatar?") without needing an alt account.
 */

export const data = new SlashCommandBuilder()
  .setName('verify-test')
  .setDescription('Test verify flow — preview audit + captcha (admin only)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName('self')
      .setDescription('Chạy audit + captcha trên chính tài khoản của bạn')
      .addBooleanOption((opt) =>
        opt.setName('force_hard').setDescription('Ép dùng hard captcha (image+math)'),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('decision')
      .setDescription('Override audit decision để xem challenge cho từng case')
      .addStringOption((opt) =>
        opt
          .setName('value')
          .setDescription('clean | suspect | kick')
          .setRequired(true)
          .addChoices(
            { name: 'clean', value: 'clean' },
            { name: 'suspect', value: 'suspect' },
            { name: 'kick (would-kick preview)', value: 'kick' },
          ),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: '❌ Lệnh này chỉ dùng trong guild.', ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand(true);
  const member = interaction.member;
  const config = await loadVerificationConfig();

  logger.info(
    { sub, invoked_by: interaction.user.id, tag: interaction.user.tag },
    'command: /verify-test',
  );

  const realAudit = auditMember(member, config);
  const overrideValue = sub === 'decision' ? interaction.options.getString('value', true) : null;
  const audit: AuditResult =
    overrideValue === 'clean' || overrideValue === 'suspect' || overrideValue === 'kick'
      ? {
          decision: overrideValue as AuditDecision,
          reasons:
            overrideValue === realAudit.decision
              ? realAudit.reasons
              : [`override → ${overrideValue}`],
          isSuspect: overrideValue !== 'clean',
        }
      : realAudit;
  const forceHard = sub === 'self' ? !!interaction.options.getBoolean('force_hard') : false;

  // KICK preview — no challenge would be generated in production.
  if (audit.decision === 'kick') {
    const embed = themedEmbed('danger', {
      title: '❌ Audit Decision: KICK',
      description: [
        `**Account age:** \`${((Date.now() - member.user.createdTimestamp) / 86_400_000).toFixed(2)}d\``,
        `**Avatar:** \`${member.user.avatar ? 'custom' : 'default'}\``,
        `**Username:** \`${member.user.username}\``,
        '',
        '**Audit reasons:**',
        audit.reasons.map((r) => `• \`${r}\``).join('\n'),
        '',
        '*Trong production, bot sẽ kick ngay tại bước này — không sinh captcha.*',
      ].join('\n'),
      footer: 'verify-test · dry-run · không ai bị kick',
    });
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  // Build the challenge that WOULD be sent.
  const challenge = buildChallenge(audit, config, { forceHard });

  const summary = [
    `**Audit decision:** \`${audit.decision}\`${overrideValue ? '  *(overridden)*' : ''}`,
    `**Account age:** \`${((Date.now() - member.user.createdTimestamp) / 86_400_000).toFixed(2)}d\``,
    `**Avatar:** \`${member.user.avatar ? 'custom' : 'default'}\``,
    `**Audit reasons:** ${audit.reasons.length ? audit.reasons.map((r) => `\`${r}\``).join(' · ') : '*(none)*'}`,
    `**Challenge type:** \`${challenge.challenge_type}\`${forceHard ? '  *(forceHard)*' : ''}`,
    `**Expected answer:** ||\`${challenge.challenge_data.expected}\`||`,
  ].join('\n');

  const embed = themedEmbed('info', {
    title: '🧪 /verify-test — Preview',
    description: [
      summary,
      '',
      '━━━ **DM Preview (would be sent):** ━━━',
      '',
      challenge.dmContent,
    ].join('\n'),
    footer: 'dry-run · không gửi DM thật · không tạo Verification record',
  });

  const reply: Parameters<typeof interaction.reply>[0] = {
    embeds: [embed],
    ephemeral: true,
  };

  if (challenge.dmImageBuffer) {
    reply.files = [new AttachmentBuilder(challenge.dmImageBuffer, { name: 'captcha-preview.png' })];
  }

  await interaction.reply(reply);
}

export const command = { data, execute };
export default command;
