import type { Guild, GuildMember } from 'discord.js';
import { SUB_TITLES } from '../../config/cultivation.js';
import { getStore } from '../../db/index.js';
import type { ReactionRoleMapping } from '../../db/types.js';
import { logger } from '../../utils/logger.js';

/**
 * Reaction roles for sub-titles (Kiếm Tu / Đan Sư / Trận Pháp Sư /
 * Tán Tu). One pinned bot-posted message in `#leveling-guide` carries
 * 4 emoji reactions; reacting grants the matching role, un-reacting
 * removes it.
 *
 * Config persists in `store.reactionRolesConfig` (singleton):
 *   - message_id, channel_id: the pinned bot message
 *   - mappings: [{ emoji, role_name }]
 *
 * Setup via `npm run bot -- setup-reaction-roles` (one-time after
 * sync-server). Runtime listeners route reaction adds/removes via
 * `handleReactionAdd` / `handleReactionRemove` below.
 */

export const DEFAULT_SUBTITLE_MAPPINGS: readonly ReactionRoleMapping[] = SUB_TITLES.map((s) => ({
  emoji: s.emoji,
  role_name: s.name,
}));

interface RouteResult {
  /** True when this reaction is on the configured reaction-roles message. */
  matched: boolean;
  /** Matching role name if any. */
  roleName?: string;
}

/**
 * Decide whether (and to which role) a reaction maps. Pure check
 * against the stored config — easy to unit-test.
 */
export function routeReaction(messageId: string, emoji: string): RouteResult {
  const cfg = getStore().reactionRolesConfig.get();
  if (!cfg.message_id || cfg.message_id !== messageId) return { matched: false };
  const mapping = cfg.mappings.find((m) => m.emoji === emoji);
  if (!mapping) return { matched: true }; // on the config message but unknown emoji
  return { matched: true, roleName: mapping.role_name };
}

async function assignRole(member: GuildMember, roleName: string): Promise<void> {
  const role = member.guild.roles.cache.find((r) => r.name === roleName);
  if (!role) {
    logger.warn({ role_name: roleName }, 'reactionRoles: role not found in guild');
    return;
  }
  if (member.roles.cache.has(role.id)) return;
  try {
    await member.roles.add(role, `reaction-role: ${roleName}`);
    logger.info({ discord_id: member.id, role_name: roleName }, 'reactionRoles: granted');
  } catch (err) {
    logger.error({ err, discord_id: member.id, role_name: roleName }, 'reactionRoles: add failed');
  }
}

async function removeRole(member: GuildMember, roleName: string): Promise<void> {
  const role = member.guild.roles.cache.find((r) => r.name === roleName);
  if (!role) return;
  if (!member.roles.cache.has(role.id)) return;
  try {
    await member.roles.remove(role, `reaction-role: ${roleName} (unreact)`);
    logger.info({ discord_id: member.id, role_name: roleName }, 'reactionRoles: removed');
  } catch (err) {
    logger.error(
      { err, discord_id: member.id, role_name: roleName },
      'reactionRoles: remove failed',
    );
  }
}

/**
 * Handle a reaction-add event. Returns `true` if the reaction was on
 * the reaction-roles message (so callers can skip their other handlers,
 * e.g. XP awarding).
 */
export async function handleReactionAdd(
  guild: Guild,
  userId: string,
  messageId: string,
  emoji: string,
): Promise<boolean> {
  const route = routeReaction(messageId, emoji);
  if (!route.matched) return false;
  if (route.roleName) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) await assignRole(member, route.roleName);
  }
  return true;
}

export async function handleReactionRemove(
  guild: Guild,
  userId: string,
  messageId: string,
  emoji: string,
): Promise<boolean> {
  const route = routeReaction(messageId, emoji);
  if (!route.matched) return false;
  if (route.roleName) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) await removeRole(member, route.roleName);
  }
  return true;
}

/**
 * Persist the config + (caller-supplied) message ID. Called by the
 * setup CLI after it posts + reacts to the bot message.
 */
export async function saveReactionRolesConfig(
  channelId: string,
  messageId: string,
  mappings: readonly ReactionRoleMapping[],
): Promise<void> {
  await getStore().reactionRolesConfig.set({
    channel_id: channelId,
    message_id: messageId,
    mappings: [...mappings],
  });
}
