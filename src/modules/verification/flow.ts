import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type Guild,
  type GuildMember,
  ModalBuilder,
  type ModalSubmitInteraction,
  type Role,
  type TextChannel,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { ulid } from 'ulid';
import { ANNOUNCEMENT_CHANNELS } from '../../config/channels.js';
import type { VerificationConfig } from '../../config/verification.js';
import { getStore } from '../../db/index.js';
import type { Verification } from '../../db/types.js';
import { logger } from '../../utils/logger.js';
import { postBotLog } from '../bot-log.js';
import type { AuditResult } from './audit.js';
import { generateImageCaptcha, parseHardReply, verifyImageReply } from './captcha-image.js';
import { generateMathChallenge, renderMathChallenge, verifyMathReply } from './captcha-math.js';

/**
 * Verification flow orchestrator. State machine drives a member from
 * `guildMemberAdd` through challenge → reply → pass/fail/timeout.
 *
 * State lives in `store.verifications` keyed by `discord_id`:
 *   pending → passed | failed | timeout
 *
 * Two entry surfaces:
 *   - DM (preferred): `startVerification` tries to DM the challenge.
 *   - Fallback button: posted in #verify if DM is blocked. Click opens a
 *     modal (math) or an ephemeral with image + "Nhập đáp án" button
 *     (image+math).
 *
 * All Discord side-effects log to pino; persistent mod-log entries go to
 * `store.automodLogs`. The #bot-log channel post is wired up in events/
 * (Chunk 5) so flow.ts stays headless and testable for the pure parts.
 */

export const PHAM_NHAN_ROLE_NAME = 'Phàm Nhân';
export const UNVERIFIED_ROLE_NAME = 'Chưa Xác Minh';

export const BUTTON_ID_START = 'verify:start';
export const BUTTON_ID_OPEN_MODAL = 'verify:open';
export const MODAL_ID = 'verify:modal';
export const MODAL_INPUT_ID = 'verify:answer';

const KICK_REASONS = {
  audit: 'Account audit kick — age below threshold',
  failed: 'Verification failed — max attempts exceeded',
  timeout: 'Verification timeout',
} as const;

interface BuildChallengeResult {
  challenge_type: Verification['challenge_type'];
  challenge_data: Verification['challenge_data'];
  dmContent: string;
  dmImageBuffer: Buffer | null;
}

/**
 * Build a challenge payload from an audit decision. Pure: no side effects,
 * tests can call this directly.
 *
 * - `clean` audit (or no force) → math challenge
 * - `suspect` audit OR `forceHard` (raid mode) → image+math challenge
 */
export function buildChallenge(
  audit: AuditResult,
  config: VerificationConfig,
  opts: { forceHard?: boolean } = {},
): BuildChallengeResult {
  const useHard = opts.forceHard || audit.decision === 'suspect';

  if (useHard) {
    const img = generateImageCaptcha();
    const math = generateMathChallenge({
      minA: config.captcha.mathMinA,
      maxA: config.captcha.mathMaxA,
      minB: config.captcha.mathMinB,
      maxB: config.captcha.mathMaxB,
    });
    const expected = `${img.text} ${math.expected}`;
    const dm = [
      '🏯 **Chào mừng đến Radiant Tech Sect**',
      '',
      'Tài khoản của bạn được đánh giá là cần xác minh nâng cao.',
      `Hãy nhìn vào ảnh đính kèm và trả lời theo định dạng: \`<chữ trong ảnh> ${math.a}+${math.b}\``,
      `Ví dụ: \`ABC2XY ${math.a + math.b}\``,
      '',
      `Thời gian: **${Math.floor(config.thresholds.captchaTimeoutMs / 60_000)} phút**. Tối đa **${config.thresholds.captchaMaxAttempts}** lần thử.`,
    ].join('\n');
    return {
      challenge_type: 'image+math',
      challenge_data: {
        expected,
        image_text: img.text,
        math_answer: math.expected,
      },
      dmContent: dm,
      dmImageBuffer: img.buffer,
    };
  }

  const math = generateMathChallenge({
    minA: config.captcha.mathMinA,
    maxA: config.captcha.mathMaxA,
    minB: config.captcha.mathMinB,
    maxB: config.captcha.mathMaxB,
  });
  return {
    challenge_type: 'math',
    challenge_data: { expected: math.expected },
    dmContent: renderMathChallenge(math),
    dmImageBuffer: null,
  };
}

/**
 * Pure verifier — compares an inbound reply against the stored challenge.
 * No side effects, easy to unit-test.
 */
export function verifyReply(verification: Verification, reply: string): boolean {
  if (verification.challenge_type === 'math') {
    return verifyMathReply(reply, verification.challenge_data.expected);
  }
  const parsed = parseHardReply(reply);
  if (!parsed) return false;
  const imgText = String(verification.challenge_data.image_text ?? '');
  const mathExp = String(verification.challenge_data.math_answer ?? '');
  return verifyImageReply(parsed.imageText, imgText) && verifyMathReply(parsed.mathAnswer, mathExp);
}

function findRoleByName(guild: Guild, name: string): Role | null {
  return guild.roles.cache.find((r) => r.name === name) ?? null;
}

function findVerifyChannel(guild: Guild): TextChannel | null {
  const ch = guild.channels.cache.find(
    (c) => c.name === ANNOUNCEMENT_CHANNELS.verification && c.isTextBased(),
  );
  return (ch as TextChannel | undefined) ?? null;
}

async function logModAction(
  discordId: string,
  rule: 'spam' | 'profanity' | 'mass_mention' | 'link' | 'caps',
  action: 'delete' | 'warn' | 'timeout' | 'kick' | 'ban',
  context: Record<string, unknown>,
): Promise<void> {
  await getStore().automodLogs.append({
    id: ulid(),
    discord_id: discordId,
    rule,
    action,
    context,
    created_at: Date.now(),
  });
}

/**
 * Kick a member with a reason logged to pino + automodLogs. Best-effort —
 * if the kick API fails (e.g., bot lost permission), the error is logged
 * but not re-thrown.
 */
export async function kickWithReason(
  member: GuildMember,
  reason: keyof typeof KICK_REASONS,
  context: Record<string, unknown> = {},
): Promise<void> {
  const reasonText = KICK_REASONS[reason];
  try {
    await member.kick(reasonText);
    logger.info(
      { discord_id: member.id, tag: member.user.tag, reason, ...context },
      'verify: member kicked',
    );
  } catch (err) {
    logger.error(
      { err, discord_id: member.id, reason, ...context },
      'verify: kick failed (bot permission?)',
    );
  }
  await logModAction(member.id, 'spam', 'kick', { phase: 'verify', reason, ...context });
  await postBotLog(`❌ Kick **${member.user.tag}** (\`${member.id}\`) — lý do: \`${reason}\``);
}

/**
 * Try to grant Phàm Nhân and remove Chưa Xác Minh. Best-effort and
 * idempotent — already-verified members get a no-op.
 */
async function grantVerifiedRoles(member: GuildMember, reason: string): Promise<boolean> {
  const phamNhan = findRoleByName(member.guild, PHAM_NHAN_ROLE_NAME);
  const unverified = findRoleByName(member.guild, UNVERIFIED_ROLE_NAME);
  if (!phamNhan) {
    logger.error({ guild: member.guild.id }, 'verify: Phàm Nhân role missing — run sync-server');
    return false;
  }
  try {
    if (!member.roles.cache.has(phamNhan.id)) {
      await member.roles.add(phamNhan, reason);
    }
    if (unverified && member.roles.cache.has(unverified.id)) {
      await member.roles.remove(unverified, reason);
    }
    return true;
  } catch (err) {
    logger.error({ err, discord_id: member.id }, 'verify: role grant failed');
    return false;
  }
}

/**
 * Entry point. Run audit decision → kick early, or create a Verification
 * record + try to DM the challenge. On DM failure, post the fallback
 * button in #verify.
 */
export async function startVerification(
  member: GuildMember,
  audit: AuditResult,
  config: VerificationConfig,
  opts: { forceHard?: boolean } = {},
): Promise<{ status: 'pending' | 'kicked-by-audit'; dmDelivered: boolean }> {
  // Bots should never go through verification.
  if (member.user.bot) {
    return { status: 'pending', dmDelivered: false };
  }

  // Hard-fail audit decision → kick immediately, no challenge.
  if (audit.decision === 'kick') {
    await kickWithReason(member, 'audit', { audit_reasons: audit.reasons });
    return { status: 'kicked-by-audit', dmDelivered: false };
  }

  const challenge = buildChallenge(audit, config, opts);
  const verification: Verification = {
    discord_id: member.id,
    challenge_type: challenge.challenge_type,
    challenge_data: challenge.challenge_data,
    attempts: 0,
    started_at: Date.now(),
    status: 'pending',
  };
  await getStore().verifications.set(verification);

  logger.info(
    {
      discord_id: member.id,
      tag: member.user.tag,
      type: challenge.challenge_type,
      audit: audit.decision,
      audit_reasons: audit.reasons,
      force_hard: !!opts.forceHard,
    },
    'verify: challenge generated',
  );

  const delivered = await sendChallengeDm(member, challenge);
  if (!delivered) {
    await postFallbackButton(member, audit.decision);
  }
  return { status: 'pending', dmDelivered: delivered };
}

async function sendChallengeDm(
  member: GuildMember,
  challenge: BuildChallengeResult,
): Promise<boolean> {
  try {
    const dm = await member.createDM();
    if (challenge.dmImageBuffer) {
      await dm.send({
        content: challenge.dmContent,
        files: [{ attachment: challenge.dmImageBuffer, name: 'captcha.png' }],
      });
    } else {
      await dm.send({ content: challenge.dmContent });
    }
    return true;
  } catch (err) {
    logger.warn(
      { err, discord_id: member.id, tag: member.user.tag },
      'verify: DM failed, will use fallback button',
    );
    return false;
  }
}

async function postFallbackButton(
  member: GuildMember,
  auditDecision: AuditResult['decision'],
): Promise<void> {
  const channel = findVerifyChannel(member.guild);
  if (!channel) {
    logger.error(
      { guild: member.guild.id },
      'verify: #verify channel missing — cannot post fallback',
    );
    return;
  }
  const button = new ButtonBuilder()
    .setCustomId(BUTTON_ID_START)
    .setLabel('🔓 Bắt đầu xác minh')
    .setStyle(ButtonStyle.Primary);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);
  try {
    await channel.send({
      content: `${member}, tin nhắn riêng (DM) của bạn đang chặn bot. Bấm nút bên dưới để xác minh.`,
      components: [row],
      allowedMentions: { users: [member.id] },
    });
    logger.info(
      { discord_id: member.id, audit: auditDecision },
      'verify: fallback button posted in #verify',
    );
  } catch (err) {
    logger.error({ err, discord_id: member.id }, 'verify: failed to post fallback button');
  }
}

/**
 * Handle a DM reply for a pending verification. Returns the outcome so
 * the caller (messageCreate event) can decide what to acknowledge.
 *
 * Outcomes:
 *   - 'no-pending'  : sender has no pending verification (ignore)
 *   - 'pass'        : member verified, roles granted
 *   - 'fail-retry'  : wrong answer, attempts remain
 *   - 'fail-kick'   : wrong answer, attempts exhausted → kicked
 */
export async function handleDmReply(
  guild: Guild,
  authorId: string,
  reply: string,
  config: VerificationConfig,
): Promise<{
  outcome: 'no-pending' | 'pass' | 'fail-retry' | 'fail-kick';
  attemptsLeft?: number;
}> {
  const verification = getStore().verifications.get(authorId);
  if (!verification || verification.status !== 'pending') {
    return { outcome: 'no-pending' };
  }

  const member = await guild.members.fetch(authorId).catch(() => null);
  if (!member) {
    // Member left while pending — clear record so we don't leak.
    await getStore().verifications.delete(authorId);
    return { outcome: 'no-pending' };
  }

  return resolveAttempt(member, verification, reply, config);
}

async function resolveAttempt(
  member: GuildMember,
  verification: Verification,
  reply: string,
  config: VerificationConfig,
): Promise<{
  outcome: 'pass' | 'fail-retry' | 'fail-kick';
  attemptsLeft?: number;
}> {
  if (verifyReply(verification, reply)) {
    return passVerification(member, verification);
  }
  return failAttempt(member, verification, config);
}

async function passVerification(
  member: GuildMember,
  verification: Verification,
): Promise<{ outcome: 'pass' }> {
  await getStore().verifications.set({
    ...verification,
    status: 'passed',
  });
  const ok = await grantVerifiedRoles(member, 'verification passed');
  if (ok) {
    logger.info(
      { discord_id: member.id, tag: member.user.tag, type: verification.challenge_type },
      'verify: passed',
    );
    await getStore().users.set({
      discord_id: member.id,
      username: member.user.username,
      display_name: member.displayName,
      xp: 0,
      level: 0,
      cultivation_rank: 'pham_nhan',
      sub_title: null,
      joined_at: member.joinedTimestamp ?? Date.now(),
      verified_at: Date.now(),
      last_message_at: null,
      last_daily_at: null,
      daily_streak: 0,
      is_suspect: false,
      notes: null,
    });
    // Best-effort confirmation DM (silent fail).
    member
      .send('✅ Xác minh thành công! Chào mừng gia nhập Radiant Tech Sect.')
      .catch(() => undefined);
    await postBotLog(
      `✅ **${member.user.tag}** xác minh thành công (\`${verification.challenge_type}\`)`,
    );
  }
  return { outcome: 'pass' };
}

async function failAttempt(
  member: GuildMember,
  verification: Verification,
  config: VerificationConfig,
): Promise<{ outcome: 'fail-retry' | 'fail-kick'; attemptsLeft: number }> {
  const nextAttempts = verification.attempts + 1;
  const maxAttempts = config.thresholds.captchaMaxAttempts;

  if (nextAttempts >= maxAttempts) {
    await getStore().verifications.set({
      ...verification,
      attempts: nextAttempts,
      status: 'failed',
    });
    await kickWithReason(member, 'failed', { attempts: nextAttempts });
    return { outcome: 'fail-kick', attemptsLeft: 0 };
  }

  await getStore().verifications.set({
    ...verification,
    attempts: nextAttempts,
  });
  const attemptsLeft = maxAttempts - nextAttempts;
  logger.info(
    { discord_id: member.id, attempts: nextAttempts, left: attemptsLeft },
    'verify: wrong reply, retry remaining',
  );
  return { outcome: 'fail-retry', attemptsLeft };
}

/**
 * Fallback button click handler. Discord interactions have a 3s response
 * deadline, so this either:
 *   - showModal()    (for math challenge — instant)
 *   - reply(ephemeral, image + button)  (for image+math, then stage-2 button)
 */
export async function handleFallbackStartButton(
  interaction: ButtonInteraction,
  config: VerificationConfig,
): Promise<void> {
  const userId = interaction.user.id;
  let verification = getStore().verifications.get(userId);

  // No pending record (e.g., admin manually cleared, or never created) —
  // build one on the fly using a "clean" audit. Most fallback clicks
  // already have a record since startVerification creates it first.
  if (!verification || verification.status !== 'pending') {
    await interaction.reply({
      content: '⚠️ Không tìm thấy phiên xác minh nào đang chờ. Hãy thử rời server và vào lại.',
      ephemeral: true,
    });
    return;
  }

  // Regenerate the captcha so the user actually sees it (DM failed → they
  // never received it). Preserve challenge_type from the original audit
  // decision so a suspect member still gets image+math.
  const challenge = buildChallenge(
    {
      decision: verification.challenge_type === 'image+math' ? 'suspect' : 'clean',
      reasons: [],
      isSuspect: verification.challenge_type === 'image+math',
    },
    config,
    { forceHard: verification.challenge_type === 'image+math' },
  );
  verification = {
    ...verification,
    challenge_type: challenge.challenge_type,
    challenge_data: challenge.challenge_data,
  };
  await getStore().verifications.set(verification);

  if (challenge.challenge_type === 'math') {
    await interaction.showModal(buildAnswerModal('Nhập đáp án phép toán'));
    return;
  }

  // image+math → ephemeral with image + stage-2 button
  const stage2 = new ButtonBuilder()
    .setCustomId(BUTTON_ID_OPEN_MODAL)
    .setLabel('✍️ Nhập đáp án')
    .setStyle(ButtonStyle.Primary);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(stage2);
  await interaction.reply({
    content: challenge.dmContent,
    files: challenge.dmImageBuffer
      ? [{ attachment: challenge.dmImageBuffer, name: 'captcha.png' }]
      : [],
    components: [row],
    ephemeral: true,
  });
}

/**
 * Stage-2 button (image+math only): user clicks "Nhập đáp án" → modal.
 */
export async function handleFallbackOpenModalButton(interaction: ButtonInteraction): Promise<void> {
  const verification = getStore().verifications.get(interaction.user.id);
  if (!verification || verification.status !== 'pending') {
    await interaction.reply({
      content: '⚠️ Phiên xác minh không còn hợp lệ.',
      ephemeral: true,
    });
    return;
  }
  await interaction.showModal(buildAnswerModal('Nhập "<chữ trong ảnh> <đáp án>"'));
}

function buildAnswerModal(placeholder: string): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId(MODAL_INPUT_ID)
    .setLabel('Đáp án')
    .setPlaceholder(placeholder)
    .setRequired(true)
    .setMaxLength(64)
    .setStyle(TextInputStyle.Short);
  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
  return new ModalBuilder()
    .setCustomId(MODAL_ID)
    .setTitle('Xác minh — Radiant Tech Sect')
    .addComponents(row);
}

/**
 * Modal submit handler. Verifies the answer and replies ephemerally with
 * pass / retry / kick message.
 */
export async function handleFallbackModalSubmit(
  interaction: ModalSubmitInteraction,
  config: VerificationConfig,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: '⚠️ Modal phải dùng trong server.', ephemeral: true });
    return;
  }
  const reply = interaction.fields.getTextInputValue(MODAL_INPUT_ID);
  const result = await handleDmReply(interaction.guild, interaction.user.id, reply, config);

  switch (result.outcome) {
    case 'pass':
      await interaction.reply({
        content: '✅ Xác minh thành công! Chào mừng gia nhập Radiant Tech Sect.',
        ephemeral: true,
      });
      return;
    case 'fail-retry':
      await interaction.reply({
        content: `❌ Sai. Còn **${result.attemptsLeft ?? 0}** lần thử. Bấm nút "Bắt đầu xác minh" để thử lại.`,
        ephemeral: true,
      });
      return;
    case 'fail-kick':
      await interaction.reply({
        content: '❌ Sai quá số lần cho phép. Bạn sẽ bị kick — hãy thử vào lại server sau.',
        ephemeral: true,
      });
      return;
    case 'no-pending':
      await interaction.reply({
        content: '⚠️ Không tìm thấy phiên xác minh nào.',
        ephemeral: true,
      });
      return;
  }
}

/**
 * Sweep all pending verifications past timeout. Called by a cron job from
 * the scheduler (Chunk 7). Kicks the member and marks the record as
 * `timeout`.
 */
export async function cleanupExpiredVerifications(
  guild: Guild,
  config: VerificationConfig,
  now: number = Date.now(),
): Promise<{ expired: number; kicked: number }> {
  const timeoutMs = config.thresholds.captchaTimeoutMs;
  const stale = getStore().verifications.query(
    (v) => v.status === 'pending' && v.started_at + timeoutMs < now,
  );
  let kicked = 0;
  for (const v of stale) {
    await getStore().verifications.set({ ...v, status: 'timeout' });
    const member = await guild.members.fetch(v.discord_id).catch(() => null);
    if (member) {
      await kickWithReason(member, 'timeout', {
        elapsed_ms: now - v.started_at,
      });
      kicked++;
    }
  }
  if (stale.length > 0) {
    logger.info({ expired: stale.length, kicked }, 'verify: expired pending verifications swept');
  }
  return { expired: stale.length, kicked };
}
