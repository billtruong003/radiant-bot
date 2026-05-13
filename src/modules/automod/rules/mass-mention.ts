import type { Message } from 'discord.js';
import { loadAutomodConfig } from '../../../config/automod.js';
import type { AutomodRule, RuleHit } from '../types.js';

/**
 * Mass-mention guard: a single message mentioning ≥ N distinct users is
 * usually a raid/ping-spam vector. Triggers timeout to break the chain.
 *
 * Mentions counted: user mentions (`<@id>`) + role mentions. `@everyone`
 * / `@here` are NOT counted here — Discord's own perm system gates those.
 */

export const massMentionRule: AutomodRule = {
  id: 'mass_mention',
  name: 'Mass mention',
  severity: 3,
  action: 'timeout',
  warnText: '⚠️ Bạn vừa mention quá nhiều người trong 1 tin nhắn — đã bị tạm khoá 10 phút.',
  async detect(message: Message): Promise<RuleHit | null> {
    const config = await loadAutomodConfig();
    const userMentions = message.mentions.users.size;
    const roleMentions = message.mentions.roles.size;
    const total = userMentions + roleMentions;
    if (total < config.thresholds.massMentionCount) return null;
    return {
      reason: `mentioned ${total} entities (>= ${config.thresholds.massMentionCount})`,
      context: { user_mentions: userMentions, role_mentions: roleMentions },
    };
  },
};
