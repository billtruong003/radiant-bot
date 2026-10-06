import type { User } from '../../db/types.js';
import type { AvatarLook } from '../avatar/catalog.js';
import type { ProfileData } from './profile-data.js';

/** Sample members for previews and tests (numbers match the mockups). */

export const LOOK_BILL: AvatarLook = {
  skin: 0,
  eyes: 4,
  hair_style: 5,
  hair_color: 0,
  robe_style: 0,
  robe_color: 0,
  back: 0,
};
export const LOOK_LAM: AvatarLook = {
  skin: 1,
  eyes: 5,
  hair_style: 3,
  hair_color: 2,
  robe_style: 1,
  robe_color: 2,
  back: 1,
};
export const LOOK_MOC: AvatarLook = {
  skin: 5,
  eyes: 0,
  hair_style: 11,
  hair_color: 4,
  robe_style: 2,
  robe_color: 4,
  back: 2,
};
export const LOOK_HUYET: AvatarLook = {
  skin: 6,
  eyes: 3,
  hair_style: 7,
  hair_color: 0,
  robe_style: 1,
  robe_color: 3,
  back: 0,
};
export const LOOK_VAN: AvatarLook = {
  skin: 2,
  eyes: 2,
  hair_style: 2,
  hair_color: 1,
  robe_style: 2,
  robe_color: 1,
  back: 3,
};
export const LOOK_AKI: AvatarLook = {
  skin: 0,
  eyes: 5,
  hair_style: 3,
  hair_color: 4,
  robe_style: 2,
  robe_color: 4,
  back: 3,
};

export function sampleProfile(): ProfileData {
  return {
    discordId: 'sample',
    name: 'Bill The Dev',
    look: LOOK_BILL,
    user: { discord_id: 'sample', username: 'billthedev' } as User,
    rank: 'kim_dan',
    rankName: 'Kim Đan',
    level: 24,
    xpInLevel: 3240,
    xpNeeded: 4000,
    totalXp: 48920,
    nextRealm: { name: 'Nguyên Anh', level: 35 },
    power: {
      base: 100,
      levelBonus: 120,
      rankBonus: 90,
      subTitleBonus: 30,
      statBonus: 276,
      congPhapBonus: 2860,
      phapKhiBonus: 1450,
      nhanBonus: 602,
      weaponBonus: 400,
      total: 12480,
    },
    alloc: { dmg: 18, hp: 12, def: 8, spd: 10 },
    unspent: 3,
    pills: 37,
    coins: 1240,
    streak: 12,
    title: 'Lôi Kiếp Chân Nhân',
    subTitle: 'Trận Pháp Sư',
    weapon: {
      slot: 'Vũ khí',
      icon: 'jian_sword__icy_frost_steel',
      name: 'Hàn Sương Kiếm',
      grade: 'Thiên Phẩm',
      color: '#5fa8e8',
      level: 5,
    },
    phapKhi: {
      slot: 'Pháp khí',
      icon: 'iron_fan__shining_silver',
      name: 'Thanh Phong Phiến',
      grade: 'Hiếm',
      color: '#5fa8e8',
      level: 8,
    },
    rings: [
      {
        slot: 'Nhẫn 1',
        icon: 'yinyang_ring__green_jade',
        name: 'Hỗn Nguyên Nhẫn',
        grade: 'Sử thi',
        color: '#b48ef0',
        level: 0,
      },
      null,
    ],
    ringLocked: [null, 'Nguyên Anh'],
    congPhap: [
      {
        slot: 'Ô 1',
        icon: 'scroll_thien',
        name: 'Kim Cang Quyền',
        grade: 'Hiếm',
        color: '#5fa8e8',
        level: 4,
      },
      {
        slot: 'Ô 2',
        icon: 'scroll_thanh',
        name: 'Cửu Long Huyết Công',
        grade: 'Huyền thoại',
        color: '#f0b84a',
        level: 2,
      },
      {
        slot: 'Ô 3',
        icon: 'scroll_pham',
        name: 'Ngũ Hành Quyền',
        grade: 'Thường',
        color: '#9aa3ad',
        level: 7,
      },
      {
        slot: 'Ô 4',
        icon: 'scroll_thien',
        name: 'Ngọc Nữ Tâm Kinh',
        grade: 'Sử thi',
        color: '#b48ef0',
        level: 1,
      },
    ],
  };
}
