import type { Guild, GuildMember, Role } from 'discord.js';
import { CULTIVATION_RANKS } from '../../config/cultivation.js';
import type { BotCliService } from '../service.js';

const PHAM_NHAN_ROLE_NAME = 'Phàm Nhân';
const UNVERIFIED_ROLE_NAME = 'Chưa Xác Minh';

const CULTIVATION_ROLE_NAMES: ReadonlySet<string> = new Set(CULTIVATION_RANKS.map((r) => r.name));
// Also accept Tiên Nhân (admin-grant top) + Thiên Đạo (bot's flair role) so
// members already promoted aren't downgraded.
const PROTECTED_ROLE_NAMES: ReadonlySet<string> = new Set([
  ...CULTIVATION_ROLE_NAMES,
  'Tiên Nhân',
  'Chưởng Môn',
  'Thiên Đạo',
  'Trưởng Lão',
  'Chấp Pháp', // was Nội Môn Đệ Tử
]);

interface OnboardOutcome {
  member: GuildMember;
  reason: 'bot' | 'is-owner' | 'has-rank' | 'is-staff' | 'will-onboard';
  actions: { addRole?: string; removeRole?: string };
}

function classifyMember(
  member: GuildMember,
  phamNhanId: string,
  unverifiedId: string,
  ownerId: string,
): OnboardOutcome {
  if (member.user.bot) {
    return { member, reason: 'bot', actions: {} };
  }
  // Server owner bypasses Discord permissions anyway; never auto-onboard
  // them into Phàm Nhân (they should hold Trưởng Lão manually).
  if (member.id === ownerId) {
    return { member, reason: 'is-owner', actions: {} };
  }
  // Has any protected role (already a cultivator or staff) → skip.
  for (const role of member.roles.cache.values()) {
    if (PROTECTED_ROLE_NAMES.has(role.name)) {
      const isStaff =
        role.name === 'Chưởng Môn' ||
        role.name === 'Thiên Đạo' ||
        role.name === 'Trưởng Lão' ||
        role.name === 'Chấp Pháp';
      return {
        member,
        reason: isStaff ? 'is-staff' : 'has-rank',
        actions: {},
      };
    }
  }
  const actions: OnboardOutcome['actions'] = { addRole: phamNhanId };
  if (member.roles.cache.has(unverifiedId)) {
    actions.removeRole = unverifiedId;
  }
  return { member, reason: 'will-onboard', actions };
}

function resolveRole(guild: Guild, name: string): Role {
  const role = guild.roles.cache.find((r) => r.name === name);
  if (!role) throw new Error(`role not found: "${name}" — run sync-server first`);
  return role;
}

export const bulkOnboard: BotCliService = {
  name: 'bulk-onboard',
  description:
    'One-time grant Phàm Nhân to existing members (skips verification flow). Pass --apply to actually run.',
  usage: 'bulk-onboard [--apply]',
  needsClient: true,
  async execute(ctx, args) {
    const g = ctx.guild;
    if (!g) throw new Error('bulk-onboard requires a connected client');
    const apply = args.includes('--apply');

    // Populate role + member caches before any lookups.
    await g.roles.fetch();
    const phamNhan = resolveRole(g, PHAM_NHAN_ROLE_NAME);
    const unverified = resolveRole(g, UNVERIFIED_ROLE_NAME);

    // Discord caps fetch() at 1000 by default; bots <1k members fit in one call.
    const members = await g.members.fetch();
    const outcomes = [...members.values()].map((m) =>
      classifyMember(m, phamNhan.id, unverified.id, g.ownerId),
    );

    const groups = {
      bot: outcomes.filter((o) => o.reason === 'bot'),
      owner: outcomes.filter((o) => o.reason === 'is-owner'),
      hasRank: outcomes.filter((o) => o.reason === 'has-rank'),
      isStaff: outcomes.filter((o) => o.reason === 'is-staff'),
      willOnboard: outcomes.filter((o) => o.reason === 'will-onboard'),
    };

    const lines: string[] = [
      '',
      `=== bulk-onboard ${apply ? '(APPLY)' : '(DRY-RUN)'} ===`,
      `Total members fetched: ${members.size}`,
      `  bots                  : ${groups.bot.length}  (skipped)`,
      `  server owner          : ${groups.owner.length}  (skipped — manual role assignment)`,
      `  already has rank      : ${groups.hasRank.length}  (skipped — cultivation role detected)`,
      `  staff (admin/mod)     : ${groups.isStaff.length}  (skipped — top role)`,
      `  → will receive Phàm Nhân: ${groups.willOnboard.length}`,
      '',
    ];

    if (groups.willOnboard.length > 0) {
      lines.push('Will onboard:');
      for (const o of groups.willOnboard) {
        const tag = `${o.member.user.tag}`;
        const rmNote = o.actions.removeRole ? ' (also remove Chưa Xác Minh)' : '';
        lines.push(`  + ${tag.padEnd(40)} ${o.member.id}${rmNote}`);
      }
      lines.push('');
    }

    process.stdout.write(lines.join('\n'));

    if (!apply) {
      process.stdout.write('Dry-run. Re-run with `-- --apply` to actually grant roles.\n\n');
      return;
    }

    let granted = 0;
    let failed = 0;
    for (const o of groups.willOnboard) {
      const rolesToSet = new Set(o.member.roles.cache.keys());
      rolesToSet.add(phamNhan.id);
      rolesToSet.delete(unverified.id);
      try {
        await o.member.roles.set(
          [...rolesToSet],
          'bulk-onboard: grant Phàm Nhân to pre-existing member',
        );
        granted++;
        if (granted % 10 === 0) {
          process.stdout.write(`  ... ${granted}/${groups.willOnboard.length}\n`);
        }
      } catch (err) {
        failed++;
        process.stderr.write(`  ! failed ${o.member.user.tag}: ${(err as Error).message}\n`);
      }
      // Light rate-limit pacing; discord.js handles bursts but we want headroom.
      await new Promise((r) => setTimeout(r, 250));
    }

    process.stdout.write(
      `\n=== bulk-onboard complete ===\n  granted: ${granted}\n  failed : ${failed}\n\n`,
    );
  },
};
