import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Guild, GuildMember } from 'discord.js';
import { env } from '../../config/env.js';
import { loadVerificationConfig } from '../../config/verification.js';
import { type AuditResult, auditMember } from '../../modules/verification/audit.js';
import { buildChallenge } from '../../modules/verification/flow.js';
import type { BotCliService } from '../service.js';

/**
 * Dry-run verification preview for an existing guild member.
 *
 * What it does:
 *   1. Resolves the target member (by `--member=<id>` or `--self` =
 *      first ADMIN_USER_IDS env entry).
 *   2. Runs the Layer 1 audit on their actual account properties.
 *   3. Builds the would-be challenge.
 *   4. Prints the audit decision + DM preview + challenge expected.
 *   5. If hard captcha, saves the image PNG to `data/simulate-captcha-<id>.png`
 *      so the operator can eyeball whether it's readable.
 *
 * What it does NOT do:
 *   - Send a real DM.
 *   - Persist a Verification record.
 *   - Touch the member's roles or kick them.
 *
 * This is a rendering preview, not an end-to-end test. The full flow is
 * covered by `tests/verification/flow-integration.test.ts` with mocked
 * Discord. For a true round-trip live test, use an alt account.
 */

interface ParsedArgs {
  memberId: string | null;
  self: boolean;
  decisionOverride: AuditResult['decision'] | null;
  forceHard: boolean;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  let memberId: string | null = null;
  let self = false;
  let decisionOverride: AuditResult['decision'] | null = null;
  let forceHard = false;
  for (const a of args) {
    if (a === '--self') self = true;
    else if (a === '--force-hard') forceHard = true;
    else if (a.startsWith('--member=')) memberId = a.slice('--member='.length);
    else if (a.startsWith('--decision=')) {
      const v = a.slice('--decision='.length);
      if (v === 'clean' || v === 'suspect' || v === 'kick') decisionOverride = v;
    }
  }
  return { memberId, self, decisionOverride, forceHard };
}

async function resolveMember(guild: Guild, parsed: ParsedArgs): Promise<GuildMember> {
  if (parsed.self) {
    // Prefer ADMIN_USER_IDS[0] if set; fall back to guild owner since the
    // operator running this CLI is realistically the server owner.
    const targetId = env.ADMIN_USER_IDS[0] ?? guild.ownerId;
    return await guild.members.fetch(targetId);
  }
  if (!parsed.memberId) {
    throw new Error('must pass --member=<id> or --self');
  }
  return await guild.members.fetch(parsed.memberId);
}

export const simulateVerify: BotCliService = {
  name: 'simulate-verify',
  description:
    'Dry-run preview of the verification flow for a given member (audit + challenge + PNG, no DM)',
  usage: 'simulate-verify [--self | --member=<id>] [--decision=clean|suspect|kick] [--force-hard]',
  needsClient: true,
  async execute(ctx, args) {
    const g = ctx.guild;
    if (!g) throw new Error('simulate-verify requires a connected client');
    const parsed = parseArgs(args);

    await g.roles.fetch();
    const member = await resolveMember(g, parsed);
    const config = await loadVerificationConfig();

    const realAudit = auditMember(member, config);
    const audit: AuditResult = parsed.decisionOverride
      ? {
          decision: parsed.decisionOverride,
          reasons:
            parsed.decisionOverride === realAudit.decision
              ? realAudit.reasons
              : [`override → ${parsed.decisionOverride}`],
          isSuspect: parsed.decisionOverride === 'kick' || parsed.decisionOverride === 'suspect',
        }
      : realAudit;

    const lines: string[] = [
      '',
      '=== simulate-verify (DRY-RUN) ===',
      `Target  : ${member.user.tag} (${member.id})`,
      `Account : created ${new Date(member.user.createdTimestamp).toISOString()}`,
      `Avatar  : ${member.user.avatar ? 'custom' : 'default (no avatar)'}`,
      `Roles   : ${[...member.roles.cache.values()].map((r) => r.name).join(', ') || '<none>'}`,
      '',
      'AUDIT (Layer 1):',
      `  decision  : ${audit.decision}${parsed.decisionOverride ? '  (overridden)' : ''}`,
      `  isSuspect : ${audit.isSuspect}`,
      `  reasons   : ${audit.reasons.length ? audit.reasons.join(' | ') : '<none>'}`,
      '',
    ];

    if (audit.decision === 'kick') {
      lines.push('→ Would KICK immediately (no challenge generated).');
      lines.push('');
      process.stdout.write(lines.join('\n'));
      return;
    }

    const challenge = buildChallenge(audit, config, { forceHard: parsed.forceHard });
    lines.push('CHALLENGE:');
    lines.push(`  type     : ${challenge.challenge_type}`);
    lines.push(`  expected : ${challenge.challenge_data.expected}`);
    if (challenge.challenge_type === 'image+math') {
      lines.push(`  imageText: ${challenge.challenge_data.image_text}`);
      lines.push(`  mathAns  : ${challenge.challenge_data.math_answer}`);
    }
    lines.push('');
    lines.push('DM PREVIEW (would be sent):');
    lines.push('---');
    lines.push(challenge.dmContent);
    lines.push('---');
    lines.push('');

    if (challenge.dmImageBuffer) {
      await fs.mkdir(env.DATA_DIR, { recursive: true });
      const outPath = path.join(env.DATA_DIR, `simulate-captcha-${member.id}.png`);
      await fs.writeFile(outPath, challenge.dmImageBuffer);
      lines.push(`Image captcha saved → ${outPath}`);
      lines.push('  (open it to confirm the text is human-readable)');
      lines.push('');
    }

    lines.push('No DM was sent. No Verification record persisted. No roles changed.');
    lines.push('');
    process.stdout.write(lines.join('\n'));
  },
};
