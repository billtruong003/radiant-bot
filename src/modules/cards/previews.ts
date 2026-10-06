import type { Rendered } from '../pixel/output.js';
import { renderAvatarCard } from './avatar-card.js';
import {
  renderAllocCard,
  renderRankCard,
  renderStatCard,
  renderSubTitleCard,
  renderTitlesCard,
} from './hoso-cards.js';
import { renderKitSheet } from './kit-sheet.js';
import { renderProfileCard } from './profile-card.js';
import { LOOK_BILL, sampleProfile } from './samples.js';

/** Every card with sample data, for scripts/render-preview.ts and tests. */
export const PREVIEWS: Record<string, () => Promise<Rendered>> = {
  'kit-sheet': renderKitSheet,
  avatar: () => renderAvatarCard({ look: LOOK_BILL, name: 'Bill The Dev', rank: 'kim_dan' }),
  'avatar-empty': () => renderAvatarCard({ look: null, name: 'Tán Tu 042', rank: 'kim_dan' }),
  profile: () => renderProfileCard(sampleProfile()),
  rank: () => renderRankCard(sampleProfile()),
  stat: () =>
    renderStatCard(
      sampleProfile(),
      'Nhẫn ô 2 ở Nguyên Anh (Lv 35)',
      'Cửu Long Huyết Công +3 · 80% thành công',
    ),
  alloc: () => renderAllocCard(sampleProfile(), 'dmg'),
  titles: () =>
    renderTitlesCard('Bill The Dev', [
      { name: 'Sát Tinh Sơ Chân', description: 'Thắng 10 trận luận kiếm', state: 'got' },
      { name: 'Sát Tinh Chân Nhân', description: 'Thắng 50 trận luận kiếm', state: 'lock' },
      { name: 'Trảm Tiên Đạo', description: '10 lần miểu sát', state: 'lock' },
      { name: 'Lôi Kiếp Chân Nhân', description: 'Vượt 5 lần thiên kiếp', state: 'on' },
      { name: 'Đan Thánh', description: '5 công pháp huyền thoại', state: 'lock' },
      { name: 'Hỏa Phụng Tu Sĩ', description: 'Vũ khí lên +5', state: 'got' },
    ]),
  subtitle: () =>
    renderSubTitleCard([
      {
        name: 'Kiếm Tu',
        theme: 'Chơi game, thích combat',
        icon: 'jian_sword__icy_frost_steel',
        color: '#5fa8e8',
        on: true,
      },
      {
        name: 'Đan Sư',
        theme: 'Vẽ, dựng, sáng tạo',
        icon: 'gold_medicine__green_jade',
        color: '#e8806e',
        on: false,
      },
      {
        name: 'Trận Pháp Sư',
        theme: 'Dev, tech, làm tool',
        icon: 'rune_ring__divine_gold_inlaid_wood',
        color: '#b48ef0',
        on: true,
      },
      {
        name: 'Tán Tu',
        theme: 'Mỗi thứ một chút',
        icon: 'iron_fan__shining_silver',
        color: '#8fd18a',
        on: false,
      },
    ]),
};
