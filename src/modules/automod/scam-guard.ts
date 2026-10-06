import type { Message } from 'discord.js';
import { ulid } from 'ulid';
import { getStore } from '../../db/index.js';
import { logger } from '../../utils/logger.js';
import { postBotLog } from '../bot-log.js';

/**
 * Scam guard: stops the "free money from MrBeast + @everyone" raids that a
 * hacked account sprays across every channel in a minute (29/09/2026, ~38
 * channels, 4 images each). It runs for EVERYONE except the server owner,
 * staff included, because the account that did it held Trưởng Lão: a stolen
 * account keeps its roles, so roles prove nothing here.
 *
 * It fires on any of:
 *   - the same author posting in BURST_CHANNELS different channels within
 *     BURST_WINDOW_MS (no human chats like that);
 *   - @everyone / @here together with an attachment or a link;
 *   - scam words (MrBeast, free money, nitro, airdrop…) together with an
 *     attachment, a link or a mass ping.
 *
 * Response: delete the message and every message of the burst, time the
 * member out for LOCK_MS (the account is probably stolen; staff lift it
 * once the owner has secured it), and alert #bot-log.
 */

/** Channels in one window that count as a raid when the message carries an image, link or ping... */
export const BURST_CHANNELS = 4;
/** ...and without any of those. */
export const BURST_CHANNELS_PLAIN = 6;
export const BURST_WINDOW_MS = 90_000;
export const LOCK_MS = 7 * 24 * 3600 * 1000;

const SCAM_WORDS =
  /mr\.?\s*beast|free\s*(money|nitro|robux|v-?bucks|crypto)|nitro\s*(free|gift)|steam\s*gift|airdrop|giveaway|claim\s*(your|now)|\$\s?\d{2,}\s*(usd)?\s*(free|gift)|tiền\s*(miễn\s*phí|free)|nhận\s*(quà|tiền)\s*(miễn\s*phí|free)/i;
const LINK = /https?:\/\/|discord\.gg\/|\bwww\./i;
const MASS_PING = /@(everyone|here)/;

export interface ScamSignal {
  content: string;
  attachments: number;
  embeds: number;
  /** Discord resolved a real @everyone/@here ping. */
  pingsEveryone: boolean;
}

export type ScamVerdict = { scam: false } | { scam: true; reason: string };

/** Content-only check for one message. */
export function judgeMessage(m: ScamSignal): ScamVerdict {
  const mass = m.pingsEveryone || MASS_PING.test(m.content);
  const media = m.attachments > 0 || m.embeds > 0 || LINK.test(m.content);
  if (mass && media) return { scam: true, reason: '@everyone kèm ảnh hoặc link' };
  if (SCAM_WORDS.test(m.content) && (media || mass))
    return { scam: true, reason: 'nội dung lừa đảo (MrBeast / tiền free / nitro…)' };
  return { scam: false };
}

/** Many channels at once is a raid; fewer still is when the message carries something to click or a ping. */
export function isBurst(channels: number, m: ScamSignal): boolean {
  const loaded =
    m.attachments > 0 ||
    m.embeds > 0 ||
    LINK.test(m.content) ||
    m.pingsEveryone ||
    MASS_PING.test(m.content);
  return channels >= (loaded ? BURST_CHANNELS : BURST_CHANNELS_PLAIN);
}

interface Seen {
  channelId: string;
  messageId: string;
  at: number;
}

/** Recent messages per author, to spot one account posting across many channels at once. */
export class BurstTracker {
  private readonly byAuthor = new Map<string, Seen[]>();

  record(authorId: string, seen: Seen): Seen[] {
    const recent = (this.byAuthor.get(authorId) ?? []).filter(
      (s) => seen.at - s.at <= BURST_WINDOW_MS,
    );
    recent.push(seen);
    this.byAuthor.set(authorId, recent);
    if (this.byAuthor.size > 5000) {
      for (const [id, list] of this.byAuthor)
        if (seen.at - (list.at(-1)?.at ?? 0) > BURST_WINDOW_MS) this.byAuthor.delete(id);
    }
    return recent;
  }

  channelsIn(recent: Seen[]): number {
    return new Set(recent.map((s) => s.channelId)).size;
  }

  clear(authorId: string): void {
    this.byAuthor.delete(authorId);
  }
}

export const burstTracker = new BurstTracker();
const lockedRecently = new Map<string, number>();

/**
 * Returns true when the message was a scam and has been handled; the caller
 * must stop processing it.
 */
export async function scamGuard(message: Message): Promise<boolean> {
  if (!message.inGuild() || message.author.bot) return false;
  if (message.guild.ownerId === message.author.id) return false;

  const now = message.createdTimestamp;
  const recent = burstTracker.record(message.author.id, {
    channelId: message.channelId,
    messageId: message.id,
    at: now,
  });
  const signal: ScamSignal = {
    content: message.content,
    attachments: message.attachments.size,
    embeds: message.embeds.length,
    pingsEveryone: message.mentions.everyone,
  };
  const burst = isBurst(burstTracker.channelsIn(recent), signal);
  const verdict = judgeMessage(signal);
  if (!burst && !verdict.scam) return false;
  const reason = verdict.scam
    ? verdict.reason
    : `đăng vào ${burstTracker.channelsIn(recent)} kênh trong ${BURST_WINDOW_MS / 1000} giây`;

  // Delete this message and the rest of the burst.
  const targets = burst
    ? recent
    : [{ channelId: message.channelId, messageId: message.id, at: now }];
  await Promise.all(
    targets.map(async (t) => {
      try {
        const channel = await message.guild.channels.fetch(t.channelId);
        if (channel?.isTextBased()) await channel.messages.delete(t.messageId);
      } catch {
        // already gone or no permission; the alert below still goes out
      }
    }),
  );

  const already = (lockedRecently.get(message.author.id) ?? 0) > now - BURST_WINDOW_MS;
  if (already) return true;
  lockedRecently.set(message.author.id, now);
  burstTracker.clear(message.author.id);

  let locked = false;
  try {
    if (message.member?.moderatable) {
      await message.member.timeout(LOCK_MS, `Scam guard: ${reason}`);
      locked = true;
    }
  } catch (err) {
    logger.warn({ err, discord_id: message.author.id }, 'scam-guard: timeout failed');
  }

  await getStore().automodLogs.append({
    id: ulid(),
    discord_id: message.author.id,
    rule: 'scam',
    action: locked ? 'timeout' : 'delete',
    context: { reason, deleted: targets.length, channel_id: message.channelId },
    created_at: now,
  });
  logger.warn(
    { discord_id: message.author.id, reason, deleted: targets.length, locked },
    'scam-guard: fired',
  );
  await postBotLog(
    [
      `🚨 **Chặn spam lừa đảo** — <@${message.author.id}> (${message.author.tag})`,
      `Lý do: ${reason}. Đã xoá ${targets.length} tin.`,
      locked
        ? 'Tài khoản đã bị khoá chat 7 ngày. Nhiều khả năng tài khoản bị hack: liên hệ chủ tài khoản đổi mật khẩu, bật 2FA, rồi staff gỡ khoá.'
        : '⚠️ Không khoá được (role cao hơn bot). Staff xử lý tay ngay.',
    ].join('\n'),
  );
  return true;
}
