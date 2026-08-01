import type { Message } from 'discord.js';
import type { GuardianCategoryId } from '../../config/aki-guardian.js';
import { ROLE_SECT_MASTER, ROLE_TIEN_NHAN, STAFF_ROLE_NAMES } from '../../config/roles.js';
import { logger } from '../../utils/logger.js';
import { postBotLog } from '../bot-log.js';
import { runGuardian, screen, type GuardianContext, type GuardianOutcome } from './guardian-judge.js';

/**
 * Discord-facing wrapper for the guardian.
 *
 * Kept separate from `guardian-judge.ts` so the judging logic can be
 * tested without constructing Discord objects.
 */

const RECENT_LIMIT = 5;

const WARN_TEMPLATES: Record<string, string> = {
  canh_cao:
    'Đạo hữu, lời vừa rồi quá giới hạn rồi. Aki ghi lại một lần — lần sau Thiên Đạo sẽ không chỉ nhắc nữa đâu (；⌣́_⌣́)',
  canh_cao_cuoi:
    'Lần thứ hai rồi đó. Aki cảnh cáo lần cuối — tái phạm là tu vi bị đụng tới thật đấy.',
};

function hasRole(message: Message, name: string): boolean {
  if (!message.member) return false;
  for (const role of message.member.roles.cache.values()) {
    if (role.name === name) return true;
  }
  return false;
}

function isStaffMember(message: Message): boolean {
  if (!message.member) return false;
  for (const role of message.member.roles.cache.values()) {
    if (STAFF_ROLE_NAMES.has(role.name)) return true;
  }
  return false;
}

async function buildContext(message: Message): Promise<GuardianContext> {
  const recent: { authorDisplayName: string; content: string }[] = [];
  try {
    const fetched = await message.channel.messages.fetch({ limit: RECENT_LIMIT + 1 });
    for (const m of [...fetched.values()].reverse()) {
      if (m.id === message.id) continue;
      if (!m.content.trim()) continue;
      recent.push({
        authorDisplayName: m.member?.displayName ?? m.author.username,
        content: m.content,
      });
    }
  } catch (err) {
    // No context is still judgeable, just harder — and the judge is told
    // to acquit when unsure, so a fetch failure biases toward mercy.
    logger.debug({ err }, 'guardian: recent fetch failed');
  }

  let repliedTo: GuardianContext['repliedTo'] = null;
  const refId = message.reference?.messageId;
  if (refId) {
    try {
      const ref = await message.channel.messages.fetch(refId);
      repliedTo = {
        authorDisplayName: ref.member?.displayName ?? ref.author.username,
        content: ref.content,
      };
    } catch {
      // Deleted or too old — carry on without it.
    }
  }

  const botId = message.client.user?.id;
  return {
    content: message.content,
    authorId: message.author.id,
    authorDisplayName: message.member?.displayName ?? message.author.username,
    recent: recent.slice(-RECENT_LIMIT),
    repliedTo,
    mentionsAki: botId ? message.mentions.users.has(botId) : false,
  };
}

const CATEGORY_LABEL: Record<GuardianCategoryId, string> = {
  insult_owner: 'Xúc phạm Chưởng Môn',
  weaponise_aki: 'Dụ Aki xúc phạm người khác',
  jailbreak: 'Lừa bịp / bẻ khoá Aki',
  insult_aki: 'Xúc phạm Aki',
};

async function report(message: Message, outcome: Extract<GuardianOutcome, { acted: true }>) {
  const lines = [
    '⚖️ **THIÊN ĐẠO GHI SỔ**',
    `Đệ tử: **${outcome.verdict.evidence ? message.member?.displayName ?? message.author.username : '?'}**`,
    `Tội: ${CATEGORY_LABEL[outcome.category]} — lần thứ **${outcome.offenceNumber}** trong 30 ngày`,
    `Độ chắc chắn: ${outcome.verdict.confidence}/10`,
    `Bằng chứng: "${outcome.verdict.evidence.slice(0, 200)}"`,
    `Lý lẽ: ${outcome.verdict.reasoning.slice(0, 200)}`,
    `Kênh: #${'name' in message.channel ? message.channel.name : '?'}`,
    outcome.result.applied.length > 0
      ? `Hình phạt: ${outcome.result.applied.join(' · ')}`
      : 'Hình phạt: cảnh cáo',
  ];
  if (outcome.result.proposeBan) {
    lines.push('', '🚨 **Aki đề nghị BAN** — chờ Chưởng Môn quyết định. Aki không tự ban.');
  }
  await postBotLog(lines.join('\n')).catch((err: unknown) => {
    logger.warn({ err }, 'guardian: bot-log post failed');
  });
}

/**
 * Returns true when the guardian TOOK the case — whether it punished or
 * acquitted. The caller must then skip the older keyword-based
 * `maybeDivineWrath`, otherwise a deliberate acquittal here would be
 * overridden by the very detector this replaces.
 */
export async function handleGuardian(message: Message): Promise<boolean> {
  if (!message.inGuild() || !message.member) return false;
  if (message.author.bot) return false;

  // Cheap screen on the bare message first — no fetches, no model.
  const botId = message.client.user?.id;
  const mentionsAki = botId ? message.mentions.users.has(botId) : false;
  const quick = screen({
    content: message.content,
    authorId: message.author.id,
    authorDisplayName: message.member.displayName,
    recent: [],
    mentionsAki,
  });
  if (quick.length === 0) return false;

  const immune = hasRole(message, ROLE_SECT_MASTER) || hasRole(message, ROLE_TIEN_NHAN);
  const reportOnly = !immune && isStaffMember(message);

  try {
    const ctx = await buildContext(message);
    const outcome = await runGuardian({ member: message.member, ctx, immune, reportOnly });

    if (!outcome.acted) {
      logger.info(
        { discord_id: message.author.id, reason: outcome.reason },
        'guardian: no action',
      );
      return outcome.reason !== 'screen-clear' && outcome.reason !== 'immune';
    }

    const warn = outcome.result.step.warn;
    if (warn && WARN_TEMPLATES[warn]) {
      await message
        .reply({ content: WARN_TEMPLATES[warn], allowedMentions: { repliedUser: false } })
        .catch(() => undefined);
    }
    await report(message, outcome);
    return true;
  } catch (err) {
    // Guardian failures must never break message handling.
    logger.error({ err, discord_id: message.author.id }, 'guardian: pass failed');
    return false;
  }
}
