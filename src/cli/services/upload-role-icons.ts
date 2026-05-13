import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Role } from 'discord.js';
import {
  CULTIVATION_ICONS,
  type IconSource,
  type RoleIconAssignment,
  SUBTITLE_ICONS,
} from '../../config/role-icons.js';
import type { BotCliService } from '../service.js';

/**
 * Apply role icons (cultivation + sub-titles) to the guild.
 *
 * Discord requires **Server Boost Level 2** (≥ 7 boosts) for either
 * unicode-emoji or custom-PNG role icons. The CLI checks
 * `guild.premiumTier` first and aborts with a clear message if the
 * guild isn't there yet.
 *
 * Usage:
 *   npm run bot -- upload-role-icons               # all roles, unicode default
 *   npm run bot -- upload-role-icons --use=png     # use PNG from assets/role-icons/
 *   npm run bot -- upload-role-icons --dry-run     # preview
 *   npm run bot -- upload-role-icons --kind=sub    # only sub-titles
 *
 * PNG asset spec (see assets/role-icons/README.md):
 *   - 256x256 PNG, transparent background
 *   - Energy-orb motif, tinted to match cultivation.ts colorHex
 *   - Filename matches CultivationRankId (e.g., pham_nhan.png)
 */

interface ParsedArgs {
  use: IconSource;
  dryRun: boolean;
  kind: 'all' | 'cultivation' | 'sub';
}

function parseArgs(args: readonly string[]): ParsedArgs {
  let use: IconSource = 'unicode';
  let dryRun = false;
  let kind: ParsedArgs['kind'] = 'all';
  for (const a of args) {
    if (a === '--dry-run') dryRun = true;
    else if (a === '--use=png') use = 'png';
    else if (a === '--use=unicode') use = 'unicode';
    else if (a === '--kind=cultivation') kind = 'cultivation';
    else if (a === '--kind=sub') kind = 'sub';
  }
  return { use, dryRun, kind };
}

const ASSETS_DIR = 'assets/role-icons';
const BOOST_TIER_REQUIRED = 2;

async function readPng(filename: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(path.join(ASSETS_DIR, filename));
  } catch {
    return null;
  }
}

async function applyIcon(
  role: Role,
  assignment: RoleIconAssignment,
  source: IconSource,
  dryRun: boolean,
): Promise<'applied-unicode' | 'applied-png' | 'png-missing' | 'dry-unicode' | 'dry-png'> {
  if (source === 'unicode') {
    if (dryRun) return 'dry-unicode';
    await role.setUnicodeEmoji(assignment.unicodeEmoji);
    return 'applied-unicode';
  }
  const buf = await readPng(assignment.pngPath);
  if (!buf) return 'png-missing';
  if (dryRun) return 'dry-png';
  await role.setIcon(buf);
  return 'applied-png';
}

export const uploadRoleIcons: BotCliService = {
  name: 'upload-role-icons',
  description: 'Apply unicode-emoji or PNG icons to cultivation + sub-title roles (needs Boost L2)',
  usage: 'upload-role-icons [--use=unicode|png] [--kind=all|cultivation|sub] [--dry-run]',
  needsClient: true,
  async execute(ctx, args) {
    const g = ctx.guild;
    if (!g) throw new Error('upload-role-icons requires a connected client');
    const parsed = parseArgs(args);

    // Re-fetch with force to ensure premiumTier + name are populated
    // (guilds.fetch(id) without force may return a partial).
    await g.fetch();

    const tier = g.premiumTier ?? 0;
    const lines: string[] = [
      '',
      `=== upload-role-icons ${parsed.dryRun ? '(DRY-RUN)' : '(APPLY)'} ===`,
      `Guild      : ${g.name ?? g.id}`,
      `Boost tier : ${tier} (${g.premiumSubscriptionCount ?? 0} boosts)`,
      `Source     : ${parsed.use}`,
      `Kind       : ${parsed.kind}`,
      '',
    ];

    if (tier < BOOST_TIER_REQUIRED) {
      lines.push(
        `⚠️  Server Boost Level ${BOOST_TIER_REQUIRED} required for role icons. Current: tier ${g.premiumTier}.`,
        '   Skipping all assignments.',
        '   When the server reaches Boost Level 2 (need ≥ 7 boosts), re-run this CLI.',
        '',
      );
      process.stdout.write(lines.join('\n'));
      return;
    }

    await g.roles.fetch();

    const assignments: RoleIconAssignment[] = [];
    if (parsed.kind === 'all' || parsed.kind === 'cultivation') {
      assignments.push(...Object.values(CULTIVATION_ICONS));
    }
    if (parsed.kind === 'all' || parsed.kind === 'sub') {
      assignments.push(...Object.values(SUBTITLE_ICONS));
    }

    const counters = { applied: 0, missingRole: 0, missingPng: 0, dryRun: 0, failed: 0 };
    for (const a of assignments) {
      const role = g.roles.cache.find((r) => r.name === a.roleName);
      if (!role) {
        lines.push(`  ${a.roleName.padEnd(18)} → ⚠️  role missing`);
        counters.missingRole++;
        continue;
      }
      try {
        const result = await applyIcon(role, a, parsed.use, parsed.dryRun);
        const tag =
          result === 'applied-unicode'
            ? `✅ unicode ${a.unicodeEmoji}`
            : result === 'applied-png'
              ? `✅ png ${a.pngPath}`
              : result === 'png-missing'
                ? `⚠️  png ${a.pngPath} not found in ${ASSETS_DIR}/`
                : result === 'dry-unicode'
                  ? `➕ would set unicode ${a.unicodeEmoji}`
                  : `➕ would set png ${a.pngPath}`;
        lines.push(`  ${a.roleName.padEnd(18)} → ${tag}`);
        if (result === 'applied-unicode' || result === 'applied-png') counters.applied++;
        else if (result === 'png-missing') counters.missingPng++;
        else counters.dryRun++;
        await new Promise((r) => setTimeout(r, 300));
      } catch (err) {
        counters.failed++;
        lines.push(`  ${a.roleName.padEnd(18)} → ❌ ${(err as Error).message}`);
      }
    }

    lines.push(
      '',
      'Summary:',
      parsed.dryRun
        ? `  would apply       : ${counters.dryRun}`
        : `  applied           : ${counters.applied}`,
      `  role missing      : ${counters.missingRole}`,
      ...(parsed.use === 'png' ? [`  png missing       : ${counters.missingPng}`] : []),
      `  failed            : ${counters.failed}`,
      '',
    );
    process.stdout.write(lines.join('\n'));
  },
};
