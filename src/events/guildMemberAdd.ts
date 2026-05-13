import { type Client, Events, type GuildMember, type Role } from 'discord.js';
import { loadVerificationConfig } from '../config/verification.js';
import { auditMember } from '../modules/verification/audit.js';
import { UNVERIFIED_ROLE_NAME, startVerification } from '../modules/verification/flow.js';
import { recordJoinAndCheck } from '../modules/verification/raid.js';
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

async function handleNewMember(member: GuildMember): Promise<void> {
  if (member.user.bot) return;
  logger.info({ discord_id: member.id, tag: member.user.tag }, 'guildMemberAdd: new member');

  const config = await loadVerificationConfig();

  // Track this join for raid detection BEFORE starting the challenge so
  // the threshold check is based on the latest count.
  const raid = await recordJoinAndCheck(
    Date.now(),
    config.thresholds.raidJoinWindowMs,
    config.thresholds.raidJoinThreshold,
  );

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
