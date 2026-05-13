import { EmbedBuilder, type GuildMember, type TextChannel } from 'discord.js';
import { ANNOUNCEMENT_CHANNELS } from '../../config/channels.js';
import { CULTIVATION_RANKS, rankById, rankForLevel } from '../../config/cultivation.js';
import { getStore } from '../../db/index.js';
import type { CultivationRankId } from '../../db/types.js';
import { logger } from '../../utils/logger.js';

/**
 * Cultivation rank promoter. Reads `leveledUp` from awardXp result and:
 *   1. Decides whether the new level maps to a higher cultivation rank
 *      (via `rankForLevel`).
 *   2. If yes, swaps the member's rank role on Discord (atomic via
 *      `member.roles.set([...])` so we don't leave a window where the
 *      member has zero rank roles).
 *   3. Updates `user.cultivation_rank` in the store.
 *   4. Returns a `PromotionResult` so the caller (event handler) can
 *      post the right embed.
 *
 * Embeds are posted by `postLevelUpEmbed` — separated so unit tests can
 * verify promotion logic without a Discord channel fake.
 *
 * Skip rules:
 *   - Tiên Nhân is admin-grant only — never auto-promote/demote them.
 *   - rankForLevel excludes Tiên Nhân so promotions cap at Độ Kiếp.
 */

const CULTIVATION_ROLE_NAMES: readonly string[] = CULTIVATION_RANKS.map((r) => r.name);

export interface PromotionResult {
  promoted: boolean;
  oldRank: CultivationRankId;
  newRank: CultivationRankId;
}

export async function maybePromoteRank(
  member: GuildMember,
  newLevel: number,
): Promise<PromotionResult> {
  const user = getStore().users.get(member.id);
  if (!user) {
    return { promoted: false, oldRank: 'pham_nhan', newRank: 'pham_nhan' };
  }
  const oldRank = user.cultivation_rank;
  // Tiên Nhân is admin-grant; never auto-touch.
  if (oldRank === 'tien_nhan') {
    return { promoted: false, oldRank, newRank: oldRank };
  }

  const newRank = rankForLevel(newLevel);
  if (newRank === oldRank) {
    return { promoted: false, oldRank, newRank };
  }

  // Persist rank change first so a Discord failure doesn't lose state.
  await getStore().users.set({ ...user, cultivation_rank: newRank });

  // Swap the Discord role atomically. `roles.set([keep, newRole])` avoids
  // a window where the user has zero cultivation roles.
  const guild = member.guild;
  const newRoleName = rankById(newRank).name;
  const newRole = guild.roles.cache.find((r) => r.name === newRoleName);
  if (!newRole) {
    logger.error(
      { guild: guild.id, rank: newRank, role_name: newRoleName },
      'rank-promoter: target role missing — run sync-server',
    );
    return { promoted: true, oldRank, newRank };
  }

  const keepRoleIds: string[] = [];
  for (const role of member.roles.cache.values()) {
    if (CULTIVATION_ROLE_NAMES.includes(role.name)) continue; // drop all old ranks
    keepRoleIds.push(role.id);
  }
  keepRoleIds.push(newRole.id);

  try {
    await member.roles.set(keepRoleIds, `auto-promote to ${newRank} (level ${newLevel})`);
    logger.info(
      { discord_id: member.id, old: oldRank, new: newRank, level: newLevel },
      'rank-promoter: role swapped',
    );
  } catch (err) {
    logger.error(
      { err, discord_id: member.id, new_rank: newRank },
      'rank-promoter: role swap failed (bot permission / role hierarchy?)',
    );
  }

  return { promoted: true, oldRank, newRank };
}

function findLevelUpChannel(member: GuildMember): TextChannel | null {
  const ch = member.guild.channels.cache.find(
    (c) => c.name === ANNOUNCEMENT_CHANNELS.levelUp && c.isTextBased(),
  );
  return (ch as TextChannel | undefined) ?? null;
}

function hexToInt(hex: string): number {
  return Number.parseInt(hex.replace(/^#/, ''), 16);
}

/**
 * Posts the level-up message in `#level-up`. Two flavors:
 *   - Plain level up: small embed with new level.
 *   - Đột phá cảnh giới: rank changed — special embed with rank color,
 *     mentions the member, and uses cultivation theme.
 */
export async function postLevelUpEmbed(
  member: GuildMember,
  newLevel: number,
  promotion: PromotionResult,
): Promise<void> {
  const channel = findLevelUpChannel(member);
  if (!channel) {
    logger.warn(
      { guild: member.guild.id, expected: ANNOUNCEMENT_CHANNELS.levelUp },
      'rank-promoter: #level-up channel missing — skipping embed',
    );
    return;
  }

  try {
    if (promotion.promoted) {
      const newRank = rankById(promotion.newRank);
      const embed = new EmbedBuilder()
        .setColor(hexToInt(newRank.colorHex))
        .setTitle('⚡ Đột phá cảnh giới')
        .setDescription(
          `${member} đã thành công đột phá cảnh giới, bước vào **${newRank.name}**.\n*${newRank.description}*`,
        )
        .addFields({ name: 'Cấp độ', value: `**Level ${newLevel}**`, inline: true })
        .setTimestamp();
      await channel.send({
        content: `${member}`,
        embeds: [embed],
        allowedMentions: { users: [member.id] },
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x5dade2)
      .setTitle('🎯 Lên cấp')
      .setDescription(`${member} đã lên **Level ${newLevel}**.`)
      .setTimestamp();
    await channel.send({ embeds: [embed] });
  } catch (err) {
    logger.warn({ err, discord_id: member.id }, 'rank-promoter: embed post failed');
  }
}
