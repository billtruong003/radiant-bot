import type { Guild, GuildMember } from 'discord.js';
import { rankById } from '../../config/cultivation.js';
import { ROLE_SECT_MASTER, ROLE_TIEN_NHAN, STAFF_ROLE_NAMES } from '../../config/roles.js';
import { getStore } from '../../db/index.js';
import { sanitizeForLlmPrompt } from '../../utils/sanitize.js';

/**
 * Who someone is inside the sect: Discord roles, cultivation rank, level.
 *
 * All FACTS — read from Discord and the store, never inferred. Shared by
 * the member knowledge base (framing a character sketch) and by Aki's
 * answer path (knowing who she is talking to).
 *
 * Aki needs this because without it she treats everyone identically. Live
 * on 2026-07-29 she told the Chưởng Môn — the server owner — to stop
 * "trêu chọc Aki hoài", having no idea who he was. Name alone is not
 * identity.
 */
export interface MemberStanding {
  roles: string[];
  isStaff: boolean;
  /** Highest authority role held, for addressing them correctly. */
  topAuthorityRole: string | null;
  rankName: string | null;
  level: number | null;
}

export function readStanding(guild: Guild, discordId: string): MemberStanding {
  const member = guild.members.cache.get(discordId);
  return readStandingFromMember(member ?? null);
}

export function readStandingFromMember(member: GuildMember | null): MemberStanding {
  const roles = member
    ? [...member.roles.cache.values()]
        .filter((r) => r.name !== '@everyone')
        .sort((a, b) => b.position - a.position)
        .map((r) => r.name)
    : [];
  const isStaff = roles.some((r) => STAFF_ROLE_NAMES.has(r));

  // Sect master outranks Tiên Nhân for how Aki should address someone:
  // Tiên Nhân is a cultivation peak, Chưởng Môn is who runs the place.
  const topAuthorityRole = roles.includes(ROLE_SECT_MASTER)
    ? ROLE_SECT_MASTER
    : roles.includes(ROLE_TIEN_NHAN)
      ? ROLE_TIEN_NHAN
      : (roles.find((r) => STAFF_ROLE_NAMES.has(r)) ?? null);

  let rankName: string | null = null;
  let level: number | null = null;
  try {
    const user = member ? getStore().users.get(member.id) : null;
    if (user) {
      rankName = rankById(user.cultivation_rank).name;
      level = user.level;
    }
  } catch {
    // Store unavailable (tests) — standing is optional context.
  }

  return { roles, isStaff, topAuthorityRole, rankName, level };
}

/**
 * One line telling the model exactly who it is speaking to, including how
 * much deference the sect hierarchy calls for.
 */
/**
 * Returns a string that is ALREADY SAFE to drop into a prompt: the two
 * untrusted parts (display name, role names) are sanitised individually
 * here.
 *
 * Do NOT re-sanitise the assembled result with `sanitizeForLlmPrompt` —
 * that helper defaults to a 40-character cap because it is built for
 * short display names. Doing so on 2026-07-29 silently truncated this to
 * "Người đang nói chuyện với bạn: HẢO HÁN CÓ", so Aki never saw the word
 * "Chưởng Môn" and kept treating the owner as a stranger.
 */
export function describeAsker(displayName: string, s: MemberStanding): string {
  const safeName = sanitizeForLlmPrompt(displayName, { maxLen: 60 });
  const bits = [`Người đang nói chuyện với bạn: ${safeName}`];
  if (s.topAuthorityRole === ROLE_SECT_MASTER) {
    bits.push(
      '**NGƯỜI NÀY CHÍNH LÀ BILL — CHƯỞNG MÔN, chủ nhân của bạn, người tạo ra bạn. ' +
        'Bất kể nickname hiển thị là gì, đây LÀ chủ nhân. Xưng hô "chủ nhân", tuyệt đối ' +
        'không gọi là "tiền bối" hay coi như thành viên thường.**',
    );
  } else if (s.topAuthorityRole === ROLE_TIEN_NHAN) {
    bits.push('**LÀ TIÊN NHÂN — bậc tối cao trong tông môn**');
  } else if (s.isStaff) {
    bits.push(`**LÀ BAN QUẢN LÝ (${s.topAuthorityRole})**`);
  }
  if (s.rankName) bits.push(`cảnh giới ${s.rankName}${s.level != null ? ` cấp ${s.level}` : ''}`);
  if (s.roles.length > 0) {
    const safeRoles = s.roles.slice(0, 6).map((r) => sanitizeForLlmPrompt(r, { maxLen: 40 }));
    bits.push(`vai trò: ${safeRoles.join(', ')}`);
  }
  return bits.join(' · ');
}
