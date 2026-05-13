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
  { name: 'Trưởng Lão', colorHex: '#d4af37', hoist: true, mentionable: true, isStaff: true },
  { name: 'Tiên Nhân', colorHex: '#ffffff', hoist: true, mentionable: true },
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

export const CATEGORIES: readonly CategoryDef[] = [
  {
    name: '🏯 Tông Môn Đại Điện',
    channels: [
      { name: 'thông-báo', type: 'announcement', perm: 'public_read' },
      { name: 'nội-quy', type: 'text', perm: 'public_read' },
      { name: 'nhật-ký-tông-môn', type: 'text', perm: 'bot_log', noXp: true },
      { name: 'phòng-trưởng-lão', type: 'text', perm: 'admin_only' },
    ],
  },
  {
    name: '🔒 Kiểm Tra',
    channels: [{ name: 'xác-minh', type: 'text', perm: 'unverified_only', noXp: true }],
  },
  {
    name: '📜 Đại Hội',
    channels: [
      { name: 'thảo-luận-chung', type: 'text', perm: 'verified_full' },
      { name: 'giới-thiệu', type: 'text', perm: 'verified_full' },
      { name: 'meme', type: 'text', perm: 'verified_full' },
      { name: 'điểm-danh', type: 'text', perm: 'verified_full' },
    ],
  },
  {
    name: '🔬 Công Nghệ',
    channels: [
      { name: 'game-development', type: 'text', perm: 'verified_full' },
      { name: 'ai-ml', type: 'text', perm: 'verified_full' },
      { name: 'tools-showcase', type: 'text', perm: 'verified_full' },
      { name: 'cứu-trợ', type: 'text', perm: 'verified_full' },
    ],
  },
  {
    name: '🎮 Giải Trí',
    channels: [
      { name: 'gaming', type: 'text', perm: 'verified_full' },
      { name: 'highlight', type: 'text', perm: 'verified_full' },
      { name: 'xem-phim-cùng', type: 'text', perm: 'verified_full' },
    ],
  },
  {
    name: '🎨 Sáng Tạo',
    channels: [
      { name: 'tranh-vẽ', type: 'text', perm: 'verified_full' },
      { name: 'âm-nhạc', type: 'text', perm: 'verified_full' },
      { name: 'văn-chương', type: 'text', perm: 'verified_full' },
    ],
  },
  {
    name: '🌌 Tu Luyện',
    channels: [
      { name: 'hướng-dẫn-tu-luyện', type: 'text', perm: 'verified_read' },
      { name: 'đột-phá', type: 'text', perm: 'verified_read' },
      { name: 'bảng-xếp-hạng', type: 'text', perm: 'verified_read' },
      { name: 'độ-kiếp', type: 'text', perm: 'verified_full' },
    ],
  },
  {
    name: '🛠️ Phòng Luyện Khí',
    channels: [
      { name: 'lệnh-bot', type: 'text', perm: 'verified_full', noXp: true },
      { name: 'bot-dev', type: 'text', perm: 'mod_only', noXp: true },
      { name: 'ý-tưởng-automation', type: 'text', perm: 'verified_full' },
    ],
  },
  {
    name: '📚 Tài Nguyên',
    channels: [
      { name: 'tài-liệu', type: 'text', perm: 'verified_full' },
      { name: 'tin-tuyển-dụng', type: 'text', perm: 'verified_full' },
    ],
  },
  {
    name: '🔊 Voice',
    channels: [
      { name: 'Sảnh Chính', type: 'voice', perm: 'verified_full' },
      { name: 'Gaming', type: 'voice', perm: 'verified_full' },
      { name: 'Tu Luyện (Pomodoro)', type: 'voice', perm: 'verified_full' },
      { name: 'Tu Luyện Tịnh Tâm', type: 'voice', perm: 'verified_full' },
      { name: 'Phim Ảnh', type: 'voice', perm: 'verified_full' },
      { name: 'Gaming 2', type: 'voice', perm: 'verified_full' },
    ],
  },
] as const;

export const CHANNEL_TYPE_TO_DISCORD = {
  text: ChannelType.GuildText,
  voice: ChannelType.GuildVoice,
  announcement: ChannelType.GuildAnnouncement,
} as const;

/**
 * Permission flag references for Phase 2 to translate `PermPreset` →
 * Discord permission overwrites. Phase 2 will compose these with role lookups.
 */
export const PERM_FLAGS = PermissionFlagsBits;
