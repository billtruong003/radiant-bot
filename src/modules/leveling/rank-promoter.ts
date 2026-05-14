import type { GuildMember, Message, TextChannel } from 'discord.js';
import { ANNOUNCEMENT_CHANNELS, matchesChannelName } from '../../config/channels.js';
import { CULTIVATION_RANKS, rankById, rankForLevel } from '../../config/cultivation.js';
import { ICONS, RANK_ICONS } from '../../config/ui.js';
import { getStore } from '../../db/index.js';
import type { CultivationRankId } from '../../db/types.js';
import { themedEmbed } from '../../utils/embed.js';
import { logger } from '../../utils/logger.js';
import { sanitizeForDisplay } from '../../utils/sanitize.js';
import { auraFor, renderBreakthroughDescription, renderPlainLevelUpDescription } from './aura.js';
import { narrateRankPromotion } from './narration.js';

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

  // B4 (Phase 11): if this promotion lands on Trúc Cơ (level 10), DM
  // the disciple suggesting a sub-title. One-shot — User.sub_title is
  // null on first arrival here; if a returning member already has a
  // sub-title we skip silently.
  if (newRank === 'truc_co' && oldRank !== 'truc_co') {
    void promptSubTitleSelection(member).catch((err) => {
      logger.warn({ err, discord_id: member.id }, 'rank-promoter: sub-title prompt failed');
    });
  }

  return { promoted: true, oldRank, newRank };
}

async function promptSubTitleSelection(member: GuildMember): Promise<void> {
  const user = getStore().users.get(member.id);
  if (user?.sub_title) return; // already picked one — no nag

  const dm = [
    '🌟 **Chúc mừng đạo hữu đột phá Trúc Cơ!**',
    '',
    'Aki nhận thấy đạo hữu đã đến mốc cảnh giới được chọn **sub-title** — định hướng tu đạo riêng.',
    '',
    '**4 lựa chọn:**',
    '⚔️  `Kiếm Tu`        — gaming / combat',
    '🧪  `Đan Sư`         — art / creative',
    '🔮  `Trận Pháp Sư`   — tech / dev',
    '🌀  `Tán Tu`         — mixed (giữ tự do)',
    '',
    'Dùng `/title add <name>` để chọn. Đổi sau cũng được bằng `/title remove`.',
    '',
    '_Đường tu càng rõ chí, càng vững (◕‿◕)_',
  ].join('\n');

  try {
    await member.send(dm);
    logger.info({ discord_id: member.id }, 'rank-promoter: sub-title prompt DM sent');
  } catch {
    // DM blocked — silent skip. The user can still use /title anytime.
  }
}

function findLevelUpChannel(member: GuildMember): TextChannel | null {
  const ch = member.guild.channels.cache.find(
    (c) => matchesChannelName(c, ANNOUNCEMENT_CHANNELS.levelUp) && c.isTextBased(),
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
      const oldRank = rankById(promotion.oldRank);
      const newRank = rankById(promotion.newRank);
      const oldIcon = RANK_ICONS[promotion.oldRank] ?? '⭐';
      const newIcon = RANK_ICONS[promotion.newRank] ?? '⭐';

      // Phase 11.2 / A8 — chronicler narration (LLM-generated VN xianxia
      // prose). Phase 12.3 — tiered aura visual (smoke + energy + rainbow
      // animation for legendary tiers).
      const chronicle = await narrateRankPromotion({
        userDisplayName: member.displayName,
        oldRank: promotion.oldRank,
        newRank: promotion.newRank,
      });

      const description = renderBreakthroughDescription({
        oldRankIcon: oldIcon,
        newRankIcon: newIcon,
        oldRankName: oldRank.name,
        newRankName: newRank.name,
        newRankId: promotion.newRank,
        memberMention: member.toString(),
        chronicle,
      });

      const safeName = sanitizeForDisplay(member.displayName);
      const embed = themedEmbed('cultivation', {
        color: hexToInt(newRank.colorHex),
        title: `${ICONS.cultivation} Đột phá cảnh giới ${ICONS.cultivation}`,
        description,
        footer: 'Cảnh giới mới đã mở khoá quyền lợi · Radiant Tech Sect',
      })
        .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: '👤 Đệ tử', value: safeName, inline: true },
          { name: '📈 Cấp độ', value: `**Level ${newLevel}**`, inline: true },
          { name: `${newIcon} Cảnh giới`, value: newRank.name, inline: true },
        );

      const sent = (await channel.send({
        content: `🎉 Chúc mừng ${member}!`,
        embeds: [embed],
        allowedMentions: { users: [member.id] },
      })) as Message;

      // Phase 12.3 — rainbow animation for Đại Thừa / Độ Kiếp / Tiên Nhân.
      // We re-edit the embed 5 times with successive border colors over
      // ~3s. Discord rate limit is generous (5/5s per message); we space
      // edits at 500ms intervals. Best-effort: any edit failure is
      // swallowed and the final color stays whatever sent first.
      const aura = auraFor(promotion.newRank);
      if (aura.rainbowCycle.length > 0) {
        void animateRainbow(sent, embed, aura.rainbowCycle, hexToInt(newRank.colorHex));
      }
      return;
    }

    // Plain level-up (no rank cross) — lower-key visual: single aura line
    // bracketing the message, no animation.
    const user = getStore().users.get(member.id);
    const rankId = user?.cultivation_rank ?? 'pham_nhan';
    const rankIcon = RANK_ICONS[rankId] ?? '⭐';
    const description = renderPlainLevelUpDescription({
      memberMention: member.toString(),
      newLevel,
      currentRankId: rankId,
      rankIcon,
    });
    const embed = themedEmbed('levelup', {
      title: `${ICONS.sparkle} Lên cấp`,
      description,
      footer: undefined,
    });
    await channel.send({
      embeds: [embed],
      allowedMentions: { users: [member.id] },
    });
  } catch (err) {
    logger.warn({ err, discord_id: member.id }, 'rank-promoter: embed post failed');
  }
}

/**
 * Animate the embed border color through `cycle` over ~3 seconds. Used
 * for legendary-tier breakthroughs (Đại Thừa+) so visually-significant
 * promotions look genuinely special. Final frame restores `finalColor`
 * so the message persists with the rank's canonical color.
 *
 * Best-effort: any edit failure (rate limit, message deleted, perm
 * loss) is swallowed silently — the static first frame is already up
 * so the user sees the breakthrough regardless.
 */
async function animateRainbow(
  message: Message,
  embed: ReturnType<typeof themedEmbed>,
  cycle: readonly number[],
  finalColor: number,
): Promise<void> {
  const FRAME_MS = 500;
  for (let i = 0; i < cycle.length; i++) {
    await new Promise((r) => setTimeout(r, FRAME_MS));
    try {
      const c = cycle[i];
      if (c === undefined) continue;
      embed.setColor(c);
      await message.edit({ embeds: [embed] });
    } catch {
      return; // any failure → stop the animation
    }
  }
  // Restore final color frame.
  await new Promise((r) => setTimeout(r, FRAME_MS));
  try {
    embed.setColor(finalColor);
    await message.edit({ embeds: [embed] });
  } catch {
    /* swallow */
  }
}
