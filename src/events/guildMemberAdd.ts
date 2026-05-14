import { type Client, Events, type GuildMember, type Role } from 'discord.js';
import { rankById } from '../config/cultivation.js';
import { loadVerificationConfig } from '../config/verification.js';
import { getStore } from '../db/index.js';
import { auditMember } from '../modules/verification/audit.js';
import {
  PHAM_NHAN_ROLE_NAME,
  UNVERIFIED_ROLE_NAME,
  startVerification,
} from '../modules/verification/flow.js';
import { recordJoinAndCheck } from '../modules/verification/raid.js';
import { getRemainingCooldownMs } from '../modules/verification/rejoin-cooldown.js';
import { postWelcome } from '../modules/welcome/index.js';
import { logger } from '../utils/logger.js';

/**
 * `guildMemberAdd` event: assign Chưa Xác Minh, run Layer 1 audit,
 * track the join for raid detection, and hand off to the verification
 * flow.
 *
 * Errors here are caught + logged but never re-thrown — Discord.js
 * unhandled-event errors are silent on the client otherwise.
 */

function findRoleByName(member: GuildMember, name: string): Role | null {
  return member.guild.roles.cache.find((r) => r.name === name) ?? null;
}

async function assignUnverifiedRole(member: GuildMember): Promise<void> {
  const role = findRoleByName(member, UNVERIFIED_ROLE_NAME);
  if (!role) {
    logger.error(
      { guild: member.guild.id, role_name: UNVERIFIED_ROLE_NAME },
      'guildMemberAdd: Chưa Xác Minh role missing — run sync-server',
    );
    return;
  }
  if (member.roles.cache.has(role.id)) return;
  try {
    await member.roles.add(role, 'new member — pending verification');
  } catch (err) {
    logger.error(
      { err, discord_id: member.id, tag: member.user.tag },
      'guildMemberAdd: failed to assign Chưa Xác Minh',
    );
  }
}

/**
 * Re-join short-circuit: if this Discord ID was previously verified
 * (User entity exists in store with verified_at set), skip the captcha
 * entirely. Restore Phàm Nhân + their current cultivation rank role
 * and post a "returning disciple" welcome.
 *
 * Returns true if the fast-path was taken.
 */
async function tryRestoreReturningMember(member: GuildMember): Promise<boolean> {
  const user = getStore().users.get(member.id);
  if (!user || user.verified_at === null) return false;

  const guild = member.guild;
  const phamNhanRole = guild.roles.cache.find((r) => r.name === PHAM_NHAN_ROLE_NAME);
  const rankRole = (() => {
    try {
      return guild.roles.cache.find((r) => r.name === rankById(user.cultivation_rank).name) ?? null;
    } catch {
      return null;
    }
  })();

  if (!phamNhanRole) {
    logger.warn(
      { discord_id: member.id, role: PHAM_NHAN_ROLE_NAME },
      'rejoin: Phàm Nhân role missing — falling back to full verify',
    );
    return false;
  }

  try {
    await member.roles.add(phamNhanRole, 'returning verified disciple');
    if (rankRole && rankRole.id !== phamNhanRole.id) {
      await member.roles.add(rankRole, `restore cultivation rank ${user.cultivation_rank}`);
    }
  } catch (err) {
    logger.error(
      { err, discord_id: member.id },
      'rejoin: failed to grant verified roles — falling back to full verify',
    );
    return false;
  }

  logger.info(
    {
      discord_id: member.id,
      tag: member.user.tag,
      cultivation_rank: user.cultivation_rank,
      level: user.level,
      original_verified_at: user.verified_at,
    },
    'rejoin: restored previously-verified member, skipped captcha',
  );

  // Best-effort welcome (returning-disciple variant). postWelcome detects
  // returning via store lookup; we set a hint flag for future iteration.
  try {
    await postWelcome(member, { returning: true });
  } catch (err) {
    logger.warn({ err, discord_id: member.id }, 'rejoin: welcome post failed');
  }

  return true;
}

async function handleNewMember(member: GuildMember): Promise<void> {
  if (member.user.bot) return;
  logger.info({ discord_id: member.id, tag: member.user.tag }, 'guildMemberAdd: new member');

  // B6 — verify re-attempt cooldown. If this member was kicked for a
  // failed/timeout verify within the last hour, kick them again with a
  // "đợi X phút" reason. Stops the rejoin-grind loop without needing
  // Discord's real ban primitive (which we don't have a clean revoke
  // path for).
  const remainingMs = getRemainingCooldownMs(member.id);
  if (remainingMs !== null) {
    const remainingMin = Math.ceil(remainingMs / 60_000);
    const reason = `verify cooldown — vui lòng đợi ${remainingMin} phút trước khi thử lại`;
    try {
      await member.kick(reason);
      logger.info(
        { discord_id: member.id, tag: member.user.tag, remaining_min: remainingMin },
        'guildMemberAdd: kicked on rejoin cooldown',
      );
    } catch (err) {
      logger.warn(
        { err, discord_id: member.id },
        'guildMemberAdd: failed to kick on cooldown (bot perm?)',
      );
    }
    return;
  }

  const config = await loadVerificationConfig();

  // Track this join for raid detection BEFORE branching. Even a returning
  // verified member counts as a join for raid-burst detection.
  const raid = await recordJoinAndCheck(
    Date.now(),
    config.thresholds.raidJoinWindowMs,
    config.thresholds.raidJoinThreshold,
  );

  // Re-join short-circuit (A1, Phase 11). Skip captcha for verified
  // returners. Audit + raid mode still apply for true new joiners.
  if (await tryRestoreReturningMember(member)) return;

  await assignUnverifiedRole(member);

  const audit = auditMember(member, config);
  await startVerification(member, audit, config, { forceHard: raid.forceHard });
}

export function register(client: Client): void {
  client.on(Events.GuildMemberAdd, (member) => {
    handleNewMember(member as GuildMember).catch((err) => {
      logger.error({ err, discord_id: member.id }, 'guildMemberAdd: unhandled error');
    });
  });
}
