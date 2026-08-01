/**
 * Visual design system — colors, dividers, emoji glyphs used across
 * every embed in the bot. Centralized so the look stays consistent
 * (and a future rebrand only touches one file).
 *
 * Convention: SEMANTIC colors (e.g. `SUCCESS`, `DANGER`) for embed
 * accent borders, RANK colors are in `cultivation.ts:colorHex`.
 */

// ---------- Semantic colors ----------

/** Member achievement, gold rewards, victory. */
export const COLOR_GOLD = 0xffd700;
/** Pass / OK / serene info. */
export const COLOR_BLUE = 0x5dade2;
/** Tribulation / epic event / rare. */
export const COLOR_PURPLE = 0x9b59b6;
/** Danger / fail / kick / timeout. */
export const COLOR_RED = 0xe74c3c;
/** Warning / soft caution. */
export const COLOR_ORANGE = 0xe67e22;
/** Success / OK / level up small. */
export const COLOR_GREEN = 0x2ecc71;
/** Neutral / Aki replies / general info. */
export const COLOR_AKI = 0xff8fb1; // pink — Aki's brand color
/** Dark/serious / kick / ban / admin alert. */
export const COLOR_DARK = 0x2c3e50;

// ---------- Unicode dividers / decorations ----------

/** Long horizontal rule for embed descriptions. */
export const DIVIDER = '━━━━━━━━━━━━━━━━━━━━━━━━━';
export const DIVIDER_SHORT = '━━━━━━━━━━━━━━━━';
export const DIVIDER_DOUBLE = '═══════════════════════';

// ---------- Universal glyph palette ----------

/**
 * Phase 14.8 — themed section icons cho /help + /me hub. Mystical /
 * alchemy glyphs thay vì generic emoji (Bill: "icon hiện tại k đc ngầu").
 * Unicode hỗ trợ trên mọi nền tảng, không cần upload custom emoji.
 */
export const HUB_ICONS = {
  // Section glyphs — mystical/alchemy + clean geometry
  start: '🌌', // Mới bắt đầu — cosmos
  path: '☯', // Tu vi — yin-yang path
  gear: '⚜', // Trang bị — fleur-de-lis royal
  combat: '⚔', // Combat — sword
  aki: '🔮', // Aki AI — crystal ball
  admin: '⚖', // Admin — judge scales
  extra: '✦', // Misc — small star
  // Status glyphs alt (cleaner than ✅❌)
  equipped: '✦', // Đang đeo (alt to ⭐)
  owned: '◉', // Sở hữu
  affordable: '⟢', // Mua được
  locked: '⊘', // Khoá
  insufficient: '⌛', // Chưa đủ
  // Decoration
  diamond: '❖',
  triangle: '⟁',
  sparkle_alt: '✺',
  flower: '❈',
  fire_alchemy: '🜂',
  water_alchemy: '🜄',
  ankh: '𓋹',
} as const;

export const ICONS = {
  // Status
  success: '✅',
  fail: '❌',
  warn: '⚠️',
  info: 'ℹ️',
  pending: '⏳',
  timeout: '⌛',

  // Action
  kick: '👢',
  ban: '🔨',
  mute: '🔇',
  delete: '🗑️',
  warn_action: '⚠️',

  // Cultivation theme
  cultivation: '⚡',
  tribulation: '🌩️',
  dao: '☯️',
  pill: '💊',
  formation: '🔮',
  sword: '⚔️',
  scroll: '📜',

  // Rewards / XP
  xp: '✨',
  gold: '🪙',
  treasure: '💎',
  trophy: '🏆',
  medal_gold: '🥇',
  medal_silver: '🥈',
  medal_bronze: '🥉',

  // UI
  arrow_right: '→',
  arrow_up: '↑',
  arrow_down: '↓',
  sparkle: '✨',
  fire: '🔥',
  star: '⭐',
  heart: '♥️',
  crown: '👑',

  // Aki mascot moods
  aki_happy: '(◕‿◕)',
  aki_giggle: '٩(◕‿◕)۶',
  aki_sass: '┐(￣ヮ￣)┌',
  aki_sad: '(；⌣́_⌣́)',
  aki_love: '(｡♥‿♥｡)',
} as const;

// ---------- Cảnh giới rank icons (for embed decoration only) ----------

export const RANK_ICONS = {
  pham_nhan: '⚪',
  luyen_khi: '🌬️',
  truc_co: '🔵',
  kim_dan: '🟡',
  nguyen_anh: '🟣',
  hoa_than: '🔥',
  luyen_hu: '☯️',
  hop_the: '🌟',
  dai_thua: '💎',
  do_kiep: '⚡',
  tien_nhan: '👑',
} as const;

// ---------- Footer pattern ----------

export const FOOTER_BRAND = 'Radiant Tech Sect — Tu kỹ thuật, luyện trí tuệ';

