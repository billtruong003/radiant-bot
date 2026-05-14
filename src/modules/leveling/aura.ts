import type { CultivationRankId } from '../../db/types.js';

/**
 * Phase 12.3 — tiered aura / smoke / energy visual decorations for the
 * level-up + đột phá embed.
 *
 * Each cảnh giới has its own:
 *   - `topAura`     : one-line decoration above the hero line (smoke + light)
 *   - `bottomAura`  : same for below (mirror visual)
 *   - `divider`     : unicode box-drawing line tinted by the rank's emoji
 *   - `effect`      : free-form energy emoji block injected into the embed
 *   - `rainbowCycle`: optional sequence of hex colors to animate the
 *                     embed border over 2-3 seconds (legendary tiers only)
 *
 * Lower ranks read calm + minimal; higher ranks accumulate visual mass
 * (more emojis, denser borders) until Tiên Nhân — full iridescent.
 */

export interface RankAura {
  topAura: string;
  bottomAura: string;
  divider: string;
  effect: string;
  /** Optional rainbow color cycle (epic+ only). Empty = no animation. */
  rainbowCycle: readonly number[];
}

// Color cycle helpers — used by Độ Kiếp + Tiên Nhân animated breakthroughs.
// 5 stops over the 7-rainbow + gold + iridescent palette.
const RAINBOW_5: readonly number[] = [0xff6b6b, 0xffd56b, 0x8fbf9f, 0x7fa6c5, 0xb09bd3];
const DIVINE_5: readonly number[] = [0xffd56b, 0xfff5e6, 0xb09bd3, 0xffd56b, 0xfff5e6];

const AURA_BY_RANK: Record<CultivationRankId, RankAura> = {
  pham_nhan: {
    topAura: '⠀· · · · ·',
    bottomAura: '⠀· · · · ·',
    divider: '─────────────────────',
    effect: '_Vừa bước vào tu đạo, đạo tâm còn sơ khai._',
    rainbowCycle: [],
  },
  luyen_khi: {
    topAura: '🌬️ · 🌬️ · 🌬️',
    bottomAura: '· · · 🌬️ · · ·',
    divider: '╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌',
    effect: '☁️ _Linh khí lượn lờ quanh thân — bước đầu cảm ứng thiên địa._',
    rainbowCycle: [],
  },
  truc_co: {
    topAura: '💨 ▒▒▒▒▒▒▒▒▒ 💨',
    bottomAura: '💨 ▒▒▒▒▒▒▒▒▒ 💨',
    divider: '━━━━━━━━━━━━━━━━━━━━━',
    effect: '🪨 _Trúc cơ thành hình — nền móng vững như đá thạch._',
    rainbowCycle: [],
  },
  kim_dan: {
    topAura: '✨ ⭐ ✨ ⭐ ✨ ⭐ ✨',
    bottomAura: '✨ ⭐ ✨ ⭐ ✨ ⭐ ✨',
    divider: '◇━━━━━━━━━━━━━━━━━━━◇',
    effect: '🟡 _Nội đan đã thành — kim quang chấn động xung quanh thân._',
    rainbowCycle: [],
  },
  nguyen_anh: {
    topAura: '💜 ✨ 🟣 ✨ 💜 ✨ 🟣 ✨ 💜',
    bottomAura: '💜 ✨ 🟣 ✨ 💜 ✨ 🟣 ✨ 💜',
    divider: '◈━━━━━━━━━━━━━━━━━━━◈',
    effect: '🟣 _Nguyên anh xuất khiếu — linh hồn thoát thai, đạo tâm minh tỏ._',
    rainbowCycle: [],
  },
  hoa_than: {
    topAura: '🔥 💥 🔥 💥 🔥 💥 🔥',
    bottomAura: '🔥 💥 🔥 💥 🔥 💥 🔥',
    divider: '═══════════════════════',
    effect: '🌹 _Hồng vân quanh thân — linh thức bao trùm thiên lý._',
    rainbowCycle: [],
  },
  luyen_hu: {
    topAura: '☯️ 🌀 ☯️ 🌀 ☯️ 🌀 ☯️',
    bottomAura: '☯️ 🌀 ☯️ 🌀 ☯️ 🌀 ☯️',
    divider: '╬═════════════════════╬',
    effect: '🟢 _Luyện hư phản hồn — bước qua hư cảnh, đạo tâm bất hoại._',
    rainbowCycle: [],
  },
  hop_the: {
    topAura: '🌟 🟠 🌟 🟠 🌟 🟠 🌟 🟠 🌟',
    bottomAura: '🌟 🟠 🌟 🟠 🌟 🟠 🌟 🟠 🌟',
    divider: '╠═══════════════════════╣',
    effect: '🔥 _Hợp thể đạo thân — nhục thân hợp nhất với thiên đạo._',
    rainbowCycle: [],
  },
  dai_thua: {
    topAura: '💎 ✨ 💎 ✨ 💎 ✨ 💎 ✨ 💎',
    bottomAura: '💎 ✨ 💎 ✨ 💎 ✨ 💎 ✨ 💎',
    divider: '╞═══════════════════════╡',
    effect: '💎 _Đại thừa khí tượng — phong vân chiêu sinh trong tay áo._',
    rainbowCycle: RAINBOW_5,
  },
  do_kiep: {
    topAura: '⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡',
    bottomAura: '⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡',
    divider: '⟨⟦═══════════════════⟧⟩',
    effect: '⚡ _Thiên kiếp giáng lâm — vượt qua thiên kiếp tu thành chân tiên._',
    rainbowCycle: RAINBOW_5,
  },
  tien_nhan: {
    topAura: '🌈 👑 ✨ 🌈 👑 ✨ 🌈 👑 ✨ 🌈',
    bottomAura: '🌈 👑 ✨ 🌈 👑 ✨ 🌈 👑 ✨ 🌈',
    divider: '⟪═══════════════════════⟫',
    effect: '👑 _Tiên nhân hạ phàm — đại đạo tự nhiên, vạn pháp tự thông._',
    rainbowCycle: DIVINE_5,
  },
};

export function auraFor(rankId: CultivationRankId): RankAura {
  return AURA_BY_RANK[rankId] ?? AURA_BY_RANK.pham_nhan;
}

/** Render the breakthrough embed description block with full aura wrap. */
export function renderBreakthroughDescription(input: {
  oldRankIcon: string;
  newRankIcon: string;
  oldRankName: string;
  newRankName: string;
  newRankId: CultivationRankId;
  memberMention: string;
  chronicle: string;
}): string {
  const aura = auraFor(input.newRankId);
  // arrow_right used to be ICONS.arrow_right — keep it inline so this
  // module doesn't need to import the ui.ts constants.
  const heroLine = `🌩️ **${input.memberMention}** đã đột phá cảnh giới!`;
  const transition = `${input.oldRankIcon} **${input.oldRankName}**  →  ${input.newRankIcon} **${input.newRankName}**`;
  return [
    aura.topAura,
    aura.divider,
    heroLine,
    '',
    transition,
    '',
    aura.effect,
    '',
    `_${input.chronicle}_`,
    aura.divider,
    aura.bottomAura,
  ].join('\n');
}

/**
 * Render the plain (non-rank-cross) level-up description. Lower-key
 * visual: just a single aura line tied to the current rank.
 */
export function renderPlainLevelUpDescription(input: {
  memberMention: string;
  newLevel: number;
  currentRankId: CultivationRankId;
  rankIcon: string;
}): string {
  const aura = auraFor(input.currentRankId);
  return [
    aura.topAura,
    `✨ ${input.memberMention} vừa lên **Level ${input.newLevel}** ${input.rankIcon}`,
    aura.bottomAura,
  ].join('\n');
}

export const __for_testing = { AURA_BY_RANK, RAINBOW_5, DIVINE_5 };
