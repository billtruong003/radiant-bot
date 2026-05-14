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
// Phase 12.1 palette refresh — "Ethereal Mystic": pastel + cosmic dreamy
// arc emphasising the spiritual / immortal theme. Each tier has a
// distinct hue family so adjacent ranks read as a visible elevation
// rather than the previous Flat-UI default soup.
export const CULTIVATION_RANKS: readonly CultivationRank[] = [
  {
    id: 'pham_nhan',
    name: 'Phàm Nhân',
    minLevel: 0,
    maxLevel: 0,
    colorHex: '#95989e',
    description: 'Default sau khi xác minh',
  },
  {
    id: 'luyen_khi',
    name: 'Luyện Khí',
    minLevel: 1,
    maxLevel: 9,
    colorHex: '#b8c5d0',
    description: 'Khởi đầu tu vi — được thêm phản ứng',
  },
  {
    id: 'truc_co',
    name: 'Trúc Cơ',
    minLevel: 10,
    maxLevel: 19,
    colorHex: '#7fa6c5',
    description: 'Dùng emoji bên ngoài, nhúng liên kết',
  },
  {
    id: 'kim_dan',
    name: 'Kim Đan',
    minLevel: 20,
    maxLevel: 34,
    colorHex: '#e6c87e',
    description: 'Tạo chủ đề công khai',
  },
  {
    id: 'nguyen_anh',
    name: 'Nguyên Anh',
    minLevel: 35,
    maxLevel: 49,
    colorHex: '#b09bd3',
    description: 'Tạo chủ đề riêng tư, đính kèm tập tin',
  },
  {
    id: 'hoa_than',
    name: 'Hóa Thần',
    minLevel: 50,
    maxLevel: 69,
    colorHex: '#d97b8a',
    description: 'Người nói ưu tiên, sticker ngoài',
  },
  {
    id: 'luyen_hu',
    name: 'Luyện Hư',
    minLevel: 70,
    maxLevel: 89,
    colorHex: '#8fbf9f',
    description: 'Quản lý tin nhắn của chính mình',
  },
  {
    id: 'hop_the',
    name: 'Hợp Thể',
    minLevel: 90,
    maxLevel: 119,
    colorHex: '#d4a574',
    description: 'Trusted — có thể được đề cử Nội Môn',
  },
  {
    id: 'dai_thua',
    name: 'Đại Thừa',
    minLevel: 120,
    maxLevel: 159,
    colorHex: '#e8eaf0',
    description: 'Custom title flair, custom emoji react',
  },
  {
    id: 'do_kiep',
    name: 'Độ Kiếp',
    minLevel: 160,
    maxLevel: null,
    colorHex: '#ffd56b',
    description: 'Đỉnh cao tu vi, có thể vote Trưởng Lão',
  },
] as const;

export const TIEN_NHAN: CultivationRank = {
  id: 'tien_nhan',
  name: 'Tiên Nhân',
  minLevel: Number.POSITIVE_INFINITY,
  maxLevel: null,
  colorHex: '#f5e8ff',
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
