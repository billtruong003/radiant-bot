import { ChannelType, PermissionFlagsBits } from 'discord.js';

/**
 * Declarative server structure for Phase 2 idempotent sync.
 * Channel/category/role definitions live here as data; sync logic in
 * `scripts/sync-server.ts` walks this tree to create/update without
 * deleting anything outside the schema.
 */

export type PermPreset =
  | 'public_read'
  | 'public_full'
  | 'verified_full'
  | 'verified_read'
  | 'unverified_only'
  | 'mod_only'
  | 'admin_only'
  | 'bot_log';

export interface ChannelDef {
  name: string;
  type: 'text' | 'voice' | 'announcement';
  description?: string;
  perm: PermPreset;
  noXp?: boolean;
}

export interface CategoryDef {
  name: string;
  channels: ChannelDef[];
}

export interface RoleDef {
  name: string;
  colorHex: string;
  hoist: boolean;
  mentionable: boolean;
  isCultivationRank?: boolean;
  isSubTitle?: boolean;
  isStaff?: boolean;
  isUnverified?: boolean;
}

// Phase 12.1 palette refresh — "Ethereal Mystic". Each role family has
// its own hue arc:
//   - Staff: antique-gold → cosmic-nebula → dusk-violet → twilight-blue
//   - Cultivation: cloud → mist → river → honey → iris → rose → sage →
//     apricot → pearl → divine sun → iridescent
//   - Sub-title: steel mist / blush pink / amethyst dream / driftwood
// All distinct enough that two adjacent ranks no longer read the same.
export const ROLES: readonly RoleDef[] = [
  // Top admin — sect master. Antique gold, deeper than the cultivation
  // Độ Kiếp gold so the master visibly outranks even Độ Kiếp disciples.
  { name: 'Chưởng Môn', colorHex: '#c9a455', hoist: true, mentionable: true, isStaff: true },
  // Iridescent cream-pearl — admin-grant only, distinct from Đại Thừa
  // pearl mist below.
  { name: 'Tiên Nhân', colorHex: '#f5e8ff', hoist: true, mentionable: true },
  // The bot's flair role — "Heavenly Dao", positioned between Tiên Nhân and
  // Trưởng Lão. Cosmic midnight-nebula evokes the "thiên đạo" cosmic-voice
  // persona that narrates automod punishments (Phase 11.2).
  { name: 'Thiên Đạo', colorHex: '#2c1e4e', hoist: true, mentionable: false, isStaff: true },
  // Senior advisor — supermod tier, manually granted to trusted seniors by
  // Chưởng Môn. Dusk violet — wisdom + nightfall.
  { name: 'Trưởng Lão', colorHex: '#9c7fbf', hoist: true, mentionable: true, isStaff: true },
  // Law enforcer — moderator tier. Twilight blue, distinct from Trúc Cơ
  // river-blue so a mod isn't visually mistaken for a level-10 disciple.
  { name: 'Chấp Pháp', colorHex: '#6890b8', hoist: true, mentionable: true, isStaff: true },
  {
    name: 'Độ Kiếp',
    colorHex: '#ffd56b',
    hoist: false,
    mentionable: false,
    isCultivationRank: true,
  },
  {
    name: 'Đại Thừa',
    colorHex: '#e8eaf0',
    hoist: false,
    mentionable: false,
    isCultivationRank: true,
  },
  {
    name: 'Hợp Thể',
    colorHex: '#d4a574',
    hoist: false,
    mentionable: false,
    isCultivationRank: true,
  },
  {
    name: 'Luyện Hư',
    colorHex: '#8fbf9f',
    hoist: false,
    mentionable: false,
    isCultivationRank: true,
  },
  {
    name: 'Hóa Thần',
    colorHex: '#d97b8a',
    hoist: false,
    mentionable: false,
    isCultivationRank: true,
  },
  {
    name: 'Nguyên Anh',
    colorHex: '#b09bd3',
    hoist: false,
    mentionable: false,
    isCultivationRank: true,
  },
  {
    name: 'Kim Đan',
    colorHex: '#e6c87e',
    hoist: false,
    mentionable: false,
    isCultivationRank: true,
  },
  {
    name: 'Trúc Cơ',
    colorHex: '#7fa6c5',
    hoist: false,
    mentionable: false,
    isCultivationRank: true,
  },
  {
    name: 'Luyện Khí',
    colorHex: '#b8c5d0',
    hoist: false,
    mentionable: false,
    isCultivationRank: true,
  },
  {
    name: 'Phàm Nhân',
    colorHex: '#95989e',
    hoist: false,
    mentionable: false,
    isCultivationRank: true,
  },
  // Sub-titles — themed per archetype, pastel so they don't fight with
  // the cultivation rank color a member also wears.
  { name: 'Kiếm Tu', colorHex: '#8d9ba8', hoist: false, mentionable: true, isSubTitle: true },
  { name: 'Đan Sư', colorHex: '#efb5a3', hoist: false, mentionable: true, isSubTitle: true },
  { name: 'Trận Pháp Sư', colorHex: '#a89bce', hoist: false, mentionable: true, isSubTitle: true },
  { name: 'Tán Tu', colorHex: '#a89b8d', hoist: false, mentionable: true, isSubTitle: true },
  {
    name: 'Chưa Xác Minh',
    colorHex: '#3a3a3a',
    hoist: false,
    mentionable: false,
    isUnverified: true,
  },
] as const;

/**
 * Channel + category structure is English-first (audience is broad tech /
 * dev, not necessarily into wuxia/cultivation theme). Cultivation flair
 * lives in the VN-named ROLES above (visible as level badges, opt-in
 * flavor). Four categories reuse names from the Discord starter template
 * the guild was created with so `meme` / `game-development` / `gaming` /
 * `highlight` / `Gaming` (voice) are moved in place without rename.
 */
/**
 * Phase 11 A5: channel names decorated with icons on both sides.
 *
 * Discord lowercases + hyphenates text channel names automatically; the
 * emoji on each side survives as decoration. Callers should NEVER rely
 * on exact-name matching against these literals — use
 * `canonicalChannelName()` / `matchesChannelName()` from
 * `src/config/channels.ts` to compare against the canonical slug
 * (`💬-general-💬` → `general`).
 */
export const CATEGORIES: readonly CategoryDef[] = [
  {
    name: '📢 Hub',
    channels: [
      { name: '📢-announcements-📢', type: 'text', perm: 'public_read' },
      { name: '📜-rules-📜', type: 'text', perm: 'public_read' },
      { name: '📋-bot-log-📋', type: 'text', perm: 'bot_log', noXp: true },
      { name: '🏛️-elder-lounge-🏛️', type: 'text', perm: 'admin_only' },
    ],
  },
  {
    name: '🔒 Verification',
    channels: [{ name: '🔒-verify-🔒', type: 'text', perm: 'unverified_only', noXp: true }],
  },
  {
    name: 'General Realm',
    channels: [
      { name: '💬-general-💬', type: 'text', perm: 'verified_full' },
      { name: '👋-introductions-👋', type: 'text', perm: 'verified_full' },
      { name: '🤣-meme-🤣', type: 'text', perm: 'verified_full' },
      { name: '📅-daily-checkin-📅', type: 'text', perm: 'verified_full' },
    ],
  },
  {
    name: 'Tech Innovations',
    channels: [
      { name: '🎮-game-dev-🎮', type: 'text', perm: 'verified_full' },
      { name: '🤖-ai-ml-🤖', type: 'text', perm: 'verified_full' },
      { name: '🛠️-tools-showcase-🛠️', type: 'text', perm: 'verified_full' },
      { name: '🆘-help-me-🆘', type: 'text', perm: 'verified_full' },
    ],
  },
  {
    name: 'Entertainment',
    channels: [
      { name: '🕹️-gaming-🕹️', type: 'text', perm: 'verified_full' },
      { name: '⭐-highlight-⭐', type: 'text', perm: 'verified_full' },
      { name: '🎬-movie-night-🎬', type: 'text', perm: 'verified_full' },
    ],
  },
  {
    name: '🎨 Creative',
    channels: [
      { name: '🎨-art-🎨', type: 'text', perm: 'verified_full' },
      { name: '🎵-music-🎵', type: 'text', perm: 'verified_full' },
      { name: '✍️-writing-✍️', type: 'text', perm: 'verified_full' },
    ],
  },
  {
    name: '📈 Cultivation Path',
    channels: [
      { name: '📖-leveling-guide-📖', type: 'text', perm: 'verified_read' },
      { name: '⚡-level-up-⚡', type: 'text', perm: 'verified_read' },
      { name: '🏆-leaderboard-🏆', type: 'text', perm: 'verified_read' },
      { name: '🌩️-tribulation-🌩️', type: 'text', perm: 'verified_full' },
    ],
  },
  {
    name: '🛠️ Workshop',
    channels: [
      { name: '💻-bot-commands-💻', type: 'text', perm: 'verified_full', noXp: true },
      { name: '🔧-bot-dev-🔧', type: 'text', perm: 'mod_only', noXp: true },
      { name: '💡-automation-ideas-💡', type: 'text', perm: 'verified_full' },
    ],
  },
  {
    name: '📚 Resources',
    channels: [
      { name: '📚-docs-📚', type: 'text', perm: 'verified_full' },
      { name: '💼-jobs-💼', type: 'text', perm: 'verified_full' },
    ],
  },
  {
    name: 'Voice Channels',
    channels: [
      { name: '🏛️ Main Hall 🏛️', type: 'voice', perm: 'verified_full' },
      { name: '🎮 Gaming 🎮', type: 'voice', perm: 'verified_full' },
      { name: '🎯 Focus Room 🎯', type: 'voice', perm: 'verified_full' },
      { name: '📚 Quiet Study 📚', type: 'voice', perm: 'verified_full' },
      { name: '🎬 Movie Room 🎬', type: 'voice', perm: 'verified_full' },
      { name: '🎮 Gaming 2 🎮', type: 'voice', perm: 'verified_full' },
    ],
  },
] as const;

/**
 * Schema type → Discord channel type for create/lookup.
 *
 * NOTE: `announcement` maps to `GuildText` for create. Discord rejects
 * direct creation of GuildAnnouncement (type 5) — that type only exists
 * via upgrading a text channel through the Community feature. We keep
 * the schema flag so Phase 5+ can branch on intent (announcement-style
 * channels get bot-only post permissions via `public_read` preset, which
 * already covers the read-only semantic).
 */
export const CHANNEL_TYPE_TO_DISCORD = {
  text: ChannelType.GuildText,
  voice: ChannelType.GuildVoice,
  announcement: ChannelType.GuildText,
} as const;

/**
 * Permission flag references for Phase 2 to translate `PermPreset` →
 * Discord permission overwrites. Phase 2 will compose these with role lookups.
 */
export const PERM_FLAGS = PermissionFlagsBits;
