import { rankIndex } from '../../config/cultivation.js';
import type { Avatar, CultivationRankId } from '../../db/types.js';

/**
 * Paper-doll choices for a cultivator. Each layer is one sprite sheet in
 * assets/cultivation/sprites, and an option's position in its list is its
 * column (or row) in that sheet, so the order here must match the sheets.
 * Skin, eyes and hair come from Pixel People by TokyoGeisha (CC0); robes
 * and back items were drawn for this server on the same body.
 *
 * Some options open only at a cảnh giới, so breaking through also unlocks
 * new looks. The web page shows them locked and the server refuses them.
 */

export interface AvatarOption {
  label: string;
  /** Swatch colour shown on the option button. */
  swatch: string;
  /** Lowest cảnh giới that may wear it; undefined = everyone. */
  minRank?: CultivationRankId;
}

export type AvatarLayer =
  | 'skin'
  | 'eyes'
  | 'hair_style'
  | 'hair_color'
  | 'robe_style'
  | 'robe_color'
  | 'back';

export const AVATAR_LAYERS: Record<AvatarLayer, { label: string; options: AvatarOption[] }> = {
  skin: {
    label: 'Nguồn gốc',
    options: [
      { label: 'Sáng', swatch: '#f0c890' },
      { label: 'Bánh mật', swatch: '#a8703c' },
      { label: 'Ngà', swatch: '#f3eba0' },
      { label: 'Lúa', swatch: '#e0cf80' },
      { label: 'Thủy tộc', swatch: '#80d0f0' },
      { label: 'Mộc tộc', swatch: '#30c050' },
      { label: 'Huyết tộc', swatch: '#f05040', minRank: 'truc_co' },
      { label: 'Ma tộc', swatch: '#303030', minRank: 'nguyen_anh' },
    ],
  },
  eyes: {
    label: 'Mắt',
    options: [
      { label: 'Bạch nhãn', swatch: '#ffffff', minRank: 'hoa_than' },
      { label: 'Ngân', swatch: '#c3c3c3' },
      { label: 'Khói', swatch: '#7f7f7f' },
      { label: 'Than', swatch: '#555555' },
      { label: 'Mực', swatch: '#151515' },
      { label: 'Băng', swatch: '#99d9ea' },
    ],
  },
  hair_style: {
    label: 'Kiểu tóc',
    options: [
      { label: 'Bồng', swatch: '#3a3348' },
      { label: 'Ngắn', swatch: '#3a3348' },
      { label: 'Ngang vai', swatch: '#3a3348' },
      { label: 'Xõa dài', swatch: '#3a3348' },
      { label: 'Mái bằng', swatch: '#3a3348' },
      { label: 'Búi trâm', swatch: '#3a3348' },
      { label: 'Trọc', swatch: '#3a3348' },
      { label: 'Chỏm', swatch: '#3a3348' },
      { label: 'Mái lệch', swatch: '#3a3348' },
      { label: 'Mái tỉa', swatch: '#3a3348' },
      { label: 'Che mắt', swatch: '#3a3348' },
      { label: 'Tai hồ ly', swatch: '#3a3348', minRank: 'nguyen_anh' },
      { label: 'Mái nhọn', swatch: '#3a3348' },
    ],
  },
  hair_color: {
    label: 'Màu tóc',
    options: [
      { label: 'Mực', swatch: '#1e1e1e' },
      { label: 'Nâu', swatch: '#7a4a2a' },
      { label: 'Bạch', swatch: '#c8c8c8' },
      { label: 'Kim', swatch: '#f0e030', minRank: 'nguyen_anh' },
      { label: 'Hỏa', swatch: '#e06010' },
    ],
  },
  robe_style: {
    label: 'Y phục',
    options: [
      { label: 'Đạo bào', swatch: '#3a3348' },
      { label: 'Võ bào', swatch: '#3a3348' },
      { label: 'Nho sam', swatch: '#3a3348' },
    ],
  },
  robe_color: {
    label: 'Màu áo',
    options: [
      { label: 'Thanh', swatch: '#3d6fb0' },
      { label: 'Bạch', swatch: '#e9e4d6' },
      { label: 'Huyết', swatch: '#9c2a35' },
      { label: 'Mặc', swatch: '#2b2d3a' },
      { label: 'Ngọc', swatch: '#3f8f73' },
    ],
  },
  back: {
    label: 'Đeo theo',
    options: [
      { label: 'Kiếm', swatch: '#cfd6e0' },
      { label: 'Hồ lô', swatch: '#c98a3a' },
      { label: 'Phất trần', swatch: '#efeae0', minRank: 'nguyen_anh' },
      { label: 'Không', swatch: '#15131c' },
    ],
  },
};

export const LAYER_KEYS = Object.keys(AVATAR_LAYERS) as AvatarLayer[];
export const BACK_NONE = AVATAR_LAYERS.back.options.length - 1;

export type AvatarLook = Pick<Avatar, AvatarLayer>;

export const DEFAULT_LOOK: AvatarLook = {
  skin: 0,
  eyes: 4,
  hair_style: 5,
  hair_color: 0,
  robe_style: 0,
  robe_color: 0,
  back: 0,
};

export function isUnlocked(option: AvatarOption, rank: CultivationRankId): boolean {
  return !option.minRank || rankIndex(rank) >= rankIndex(option.minRank);
}

/**
 * Checks a look sent by the web page. Returns the cleaned look, or the first
 * problem in Vietnamese so the page can show it.
 */
export function validateLook(
  input: unknown,
  rank: CultivationRankId,
): { ok: true; look: AvatarLook } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null)
    return { ok: false, error: 'Dữ liệu tạo hình không hợp lệ.' };
  const raw = input as Record<string, unknown>;
  const look = {} as AvatarLook;
  for (const key of LAYER_KEYS) {
    const value = raw[key];
    const layer = AVATAR_LAYERS[key];
    if (
      !Number.isInteger(value) ||
      (value as number) < 0 ||
      (value as number) >= layer.options.length
    ) {
      return { ok: false, error: `Lựa chọn ${layer.label.toLowerCase()} không hợp lệ.` };
    }
    const option = layer.options[value as number] as AvatarOption;
    if (!isUnlocked(option, rank)) {
      return { ok: false, error: `${option.label} chưa mở ở cảnh giới hiện tại.` };
    }
    look[key] = value as number;
  }
  return { ok: true, look };
}

/** A random look using only options this cảnh giới has opened. */
export function randomLook(
  rank: CultivationRankId,
  random: () => number = Math.random,
): AvatarLook {
  const look = {} as AvatarLook;
  for (const key of LAYER_KEYS) {
    const open = AVATAR_LAYERS[key].options
      .map((option, index) => ({ option, index }))
      .filter(({ option }) => isUnlocked(option, rank));
    look[key] = (open[Math.floor(random() * open.length)] ?? open[0])?.index ?? 0;
  }
  return look;
}

/** Short Vietnamese description, e.g. "Búi trâm mực · Đạo bào thanh · Kiếm". */
export function describeLook(look: AvatarLook): string {
  const name = (key: AvatarLayer) => AVATAR_LAYERS[key].options[look[key]]?.label ?? '';
  const parts = [
    `${name('hair_style')} ${name('hair_color').toLowerCase()}`,
    `${name('robe_style')} ${name('robe_color').toLowerCase()}`,
  ];
  if (look.back !== BACK_NONE) parts.push(name('back'));
  return parts.join(' · ');
}
