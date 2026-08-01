import { ChannelType, type Client, type Guild, type TextChannel } from 'discord.js';
import { env } from '../../config/env.js';
import { getStore } from '../../db/index.js';
import type { MemberProfile } from '../../db/types.js';
import { logger } from '../../utils/logger.js';
import { sanitizeForLlmBody, sanitizeForLlmPrompt } from '../../utils/sanitize.js';
import { postBotLog } from '../bot-log.js';
import { llm } from '../llm/index.js';
import { type MemberStanding, readStanding } from './standing.js';

/**
 * Phase 15 — member knowledge base.
 *
 * Reads recent public chat, asks a free model to distil a short character
 * sketch per active member, stores ONE row per member (updated in place),
 * and posts a digest to #bot-log.
 *
 * Two design rules, both learned the hard way in this repo:
 *
 *  1. RAW CHAT IS NEVER STORED. Messages are fetched from Discord at run
 *     time, fed to the model, and dropped. Only the distilled profile is
 *     persisted. Storing raw chat is what turned xp_logs into a 140k-row,
 *     47MB-of-heap problem, and it would be far worse here (message
 *     bodies, not counters).
 *  2. EVERYTHING IS BOUNDED — channels scanned, messages per channel,
 *     members profiled per run, and the length of every stored field.
 *     Nothing here may grow with time.
 *
 * These profiles are GUESSES from a small model over a limited window.
 * The digest says so, and `messages_analyzed` is stored alongside so a
 * thin profile is visibly thin.
 */

/** Max text channels to sample, newest-activity first. */
const MAX_CHANNELS = 6;
/** Messages pulled per channel (Discord caps a single fetch at 100). */
const MESSAGES_PER_CHANNEL = 100;
/** Members profiled per run — keeps one run to a handful of LLM calls. */
const MAX_MEMBERS_PER_RUN = 8;
/** Below this, there isn't enough signal to say anything honest. */
const MIN_MESSAGES_FOR_PROFILE = 8;
/** Per-message chars fed to the model. */
const MAX_MSG_LEN = 200;
/** Messages per member handed to the model. */
const MAX_SAMPLE_PER_MEMBER = 40;
/** Caps on stored strings, so a chatty model can't bloat a row. */
const MAX_SUMMARY_LEN = 400;
const MAX_TAG_LEN = 40;
const MAX_TAGS = 6;

const PROFILE_SYSTEM_PROMPT = [
  'Bạn là người quan sát cộng đồng. Dựa trên các tin nhắn công khai của MỘT thành viên,',
  'hãy suy luận chân dung ngắn gọn về họ.',
  '',
  'Trả về DUY NHẤT một JSON object, không kèm giải thích, không kèm markdown:',
  '{"summary": "2-3 câu tiếng Việt mô tả tính cách + cách họ tham gia cộng đồng",',
  ' "interests": ["chủ đề họ hay nói"], "tone": "cách nói chuyện của họ",',
  ' "expertise": ["thứ họ tỏ ra thành thạo"]}',
  '',
  'QUY TẮC:',
  '- Chỉ suy luận từ tin nhắn được cung cấp. KHÔNG bịa thêm.',
  '- Nếu dữ liệu quá ít để kết luận, hãy nói thẳng trong summary là chưa đủ dữ liệu.',
  '- Viết tôn trọng, trung lập. KHÔNG phán xét đạo đức, KHÔNG suy đoán về',
  '  giới tính, tuổi, tôn giáo, chính trị, sức khoẻ hay đời tư.',
  '- interests/expertise: tối đa 5 mục, mỗi mục vài từ.',
  '- Có thể nhắc tới vai trò của họ trong tông môn nếu tin nhắn phản ánh điều đó',
  '  (ví dụ người quản lý hay nhắc nội quy, người mới hay hỏi cách chơi).',
].join('\n');

interface InferredProfile {
  summary: string;
  interests: string[];
  tone: string;
  expertise: string[];
}

/** Trim + cap a model-supplied string. */
function capStr(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** Trim + cap a model-supplied string array. */
function capTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim().slice(0, MAX_TAG_LEN))
    .filter((v) => v.length > 0)
    .slice(0, MAX_TAGS);
}

/**
 * Parse the model's JSON. Models wrap JSON in ``` fences often enough that
 * stripping them is worth the three lines.
 */
function parseProfileJson(raw: string): InferredProfile | null {
  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  }
  // Tolerate leading prose before the object.
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>;
    const summary = capStr(parsed.summary, MAX_SUMMARY_LEN);
    if (!summary) return null;
    return {
      summary,
      interests: capTags(parsed.interests),
      tone: capStr(parsed.tone, MAX_TAG_LEN * 2),
      expertise: capTags(parsed.expertise),
    };
  } catch {
    return null;
  }
}

interface CollectedMessages {
  /** discord_id → their recent message bodies, oldest → newest. */
  byAuthor: Map<string, string[]>;
  /** discord_id → {username, displayName} seen on the messages. */
  identities: Map<string, { username: string; displayName: string | null }>;
  channelsScanned: number;
}

/**
 * Pull recent messages from the busiest text channels the bot can read.
 *
 * Skips bots and empty/attachment-only messages. Never returns the raw
 * Message objects — only the strings we need — so nothing heavy escapes
 * this function.
 */
async function collectRecentMessages(guild: Guild): Promise<CollectedMessages> {
  const byAuthor = new Map<string, string[]>();
  const identities = new Map<string, { username: string; displayName: string | null }>();
  let channelsScanned = 0;

  const textChannels = [...guild.channels.cache.values()]
    .filter((c): c is TextChannel => c.type === ChannelType.GuildText)
    .filter((c) => {
      const me = guild.members.me;
      return me ? c.permissionsFor(me)?.has('ReadMessageHistory') === true : false;
    })
    // Busiest-recent first so a run samples where people actually talk.
    .sort((a, b) => (b.lastMessageId ?? '').localeCompare(a.lastMessageId ?? ''))
    .slice(0, MAX_CHANNELS);

  for (const channel of textChannels) {
    try {
      const messages = await channel.messages.fetch({ limit: MESSAGES_PER_CHANNEL });
      channelsScanned++;
      for (const msg of messages.values()) {
        if (msg.author.bot) continue;
        const content = msg.content?.trim();
        if (!content) continue;
        const id = msg.author.id;
        if (!identities.has(id)) {
          identities.set(id, {
            username: msg.author.username,
            displayName: msg.member?.displayName ?? null,
          });
        }
        const list = byAuthor.get(id) ?? [];
        // Cheap guard: stop accumulating well past what we'd ever sample.
        if (list.length < MAX_SAMPLE_PER_MEMBER * 2) list.push(content);
        byAuthor.set(id, list);
      }
    } catch (err) {
      // One unreadable channel must not kill the run.
      logger.warn(
        { err, channel: channel.name },
        'member-profiles: channel fetch failed, skipping',
      );
    }
  }

  return { byAuthor, identities, channelsScanned };
}

/** One line of context prepended to the message sample. */
function standingLine(displayName: string, s: MemberStanding): string {
  const bits = [`Thành viên: ${sanitizeForLlmPrompt(displayName)}`];
  if (s.rankName) bits.push(`cảnh giới ${s.rankName}${s.level != null ? ` (cấp ${s.level})` : ''}`);
  if (s.isStaff) bits.push('LÀ BAN QUẢN LÝ tông môn');
  if (s.roles.length > 0) bits.push(`vai trò: ${s.roles.slice(0, 6).map((r) => sanitizeForLlmPrompt(r)).join(', ')}`);
  return bits.join(' · ');
}

/** Ask the model for one member's sketch. Returns null on any failure. */
async function inferOne(
  displayName: string,
  messages: readonly string[],
  standing: MemberStanding,
): Promise<InferredProfile | null> {
  const sample = messages
    .slice(-MAX_SAMPLE_PER_MEMBER)
    .map((m) => `- ${sanitizeForLlmBody(m, { maxLen: MAX_MSG_LEN })}`)
    .join('\n');

  const result = await llm.complete('member-profile', {
    systemPrompt: PROFILE_SYSTEM_PROMPT,
    userPrompt: `${standingLine(displayName, standing)}\n\nTin nhắn gần đây:\n${sample}`,
    maxOutputTokens: 800,
    temperature: 0.4,
    responseFormat: 'json',
  });
  if (!result) return null;
  return parseProfileJson(result.text);
}

/**
 * One full pass: collect → infer → persist → report.
 *
 * Never throws; the scheduler treats a failed run as a no-op and tries
 * again on the next tick.
 */
export async function runMemberProfiling(client: Client): Promise<void> {
  if (!env.MEMBER_PROFILING_ENABLED) return;

  const guild = client.guilds.cache.get(env.DISCORD_GUILD_ID);
  if (!guild) {
    logger.warn({ guild_id: env.DISCORD_GUILD_ID }, 'member-profiles: guild not in cache, skipping');
    return;
  }

  const started = Date.now();
  const { byAuthor, identities, channelsScanned } = await collectRecentMessages(guild);
  const store = getStore();

  // Stale-first rotation. Sorting by message count alone meant the same
  // 8 loudest members were re-profiled every single day while quieter
  // (but eligible) members NEVER got a profile — the knowledge base could
  // not become comprehensive. Now: members with no profile come first,
  // then oldest profile first; message count only breaks ties. Over
  // successive runs the budget sweeps the whole eligible population.
  const candidates = [...byAuthor.entries()]
    .filter(([, msgs]) => msgs.length >= MIN_MESSAGES_FOR_PROFILE)
    .sort((a, b) => {
      const staleA = store.memberProfiles.get(a[0])?.updated_at ?? 0;
      const staleB = store.memberProfiles.get(b[0])?.updated_at ?? 0;
      return staleA - staleB || b[1].length - a[1].length;
    })
    .slice(0, MAX_MEMBERS_PER_RUN);

  if (candidates.length === 0) {
    logger.info(
      { channels: channelsScanned, authors: byAuthor.size },
      'member-profiles: nobody met the message floor, skipping run',
    );
    return;
  }

  // Roles live on GuildMember, and discord.js only caches members it has
  // already seen — without this the roles array came back empty for
  // everyone (observed live 2026-07-28). Fetch exactly the candidates, not
  // the whole guild, so this stays bounded as the server grows.
  try {
    await guild.members.fetch({ user: candidates.map(([id]) => id) });
  } catch (err) {
    // Roles are enrichment, not the point — carry on without them.
    logger.warn({ err }, 'member-profiles: member fetch failed, roles will be empty');
  }

  const updated: {
    name: string;
    profile: InferredProfile;
    count: number;
    standing: MemberStanding;
  }[] = [];
  let failed = 0;

  for (const [discordId, messages] of candidates) {
    const identity = identities.get(discordId);
    const name = identity?.displayName || identity?.username || discordId;
    try {
      const standing = readStanding(guild, discordId);
      const inferred = await inferOne(name, messages, standing);
      if (!inferred) {
        failed++;
        continue;
      }
      const row: MemberProfile = {
        discord_id: discordId,
        username: identity?.username ?? '',
        display_name: identity?.displayName ?? null,
        summary: inferred.summary,
        interests: inferred.interests,
        tone: inferred.tone,
        expertise: inferred.expertise,
        messages_analyzed: messages.length,
        updated_at: Date.now(),
        roles: standing.roles,
        is_staff: standing.isStaff,
        cultivation_rank_name: standing.rankName ?? undefined,
        level: standing.level ?? undefined,
      };
      await store.memberProfiles.set(row);
      updated.push({ name, profile: inferred, count: messages.length, standing });
    } catch (err) {
      failed++;
      logger.warn({ err, discord_id: discordId }, 'member-profiles: inference failed for member');
    }
  }

  logger.info(
    {
      channels: channelsScanned,
      candidates: candidates.length,
      updated: updated.length,
      failed,
      duration_ms: Date.now() - started,
    },
    'member-profiles: run complete',
  );

  if (updated.length > 0) await postDigest(updated, channelsScanned, failed);
}

/** Post the run's findings to #bot-log, chunked under Discord's limit. */
async function postDigest(
  updated: { name: string; profile: InferredProfile; count: number }[],
  channelsScanned: number,
  failed: number,
): Promise<void> {
  const header = [
    '🧠 **Hồ sơ thành viên — cập nhật**',
    `_${updated.length} người · quét ${channelsScanned} kênh${failed > 0 ? ` · ${failed} lỗi` : ''}_`,
    '_Suy luận tự động từ tin nhắn công khai gần đây — chỉ mang tính tham khảo._',
    '',
  ].join('\n');

  const blocks = updated.map(({ name, profile, count }) => {
    const lines = [`**${name}** _(${count} tin)_`, profile.summary];
    if (profile.interests.length > 0) lines.push(`• Quan tâm: ${profile.interests.join(', ')}`);
    if (profile.expertise.length > 0) lines.push(`• Thạo: ${profile.expertise.join(', ')}`);
    if (profile.tone) lines.push(`• Giọng: ${profile.tone}`);
    return lines.join('\n');
  });

  // Discord hard-caps a message at 2000 chars; pack blocks without ever
  // splitting one member across two messages.
  const LIMIT = 1900;
  let current = header;
  for (const block of blocks) {
    if (current.length + block.length + 2 > LIMIT) {
      await postBotLog(current);
      current = '';
    }
    current += (current ? '\n\n' : '') + block;
  }
  if (current.trim()) await postBotLog(current);
}

export const __for_testing = { parseProfileJson, capTags, capStr };
