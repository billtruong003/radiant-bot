import type { CultivationRankId } from '../../db/types.js';

/**
 * Bí cảnh: six hunting grounds, ten floors each. A monster is either a strip
 * from the monster packs (STRIPS in pixel/monsters.ts) or one of the pixel
 * grid monsters (GRID_MONSTERS). Power numbers are on the lực chiến scale.
 */

export interface MonsterDef {
  id: string;
  name: string;
  art:
    | { kind: 'strip'; idle: string; attack?: string; death?: string }
    | { kind: 'grid'; key: string };
  /** Display scale on the 960-wide scene (whole numbers only). */
  scale: number;
}

export interface ZoneDef {
  id: string;
  name: string;
  minRank: CultivationRankId;
  /** Monster power on floor 1; each floor above multiplies by FLOOR_STEP. */
  basePower: number;
  monsters: string[];
  /** Short line for the Yêu thú lục. */
  lore: string;
  ground: string;
  sky: string;
}

export const MONSTERS: Record<string, MonsterDef> = {
  linh_dich: {
    id: 'linh_dich',
    name: 'Linh Dịch',
    art: { kind: 'grid', key: 'linh_dich' },
    scale: 6,
  },
  ho_yeu: { id: 'ho_yeu', name: 'Hồ Yêu', art: { kind: 'grid', key: 'ho_yeu' }, scale: 6 },
  lang_xam: {
    id: 'lang_xam',
    name: 'Xám Lang',
    art: {
      kind: 'strip',
      idle: 'wolf_gray_idle',
      attack: 'wolf_gray_attack',
      death: 'wolf_gray_death',
    },
    scale: 4,
  },
  lang_hac: {
    id: 'lang_hac',
    name: 'Hắc Lang',
    art: { kind: 'strip', idle: 'wolf_black_idle' },
    scale: 4,
  },
  lang_bach: {
    id: 'lang_bach',
    name: 'Bạch Lang',
    art: { kind: 'strip', idle: 'wolf_white_idle' },
    scale: 4,
  },
  doc_xa: { id: 'doc_xa', name: 'Độc Xà', art: { kind: 'grid', key: 'doc_xa' }, scale: 6 },
  huyet_doi: {
    id: 'huyet_doi',
    name: 'Huyết Dơi',
    art: { kind: 'strip', idle: 'bat_idle', attack: 'bat_attack', death: 'bat_die' },
    scale: 5,
  },
  thach_quy: {
    id: 'thach_quy',
    name: 'Thạch Quỷ',
    art: { kind: 'grid', key: 'thach_quy' },
    scale: 6,
  },
  nguu_ma: { id: 'nguu_ma', name: 'Ngưu Ma', art: { kind: 'grid', key: 'nguu_ma' }, scale: 6 },
  thiet_ky: {
    id: 'thiet_ky',
    name: 'Thiết Kỵ',
    art: { kind: 'strip', idle: 'knight_idle', attack: 'knight_attack', death: 'knight_death' },
    scale: 4,
  },
  thanh_ky_si: {
    id: 'thanh_ky_si',
    name: 'Thánh Kỵ Sĩ',
    art: { kind: 'strip', idle: 'paladin_idle', attack: 'paladin_attack', death: 'paladin_death' },
    scale: 3,
  },
};

export const ZONES: ZoneDef[] = [
  {
    id: 'thanh-moc-lam',
    name: 'Thanh Mộc Lâm',
    minRank: 'pham_nhan',
    basePower: 120,
    monsters: ['linh_dich', 'ho_yeu'],
    lore: 'Rừng non ở chân núi, linh dịch và hồ yêu nhỏ tụ quanh suối.',
    ground: '#1d2a1c',
    sky: '#141c17',
  },
  {
    id: 'lang-coc',
    name: 'Lang Cốc',
    minRank: 'luyen_khi',
    basePower: 260,
    monsters: ['lang_xam', 'lang_hac', 'lang_bach'],
    lore: 'Thung lũng gió lạnh, bầy sói săn theo đàn ba con.',
    ground: '#2a2a30',
    sky: '#171a20',
  },
  {
    id: 'doc-xa-dam',
    name: 'Độc Xà Đầm',
    minRank: 'truc_co',
    basePower: 520,
    monsters: ['doc_xa', 'linh_dich'],
    lore: 'Đầm lầy chướng khí, độc xà nằm chờ dưới lá sen.',
    ground: '#1e2a14',
    sky: '#121a10',
  },
  {
    id: 'huyet-doi-dong',
    name: 'Huyết Dơi Động',
    minRank: 'kim_dan',
    basePower: 950,
    monsters: ['huyet_doi'],
    lore: 'Hang tối không đáy, tiếng cánh dơi vọng từ mọi phía.',
    ground: '#221418',
    sky: '#120c10',
  },
  {
    id: 'thach-quy-linh',
    name: 'Thạch Quỷ Lĩnh',
    minRank: 'nguyen_anh',
    basePower: 1700,
    monsters: ['thach_quy', 'nguu_ma'],
    lore: 'Đỉnh núi đá, thạch quỷ thức dậy khi có người đạp lên.',
    ground: '#2a2420',
    sky: '#1a1614',
  },
  {
    id: 'thiet-ky-thanh',
    name: 'Thiết Kỵ Thành',
    minRank: 'hoa_than',
    basePower: 3000,
    monsters: ['thiet_ky', 'thanh_ky_si'],
    lore: 'Thành cổ bỏ hoang, đội kỵ binh sắt vẫn tuần tra như ngàn năm trước.',
    ground: '#24242c',
    sky: '#14141c',
  },
];

export const FLOORS = 10;
export const FLOOR_STEP = 1.18;

export function zoneById(id: string): ZoneDef | null {
  return ZONES.find((z) => z.id === id) ?? null;
}
