import { ChannelType, type Guild, type VoiceChannel } from 'discord.js';
import { isWorkingVoiceChannel } from '../../config/channels.js';
import { VOICE_WORKING_XP_PER_MIN, VOICE_XP_PER_MIN } from '../../config/leveling.js';
import { logger } from '../../utils/logger.js';
import { maybePromoteRank, postLevelUpEmbed } from './rank-promoter.js';
import { awardXp } from './tracker.js';

/**
 * Voice XP minute-tick. Called from the scheduler every 60 seconds.
 *
 * Per SPEC §3:
 *   - 10 XP/min in voice channel with ≥ 2 non-bot members, not AFK
 *   - 15 XP/min in voice "Working" channels (Focus Room, Quiet Study)
 *   - solo (1 person) → 0 XP
 *   - AFK channel → 0 XP
 *
 * Why a tick instead of session tracking on voiceStateUpdate:
 *   - Simpler: no persistent state to maintain, no edge cases on
 *     reconnect/move/crash mid-session.
 *   - Trade-off: a member who joins for <60s right between ticks
 *     earns nothing. Acceptable — sub-minute presence shouldn't grind.
 */

function isWorkingChannel(name: string): boolean {
  return isWorkingVoiceChannel(name);
}

function countNonBotHumans(channel: VoiceChannel): number {
  let n = 0;
  for (const m of channel.members.values()) {
    if (!m.user.bot) n++;
  }
  return n;
}

/**
 * Run one voice XP tick across all voice channels of the guild. Returns
 * a summary for logging.
 */
export async function runVoiceTick(guild: Guild): Promise<{
  awarded: number;
  channels: number;
}> {
  let awarded = 0;
  let channelsScanned = 0;

  const afkChannelId = guild.afkChannelId;
  for (const channel of guild.channels.cache.values()) {
    if (channel.type !== ChannelType.GuildVoice) continue;
    const vc = channel as VoiceChannel;
    channelsScanned++;
    if (vc.id === afkChannelId) continue;

    const humans = countNonBotHumans(vc);
    if (humans < 2) continue; // solo or empty

    const amount = isWorkingChannel(vc.name) ? VOICE_WORKING_XP_PER_MIN : VOICE_XP_PER_MIN;
    const source = isWorkingChannel(vc.name) ? 'voice_working' : 'voice';

    for (const member of vc.members.values()) {
      if (member.user.bot) continue;
      try {
        const result = await awardXp({
          discordId: member.id,
          username: member.user.username,
          displayName: member.displayName,
          amount,
          source,
          metadata: { channel_id: vc.id, channel_name: vc.name },
        });
        awarded++;

        if (result.leveledUp) {
          const promotion = await maybePromoteRank(member, result.newLevel);
          await postLevelUpEmbed(member, result.newLevel, promotion);
        }
      } catch (err) {
        logger.error({ err, discord_id: member.id, channel: vc.name }, 'voice-xp: award failed');
      }
    }
  }

  if (awarded > 0) {
    logger.debug({ awarded, channels: channelsScanned }, 'voice-xp: tick complete');
  }
  return { awarded, channels: channelsScanned };
}
