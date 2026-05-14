import { type Client, Events, type GuildMember, type PartialGuildMember } from 'discord.js';
import { getStore } from '../db/index.js';
import { postBotLog } from '../modules/bot-log.js';
import { logger } from '../utils/logger.js';

/**
 * Phase 12 — server boost detection. When a member starts boosting
 * (premiumSince transitions null → set), grant a one-time pills bonus
 * and contribution lump-sum. When they unboost, no penalty.
 *
 * Reward calibration:
 *   - +5 pills per boost (Đan dược to power up tribulation attempts)
 *   - +500 contribution_points (lets them grab a rare công pháp)
 *
 * Idempotency: we track the grant via the user's premium_boost_at_ms
 * field — only credit when transitioning, not on every cache update.
 */

const BOOST_REWARD_PILLS = 5;
const BOOST_REWARD_CONTRIBUTION = 500;

async function handleUpdate(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember,
): Promise<void> {
  if (newMember.user.bot) return;
  const wasBooster = oldMember.premiumSince !== null && oldMember.premiumSince !== undefined;
  const isBooster = newMember.premiumSince !== null && newMember.premiumSince !== undefined;
  if (wasBooster || !isBooster) return; // not a fresh boost transition

  const store = getStore();
  const user = store.users.get(newMember.id);
  if (!user) {
    logger.info(
      { discord_id: newMember.id, tag: newMember.user.tag },
      'boost: skipped — user has no record yet',
    );
    return;
  }

  // Double-reward gate: if this user has been rewarded for a boost before
  // (premium_boosted_at_ms set), skip. Stops the unboost/reboost cycle
  // from farming pills. We log so staff can grant manually if a real
  // first-time boost was missed (e.g., bot was offline).
  if (user.premium_boosted_at_ms != null) {
    logger.info(
      {
        discord_id: newMember.id,
        tag: newMember.user.tag,
        first_boost_ms: user.premium_boosted_at_ms,
      },
      'boost: skipped — user already rewarded for a prior boost',
    );
    return;
  }

  await store.users.set({
    ...user,
    pills: (user.pills ?? 0) + BOOST_REWARD_PILLS,
    contribution_points: (user.contribution_points ?? 0) + BOOST_REWARD_CONTRIBUTION,
    premium_boosted_at_ms: Date.now(),
  });

  logger.info(
    {
      discord_id: newMember.id,
      tag: newMember.user.tag,
      pills_granted: BOOST_REWARD_PILLS,
      contribution_granted: BOOST_REWARD_CONTRIBUTION,
    },
    'boost: rewards granted to fresh booster',
  );

  await postBotLog(
    `🌟 **${newMember.displayName}** vừa boost server — Aki tặng **${BOOST_REWARD_PILLS} đan dược** + **${BOOST_REWARD_CONTRIBUTION} cống hiến**! Cảm ơn đã hỗ trợ tông môn ✨`,
  );

  // Best-effort DM thank-you.
  try {
    await newMember.send(
      `🌟 Cảm ơn đạo hữu **${newMember.displayName}** đã boost server Radiant Tech Sect!\n\nAki tặng:\n• 💊 **+${BOOST_REWARD_PILLS}** đan dược độ kiếp\n• 🪙 **+${BOOST_REWARD_CONTRIBUTION}** điểm cống hiến\n\nCheck \`/inventory\` để xem nhé ٩(◕‿◕)۶`,
    );
  } catch {
    // DM closed — silent.
  }
}

export function register(client: Client): void {
  client.on(Events.GuildMemberUpdate, (oldM, newM) => {
    handleUpdate(oldM, newM as GuildMember).catch((err) => {
      logger.error({ err, discord_id: newM.id }, 'guildMemberUpdate: handler error');
    });
  });
}

export const __for_testing = { BOOST_REWARD_PILLS, BOOST_REWARD_CONTRIBUTION };
