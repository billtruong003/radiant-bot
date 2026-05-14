import type { Message } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { postBotLog } from '../bot-log.js';
import { judgeAndPunish } from './divine-judgment.js';

/**
 * Phase 12.5 — Aki auto-defense.
 *
 * Bill 2026-05-14: "update tính năng để Aki tự xử lý mấy thằng chửi Aki
 * hoặc Thiên Đạo sẽ trừng phạt vì đụng đến em ghệ Aki".
 *
 * When a non-staff member's message mentions Aki (or alt NPCs) + contains
 * an insult token, we auto-invoke the existing `judgeAndPunish()`
 * pipeline with an auto-built crime description. Thiên Đạo (LLM) decides
 * the punishment from the standard menu and applies it.
 *
 * Design choices:
 *   - HEURISTIC, not LLM, for detection — fast + free + deterministic.
 *     Per-user 1h cooldown stops spam-triggering.
 *   - Staff exempt (already filtered upstream in messageCreate).
 *   - Skip if profanity already fired on the same message (the offender
 *     is already being handled by the graduated profanity tier).
 *   - Skip the bot's own messages obviously.
 *
 * False-positive avoidance — only fires when ALL of:
 *   1. Message mentions Aki / Akira / Meifeng as a word (not substring)
 *   2. Message contains ≥1 insult token
 *   3. User not staff, not on cooldown
 */

const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour per user

// Word-boundary-aware Aki name patterns. We do `\b<name>\b` so "akimichu"
// or "aki-tea" don't false-trigger. Diacritic-normalized lowercase compare.
const AKI_NAMES = ['aki', 'akira', 'meifeng', 'mei phong', 'mỹ phụng'];

// VN + EN insult tokens. Conservative — clear pejoratives only, no
// ambiguous words. Lowercased + diacritic-stripped before match. The
// match is full-word so "gà" won't match "gàn" (close enough VN nuance).
const INSULT_TOKENS = [
  // VN gen-z pejoratives
  'gà',
  'ga',
  'ngu',
  'dở',
  'do',
  'dở hơi',
  'do hoi',
  'kém',
  'kem',
  'đần',
  'dan',
  'óc chó',
  'oc cho',
  'óc tôm',
  'oc tom',
  'óc cá vàng',
  'oc ca vang',
  'khùng',
  'khung',
  'điên',
  'dien',
  'rảnh',
  'ranh',
  'cứt',
  'cut',
  'ghẻ',
  'ghe',
  'tệ',
  'te',
  // EN pejoratives
  'dumb',
  'stupid',
  'useless',
  'trash',
  'lame',
  'noob',
  'sucks',
  'bad bot',
];

function normalizeForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface DetectionResult {
  isInsult: boolean;
  matchedName: string | null;
  matchedInsult: string | null;
}

/**
 * Pure detector. Returns whether the message text targets Aki/NPC with
 * an insult, and which tokens matched (for logging + crime description).
 * No I/O.
 */
export function detectAkiInsult(content: string): DetectionResult {
  if (!content || content.trim().length === 0) {
    return { isInsult: false, matchedName: null, matchedInsult: null };
  }
  const normalized = normalizeForMatch(content);

  // Find at least one Aki/NPC name as a whole word.
  let nameHit: string | null = null;
  for (const name of AKI_NAMES) {
    const norm = normalizeForMatch(name);
    const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegex(norm)}(?:$|[^\\p{L}\\p{N}])`, 'u');
    if (re.test(normalized)) {
      nameHit = name;
      break;
    }
  }
  if (!nameHit) return { isInsult: false, matchedName: null, matchedInsult: null };

  // Find at least one insult token as whole word.
  let insultHit: string | null = null;
  for (const token of INSULT_TOKENS) {
    const norm = normalizeForMatch(token);
    const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegex(norm)}(?:$|[^\\p{L}\\p{N}])`, 'u');
    if (re.test(normalized)) {
      insultHit = token;
      break;
    }
  }
  if (!insultHit) return { isInsult: false, matchedName: nameHit, matchedInsult: null };

  return { isInsult: true, matchedName: nameHit, matchedInsult: insultHit };
}

// In-memory cooldown — per-user. 1h after a divine wrath fires, the
// same user can't re-trigger.
const cooldowns: Map<string, number> = new Map();

export function isOnCooldown(userId: string, now: number = Date.now()): boolean {
  const expiry = cooldowns.get(userId);
  if (expiry === undefined) return false;
  if (now >= expiry) {
    cooldowns.delete(userId);
    return false;
  }
  return true;
}

export function recordWrath(userId: string, now: number = Date.now()): void {
  cooldowns.set(userId, now + COOLDOWN_MS);
}

export function reset(): void {
  cooldowns.clear();
}

export interface MaybeDivineWrathInput {
  message: Message;
  isStaff: boolean;
}

/**
 * Check if a message qualifies for Aki auto-defense + trigger divine
 * judgment if so. Best-effort: any failure logs but doesn't throw —
 * messageCreate handler never crashes over a defense miss.
 *
 * Returns true if wrath was triggered (caller may want to skip XP
 * earning for that message).
 */
export async function maybeDivineWrath(input: MaybeDivineWrathInput): Promise<boolean> {
  const { message, isStaff } = input;
  if (isStaff) return false;
  if (message.author.bot) return false;
  if (!message.inGuild() || !message.member) return false;

  const detection = detectAkiInsult(message.content);
  if (!detection.isInsult) return false;
  if (isOnCooldown(message.author.id)) {
    logger.debug(
      { discord_id: message.author.id, content: message.content.slice(0, 80) },
      'aki-defense: insult detected but user on cooldown',
    );
    return false;
  }

  recordWrath(message.author.id);

  // Auto-build crime description. Quote the offending line + identify
  // which NPC was attacked. Trimmed to 500 chars max to keep LLM prompt
  // bounded.
  const quoted = message.content.slice(0, 400);
  const crimeDescription = [
    `Đệ tử "${message.member.displayName}" vừa chửi/khinh thường ${detection.matchedName ?? 'Aki'} trong kênh #${
      message.channel && 'name' in message.channel
        ? (message.channel as { name: string }).name
        : 'unknown'
    }.`,
    `Tin nhắn nguyên văn: "${quoted}"`,
    `Hành vi này xúc phạm hầu gái của tông môn — đáng bị xử phạt.`,
  ].join('\n');

  logger.info(
    {
      discord_id: message.author.id,
      tag: message.author.tag,
      matched_name: detection.matchedName,
      matched_insult: detection.matchedInsult,
      channel: message.channelId,
    },
    'aki-defense: insult detected — invoking Thiên Đạo',
  );

  try {
    const result = await judgeAndPunish({
      target: message.member,
      crimeDescription,
      accuserId: 'aki-auto-defense',
    });

    if (!result.ok) {
      logger.warn(
        { discord_id: message.author.id, reason: result.reason },
        'aki-defense: judgment failed (will not retry until cooldown expires)',
      );
      return false;
    }

    // Verdict in the channel where the insult happened (so observers see
    // immediate cosmic justice) + bot-log for staff audit.
    const channel = message.channel as unknown as
      | { send?: (c: { content: string; allowedMentions: { parse: never[] } }) => Promise<unknown> }
      | undefined;
    if (channel && typeof channel.send === 'function') {
      const publicLines = result.applied
        .filter((a) => a.result === 'applied')
        .map((a) => `• ${a.punishmentName} (${a.severity})`);
      await channel.send({
        content: [
          `⚖️ **Thiên Đạo đã giáng xuống** — kẻ nào dám chạm vào hầu gái của tông môn?`,
          '',
          `_${result.verdict}_`,
          '',
          ...(publicLines.length > 0
            ? ['**Hình phạt**:', ...publicLines]
            : ['_Chỉ công khai cảnh báo lần này._']),
        ].join('\n'),
        allowedMentions: { parse: [] },
      });
    }
    await postBotLog(
      `🛡️ **Aki auto-defense** triggered by **${message.author.tag}** — Thiên Đạo applied: ${
        result.applied
          .filter((a) => a.result === 'applied')
          .map((a) => a.punishmentName)
          .join(', ') || '_(none)_'
      }`,
    );

    return true;
  } catch (err) {
    logger.error(
      { err, discord_id: message.author.id },
      'aki-defense: divine wrath threw — letting message through',
    );
    return false;
  }
}

export const __for_testing = {
  AKI_NAMES,
  INSULT_TOKENS,
  COOLDOWN_MS,
  cooldowns,
  normalizeForMatch,
};
