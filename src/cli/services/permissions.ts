import { CATEGORIES, type PermPreset } from '../../config/server-structure.js';
import type { BotCliService } from '../service.js';

type Access = 'hidden' | 'view' | 'post' | 'manage' | 'readmanage';

const ACCESS_LABEL: Record<Access, string> = {
  hidden: '  -  ',
  view: 'view ',
  post: 'post ',
  manage: 'MANAGE',
  readmanage: 'view+M',
};

interface PresetAccess {
  everyone: Access;
  unverified: Access;
  cultivators: Access;
  mod: Access;
  admin: Access;
}

const PRESET_ACCESS: Record<PermPreset, PresetAccess> = {
  public_read: {
    everyone: 'view',
    unverified: 'view',
    cultivators: 'view',
    mod: 'post',
    admin: 'manage',
  },
  public_full: {
    everyone: 'post',
    unverified: 'post',
    cultivators: 'post',
    mod: 'manage',
    admin: 'manage',
  },
  verified_full: {
    everyone: 'hidden',
    unverified: 'hidden',
    cultivators: 'post',
    mod: 'manage',
    admin: 'manage',
  },
  verified_read: {
    everyone: 'hidden',
    unverified: 'hidden',
    cultivators: 'view',
    mod: 'post',
    admin: 'manage',
  },
  unverified_only: {
    everyone: 'hidden',
    unverified: 'post',
    cultivators: 'hidden',
    mod: 'view',
    admin: 'manage',
  },
  mod_only: {
    everyone: 'hidden',
    unverified: 'hidden',
    cultivators: 'hidden',
    mod: 'post',
    admin: 'manage',
  },
  admin_only: {
    everyone: 'hidden',
    unverified: 'hidden',
    cultivators: 'hidden',
    mod: 'hidden',
    admin: 'manage',
  },
  bot_log: {
    everyone: 'hidden',
    unverified: 'hidden',
    cultivators: 'hidden',
    mod: 'view',
    admin: 'readmanage',
  },
};

const COL_WIDTH_CHANNEL = 22;
const COL_WIDTH_ACCESS = 7;

function pad(s: string, w: number): string {
  if (s.length >= w) return s.slice(0, w);
  return s + ' '.repeat(w - s.length);
}

export const permissions: BotCliService = {
  name: 'permissions',
  description: 'Render channel × role permission matrix from server-structure',
  usage: 'permissions',
  needsClient: false,
  async execute() {
    const lines: string[] = ['', '=== Channel × Role Access Matrix ===', ''];

    const header = [
      pad('CHANNEL', COL_WIDTH_CHANNEL),
      pad('@everyone', COL_WIDTH_ACCESS),
      pad('Unverif', COL_WIDTH_ACCESS),
      pad('Cultiv', COL_WIDTH_ACCESS),
      pad('Mod', COL_WIDTH_ACCESS),
      pad('Admin', COL_WIDTH_ACCESS),
      'PRESET',
    ].join(' │ ');
    lines.push(header);
    lines.push('─'.repeat(header.length));

    for (const cat of CATEGORIES) {
      lines.push(`▼ ${cat.name}`);
      for (const ch of cat.channels) {
        const access = PRESET_ACCESS[ch.perm];
        const row = [
          pad(`  ${ch.name}`, COL_WIDTH_CHANNEL),
          pad(ACCESS_LABEL[access.everyone], COL_WIDTH_ACCESS),
          pad(ACCESS_LABEL[access.unverified], COL_WIDTH_ACCESS),
          pad(ACCESS_LABEL[access.cultivators], COL_WIDTH_ACCESS),
          pad(ACCESS_LABEL[access.mod], COL_WIDTH_ACCESS),
          pad(ACCESS_LABEL[access.admin], COL_WIDTH_ACCESS),
          ch.perm,
        ].join(' │ ');
        lines.push(row);
      }
    }

    lines.push('');
    lines.push('Legend:');
    lines.push('  view   = can see + read history');
    lines.push('  post   = view + send messages');
    lines.push('  MANAGE = post + moderate (delete, pin, manage channel)');
    lines.push('  view+M = view + manage (NO send — bot-only-post channels)');
    lines.push('  -      = hidden (cannot see)');
    lines.push('');
    lines.push('Role groups:');
    lines.push('  @everyone   = before joining (incl. raid bots, lurkers)');
    lines.push('  Unverif     = "Chưa Xác Minh" — joined but not verified yet');
    lines.push(
      '  Cultiv      = Phàm Nhân, Luyện Khí, ..., Độ Kiếp, Tiên Nhân (11 cultivation roles)',
    );
    lines.push('  Mod         = Nội Môn Đệ Tử (moderator)');
    lines.push('  Admin       = Trưởng Lão (administrator)');
    lines.push('');

    process.stdout.write(lines.join('\n'));
  },
};
