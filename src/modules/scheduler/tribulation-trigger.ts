import type { Client } from 'discord.js';
import { env } from '../../config/env.js';
import { TRIBULATION_DAILY_TRIGGER_CHANCE } from '../../config/leveling.js';
import {
  isTribulationOnCooldown,
  pickEligibleUserId,
  runTribulation,
} from '../../modules/events/tribulation.js';
import { logger } from '../../utils/logger.js';

/**
 * Daily random tribulation trigger. Fired once per day at 18:00 VN
 * (per SPEC §8.4 — "0 18 * * * maybeRunTribulation, 25% chance in
 * window").
 *
 * Gating, in order:
 *   1. Roll 25% — most days nothing happens (keeps the event rare)
 *   2. Cooldown 24h check (defensive — last tribulation might be
 *      within window if /breakthrough fired earlier today)
 *   3. Pick eligible user (level ≥ 10)
 *   4. Resolve GuildMember + check presence (not AFK in voice OR has
 *      sent a message recently). Phase 7 keeps this simple — just
 *      verifies member exists in guild.
 *   5. runTribulation(member)
 *
 * All gating misses are logged at debug so the cron doesn't pollute
 * the bot-log channel.
 */

export async function maybeRunRandomTribulation(client: Client): Promise<void> {
  if (Math.random() >= TRIBULATION_DAILY_TRIGGER_CHANCE) {
    logger.debug({ chance: TRIBULATION_DAILY_TRIGGER_CHANCE }, 'tribulation-cron: skipped by roll');
    return;
  }

  if (isTribulationOnCooldown()) {
    logger.debug('tribulation-cron: skipped — cooldown active');
    return;
  }

  const userId = pickEligibleUserId();
  if (!userId) {
    logger.debug('tribulation-cron: no eligible users (level ≥ 10)');
    return;
  }

  const guild = client.guilds.cache.get(env.DISCORD_GUILD_ID);
  if (!guild) {
    logger.warn({ guild_id: env.DISCORD_GUILD_ID }, 'tribulation-cron: guild not in cache');
    return;
  }

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) {
    logger.warn({ discord_id: userId }, 'tribulation-cron: member not in guild, skipping');
    return;
  }

  logger.info(
    { discord_id: member.id, tag: member.user.tag },
    'tribulation-cron: triggering random tribulation',
  );
  try {
    await runTribulation(member);
  } catch (err) {
    logger.error({ err, discord_id: member.id }, 'tribulation-cron: runTribulation threw');
  }
}
