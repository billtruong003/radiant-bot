import type { GuildMember } from 'discord.js';
import { CULTIVATION_RANKS, rankById } from '../../config/cultivation.js';
import {
  type DivinePunishment,
  type PunishmentId,
  loadPunishmentMenu,
} from '../../config/divine-punishments.js';
import { getStore } from '../../db/index.js';
import type { CultivationRankId, User } from '../../db/types.js';
import { logger } from '../../utils/logger.js';
import { sanitizeForLlmBody, sanitizeForLlmPrompt } from '../../utils/sanitize.js';
import { cumulativeXpForLevel } from '../leveling/engine.js';
import { llm } from '../llm/index.js';

/**
 * Phase 12.4 — Áp Chế Thiên Đạo.
 *
 * Tông Chủ runs /thien-dao with a target + crime description. We:
 *   1. Snapshot target's stats + recent automod history
 *   2. Send to LLM with Thiên Đạo cosmic-judge persona + the punishment
 *      menu — model picks 1-3 penalties + composes a 1-2 sentence verdict
 *   3. Parse + validate response (clamp severity into allowed range,
 *      drop unknown punishment IDs)
 *   4. Apply penalties atomically through existing entity APIs
 *   5. Return the judgment + applied results so the caller can post the
 *      narration to #bot-log
 *
 * Failure modes:
 *   - LLM down → return `{ ok: false, reason: 'llm-unavailable' }` so
 *     the caller can either retry or show a manual punishment menu.
 *   - Target has no user record → return `{ ok: false, reason: 'no-user' }`.
 *   - LLM picks an invalid punishment ID → silently filtered, judgment
 *     still applies if any valid penalty remains.
 */

const SYSTEM_PROMPT_TEMPLATE = `BẠN LÀ "Thiên Đạo" — phán quan tối cao của tông môn Radiant Tech Sect. Tông Chủ vừa triệu hồi bạn để xử phạt một đệ tử.

# Nhiệm vụ

Đọc:
1. Mô tả tội của đệ tử (do Tông Chủ tường thuật)
2. Snapshot trạng thái đệ tử (cấp độ, cảnh giới, currency, lịch sử automod)
3. Menu hình phạt khả dụng

→ Chọn 1-3 hình phạt phù hợp với tội. Cân nhắc:
- Tội nhẹ (cãi nhau, spam một-lần) → 1 hình phạt nhẹ
- Tội vừa (lặp lại profanity, vi phạm có ý đồ) → 1-2 hình phạt vừa
- Tội nặng (cố ý phá hoại, tấn công cá nhân) → 2-3 hình phạt nặng

Severity của mỗi hình phạt phải nằm trong range cho phép.

# Phong cách verdict

Viết 1-2 câu lời phán xử theo phong cách Thiên Đạo (cosmic VN xianxia voice):
- Trầm hùng, không giễu cợt
- KHÔNG dùng Hán tự (không 弟子, không 道)
- Có thể chêm: "thiên kiếp", "phong ấn", "đạo tâm", "vong ngôn"
- 80-200 ký tự

# Output — STRICT JSON

{
  "verdict": "1-2 câu VN phán quyết",
  "punishments": [
    { "id": "xp_deduct", "severity": 500 },
    { "id": "public_shame", "severity": 1 }
  ]
}

# Quy tắc cứng

1. CHỈ output JSON object, KHÔNG markdown fence.
2. CHỈ chọn punishment.id từ menu cho sẵn.
3. severity PHẢI trong [severity_min, severity_max] của từng punishment.
4. Mảng punishments phải có 1-{MAX_PUNISHMENTS} phần tử.
5. KHÔNG bịa punishment ID mới.
6. KHÔNG đe doạ thật / KHÔNG sỉ nhục cá nhân — chỉ thuần "thiên đạo phong ấn / cảnh báo".
`;

export interface JudgmentInput {
  target: GuildMember;
  /** Tông Chủ's free-text crime description. */
  crimeDescription: string;
  accuserId: string;
}

export interface JudgmentApplied {
  punishmentId: PunishmentId;
  punishmentName: string;
  severity: number;
  result: 'applied' | 'skipped';
  reason?: string;
}

export interface JudgmentResult {
  ok: boolean;
  reason?: 'llm-unavailable' | 'no-user' | 'llm-malformed' | 'no-valid-punishment';
  verdict: string;
  applied: JudgmentApplied[];
  /** Snapshot of target stats taken at judgment time. */
  targetSnapshot: {
    discord_id: string;
    display_name: string;
    level: number;
    rank: CultivationRankId;
    pills: number;
    contribution: number;
  };
}

interface LlmResponse {
  verdict: string;
  punishments: Array<{ id: string; severity: number }>;
}

function parseLlmJson(raw: string): LlmResponse | null {
  // Strip code fences + think blocks.
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .replace(/^<think>[\s\S]*?<\/think>\s*/i, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as Partial<LlmResponse>;
    if (typeof parsed.verdict !== 'string' || !Array.isArray(parsed.punishments)) {
      return null;
    }
    return {
      verdict: parsed.verdict,
      punishments: parsed.punishments
        .filter(
          (p): p is { id: string; severity: number } =>
            typeof p === 'object' &&
            p !== null &&
            typeof (p as { id?: unknown }).id === 'string' &&
            typeof (p as { severity?: unknown }).severity === 'number',
        )
        .map((p) => ({ id: p.id, severity: p.severity })),
    };
  } catch {
    return null;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function previousRank(rank: CultivationRankId): CultivationRankId | null {
  if (rank === 'pham_nhan') return null; // floor
  if (rank === 'tien_nhan') return null; // admin grant, don't auto-demote
  const idx = CULTIVATION_RANKS.findIndex((r) => r.id === rank);
  if (idx <= 0) return null;
  return CULTIVATION_RANKS[idx - 1]?.id ?? null;
}

async function applyPunishment(
  member: GuildMember,
  user: User,
  punishment: DivinePunishment,
  severity: number,
): Promise<JudgmentApplied> {
  const store = getStore();
  const id = punishment.id as PunishmentId;
  const clamped = clamp(severity, punishment.severity_min, punishment.severity_max);

  try {
    switch (id) {
      case 'xp_deduct': {
        const floor = cumulativeXpForLevel(user.level);
        const newXp = Math.max(floor, user.xp - clamped);
        const applied = user.xp - newXp;
        await store.users.set({ ...user, xp: newXp });
        return {
          punishmentId: id,
          punishmentName: punishment.name,
          severity: applied,
          result: 'applied',
        };
      }
      case 'pill_confiscate': {
        const newPills = Math.max(0, (user.pills ?? 0) - clamped);
        const actual = (user.pills ?? 0) - newPills;
        await store.users.set({ ...user, pills: newPills });
        return {
          punishmentId: id,
          punishmentName: punishment.name,
          severity: actual,
          result: 'applied',
        };
      }
      case 'contribution_deduct': {
        const newContrib = Math.max(0, (user.contribution_points ?? 0) - clamped);
        const actual = (user.contribution_points ?? 0) - newContrib;
        await store.users.set({ ...user, contribution_points: newContrib });
        return {
          punishmentId: id,
          punishmentName: punishment.name,
          severity: actual,
          result: 'applied',
        };
      }
      case 'rank_demote_one': {
        const prev = previousRank(user.cultivation_rank);
        if (!prev) {
          return {
            punishmentId: id,
            punishmentName: punishment.name,
            severity: 0,
            result: 'skipped',
            reason: 'already at floor or Tiên Nhân',
          };
        }
        await store.users.set({ ...user, cultivation_rank: prev });
        // Swap Discord role on best-effort.
        try {
          const oldRoleName = rankById(user.cultivation_rank).name;
          const newRoleName = rankById(prev).name;
          const oldRole = member.guild.roles.cache.find((r) => r.name === oldRoleName);
          const newRole = member.guild.roles.cache.find((r) => r.name === newRoleName);
          if (oldRole && newRole) {
            await member.roles.remove(oldRole, `divine judgment: demote to ${prev}`);
            await member.roles.add(newRole, `divine judgment: demote to ${prev}`);
          }
        } catch (err) {
          logger.warn({ err, discord_id: member.id }, 'divine: role swap failed (perm/hierarchy?)');
        }
        return {
          punishmentId: id,
          punishmentName: punishment.name,
          severity: 1,
          result: 'applied',
        };
      }
      case 'timeout_minutes': {
        if (!member.moderatable) {
          return {
            punishmentId: id,
            punishmentName: punishment.name,
            severity: 0,
            result: 'skipped',
            reason: 'member not moderatable',
          };
        }
        await member.timeout(clamped * 60 * 1000, 'divine judgment');
        return {
          punishmentId: id,
          punishmentName: punishment.name,
          severity: clamped,
          result: 'applied',
        };
      }
      case 'cong_phap_strip': {
        if (!user.equipped_cong_phap_slug) {
          return {
            punishmentId: id,
            punishmentName: punishment.name,
            severity: 0,
            result: 'skipped',
            reason: 'nothing equipped',
          };
        }
        await store.users.set({ ...user, equipped_cong_phap_slug: null });
        return {
          punishmentId: id,
          punishmentName: punishment.name,
          severity: 1,
          result: 'applied',
        };
      }
      case 'public_shame':
        return {
          punishmentId: id,
          punishmentName: punishment.name,
          severity: 1,
          result: 'applied',
        };
      default:
        return {
          punishmentId: id,
          punishmentName: punishment.name,
          severity: 0,
          result: 'skipped',
          reason: 'unknown punishment id',
        };
    }
  } catch (err) {
    logger.error({ err, discord_id: member.id, punishment: id }, 'divine: apply failed');
    return {
      punishmentId: id,
      punishmentName: punishment.name,
      severity: 0,
      result: 'skipped',
      reason: `apply error: ${(err as Error).message ?? 'unknown'}`,
    };
  }
}

export async function judgeAndPunish(input: JudgmentInput): Promise<JudgmentResult> {
  const store = getStore();
  const user = store.users.get(input.target.id);

  const targetSnapshot = {
    discord_id: input.target.id,
    display_name: input.target.displayName,
    level: user?.level ?? 0,
    rank: user?.cultivation_rank ?? ('pham_nhan' as CultivationRankId),
    pills: user?.pills ?? 0,
    contribution: user?.contribution_points ?? 0,
  };

  if (!user) {
    return {
      ok: false,
      reason: 'no-user',
      verdict: '',
      applied: [],
      targetSnapshot,
    };
  }

  // Sanitize the accuser's free-text — Tông Chủ might paste a chat log
  // containing other members' display names with injection attempts.
  const safeCrime = sanitizeForLlmBody(input.crimeDescription, { maxLen: 1500 });
  const safeName = sanitizeForLlmPrompt(input.target.displayName);

  const menu = await loadPunishmentMenu();
  const systemPrompt = SYSTEM_PROMPT_TEMPLATE.replace(
    '{MAX_PUNISHMENTS}',
    String(menu.max_punishments_per_judgment),
  );

  // Recent automod hits for context (last 7 days).
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentHits = store.automodLogs.query(
    (log) => log.discord_id === input.target.id && log.created_at >= sevenDaysAgo,
  );
  const automodSummary =
    recentHits.length === 0
      ? 'không có'
      : recentHits
          .slice(0, 5)
          .map((h) => `${h.rule}(${h.action})`)
          .join(', ');

  const menuLines = menu.punishments.map(
    (p) =>
      `  - id: ${p.id} · ${p.name} · range ${p.severity_min}..${p.severity_max} · ${p.description}`,
  );

  const userPrompt = [
    `# Tội của đệ tử "${safeName}" (do Tông Chủ tường thuật)`,
    safeCrime,
    '',
    `# Snapshot đệ tử`,
    `- Cấp độ: ${user.level}`,
    `- Cảnh giới: ${rankById(user.cultivation_rank).name}`,
    `- Đan dược: ${user.pills ?? 0}`,
    `- Cống hiến: ${user.contribution_points ?? 0}`,
    `- Automod hits 7 ngày: ${automodSummary}`,
    '',
    `# Menu hình phạt (CHỈ chọn id từ menu này)`,
    ...menuLines,
    '',
    `Trả về JSON theo schema đã nêu.`,
  ].join('\n');

  const result = await llm.complete('divine-judgment', {
    systemPrompt,
    userPrompt,
    maxOutputTokens: 600,
    temperature: 0.5,
    responseFormat: 'json',
  });

  if (!result) {
    return { ok: false, reason: 'llm-unavailable', verdict: '', applied: [], targetSnapshot };
  }

  const parsed = parseLlmJson(result.text);
  if (!parsed) {
    logger.error({ raw: result.text.slice(0, 200) }, 'divine: LLM response unparseable');
    return { ok: false, reason: 'llm-malformed', verdict: '', applied: [], targetSnapshot };
  }

  // Validate punishments against menu — drop unknown IDs.
  const menuById = new Map(menu.punishments.map((p) => [p.id, p]));
  const valid = parsed.punishments
    .filter((p) => menuById.has(p.id))
    .slice(0, menu.max_punishments_per_judgment);
  if (valid.length === 0) {
    return {
      ok: false,
      reason: 'no-valid-punishment',
      verdict: parsed.verdict,
      applied: [],
      targetSnapshot,
    };
  }

  // Apply each. Use the latest user record per iteration so multi-penalty
  // sequences see prior penalty deductions.
  const applied: JudgmentApplied[] = [];
  for (const p of valid) {
    const menuEntry = menuById.get(p.id);
    if (!menuEntry) continue;
    const freshUser = store.users.get(input.target.id);
    if (!freshUser) break;
    const out = await applyPunishment(input.target, freshUser, menuEntry, p.severity);
    applied.push(out);
  }

  logger.info(
    {
      target: input.target.id,
      accuser: input.accuserId,
      crime_len: safeCrime.length,
      applied: applied.map((a) => `${a.punishmentId}:${a.severity}:${a.result}`),
    },
    'divine: judgment executed',
  );

  return { ok: true, verdict: parsed.verdict, applied, targetSnapshot };
}

export const __for_testing = { parseLlmJson, previousRank, clamp };
