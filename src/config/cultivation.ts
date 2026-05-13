import type { CultivationRankId } from '../db/types.js';

export interface CultivationRank {
  id: CultivationRankId;
  name: string;
  minLevel: number;
  maxLevel: number | null;
  colorHex: string;
  description: string;
}

/**
 * 10 cảnh giới (cultivation realms) ordered low → high. Index 0 = starting
 * rank after verification. The 11th rank (Tiên Nhân) is admin-grant only.
 */
export const CULTIVATION_RANKS: readonly CultivationRank[] = [
  {
    id: 'pham_nhan',
    name: 'Phàm Nhân',
    minLevel: 0,
    maxLevel: 0,
    colorHex: '#8a8a8a',
    description: 'Default sau khi xác minh',
  },
  {
    id: 'luyen_khi',
    name: 'Luyện Khí',
    minLevel: 1,
    maxLevel: 9,
    colorHex: '#a0a0a0',
    description: 'Khởi đầu tu vi — được thêm phản ứng',
  },
  {
    id: 'truc_co',
    name: 'Trúc Cơ',
    minLevel: 10,
    maxLevel: 19,
    colorHex: '#5dade2',
    description: 'Dùng emoji bên ngoài, nhúng liên kết',
  },
  {
    id: 'kim_dan',
    name: 'Kim Đan',
    minLevel: 20,
    maxLevel: 34,
    colorHex: '#f4d03f',
    description: 'Tạo chủ đề công khai',
  },
  {
    id: 'nguyen_anh',
    name: 'Nguyên Anh',
    minLevel: 35,
    maxLevel: 49,
    colorHex: '#9b59b6',
    description: 'Tạo chủ đề riêng tư, đính kèm tập tin',
  },
  {
    id: 'hoa_than',
    name: 'Hóa Thần',
    minLevel: 50,
    maxLevel: 69,
    colorHex: '#e74c3c',
    description: 'Người nói ưu tiên, sticker ngoài',
  },
  {
    id: 'luyen_hu',
    name: 'Luyện Hư',
    minLevel: 70,
    maxLevel: 89,
    colorHex: '#1abc9c',
    description: 'Quản lý tin nhắn của chính mình',
  },
  {
    id: 'hop_the',
    name: 'Hợp Thể',
    minLevel: 90,
    maxLevel: 119,
    colorHex: '#e67e22',
    description: 'Trusted — có thể được đề cử Nội Môn',
  },
  {
    id: 'dai_thua',
    name: 'Đại Thừa',
    minLevel: 120,
    maxLevel: 159,
    colorHex: '#ecf0f1',
    description: 'Custom title flair, custom emoji react',
  },
  {
    id: 'do_kiep',
    name: 'Độ Kiếp',
    minLevel: 160,
    maxLevel: null,
    colorHex: '#ffd700',
    description: 'Đỉnh cao tu vi, có thể vote Trưởng Lão',
  },
] as const;

export const TIEN_NHAN: CultivationRank = {
  id: 'tien_nhan',
  name: 'Tiên Nhân',
  minLevel: Number.POSITIVE_INFINITY,
  maxLevel: null,
  colorHex: '#ffffff',
  description: 'Admin grant only',
};

const BY_ID: ReadonlyMap<CultivationRankId, CultivationRank> = new Map(
  [...CULTIVATION_RANKS, TIEN_NHAN].map((r) => [r.id, r] as const),
);

export function rankById(id: CultivationRankId): CultivationRank {
  const r = BY_ID.get(id);
  if (!r) throw new Error(`Unknown cultivation rank id: ${id}`);
  return r;
}

/**
 * Returns the rank ID matching the given level. Tiên Nhân is excluded
 * (admin grant only). Caller is responsible for keeping Tiên Nhân in place
 * if they already have it.
 */
export function rankForLevel(level: number): CultivationRankId {
  for (let i = CULTIVATION_RANKS.length - 1; i >= 0; i--) {
    const r = CULTIVATION_RANKS[i];
    if (r && level >= r.minLevel) return r.id;
  }
  return 'pham_nhan';
}

export const SUB_TITLES: readonly { id: string; emoji: string; name: string; theme: string }[] = [
  { id: 'kiem_tu', emoji: '⚔️', name: 'Kiếm Tu', theme: 'gaming/combat' },
  { id: 'dan_su', emoji: '🧪', name: 'Đan Sư', theme: 'art/creative' },
  { id: 'tran_phap_su', emoji: '🔮', name: 'Trận Pháp Sư', theme: 'tech/dev' },
  { id: 'tan_tu', emoji: '🌀', name: 'Tán Tu', theme: 'mixed' },
] as const;
