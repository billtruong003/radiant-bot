import type { GuildMember, Message } from 'discord.js';
import { ulid } from 'ulid';
import { STAFF_ROLE_NAMES } from '../../config/roles.js';
import { getStore } from '../../db/index.js';
import { logger } from '../../utils/logger.js';
import { buildNudgePrompt } from '../aki/persona-nudge.js';
import { postBotLog } from '../bot-log.js';
import { llm } from '../llm/index.js';
import { narratePunishment } from './narration.js';
import type { AutomodDecision } from './types.js';

/**
 * Applies the decision: deletes the message, optionally warns/timeouts/
 * kicks the author, logs to `store.automodLogs` (append-only), and
 * posts a Thiên Đạo narration (Phase 11.2 / A6b) to `#bot-log` in place
 * of the legacy one-liner. All Discord ops are best-effort — we never
 * throw out of automod.
 *
 * Action semantics:
 *   - delete   : delete message
 *   - warn     : delete + DM author
 *   - timeout  : delete + member.timeout(ms)
 *   - kick     : kick member (message left intact per Discord convention)
 *
 * Graduated profanity (Phase 11.2 / A6) — if the firing rule is
 * `profanity` and the user's 60s-window count is below 15, we BYPASS
 * the destructive action and send a brief Aki nudge (gentle 1–4, stern
 * 5–14). No delete, no log, no narration on the nudge path. The 30s
 * per-user nudge cooldown prevents LLM hammering.
 */

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
// Per-user 30s nudge cooldown felt dead in live testing (Bill saw 1 reply
// then silence). Dropped to 10s so persistent offenders get nudge cadence
// matching their spam rate without burning the free-tier LLM quota.
const NUDGE_COOLDOWN_MS = 10_000;
const STERN_THRESHOLD = 5;
const DELETE_THRESHOLD = 15;

const lastNudgeAt: Map<string, number> = new Map();

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

function resolveDisplayName(msg: Message): string {
  return msg.member?.displayName ?? msg.author?.username ?? msg.author?.tag ?? 'đệ tử';
}

function isStaff(member: GuildMember | null): boolean {
  if (!member) return false;
  const cache = member.roles?.cache;
  if (!cache || typeof cache.values !== 'function') return false;
  for (const role of cache.values()) {
    if (STAFF_ROLE_NAMES.has(role.name)) return true;
  }
  return false;
}

async function trySendNudge(
  message: Message,
  severity: 'gentle' | 'stern',
  respectfulTone: boolean,
): Promise<void> {
  const displayName = resolveDisplayName(message);
  const { systemPrompt, userPrompt } = buildNudgePrompt({
    severity,
    respectfulTone,
    userDisplayName: displayName,
  });

  const result = await llm.complete('aki-nudge', {
    systemPrompt,
    userPrompt,
    maxOutputTokens: 120,
    temperature: 0.8,
    responseFormat: 'text',
  });
  if (!result) {
    logger.debug(
      { discord_id: message.author.id, severity },
      'automod: nudge skipped — LLM router returned null',
    );
    return; // Spec: silent skip on LLM failure.
  }
  const text = result.text
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s*\n+\s*/g, ' ');
  if (!text) return;
  try {
    await message.reply({ content: text, allowedMentions: { repliedUser: false } });
  } catch (err) {
    logger.warn({ err, discord_id: message.author.id }, 'automod: nudge reply failed');
  }
}

async function tryPostCleanupLine(
  message: Message,
  ruleId: 'profanity' | 'spam',
  offenderName: string,
): Promise<void> {
  const line =
    ruleId === 'profanity'
      ? `🧹 Aki dọn dẹp giùm tông môn nha — **${offenderName}** lặp lại vong ngôn quá nhiều, em đã thu hồi ✿`
      : `🧹 Aki dọn rác chút — **${offenderName}** lặp lại tin nhắn quá nhiều, em đã thu hồi ✿`;
  try {
    const channel = message.channel as unknown as
      | { send?: (c: string) => Promise<unknown> }
      | undefined;
    if (channel && typeof channel.send === 'function') {
      await channel.send(line);
    }
  } catch (err) {
    logger.warn({ err, discord_id: message.author.id }, 'automod: cleanup line failed');
  }
}

async function handleProfanityNudge(message: Message, count: number): Promise<void> {
  const now = Date.now();
  const last = lastNudgeAt.get(message.author.id) ?? 0;
  if (now - last < NUDGE_COOLDOWN_MS) {
    return; // Per-user 30s cooldown to avoid LLM spam.
  }
  lastNudgeAt.set(message.author.id, now);

  const severity: 'gentle' | 'stern' = count >= STERN_THRESHOLD ? 'stern' : 'gentle';
  const respectfulTone = isStaff(message.member);
  await trySendNudge(message, severity, respectfulTone);

  logger.info(
    {
      discord_id: message.author.id,
      tag: message.author.tag,
      profanity_count: count,
      severity,
      respectful: respectfulTone,
    },
    'automod: profanity nudge sent (graduated tier)',
  );
}

export async function applyDecision(message: Message, decision: AutomodDecision): Promise<void> {
  const { rule, hit } = decision;
  const reason = `automod:${rule.id} — ${hit.reason}`;

  // Phase 11.2 / A6 — graduated profanity branch. Sub-15 counts in the
  // 60s window get a nudge instead of a destructive action. Counter is
  // already incremented inside the profanity rule. Staff (Chưởng Môn /
  // Trưởng Lão / Chấp Pháp) stay in the nudge tier no matter how high
  // the count climbs — they get respectful-tone reminders but their
  // messages are NEVER deleted.
  if (rule.id === 'profanity') {
    const count = typeof hit.context?.profanityCount === 'number' ? hit.context.profanityCount : 0;
    const memberIsStaff = isStaff(message.member);
    if (memberIsStaff || count < DELETE_THRESHOLD) {
      await handleProfanityNudge(message, count);
      return;
    }
  }

  // Phase 11.2 — capture display name BEFORE delete (after delete the
  // message ref still works but member may be gone if action=kick).
  const offenderName = resolveDisplayName(message);

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

  // Phase 11.2 — public-channel cleanup line. Bill: "Aki dọn dẹp rác
  // rồi xoá các tin nhắn chửi tục thì sẽ thú vị hơn". Without this
  // line the deletion looks silent and other members can't tell who
  // disappeared or why. Profanity-at-delete-tier and spam are the
  // two places this matters most — both repeat-offender flows.
  if (rule.id === 'profanity' || rule.id === 'spam') {
    await tryPostCleanupLine(message, rule.id, offenderName);
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

  // Phase 11.2 / A6b — Thiên Đạo narration replaces the legacy bot-log
  // one-liner. narratePunishment always returns a string (graceful
  // static fallback) so postBotLog never gets an empty payload.
  const narration = await narratePunishment({
    userDisplayName: resolveDisplayName(message),
    ruleId: rule.id,
    action: rule.action,
  });
  await postBotLog(`${narration}\n_(\`${rule.id}\` · ${rule.action} · ${message.author.tag})_`);
}

export const __for_testing = {
  lastNudgeAt,
  NUDGE_COOLDOWN_MS,
  STERN_THRESHOLD,
  DELETE_THRESHOLD,
};
