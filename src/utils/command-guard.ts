import { type ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { ROLE_SECT_MASTER } from '../config/roles.js';
import { logger } from './logger.js';

/**
 * Runtime permission gates for privileged commands.
 *
 * `setDefaultMemberPermissions()` alone is NOT a gate. It sets the
 * *default* Discord shows in Server Settings → Integrations, and anyone
 * who can manage the server can override it per-role or per-channel —
 * after which the bot happily executes the command, because it never
 * checked. Nine admin commands were relying on that default alone,
 * including `/grant`, which mints XP and items.
 *
 * So: declare the default for discoverability, and check again here for
 * the actual decision.
 */

async function deny(interaction: ChatInputCommandInteraction, reason: string): Promise<false> {
  logger.warn(
    {
      command: interaction.commandName,
      discord_id: interaction.user.id,
      username: interaction.user.username,
      reason,
    },
    'command-guard: denied',
  );
  await interaction
    .reply({ content: `🚫 ${reason}`, ephemeral: true })
    .catch(() => undefined);
  return false;
}

/** Server administrators only. Returns false when it has already replied. */
export async function requireAdmin(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (!interaction.inGuild()) {
    return deny(interaction, 'Lệnh này chỉ dùng được trong tông môn.');
  }
  const perms = interaction.memberPermissions;
  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return deny(interaction, 'Lệnh này chỉ dành cho quản trị tông môn.');
  }
  return true;
}

/**
 * Chưởng Môn only — by ROLE, not by permission bit.
 *
 * Deliberately narrower than `requireAdmin`: a permission bit can be
 * granted to any role, but this one identifies the owner himself.
 */
export async function requireSectMaster(
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  if (!interaction.inGuild() || !interaction.member) {
    return deny(interaction, 'Lệnh này chỉ dùng được trong tông môn.');
  }
  const roles = interaction.member.roles;
  // Uncached member payloads expose roles as bare id strings, which we
  // cannot match by name. Deny rather than guess — this gate protects the
  // owner-only commands.
  if (!('cache' in roles)) {
    return deny(interaction, 'Không xác minh được chức vị, thử lại sau.');
  }
  if (!roles.cache.some((r) => r.name === ROLE_SECT_MASTER)) {
    return deny(interaction, `Chỉ **${ROLE_SECT_MASTER}** mới dùng được lệnh này.`);
  }
  return true;
}
