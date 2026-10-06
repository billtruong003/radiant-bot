/**
 * Colour tokens for every cultivation card. They match the "Base UI" board of
 * the mockup, so a card drawn here looks like its mockup.
 */
export const PX = {
  bg: '#15131c',
  bgDeep: '#0e0c13',
  panel: '#201c2b',
  panelDim: '#1c1924',
  line: '#3a3348',
  lineDim: '#2e2939',
  ink: '#efe6cf',
  inkBright: '#f6e7c8',
  inkSoft: '#d8d0bc',
  muted: '#a89f8a',
  faint: '#6e6780',
  gold: '#d4a94a',
  goldBright: '#f0d060',
  green: '#6fbf73',
  greenSoft: '#8fd18a',
  red: '#e8806e',
  crimson: '#b23a3a',
  blue: '#5fa8e8',
  cyan: '#7fd0d8',
  purple: '#b48ef0',
  pink: '#e070b0',
  white: '#fff6c8',
} as const;

/** Weapon tiers (phẩm). */
export const TIER_COLOR: Record<string, string> = {
  pham: '#9aa3ad',
  dia: '#6fbf73',
  thien: '#5fa8e8',
  thanh: '#b48ef0',
  than: '#f0b84a',
  ban_menh: '#e8806e',
};

export const TIER_NAME: Record<string, string> = {
  pham: 'Phàm Phẩm',
  dia: 'Địa Phẩm',
  thien: 'Thiên Phẩm',
  thanh: 'Thánh Phẩm',
  than: 'Thần Phẩm',
  ban_menh: 'Bản Mệnh',
};

/** Công pháp / pháp khí / nhẫn rarities. */
export const RARITY_COLOR: Record<string, string> = {
  common: '#9aa3ad',
  uncommon: '#6fbf73',
  rare: '#5fa8e8',
  epic: '#b48ef0',
  legendary: '#f0b84a',
  tien_khi: '#e8806e',
};

export const RARITY_NAME: Record<string, string> = {
  common: 'Thường',
  uncommon: 'Khá',
  rare: 'Hiếm',
  epic: 'Sử thi',
  legendary: 'Huyền thoại',
  tien_khi: 'Tiên khí',
};

/** Colour per cảnh giới, in rank order (Phàm Nhân … Tiên Nhân). */
export const REALM_COLOR: Record<string, string> = {
  pham_nhan: '#a89f8a',
  luyen_khi: '#cfd6e0',
  truc_co: '#6fbf73',
  kim_dan: '#f0d060',
  nguyen_anh: '#5fa8e8',
  hoa_than: '#7fd0d8',
  luyen_hu: '#b48ef0',
  hop_the: '#e070b0',
  dai_thua: '#e8806e',
  do_kiep: '#f0d060',
  tien_nhan: '#fff6c8',
};

/** Enchant (cường hóa) band colour: +1..3, +4..6, +7..9, +10. */
export function enchantColor(level: number): string | null {
  if (level >= 10) return '#f0b84a';
  if (level >= 7) return '#b48ef0';
  if (level >= 4) return '#5fa8e8';
  if (level >= 1) return '#d8e0ea';
  return null;
}

/** Parses '#rrggbb' to [r, g, b]. */
export function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
  ];
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}
