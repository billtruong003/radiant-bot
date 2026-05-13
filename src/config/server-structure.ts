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

export const ROLES: readonly RoleDef[] = [
  // Top admin — sect master. Gets gold + full manage perms in channel
  // overwrites. Bot operator / server owner usually holds this.
  { name: 'Chưởng Môn', colorHex: '#d4af37', hoist: true, mentionable: true, isStaff: true },
  { name: 'Tiên Nhân', colorHex: '#ffffff', hoist: true, mentionable: true },
  // Senior advisor — supermod tier, manually granted to trusted seniors by
  // Chưởng Môn. Same channel visibility as admin, mod-level message powers,
  // CANNOT manage channels/roles (that stays with Chưởng Môn alone).
  { name: 'Trưởng Lão', colorHex: '#a569bd', hoist: true, mentionable: true, isStaff: true },
  { name: 'Nội Môn Đệ Tử', colorHex: '#5dade2', hoist: true, mentionable: true, isStaff: true },
  {
    name: 'Độ Kiếp',
    colorHex: '#ffd700',
    hoist: false,
    mentionable: false,
    isCultivationRank: true,
  },
  {
    name: 'Đại Thừa',
    colorHex: '#ecf0f1',
    hoist: false,
    mentionable: false,
    isCultivationRank: true,
  },
  {
    name: 'Hợp Thể',
    colorHex: '#e67e22',
    hoist: false,
    mentionable: false,
    isCultivationRank: true,
  },
  {
    name: 'Luyện Hư',
    colorHex: '#1abc9c',
    hoist: false,
    mentionable: false,
    isCultivationRank: true,
  },
  {
    name: 'Hóa Thần',
    colorHex: '#e74c3c',
    hoist: false,
    mentionable: false,
    isCultivationRank: true,
  },
  {
    name: 'Nguyên Anh',
    colorHex: '#9b59b6',
    hoist: false,
    mentionable: false,
    isCultivationRank: true,
  },
  {
    name: 'Kim Đan',
    colorHex: '#f4d03f',
    hoist: false,
    mentionable: false,
    isCultivationRank: true,
  },
  {
    name: 'Trúc Cơ',
    colorHex: '#5dade2',
    hoist: false,
    mentionable: false,
    isCultivationRank: true,
  },
  {
    name: 'Luyện Khí',
    colorHex: '#a0a0a0',
    hoist: false,
    mentionable: false,
    isCultivationRank: true,
  },
  {
    name: 'Phàm Nhân',
    colorHex: '#8a8a8a',
    hoist: false,
    mentionable: false,
    isCultivationRank: true,
  },
  { name: 'Kiếm Tu', colorHex: '#c0392b', hoist: false, mentionable: true, isSubTitle: true },
  { name: 'Đan Sư', colorHex: '#27ae60', hoist: false, mentionable: true, isSubTitle: true },
  { name: 'Trận Pháp Sư', colorHex: '#2980b9', hoist: false, mentionable: true, isSubTitle: true },
  { name: 'Tán Tu', colorHex: '#7f8c8d', hoist: false, mentionable: true, isSubTitle: true },
  {
    name: 'Chưa Xác Minh',
    colorHex: '#4a4a4a',
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
export const CATEGORIES: readonly CategoryDef[] = [
  {
    name: '📢 Hub',
    channels: [
      { name: 'announcements', type: 'text', perm: 'public_read' },
      { name: 'rules', type: 'text', perm: 'public_read' },
      { name: 'bot-log', type: 'text', perm: 'bot_log', noXp: true },
      { name: 'elder-lounge', type: 'text', perm: 'admin_only' },
    ],
  },
  {
    name: '🔒 Verification',
    channels: [{ name: 'verify', type: 'text', perm: 'unverified_only', noXp: true }],
  },
  {
    name: 'General Realm',
    channels: [
      { name: 'general', type: 'text', perm: 'verified_full' },
      { name: 'introductions', type: 'text', perm: 'verified_full' },
      { name: 'meme', type: 'text', perm: 'verified_full' },
      { name: 'daily-checkin', type: 'text', perm: 'verified_full' },
    ],
  },
  {
    name: 'Tech Innovations',
    channels: [
      { name: 'game-development', type: 'text', perm: 'verified_full' },
      { name: 'ai-ml', type: 'text', perm: 'verified_full' },
      { name: 'tools-showcase', type: 'text', perm: 'verified_full' },
      { name: 'help-me', type: 'text', perm: 'verified_full' },
    ],
  },
  {
    name: 'Entertainment',
    channels: [
      { name: 'gaming', type: 'text', perm: 'verified_full' },
      { name: 'highlight', type: 'text', perm: 'verified_full' },
      { name: 'movie-night', type: 'text', perm: 'verified_full' },
    ],
  },
  {
    name: '🎨 Creative',
    channels: [
      { name: 'art', type: 'text', perm: 'verified_full' },
      { name: 'music', type: 'text', perm: 'verified_full' },
      { name: 'writing', type: 'text', perm: 'verified_full' },
    ],
  },
  {
    name: '📈 Cultivation Path',
    channels: [
      { name: 'leveling-guide', type: 'text', perm: 'verified_read' },
      { name: 'level-up', type: 'text', perm: 'verified_read' },
      { name: 'leaderboard', type: 'text', perm: 'verified_read' },
      { name: 'tribulation', type: 'text', perm: 'verified_full' },
    ],
  },
  {
    name: '🛠️ Workshop',
    channels: [
      { name: 'bot-commands', type: 'text', perm: 'verified_full', noXp: true },
      { name: 'bot-dev', type: 'text', perm: 'mod_only', noXp: true },
      { name: 'automation-ideas', type: 'text', perm: 'verified_full' },
    ],
  },
  {
    name: '📚 Resources',
    channels: [
      { name: 'docs', type: 'text', perm: 'verified_full' },
      { name: 'jobs', type: 'text', perm: 'verified_full' },
    ],
  },
  {
    name: 'Voice Channels',
    channels: [
      { name: 'Main Hall', type: 'voice', perm: 'verified_full' },
      { name: 'Gaming', type: 'voice', perm: 'verified_full' },
      { name: 'Focus Room', type: 'voice', perm: 'verified_full' },
      { name: 'Quiet Study', type: 'voice', perm: 'verified_full' },
      { name: 'Movie Room', type: 'voice', perm: 'verified_full' },
      { name: 'Gaming 2', type: 'voice', perm: 'verified_full' },
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
