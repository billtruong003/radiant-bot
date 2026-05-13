import { OverwriteType, PermissionsBitField } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { type ResolveContext, resolveOverwrites } from '../../src/modules/sync/perm-presets.js';

const F = PermissionsBitField.Flags;

function ctxFromRoles(roles: Record<string, string>): ResolveContext {
  return {
    everyoneRoleId: '0',
    roleByName: new Map(Object.entries(roles).map(([name, id]) => [name, { id }])),
  };
}

function getOverwrite(
  overwrites: ReturnType<typeof resolveOverwrites>,
  id: string,
): { allow: bigint; deny: bigint; type: OverwriteType | undefined } {
  const o = overwrites.find((x) => x.id === id);
  if (!o) throw new Error(`overwrite for id ${id} not found`);
  const allow = typeof o.allow === 'bigint' ? o.allow : 0n;
  const deny = typeof o.deny === 'bigint' ? o.deny : 0n;
  return { allow, deny, type: o.type };
}

function tryGetOverwrite(
  overwrites: ReturnType<typeof resolveOverwrites>,
  id: string,
): { allow: bigint; deny: bigint; type: OverwriteType | undefined } | undefined {
  const o = overwrites.find((x) => x.id === id);
  if (!o) return undefined;
  const allow = typeof o.allow === 'bigint' ? o.allow : 0n;
  const deny = typeof o.deny === 'bigint' ? o.deny : 0n;
  return { allow, deny, type: o.type };
}

const STANDARD_ROLES = {
  'Phàm Nhân': 'rank-pham-nhan',
  'Luyện Khí': 'rank-luyen-khi',
  'Trúc Cơ': 'rank-truc-co',
  'Kim Đan': 'rank-kim-dan',
  'Nguyên Anh': 'rank-nguyen-anh',
  'Hóa Thần': 'rank-hoa-than',
  'Luyện Hư': 'rank-luyen-hu',
  'Hợp Thể': 'rank-hop-the',
  'Đại Thừa': 'rank-dai-thua',
  'Độ Kiếp': 'rank-do-kiep',
  'Tiên Nhân': 'rank-tien-nhan',
  'Chấp Pháp': 'staff-mod',
  'Trưởng Lão': 'staff-elder',
  'Chưởng Môn': 'staff-master',
  'Chưa Xác Minh': 'role-unverified',
};

describe('resolveOverwrites', () => {
  it('public_read: @everyone view, mod can post+manage, admin full', () => {
    const ows = resolveOverwrites('public_read', ctxFromRoles(STANDARD_ROLES));
    const everyone = getOverwrite(ows, '0');
    expect(everyone.allow & F.ViewChannel).toBe(F.ViewChannel);
    expect(everyone.allow & F.SendMessages).toBe(0n);
    const mod = getOverwrite(ows, 'staff-mod');
    expect(mod.allow & F.SendMessages).toBe(F.SendMessages);
  });

  it('verified_full: @everyone denied view, all cultivation roles allowed view+send', () => {
    const ows = resolveOverwrites('verified_full', ctxFromRoles(STANDARD_ROLES));
    const everyone = getOverwrite(ows, '0');
    expect(everyone.deny & F.ViewChannel).toBe(F.ViewChannel);

    for (const roleId of [
      'rank-pham-nhan',
      'rank-luyen-khi',
      'rank-truc-co',
      'rank-kim-dan',
      'rank-nguyen-anh',
      'rank-hoa-than',
      'rank-luyen-hu',
      'rank-hop-the',
      'rank-dai-thua',
      'rank-do-kiep',
      'rank-tien-nhan',
    ]) {
      const ow = getOverwrite(ows, roleId);
      expect(ow.allow & F.ViewChannel, `role ${roleId} missing view`).toBe(F.ViewChannel);
      expect(ow.allow & F.SendMessages, `role ${roleId} missing send`).toBe(F.SendMessages);
    }
    const unverified = getOverwrite(ows, 'role-unverified');
    expect(unverified.deny & F.ViewChannel).toBe(F.ViewChannel);
  });

  it('verified_read: cultivation roles can view but NOT send', () => {
    const ows = resolveOverwrites('verified_read', ctxFromRoles(STANDARD_ROLES));
    const phamnhan = getOverwrite(ows, 'rank-pham-nhan');
    expect(phamnhan.allow & F.ViewChannel).toBe(F.ViewChannel);
    expect(phamnhan.allow & F.SendMessages).toBe(0n);
    const mod = getOverwrite(ows, 'staff-mod');
    expect(mod.allow & F.SendMessages).toBe(F.SendMessages);
  });

  it('unverified_only: only Chưa Xác Minh allowed; cultivators denied', () => {
    const ows = resolveOverwrites('unverified_only', ctxFromRoles(STANDARD_ROLES));
    const everyone = getOverwrite(ows, '0');
    expect(everyone.deny & F.ViewChannel).toBe(F.ViewChannel);
    const unv = getOverwrite(ows, 'role-unverified');
    expect(unv.allow & F.ViewChannel).toBe(F.ViewChannel);
    expect(unv.allow & F.SendMessages).toBe(F.SendMessages);
    const phamnhan = getOverwrite(ows, 'rank-pham-nhan');
    expect(phamnhan.deny & F.ViewChannel).toBe(F.ViewChannel);
  });

  it('admin_only: Chưởng Môn + Trưởng Lão allowed; mod and cultivators denied', () => {
    const ows = resolveOverwrites('admin_only', ctxFromRoles(STANDARD_ROLES));
    const master = getOverwrite(ows, 'staff-master');
    expect(master.allow & F.ViewChannel).toBe(F.ViewChannel);
    expect(master.allow & F.SendMessages).toBe(F.SendMessages);
    const elder = getOverwrite(ows, 'staff-elder');
    expect(elder.allow & F.ViewChannel).toBe(F.ViewChannel);
    expect(elder.allow & F.SendMessages).toBe(F.SendMessages);
    // Only master gets ManageChannels (Trưởng Lão is supermod, not server admin).
    expect(master.allow & F.ManageChannels).toBe(F.ManageChannels);
    expect(elder.allow & F.ManageChannels).toBe(0n);

    const mod = getOverwrite(ows, 'staff-mod');
    expect(mod.deny & F.ViewChannel).toBe(F.ViewChannel);
    expect(mod.allow & F.SendMessages).toBe(0n);
  });

  it('bot_log: nobody posts; mod views; elder+master view+manage', () => {
    const ows = resolveOverwrites('bot_log', ctxFromRoles(STANDARD_ROLES));
    const everyone = getOverwrite(ows, '0');
    expect(everyone.deny & F.ViewChannel).toBe(F.ViewChannel);

    const mod = getOverwrite(ows, 'staff-mod');
    expect(mod.allow & F.ViewChannel).toBe(F.ViewChannel);
    expect(mod.allow & F.SendMessages).toBe(0n);
    expect(mod.allow & F.ManageMessages).toBe(0n);

    const elder = getOverwrite(ows, 'staff-elder');
    expect(elder.allow & F.ViewChannel).toBe(F.ViewChannel);
    expect(elder.allow & F.SendMessages).toBe(0n);
    expect(elder.allow & F.ManageMessages).toBe(F.ManageMessages);

    const master = getOverwrite(ows, 'staff-master');
    expect(master.allow & F.ViewChannel).toBe(F.ViewChannel);
    expect(master.allow & F.SendMessages).toBe(0n);
    expect(master.allow & F.ManageMessages).toBe(F.ManageMessages);
  });

  it('verified_full: Master gets ManageRoles (can promote); Elder does NOT', () => {
    const ows = resolveOverwrites('verified_full', ctxFromRoles(STANDARD_ROLES));
    const master = getOverwrite(ows, 'staff-master');
    expect(master.allow & F.ManageRoles).toBe(F.ManageRoles);
    const elder = getOverwrite(ows, 'staff-elder');
    expect(elder.allow & F.ManageRoles).toBe(0n);
    // But Elder still gets mod-tier message powers.
    expect(elder.allow & F.ManageMessages).toBe(F.ManageMessages);
  });

  it('missing role names are silently skipped (no exception)', () => {
    const ctx = ctxFromRoles({});
    const ows = resolveOverwrites('verified_full', ctx);
    expect(ows).toHaveLength(1);
    expect(ows[0]?.id).toBe('0');
    const everyone = tryGetOverwrite(ows, '0');
    expect(everyone).toBeDefined();
  });

  it('all overwrites are role type, not member', () => {
    const ows = resolveOverwrites('verified_full', ctxFromRoles(STANDARD_ROLES));
    for (const o of ows) {
      expect(o.type).toBe(OverwriteType.Role);
    }
  });

  it('no overwrite has both same role appearing twice', () => {
    const ows = resolveOverwrites('verified_full', ctxFromRoles(STANDARD_ROLES));
    const ids = ows.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
