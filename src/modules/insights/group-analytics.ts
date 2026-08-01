import type { Client } from 'discord.js';
import { rankById } from '../../config/cultivation.js';
import { getStore } from '../../db/index.js';
import { logger } from '../../utils/logger.js';
import { postBotLog } from '../bot-log.js';
import { llm } from '../llm/index.js';

/**
 * Phase 15 — weekly activity analytics for the sect leaders.
 *
 * Answers "who is actually active, who went quiet, how is the group
 * trending" from data we already store, then has a free model write the
 * two-paragraph read-out.
 *
 * Deliberately arithmetic-first: every number below is COUNTED from
 * `xp_logs` / `users`, and the model only ever writes prose about numbers
 * it is handed. It is never asked to compute or recall a statistic —
 * small models are unreliable at arithmetic and a wrong headcount in a
 * leadership report is worse than no report.
 *
 * Window is 7 days, which sits comfortably inside the 30-day xp_logs
 * retention (see `Store.pruneVolatileXpLogsNoLock`).
 */

const WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Members listed by name in each section of the digest. */
const TOP_N = 8;
/** Quiet = no activity in the window but active in the window before it. */
const MAX_WENT_QUIET = 6;

interface ActivityRow {
  discordId: string;
  name: string;
  messages: number;
  voiceTicks: number;
  xp: number;
  rankName: string;
}

export interface WeeklyStats {
  windowDays: number;
  totalMembers: number;
  activeNow: number;
  activePrev: number;
  newcomers: number;
  totalMessages: number;
  totalVoiceHours: number;
  top: ActivityRow[];
  wentQuiet: { name: string; rankName: string }[];
}

/** Count everything from the store. No model involved. */
export function computeWeeklyStats(now = Date.now()): WeeklyStats {
  const store = getStore();
  const windowStart = now - WINDOW_DAYS * DAY_MS;
  const prevStart = now - 2 * WINDOW_DAYS * DAY_MS;

  const cur = new Map<string, { messages: number; voiceTicks: number; xp: number }>();
  const prev = new Set<string>();

  store.xpLogs.query((l) => {
    const at = l.created_at as number;
    const id = l.discord_id as string;
    if (at >= windowStart) {
      const e = cur.get(id) ?? { messages: 0, voiceTicks: 0, xp: 0 };
      if (l.source === 'message') e.messages++;
      else if (l.source === 'voice' || l.source === 'voice_working') e.voiceTicks++;
      e.xp += (l.amount as number) ?? 0;
      cur.set(id, e);
    } else if (at >= prevStart) {
      prev.add(id);
    }
    return false; // counting only — never materialise the rows
  });

  const users = store.users.query(() => true);
  const byId = new Map(users.map((u) => [u.discord_id, u]));

  const rows: ActivityRow[] = [...cur.entries()].map(([id, e]) => {
    const u = byId.get(id);
    return {
      discordId: id,
      name: u?.display_name || u?.username || id,
      messages: e.messages,
      voiceTicks: e.voiceTicks,
      xp: e.xp,
      rankName: u ? rankById(u.cultivation_rank).name : '?',
    };
  });
  rows.sort((a, b) => b.xp - a.xp);

  // Active last week, silent this week — the signal leaders actually act on.
  const wentQuiet = [...prev]
    .filter((id) => !cur.has(id))
    .map((id) => {
      const u = byId.get(id);
      return {
        name: u?.display_name || u?.username || id,
        rankName: u ? rankById(u.cultivation_rank).name : '?',
      };
    })
    .slice(0, MAX_WENT_QUIET);

  // One voice tick = one minute of presence (see leveling/voice-xp.ts).
  const totalVoiceTicks = rows.reduce((s, r) => s + r.voiceTicks, 0);

  return {
    windowDays: WINDOW_DAYS,
    totalMembers: users.length,
    activeNow: cur.size,
    activePrev: prev.size,
    newcomers: users.filter((u) => (u.joined_at ?? 0) >= windowStart).length,
    totalMessages: rows.reduce((s, r) => s + r.messages, 0),
    totalVoiceHours: Math.round((totalVoiceTicks / 60) * 10) / 10,
    top: rows.slice(0, TOP_N),
    wentQuiet,
  };
}

const ANALYTICS_SYSTEM_PROMPT = [
  'Bạn là quân sư của một tông môn (cộng đồng Discord). Bạn nhận SỐ LIỆU ĐÃ ĐẾM SẴN',
  'về hoạt động 7 ngày qua và viết nhận định ngắn cho ban quản lý.',
  '',
  'Viết tiếng Việt, 2 đoạn ngắn:',
  '1) Không khí chung tuần này (sôi nổi hay trầm, so với tuần trước).',
  '2) Điều đáng chú ý + 1-2 đề xuất cụ thể cho ban quản lý.',
  '',
  'QUY TẮC:',
  '- CHỈ dùng đúng các con số được cung cấp. TUYỆT ĐỐI KHÔNG tự tính, tự bịa số mới.',
  '- Không bịa tên người không có trong dữ liệu.',
  '- Nói thẳng, không sáo rỗng. Tối đa 150 từ. Không markdown heading, không bảng.',
].join('\n');

function statsToPrompt(s: WeeklyStats): string {
  const trend =
    s.activePrev === 0
      ? 'không có dữ liệu tuần trước'
      : s.activeNow > s.activePrev
        ? `tăng (tuần trước ${s.activePrev} người)`
        : s.activeNow < s.activePrev
          ? `giảm (tuần trước ${s.activePrev} người)`
          : `đi ngang (tuần trước ${s.activePrev} người)`;
  return [
    `Tổng thành viên: ${s.totalMembers}`,
    `Hoạt động trong 7 ngày: ${s.activeNow} người — ${trend}`,
    `Thành viên mới trong tuần: ${s.newcomers}`,
    `Tổng tin nhắn tính XP: ${s.totalMessages}`,
    `Tổng giờ voice: ${s.totalVoiceHours}`,
    `Tích cực nhất: ${s.top.map((r) => `${r.name} (${r.rankName}, ${r.messages} tin, ${r.xp} XP)`).join('; ') || 'không có'}`,
    `Tuần trước có hoạt động nhưng tuần này im: ${s.wentQuiet.map((q) => `${q.name} (${q.rankName})`).join('; ') || 'không có'}`,
  ].join('\n');
}

/** Build the digest text. Exported so it can be tested without Discord. */
export async function buildWeeklyDigest(stats: WeeklyStats): Promise<string> {
  const lines = [
    '📊 **Analytics hoạt động — 7 ngày qua**',
    `Thành viên hoạt động: **${stats.activeNow}**/${stats.totalMembers}` +
      (stats.activePrev > 0 ? ` _(tuần trước ${stats.activePrev})_` : ''),
    `Tin nhắn: **${stats.totalMessages}** · Voice: **${stats.totalVoiceHours}h** · Người mới: **${stats.newcomers}**`,
    '',
  ];

  if (stats.top.length > 0) {
    lines.push('**Tích cực nhất**');
    stats.top.forEach((r, i) => {
      lines.push(`${i + 1}. ${r.name} _(${r.rankName})_ — ${r.messages} tin, ${r.xp} XP`);
    });
    lines.push('');
  }

  if (stats.wentQuiet.length > 0) {
    lines.push(`**Tuần trước có, tuần này im** — ${stats.wentQuiet.map((q) => q.name).join(', ')}`);
    lines.push('');
  }

  // Model writes only the commentary, never the numbers above.
  const result = await llm.complete('group-analytics', {
    systemPrompt: ANALYTICS_SYSTEM_PROMPT,
    userPrompt: statsToPrompt(stats),
    maxOutputTokens: 700,
    temperature: 0.5,
  });
  if (result) {
    lines.push('**Nhận định**');
    lines.push(result.text.trim());
  } else {
    // Numbers are the point; commentary is the garnish. Ship without it.
    lines.push('_(không gọi được model để viết nhận định — số liệu ở trên vẫn đúng)_');
  }

  return lines.join('\n');
}

/**
 * Weekly entry point. Never throws — the scheduler treats a failure as a
 * skipped week.
 */
export async function runWeeklyAnalytics(_client: Client): Promise<void> {
  try {
    const stats = computeWeeklyStats();
    const digest = await buildWeeklyDigest(stats);

    // Discord caps a message at 2000 chars.
    const LIMIT = 1900;
    let buf = '';
    for (const line of digest.split('\n')) {
      if (buf.length + line.length + 1 > LIMIT) {
        await postBotLog(buf);
        buf = '';
      }
      buf += (buf ? '\n' : '') + line;
    }
    if (buf.trim()) await postBotLog(buf);

    logger.info(
      {
        active: stats.activeNow,
        prev: stats.activePrev,
        messages: stats.totalMessages,
        voice_hours: stats.totalVoiceHours,
        quiet: stats.wentQuiet.length,
      },
      'group-analytics: weekly digest posted',
    );
  } catch (err) {
    logger.error({ err }, 'group-analytics: run failed');
  }
}
