import type { GuildMember } from 'discord.js';
import type { VerificationConfig } from '../../config/verification.js';

/**
 * Layer 1 account audit. Examines a joining member for cheap-to-check
 * heuristics (account age, avatar, username pattern) and returns a
 * routing decision for the verification flow:
 *
 *   - 'kick'    : account is too young → kick immediately, log
 *   - 'suspect' : has at least one soft-fail signal → use hard captcha
 *   - 'clean'   : no signals → use standard captcha
 *
 * All checks are pure functions of the member object + config; no I/O.
 */

export type AuditDecision = 'kick' | 'suspect' | 'clean';

export interface AuditResult {
  decision: AuditDecision;
  reasons: string[];
  isSuspect: boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function accountAgeDays(member: GuildMember, now: number): number {
  return (now - member.user.createdTimestamp) / MS_PER_DAY;
}

function hasCustomAvatar(member: GuildMember): boolean {
  return member.user.avatar !== null;
}

function matchesBotPattern(username: string, patterns: readonly string[]): string | null {
  for (const pat of patterns) {
    if (new RegExp(pat).test(username)) return pat;
  }
  return null;
}

/**
 * Run the full audit and produce a routing decision.
 */
export function auditMember(
  member: GuildMember,
  config: VerificationConfig,
  now: number = Date.now(),
): AuditResult {
  const reasons: string[] = [];
  const ageDays = accountAgeDays(member, now);

  // HARD fail: account too young → kick.
  if (ageDays < config.thresholds.accountAgeKickDays) {
    return {
      decision: 'kick',
      reasons: [`account age ${ageDays.toFixed(2)}d < kick threshold ${config.thresholds.accountAgeKickDays}d`],
      isSuspect: true,
    };
  }

  // SOFT signals → mark suspect, use hard captcha.
  if (ageDays < config.thresholds.accountAgeSuspectDays) {
    reasons.push(
      `account age ${ageDays.toFixed(2)}d < suspect threshold ${config.thresholds.accountAgeSuspectDays}d`,
    );
  }
  if (!hasCustomAvatar(member)) {
    reasons.push('no custom avatar');
  }
  const botPatternHit = matchesBotPattern(member.user.username, config.botUsernamePatterns);
  if (botPatternHit) {
    reasons.push(`username matches bot pattern: ${botPatternHit}`);
  }

  if (reasons.length > 0) {
    return { decision: 'suspect', reasons, isSuspect: true };
  }

  return { decision: 'clean', reasons: [], isSuspect: false };
}
