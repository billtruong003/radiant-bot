import {
  ActionRowBuilder,
  type AnyThreadChannel,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  ChannelType,
  type Guild,
  type GuildMember,
  ModalBuilder,
  type ModalSubmitInteraction,
  type Role,
  type TextChannel,
  TextInputBuilder,
  TextInputStyle,
  ThreadAutoArchiveDuration,
} from 'discord.js';
import { ulid } from 'ulid';
import { ANNOUNCEMENT_CHANNELS, matchesChannelName } from '../../config/channels.js';
import { ROLE_PHAM_NHAN, ROLE_UNVERIFIED } from '../../config/roles.js';
import type { VerificationConfig } from '../../config/verification.js';
import { getStore } from '../../db/index.js';
import type { Verification } from '../../db/types.js';
import { logger } from '../../utils/logger.js';
import { postBotLog } from '../bot-log.js';
import { postWelcome } from '../welcome/index.js';
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

/** Re-exported from `config/roles.ts` for callers that already import from flow. */
export const PHAM_NHAN_ROLE_NAME = ROLE_PHAM_NHAN;
export const UNVERIFIED_ROLE_NAME = ROLE_UNVERIFIED;

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
      '╔═══════════════════════════════════╗',
      '   🏯 **RADIANT TECH SECT**',
      '   *Cổng tu hành — Xác minh nâng cao*',
      '╚═══════════════════════════════════╝',
      '',
      'Aki nhận thấy tài khoản đạo hữu cần **xác minh kỹ hơn một chút** (¬_¬)',
      'Đừng lo, vượt qua là vào liền~',
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━',
      '📜 **Bài thử (2 phần):**',
      '🖼️ Nhìn ảnh → đọc chuỗi chữ',
      `🧮 Cộng: \`${math.a} + ${math.b} = ?\``,
      '━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '**Format reply:** `<chữ trong ảnh> <tổng>`',
      `**Ví dụ:** \`ABC2XY ${math.a + math.b}\``,
      '',
      `⏱️ Thời gian: **${Math.floor(config.thresholds.captchaTimeoutMs / 60_000)} phút** · Tối đa **${config.thresholds.captchaMaxAttempts}** lần thử`,
      '*(◕‿◕) Aki kiên nhẫn đợi đạo hữu~*',
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
    (c) => matchesChannelName(c, ANNOUNCEMENT_CHANNELS.verification) && c.isTextBased(),
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
  // B6 — record rejoin cooldown for failure-driven kicks. `audit` /
  // `accountAgeShort` are policy kicks (not the user's fault) so we
  // don't penalise rejoin; only 'failed' (captcha exhaustion) and
  // 'timeout' (gave up the flow) gate retries.
  if (reason === 'failed' || reason === 'timeout') {
    const { recordFailedVerifyKick } = await import('./rejoin-cooldown.js');
    recordFailedVerifyKick(member.id);
  }
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

  // Surface audit reasons so a kick is self-explanatory in #bot-log
  // instead of just "lý do: audit". reasons is an array of short
  // strings like ["account age 0.13d < kick threshold 1d"].
  const auditReasons = Array.isArray((context as { audit_reasons?: unknown }).audit_reasons)
    ? (context as { audit_reasons: unknown[] }).audit_reasons.filter(
        (r): r is string => typeof r === 'string',
      )
    : [];
  const detail =
    auditReasons.length > 0 ? ` — ${auditReasons.map((r) => `\`${r}\``).join(' · ')}` : '';
  await postBotLog(
    `❌ Kick **${member.user.tag}** (\`${member.id}\`) — lý do: \`${reason}\`${detail}`,
  );
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

/**
 * Sanitise a username into a Discord-thread-safe name fragment.
 * Strips non-alphanumeric, lower-cases, truncates so the full thread
 * name stays under Discord's 100-char limit.
 */
function threadNameFor(member: GuildMember): string {
  const slug = (member.user.username || member.user.tag || member.id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return `verify-${slug || member.id.slice(-6)}`;
}

/**
 * Phase 11 A2: DM blocked → open a per-user thread inside #verify and
 * post the start button there. Replaces the previous "public button
 * in #verify channel" pattern so multiple pending users no longer see
 * each other's verification UI.
 *
 * Thread auto-archives after 24h; the cleanup cron (B1) sweeps stale
 * threads. The thread id is persisted on the Verification record so
 * pass/fail/timeout can delete it.
 */
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
  const introContent = [
    `${member} ✨ chào tân đạo hữu!`,
    '',
    'Aki gửi DM nhưng đạo hữu đang **chặn tin nhắn riêng** — không sao.',
    'Bấm nút dưới để xác minh ngay trong thread riêng này nhé. *(◕‿◕)*',
    '',
    '_Thread này chỉ đạo hữu + staff thấy. Hoàn thành xong thread sẽ tự đóng._',
  ].join('\n');

  let thread: AnyThreadChannel | null = null;
  try {
    thread = await channel.threads.create({
      name: threadNameFor(member),
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
      type: ChannelType.PublicThread,
      reason: 'verify: DM-blocked fallback thread',
    });
  } catch (err) {
    logger.warn(
      { err, discord_id: member.id },
      'verify: thread create failed, falling back to channel post',
    );
  }

  // Persist thread id (or null) on the Verification record so cleanup
  // + pass-path delete know where to look.
  const existing = getStore().verifications.get(member.id);
  if (existing) {
    await getStore().verifications.set({
      ...existing,
      fallback_thread_id: thread?.id ?? null,
    });
  }

  try {
    if (thread) {
      await thread.send({
        content: introContent,
        components: [row],
        allowedMentions: { users: [member.id] },
      });
      logger.info(
        { discord_id: member.id, thread_id: thread.id, audit: auditDecision },
        'verify: fallback thread created + button posted',
      );
      return;
    }
    // Thread create failed → legacy channel post path. Still safer
    // than dropping the verification for users whose DM is blocked.
    await channel.send({
      content: introContent,
      components: [row],
      allowedMentions: { users: [member.id] },
    });
    logger.info(
      { discord_id: member.id, audit: auditDecision },
      'verify: fallback button posted in channel (thread create failed)',
    );
  } catch (err) {
    logger.error({ err, discord_id: member.id }, 'verify: failed to post fallback button');
  }
}

/**
 * Best-effort delete the per-user verify thread (if any). Called from
 * pass / fail-kick / timeout paths. Idempotent — silent skip when the
 * verification record has no thread id, or the thread is already gone.
 */
async function deleteFallbackThread(
  guild: Guild,
  verification: Verification,
  reason: string,
): Promise<void> {
  const threadId = verification.fallback_thread_id;
  if (!threadId) return;
  try {
    const thread = await guild.channels.fetch(threadId);
    if (thread?.isThread()) {
      await thread.delete(reason);
      logger.info(
        { discord_id: verification.discord_id, thread_id: threadId, reason },
        'verify: fallback thread deleted',
      );
    }
  } catch (err) {
    logger.warn(
      { err, discord_id: verification.discord_id, thread_id: threadId },
      'verify: fallback thread delete failed (may already be gone)',
    );
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
  // A2 cleanup: drop the fallback thread if one was opened.
  void deleteFallbackThread(member.guild, verification, 'verify passed');
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
    await postBotLog(
      `✅ **${member.user.tag}** xác minh thành công (\`${verification.challenge_type}\`)`,
    );
    // Welcome post + quick-start DM. Best-effort — doesn't throw out of pass.
    postWelcome(member).catch((err) =>
      logger.warn({ err, discord_id: member.id }, 'verify: welcome post failed'),
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
    void deleteFallbackThread(member.guild, verification, 'verify failed (max attempts)');
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

/** Exposed for tests + smoke-test. */
export const __for_testing = {
  threadNameFor,
};

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
    void deleteFallbackThread(guild, v, 'verify timeout');
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

/**
 * Phase 11 B1: sweep archived "verify-*" threads in #verify older than
 * `staleMs`. These accumulate when verifications complete (pass / fail /
 * timeout) but the thread delete races / fails. Called from the same
 * scheduler cron as `cleanupExpiredVerifications`.
 *
 * Safe: only targets threads whose name starts with the "verify-" prefix
 * set by `threadNameFor`. Active threads (recent activity) are skipped.
 */
export async function cleanupStaleVerifyThreads(
  guild: Guild,
  staleMs: number = 24 * 60 * 60 * 1000,
  now: number = Date.now(),
): Promise<{ swept: number }> {
  const channel = guild.channels.cache.find(
    (c) => matchesChannelName(c, ANNOUNCEMENT_CHANNELS.verification) && c.isTextBased(),
  ) as TextChannel | undefined;
  if (!channel) return { swept: 0 };

  let swept = 0;
  const active = await channel.threads.fetchActive().catch(() => null);
  const archived = await channel.threads.fetchArchived({ limit: 100 }).catch(() => null);

  const candidates = [...(active?.threads.values() ?? []), ...(archived?.threads.values() ?? [])];

  for (const thread of candidates) {
    if (!thread.name.startsWith('verify-')) continue;
    const lastActivity = thread.archiveTimestamp ?? thread.createdTimestamp ?? 0;
    if (now - lastActivity < staleMs) continue;
    try {
      await thread.delete('verify thread cleanup (stale > 24h)');
      swept++;
    } catch (err) {
      logger.warn(
        { err, thread_id: thread.id, name: thread.name },
        'verify-thread-cleanup: delete failed',
      );
    }
  }
  if (swept > 0) {
    logger.info({ swept }, 'verify-thread-cleanup: stale threads swept');
  }
  return { swept };
}
