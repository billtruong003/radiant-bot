import type { Message } from 'discord.js';
import { ulid } from 'ulid';
import { getStore } from '../../db/index.js';
import { logger } from '../../utils/logger.js';
import { postBotLog } from '../bot-log.js';
import type { AutomodDecision } from './types.js';

/**
 * Applies the decision: deletes the message, optionally warns/timeouts/
 * kicks the author, logs to `store.automodLogs` (append-only), and
 * posts a one-liner to `#bot-log`. All Discord ops are best-effort —
 * we never throw out of automod.
 *
 * Action semantics:
 *   - delete   : delete message
 *   - warn     : delete + DM author
 *   - timeout  : delete + member.timeout(ms)
 *   - kick     : kick member (message left intact per Discord convention)
 *
 * The mod-log #bot-log post is a single line so it doesn't drown out
 * other mod actions (verification kicks etc).
 */

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

async function tryDelete(msg: Message): Promise<void> {
  try {
    if (msg.deletable) await msg.delete();
  } catch (err) {
    logger.warn({ err, message_id: msg.id, channel: msg.channelId }, 'automod: delete failed');
  }
}

async function tryWarn(msg: Message, text: string): Promise<void> {
  try {
    await msg.author.send(text);
  } catch {
    // DM closed; warning is best-effort, fall through.
  }
}

async function tryTimeout(msg: Message, ms: number, reason: string): Promise<void> {
  if (!msg.guild || !msg.member) return;
  try {
    if (msg.member.moderatable) {
      await msg.member.timeout(ms, reason);
    }
  } catch (err) {
    logger.warn({ err, discord_id: msg.author.id }, 'automod: timeout failed');
  }
}

async function tryKick(msg: Message, reason: string): Promise<void> {
  if (!msg.guild || !msg.member) return;
  try {
    if (msg.member.kickable) {
      await msg.member.kick(reason);
    }
  } catch (err) {
    logger.warn({ err, discord_id: msg.author.id }, 'automod: kick failed');
  }
}

export async function applyDecision(message: Message, decision: AutomodDecision): Promise<void> {
  const { rule, hit } = decision;
  const reason = `automod:${rule.id} — ${hit.reason}`;

  // Side-effects per action type. Delete is implicit for all except 'kick'.
  switch (rule.action) {
    case 'delete':
      await tryDelete(message);
      break;
    case 'warn':
      await tryDelete(message);
      await tryWarn(message, rule.warnText ?? `⚠️ Tin nhắn của bạn bị xoá (lý do: ${hit.reason}).`);
      break;
    case 'timeout':
      await tryDelete(message);
      await tryTimeout(message, rule.timeoutMs ?? DEFAULT_TIMEOUT_MS, reason);
      if (rule.warnText) await tryWarn(message, rule.warnText);
      break;
    case 'kick':
      await tryKick(message, reason);
      break;
  }

  // Persist + announce.
  await getStore().automodLogs.append({
    id: ulid(),
    discord_id: message.author.id,
    rule: rule.id,
    action: rule.action,
    context: {
      ...(hit.context ?? {}),
      reason: hit.reason,
      message_id: message.id,
      channel_id: message.channelId,
    },
    created_at: Date.now(),
  });

  logger.info(
    {
      discord_id: message.author.id,
      tag: message.author.tag,
      rule: rule.id,
      action: rule.action,
      reason: hit.reason,
    },
    'automod: action applied',
  );

  await postBotLog(
    `🛡️ Automod **${rule.action}** ${message.author.tag} (\`${rule.id}\`) — ${hit.reason}`,
  );
}
