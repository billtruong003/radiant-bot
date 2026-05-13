import type { CultivationRankId } from '../db/types.js';

/**
 * Manifest of role-icon assignments. Bill's Phase 9 ask: every
 * cultivation rank should have a distinct icon (the "quả cầu năng
 * lượng" / energy-orb motif) tinted by rank color. Since custom PNG
 * icons require server Boost Level 2 (≥ 7 boosts), this manifest
 * supports BOTH:
 *
 *   - `unicodeEmoji`  : works at Boost L2+. Use as default until
 *                       custom PNGs are designed.
 *   - `pngPath`       : path under `assets/role-icons/` (e.g. PNG of
 *                       a glowing orb tinted to the rank). Pinned
 *                       to L2 as well, but admin-controlled instead
 *                       of emoji.
 *
 * Run `npm run bot -- upload-role-icons` to apply. The CLI gracefully
 * skips roles that don't exist + reports if the guild can't accept
 * icons (no Boost L2).
 *
 * Bill: when you design the 10 orb PNGs, drop them in
 * `assets/role-icons/<rank_id>.png` and re-run with `--use=png`.
 */

export type IconSource = 'unicode' | 'png';

export interface RoleIconAssignment {
  roleName: string;
  unicodeEmoji: string;
  /** Relative path under `assets/role-icons/`. */
  pngPath: string;
  description: string;
}

/**
 * Suggested unicode-emoji icons by rank — chosen to evoke the
 * energy-orb feel via color/shape. Customize freely.
 */
export const CULTIVATION_ICONS: Record<CultivationRankId, RoleIconAssignment> = {
  pham_nhan: {
    roleName: 'Phàm Nhân',
    unicodeEmoji: '⚪',
    pngPath: 'pham_nhan.png',
    description: 'White orb — bare cultivation',
  },
  luyen_khi: {
    roleName: 'Luyện Khí',
    unicodeEmoji: '🌬️',
    pngPath: 'luyen_khi.png',
    description: 'Light blue orb — wind/qi refinement',
  },
  truc_co: {
    roleName: 'Trúc Cơ',
    unicodeEmoji: '🔵',
    pngPath: 'truc_co.png',
    description: 'Blue orb — foundation built',
  },
  kim_dan: {
    roleName: 'Kim Đan',
    unicodeEmoji: '🟡',
    pngPath: 'kim_dan.png',
    description: 'Gold orb — golden pill formed',
  },
  nguyen_anh: {
    roleName: 'Nguyên Anh',
    unicodeEmoji: '🟣',
    pngPath: 'nguyen_anh.png',
    description: 'Purple orb — soul infant',
  },
  hoa_than: {
    roleName: 'Hóa Thần',
    unicodeEmoji: '🔥',
    pngPath: 'hoa_than.png',
    description: 'Red orb — spirit transformation',
  },
  luyen_hu: {
    roleName: 'Luyện Hư',
    unicodeEmoji: '☯️',
    pngPath: 'luyen_hu.png',
    description: 'Green orb — void refinement',
  },
  hop_the: {
    roleName: 'Hợp Thể',
    unicodeEmoji: '🌟',
    pngPath: 'hop_the.png',
    description: 'Orange orb — body unified with dao',
  },
  dai_thua: {
    roleName: 'Đại Thừa',
    unicodeEmoji: '💎',
    pngPath: 'dai_thua.png',
    description: 'White diamond orb — great vehicle',
  },
  do_kiep: {
    roleName: 'Độ Kiếp',
    unicodeEmoji: '⚡',
    pngPath: 'do_kiep.png',
    description: 'Gold thunder orb — crossing tribulation',
  },
  tien_nhan: {
    roleName: 'Tiên Nhân',
    unicodeEmoji: '👑',
    pngPath: 'tien_nhan.png',
    description: 'Crown — immortal (admin grant only)',
  },
};

export const SUBTITLE_ICONS: Record<string, RoleIconAssignment> = {
  'Kiếm Tu': {
    roleName: 'Kiếm Tu',
    unicodeEmoji: '⚔️',
    pngPath: 'kiem_tu.png',
    description: 'Sword cultivator',
  },
  'Đan Sư': {
    roleName: 'Đan Sư',
    unicodeEmoji: '🧪',
    pngPath: 'dan_su.png',
    description: 'Alchemy master',
  },
  'Trận Pháp Sư': {
    roleName: 'Trận Pháp Sư',
    unicodeEmoji: '🔮',
    pngPath: 'tran_phap_su.png',
    description: 'Formation master',
  },
  'Tán Tu': {
    roleName: 'Tán Tu',
    unicodeEmoji: '🌀',
    pngPath: 'tan_tu.png',
    description: 'Rogue cultivator',
  },
};
