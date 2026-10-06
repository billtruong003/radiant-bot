import type { Rendered } from '../pixel/output.js';
import { renderAvatarCard } from './avatar-card.js';
import { renderDailyCard, renderQuestCard } from './daily-cards.js';
import {
  renderForgeCard,
  renderInventoryCard,
  renderItemCard,
  renderSellCard,
  renderShopCard,
  renderUpgradeCard,
} from './dodac-cards.js';
import {
  type Fighter,
  renderChallengeCard,
  renderDuelResultCard,
  renderMieuSatCard,
} from './duel-cards.js';
import {
  renderAllocCard,
  renderRankCard,
  renderStatCard,
  renderSubTitleCard,
  renderTitlesCard,
} from './hoso-cards.js';
import { renderJudgmentCard } from './judgment-card.js';
import { renderKitSheet } from './kit-sheet.js';
import { renderLeaderboardCard } from './leaderboard-card.js';
import { renderProfileCard } from './profile-card.js';
import { renderRealmUpCard } from './realm-card.js';
import {
  LOOK_AKI,
  LOOK_BILL,
  LOOK_HUYET,
  LOOK_LAM,
  LOOK_MOC,
  LOOK_VAN,
  sampleProfile,
} from './samples.js';
import { renderTribulationIntro, renderTribulationOutcome } from './tribulation-cards.js';

const DUEL_A: Fighter = {
  name: 'Bill The Dev',
  look: LOOK_BILL,
  rankName: 'Kim Đan',
  rankColor: '#f0d060',
  lc: 1840,
  weapon: {
    icon: 'jian_sword__icy_frost_steel',
    name: 'Hàn Sương Kiếm',
    grade: 'Thiên Phẩm',
    color: '#5fa8e8',
    level: 7,
  },
};
const DUEL_B: Fighter = {
  name: 'Huyết Ảnh',
  look: LOOK_HUYET,
  rankName: 'Trúc Cơ',
  rankColor: '#6fbf73',
  lc: 1620,
  weapon: {
    icon: 'dao_saber__forged_iron',
    name: 'Đồng Cổ Đao',
    grade: 'Địa Phẩm',
    color: '#6fbf73',
    level: 2,
  },
};

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
  upgrade: () =>
    renderUpgradeCard({
      kind: 'weapon',
      icon: 'jian_sword__icy_frost_steel',
      name: 'Hàn Sương Kiếm',
      grade: 'Thiên Phẩm',
      color: '#5fa8e8',
      level: 8,
      from: 7,
      to: 8,
      result: 'success',
      rate: 0.15,
      costPills: 23,
      costCoins: 1600,
      detail: 'dmg 42 → 47',
    }),
  'upgrade-heavy': () =>
    renderUpgradeCard({
      kind: 'weapon',
      icon: 'jian_sword__icy_frost_steel',
      name: 'Hàn Sương Kiếm',
      grade: 'Thiên Phẩm',
      color: '#5fa8e8',
      level: 6,
      from: 7,
      to: 6,
      result: 'fail-downgrade',
      rate: 0.15,
      costPills: 23,
      costCoins: 1600,
    }),
  item: () =>
    renderItemCard({
      kindLabel: 'Vũ khí · xuyên phá',
      icon: 'spear__green_jade',
      name: 'Lôi Nha Kích',
      grade: 'Thánh Phẩm',
      color: '#b48ef0',
      level: 8,
      sub: 'Cường hóa +8: lực chiến vũ khí ×2.2',
      stats: [
        ['SÁT THƯƠNG', '46', '#e8806e'],
        ['CHÍ MẠNG', '12%', '#f0b84a', '×1.5 sát thương'],
        ['XUYÊN', '2', '#7fb2e8', 'mục tiêu'],
      ],
      skill: 'Kỹ năng: Lôi Nha. Đòn thứ ba trong hiệp gây thêm 30% sát thương.',
      lore: 'Rèn từ răng lôi thú ở Thiên Lôi Sơn, mỗi lần vung kèm tiếng sấm nhỏ.',
    }),
  inventory: () =>
    renderInventoryCard({
      tab: 'Tổng',
      pills: 37,
      coins: 1240,
      items: [
        {
          icon: 'jian_sword__icy_frost_steel',
          name: 'a',
          grade: '',
          color: '#5fa8e8',
          level: 5,
          equipped: true,
        },
        {
          icon: 'dao_saber__forged_iron',
          name: 'b',
          grade: '',
          color: '#6fbf73',
          level: 2,
          equipped: false,
        },
        {
          icon: 'spear__green_jade',
          name: 'c',
          grade: '',
          color: '#b48ef0',
          level: 8,
          equipped: false,
        },
        { icon: 'scroll_thanh', name: 'd', grade: '', color: '#f0b84a', level: 10, equipped: true },
        { icon: 'scroll_thien', name: 'e', grade: '', color: '#5fa8e8', level: 4, equipped: true },
        {
          icon: 'iron_fan__shining_silver',
          name: 'f',
          grade: '',
          color: '#5fa8e8',
          level: 8,
          equipped: true,
        },
        {
          icon: 'dragon_ring__green_jade',
          name: 'g',
          grade: '',
          color: '#b48ef0',
          level: 0,
          equipped: true,
        },
      ],
    }),
  shop: () =>
    renderShopCard({
      tab: 'Vũ khí',
      rankName: 'Kim Đan',
      pills: 37,
      coins: 1240,
      items: [
        {
          icon: 'jian_sword__icy_frost_steel',
          name: 'Hàn Sương Kiếm',
          grade: 'Thiên Phẩm',
          color: '#5fa8e8',
          level: 5,
          stat: 'dmg 42',
          pills: 18,
          coins: 900,
          state: 'equipped',
        },
        {
          icon: 'dao_saber__forged_iron',
          name: 'Đồng Cổ Đao',
          grade: 'Địa Phẩm',
          color: '#6fbf73',
          level: 0,
          stat: 'dmg 28',
          pills: 6,
          coins: 300,
          state: 'owned',
        },
        {
          icon: 'spear__forged_iron',
          name: 'Phong Vũ Thương',
          grade: 'Địa Phẩm',
          color: '#6fbf73',
          level: 0,
          stat: 'dmg 31',
          pills: 8,
          coins: 350,
          state: 'buy',
        },
        {
          icon: 'spear__green_jade',
          name: 'Lôi Nha Kích',
          grade: 'Thánh Phẩm',
          color: '#b48ef0',
          level: 0,
          stat: 'dmg 46',
          pills: 30,
          coins: 1600,
          state: 'poor',
        },
        {
          icon: 'jian_sword__divine_gold_inlaid_wood',
          name: 'Sát Thần Kiếm',
          grade: 'Thần Phẩm',
          color: '#f0b84a',
          level: 0,
          stat: 'dmg 64',
          pills: 60,
          coins: 4000,
          state: 'locked',
          need: 'Nguyên Anh',
        },
      ],
    }),
  sell: () =>
    renderSellCard({
      icon: 'scroll_thien',
      name: 'Băng Tâm Quyết',
      grade: 'Hiếm',
      color: '#5fa8e8',
      level: 3,
      pills: 12,
      coins: 800,
      jackpot: true,
      aki: LOOK_AKI,
    }),
  forge: () =>
    renderForgeCard({
      icon: 'staff__meteoric_lava_iron',
      name: 'Phá Hư Đao',
      grade: 'Bản Mệnh',
      color: '#e8806e',
      level: 0,
      element: 'Hỏa',
      stats: [
        ['SÁT THƯƠNG', '24', '#e8806e'],
        ['CHÍ MẠNG', '8%', '#f0b84a'],
        ['NẢY', '0.6', '#7fb2e8'],
      ],
      skill: 'Kỹ năng bản mệnh: Hỏa Ngục. Đòn đầu trận đốt 5% máu đối thủ mỗi hiệp.',
    }),
  daily: () =>
    renderDailyCard({
      name: 'Bill The Dev',
      look: LOOK_BILL,
      streak: 12,
      xp: 100,
      bonus: 0,
      pills: 2,
      coins: 5,
      milestones: [
        { day: 7, xp: 50, pills: 2 },
        { day: 14, xp: 150, pills: 2 },
        { day: 30, xp: 500, pills: 10 },
      ],
    }),
  'daily-milestone': () =>
    renderDailyCard({
      name: 'Bill The Dev',
      look: LOOK_BILL,
      streak: 14,
      xp: 250,
      bonus: 150,
      pills: 4,
      coins: 5,
      milestones: [
        { day: 7, xp: 50, pills: 2 },
        { day: 14, xp: 150, pills: 2 },
        { day: 30, xp: 500, pills: 10 },
      ],
    }),
  quest: () =>
    renderQuestCard({
      name: 'Bill The Dev',
      resetIn: '7 giờ 12 phút',
      quests: [
        {
          group: 'Hằng ngày',
          label: 'Gửi 25 tin nhắn',
          progress: 25,
          target: 25,
          done: true,
          xp: 100,
          pills: 1,
          coins: 20,
        },
        {
          group: 'Học tập',
          label: 'Giải 1 bài Tàng Kinh Các',
          progress: 0,
          target: 1,
          done: false,
          xp: 120,
          pills: 3,
          coins: 40,
        },
        {
          group: 'Săn yêu thú',
          label: 'Hạ 3 Hổ Yêu ở bí cảnh',
          progress: 1,
          target: 3,
          done: false,
          xp: 80,
          pills: 2,
          coins: 30,
        },
      ],
    }),
  duel: () => renderChallengeCard(DUEL_A, DUEL_B, 3),
  'duel-result': () =>
    renderDuelResultCard(
      DUEL_A,
      DUEL_B,
      {
        challengerLc: 1840,
        opponentLc: 1620,
        challengerHpStart: 1840,
        opponentHpStart: 1620,
        challengerHpEnd: 410,
        opponentHpEnd: 0,
        winner: 'challenger',
        rounds: [
          [1, 320, 290, 1550, 1300, false, false, false, false],
          [2, 610, 280, 1270, 690, true, false, false, false],
          [3, 300, 330, 940, 390, false, false, false, true],
          [4, 390, 530, 410, 0, false, true, false, false],
        ].map(([round, cd, od, ch, oh, cc, oc, cdf, odf]) => ({
          round: round as number,
          challengerDamage: cd as number,
          opponentDamage: od as number,
          challengerHpAfter: ch as number,
          opponentHpAfter: oh as number,
          challengerCrit: cc as boolean,
          opponentCrit: oc as boolean,
          challengerDefended: cdf as boolean,
          opponentDefended: odf as boolean,
        })),
      },
      3,
    ),
  'mieu-sat': () =>
    renderMieuSatCard({ ...DUEL_A, rankName: 'Hóa Thần', rankColor: '#7fd0d8' }, DUEL_B, 3),
  leaderboard: () =>
    renderLeaderboardCard({
      title: 'Bảng xếp hạng tuần',
      subtitle: 'Top 10 đệ tử tu vi nhanh nhất 7 ngày qua',
      entries: [
        ['Bill The Dev', LOOK_BILL, 'Kim Đan', '#f0d060', '+4,210 XP'],
        ['Lam Nguyệt', LOOK_LAM, 'Trúc Cơ', '#6fbf73', '+3,880 XP'],
        ['Mộc Lan', LOOK_MOC, 'Trúc Cơ', '#6fbf73', '+2,940 XP'],
        ['Huyết Ảnh', LOOK_HUYET, 'Luyện Khí', '#cfd6e0', '+2,100 XP'],
        ['Vân Du', LOOK_VAN, 'Luyện Khí', '#cfd6e0', '+1,760 XP'],
        ['Aki', LOOK_AKI, 'Luyện Khí', '#cfd6e0', '+1,200 XP'],
        ['Tán Tu 042', null, 'Phàm Nhân', '#a89f8a', '+640 XP'],
      ].map(([name, look, rankName, rankColor, score]) => ({
        name: name as string,
        look: look as typeof LOOK_BILL | null,
        rankName: rankName as string,
        rankColor: rankColor as string,
        score: score as string,
      })),
    }),
  'kiep-math': () =>
    renderTribulationIntro({
      name: 'Bill The Dev',
      look: LOOK_BILL,
      rankName: 'Kim Đan',
      question: '37 × 4 − 19 = ?',
      seconds: 30,
      passXp: 500,
      failXp: 100,
    }),
  'kiep-pass': () =>
    renderTribulationOutcome({
      name: 'Bill The Dev',
      look: LOOK_BILL,
      outcome: 'pass',
      xpDelta: 500,
      pills: 5,
    }),
  'kiep-fail': () =>
    renderTribulationOutcome({
      name: 'Bill The Dev',
      look: LOOK_BILL,
      outcome: 'fail',
      xpDelta: -100,
      pills: 0,
    }),
  ...Object.fromEntries(
    (
      [
        ['luyen_khi', 'Phàm Nhân', 'Luyện Khí'],
        ['kim_dan', 'Trúc Cơ', 'Kim Đan'],
        ['luyen_hu', 'Hóa Thần', 'Luyện Hư'],
        ['do_kiep', 'Đại Thừa', 'Độ Kiếp'],
        ['tien_nhan', 'Độ Kiếp', 'Tiên Nhân'],
      ] as const
    ).map(([id, from, to]) => [
      `realm-${id}`,
      () =>
        renderRealmUpCard({
          name: 'Bill The Dev',
          look: LOOK_BILL,
          level: 50,
          oldRankName: from,
          newRank: id,
          newRankName: to,
        }),
    ]),
  ),
  'thien-dao': () =>
    renderJudgmentCard({
      name: 'Tán Tu 042',
      look: null,
      rankName: 'Luyện Khí · Lv 12',
      verdict:
        'Kẻ này ba lần rải quảng cáo trong chính điện, coi lời răn của tông môn như gió thoảng. Thiên đạo tuần hoàn, không ai thoát được nhân quả.',
      punishments: ['Trừ 800 XP', 'Tịch thu 5 đan dược', 'Cấm khẩu 60 phút'],
    }),
};
