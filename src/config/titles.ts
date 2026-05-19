/**
 * Phase 14 — danh hiệu (honor title) catalog.
 *
 * Each title has an `id` (referenced by User.equipped_title_id), a display
 * name + emoji, a one-line description shown in /danh-hieu, and a `check`
 * function that decides if a given user qualifies. Earning is auto-checked
 * by `awardEligibleTitles()` after relevant events (duel, upgrade, rank
 * promotion, tribulation).
 *
 * Distinct from `sub_title` (Kiếm Tu/Đan Sư/...) which is a self-chosen
 * archetype tag — danh hiệu is achievement-locked.
 *
 * Catalog is code-defined (not DB) — adding a title means editing this file
 * + adding a hook at the relevant event. No runtime mutation.
 */

import type { User } from '../db/types.js';

export interface TitleEarnContext {
  user: User;
  /** Number of duels won lifetime. */
  duelWins: number;
  /** Number of miểu sát performed lifetime. */
  mieuSatCount: number;
  /** Number of tribulations passed lifetime. */
  tribulationPasses: number;
  /** Number of legendary công pháp owned. */
  legendaryCongPhapCount: number;
  /** Max upgrade level on any owned weapon. */
  maxWeaponLevel: number;
  /** Max upgrade level on any owned công pháp. */
  maxCongPhapLevel: number;
  /** Number of docs the user authored that reached `status='approved'`. */
  approvedDocsCount: number;
}

export interface TitleDef {
  id: string;
  name: string;
  emoji: string;
  description: string;
  /** Pure check — returns true if context qualifies. */
  check: (ctx: TitleEarnContext) => boolean;
}

export const TITLES: readonly TitleDef[] = [
  {
    id: 'sat_tinh',
    name: 'Sát Tinh Chân Nhân',
    emoji: '🌟',
    description: 'Thắng 50 trận duel — sát khí ngút trời.',
    check: (c) => c.duelWins >= 50,
  },
  {
    id: 'sat_tinh_so',
    name: 'Sát Tinh Sơ Chân',
    emoji: '✦',
    description: 'Thắng 10 trận duel — bước đầu khẳng định.',
    check: (c) => c.duelWins >= 10,
  },
  {
    id: 'tram_tien',
    name: 'Trảm Tiên Đạo',
    emoji: '🗡️',
    description: 'Thực hiện 10 lần miểu sát — không thương kẻ yếu.',
    check: (c) => c.mieuSatCount >= 10,
  },
  {
    id: 'loi_kiep',
    name: 'Lôi Kiếp Chân Nhân',
    emoji: '⚡',
    description: 'Vượt qua 5 lần thiên kiếp — kiên định trước cuồng sấm.',
    check: (c) => c.tribulationPasses >= 5,
  },
  {
    id: 'dan_thanh',
    name: 'Đan Thánh',
    emoji: '💊',
    description: 'Sở hữu 5 công pháp legendary — tủ pháp đầy ắp.',
    check: (c) => c.legendaryCongPhapCount >= 5,
  },
  {
    id: 'hoa_phung',
    name: 'Hoả Phụng Tu Sĩ',
    emoji: '🔥',
    description: 'Cường hóa 1 vũ khí lên Lv 5+ — luyện khí chí cường.',
    check: (c) => c.maxWeaponLevel >= 5,
  },
  {
    id: 'cuc_pham_khi',
    name: 'Cực Phẩm Khí Sĩ',
    emoji: '✨',
    description: 'Cường hóa 1 vũ khí lên Lv 10 — đỉnh cao luyện khí.',
    check: (c) => c.maxWeaponLevel >= 10,
  },
  {
    id: 'van_linh',
    name: 'Vạn Linh Quân',
    emoji: '🌀',
    description: 'Cường hóa 1 công pháp lên Lv 10 — toàn vẹn pháp môn.',
    check: (c) => c.maxCongPhapLevel >= 10,
  },
  {
    id: 'van_si',
    name: 'Văn Sĩ Chân Nhân',
    emoji: '📜',
    description: '10 tài liệu được duyệt — văn nghiệp lưu danh.',
    check: (c) => c.approvedDocsCount >= 10,
  },
  {
    id: 'tam_bich',
    name: 'Tâm Bích Chân Nhân',
    emoji: '🪷',
    description: 'Đạt cảnh giới Đại Thừa — tâm cảnh chấn động thiên hà.',
    check: (c) => c.user.cultivation_rank === 'dai_thua' || c.user.cultivation_rank === 'do_kiep' || c.user.cultivation_rank === 'tien_nhan',
  },
  {
    id: 'do_kiep_giai',
    name: 'Độ Kiếp Giả',
    emoji: '🌩️',
    description: 'Đạt cảnh giới Độ Kiếp — đỉnh cao tu vi phàm gian.',
    check: (c) => c.user.cultivation_rank === 'do_kiep' || c.user.cultivation_rank === 'tien_nhan',
  },
] as const;

export const TITLES_BY_ID: ReadonlyMap<string, TitleDef> = new Map(TITLES.map((t) => [t.id, t]));

export function getTitle(id: string): TitleDef | null {
  return TITLES_BY_ID.get(id) ?? null;
}
