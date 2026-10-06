import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Client,
  type EmbedBuilder,
  type GuildMember,
  type Message,
  type TextChannel,
} from 'discord.js';
import { ulid } from 'ulid';
import { ANNOUNCEMENT_CHANNELS, matchesChannelName } from '../../config/channels.js';
import { rankById, rankIndex } from '../../config/cultivation.js';
import { env } from '../../config/env.js';
import { judgeProblem } from '../../config/judge-problems.js';
import {
  TRIBULATION_COOLDOWN_MS,
  TRIBULATION_FAIL_PENALTY,
  TRIBULATION_MATH_TIMEOUT_MS,
  TRIBULATION_MIN_LEVEL,
  TRIBULATION_PASS_XP,
  TRIBULATION_REACTION_TIMEOUT_MS,
  TRIBULATION_TIERS,
  type TribulationTier,
} from '../../config/leveling.js';
import { DOCS_ORIGIN } from '../../config/phong-kiep.js';
import { DIVIDER, DIVIDER_DOUBLE, ICONS } from '../../config/ui.js';
import { getStore } from '../../db/index.js';
import type { CultivationRankId, SectEvent } from '../../db/types.js';
import { themedEmbed } from '../../utils/embed.js';
import { logger } from '../../utils/logger.js';
import { getLook } from '../avatar/service.js';
import { webSecret } from '../avatar/web.js';
import { withCard } from '../cards/attach.js';
import { renderTribulationIntro, renderTribulationOutcome } from '../cards/tribulation-cards.js';
import { runnerAvailable } from '../judge/runners.js';
import {
  TRIAL_SHAPE,
  createTrial,
  onTrialFinished,
  openTrialOf,
  pickProblems,
  trialToken,
} from '../judge/trial.js';
import { applyXpPenalty, awardXp } from '../leveling/tracker.js';
import type { Rendered } from '../pixel/output.js';
import { type MathPuzzle, generateMathPuzzle } from './games/math-puzzle.js';
import { type ReactionGame, generateReactionGame } from './games/reaction-speed.js';
import { runPhongKiep } from './phong-kiep.js';

/**
 * Tribulation event orchestrator — one "Thiên Kiếp" challenge.
 *
 * SPEC §8.5 game flavors:
 *   - 'math'     : multiple-choice arithmetic; difficulty by level; 30s
 *   - 'reaction' : 5 emoji buttons, click 🐉; 5s
 *
 * Rewards:
 *   - pass     : +500 XP via awardXp(source='tribulation_pass')
 *   - fail     : -100 XP via applyXpPenalty (floored at level threshold)
 *   - timeout  : same as fail
 *
 * Eligibility / cooldown is the CALLER's responsibility — this function
 * just runs the challenge once on the provided member. Use
 * `isTribulationOnCooldown()` and `pickEligibleMember()` before
 * calling.
 *
 * All side-effects best-effort: Discord post failures don't bubble out
 * but the event record is always persisted with `outcome` in metadata
 * so we can reconstruct what happened.
 */

// Re-export shorter aliases for inline use in this file. Values come
// from config/leveling.ts — edit there to retune.
const MATH_TIMEOUT_MS = TRIBULATION_MATH_TIMEOUT_MS;
const REACTION_TIMEOUT_MS = TRIBULATION_REACTION_TIMEOUT_MS;
const PASS_XP = TRIBULATION_PASS_XP;
const FAIL_XP_PENALTY = TRIBULATION_FAIL_PENALTY;
const SERVER_COOLDOWN_MS = TRIBULATION_COOLDOWN_MS;
const TRIBULATION_LEVEL_MIN = TRIBULATION_MIN_LEVEL;

export type TribulationGameType = 'math' | 'reaction' | 'quiz' | 'judge';

/** Which tribulation a realm faces (see TRIBULATION_TIERS). */
export function tierForRank(rank: CultivationRankId): TribulationTier {
  const i = rankIndex(rank);
  if (i >= rankIndex('do_kiep')) return 'cuu_thien';
  if (i >= rankIndex('luyen_hu')) return 'tam_ma';
  if (i >= rankIndex('nguyen_anh')) return 'phong';
  return 'loi';
}

/**
 * The tier actually run. Tâm Ma and Cửu Thiên need the web judge
 * (Thiên Kiếp Đài); until it is live they run Phong Kiếp's quiz but keep
 * their own rewards.
 */
export function playedGame(tier: TribulationTier): 'loi' | 'quiz' {
  return tier === 'loi' ? 'loi' : 'quiz';
}
/** 'pending': a Thiên Kiếp Đài trial was opened; the result arrives later via the trial hook. */
export type TribulationOutcome = 'pass' | 'fail' | 'timeout' | 'aborted' | 'pending';

export interface TribulationResult {
  outcome: TribulationOutcome;
  xpDelta: number;
  eventId: string;
  game: TribulationGameType;
}

export function isTribulationOnCooldown(now: number = Date.now()): boolean {
  const events = getStore().events.query((e) => e.type === 'tribulation');
  if (events.length === 0) return false;
  const last = events.reduce((a, b) => (b.started_at > a.started_at ? b : a));
  const ts = last.ended_at ?? last.started_at;
  return now - ts < SERVER_COOLDOWN_MS;
}

/**
 * Pick a random level-eligible user from the store. Returns null if
 * none qualify. Caller resolves the GuildMember separately + checks
 * presence/AFK status before running.
 */
export function pickEligibleUserId(): string | null {
  const eligible = getStore().users.query((u) => u.level >= TRIBULATION_LEVEL_MIN);
  if (eligible.length === 0) return null;
  return (eligible[Math.floor(Math.random() * eligible.length)] as { discord_id: string })
    .discord_id;
}

function findTribulationChannel(member: GuildMember): TextChannel | null {
  const ch = member.guild.channels.cache.find(
    (c) => matchesChannelName(c, ANNOUNCEMENT_CHANNELS.tribulation) && c.isTextBased(),
  );
  return (ch as TextChannel | undefined) ?? null;
}

function pickGameType(): TribulationGameType {
  return Math.random() < 0.5 ? 'math' : 'reaction';
}

function buildIntroEmbed(
  member: GuildMember,
  game: TribulationGameType,
  question: string,
  timeoutMs: number,
): EmbedBuilder {
  const seconds = Math.floor(timeoutMs / 1000);
  const description = [
    DIVIDER_DOUBLE,
    `${ICONS.tribulation} **THIÊN KIẾP GIÁNG LÂM** ${ICONS.tribulation}`,
    '',
    `${member} đối mặt với **Thiên Kiếp** — bài thử của đột phá cảnh giới.`,
    DIVIDER,
    game === 'math'
      ? `${ICONS.scroll} **Giải bài toán:**\n# ${question}`
      : '🐉 **Bấm nhanh vào Thiên Long (🐉)** trong đám yêu thú trước khi Kiếp Lôi đánh trúng!',
    DIVIDER_DOUBLE,
  ].join('\n');

  return themedEmbed('cultivation', {
    title: `${ICONS.cultivation} Thiên Kiếp ${ICONS.cultivation}`,
    description,
    footer: 'Thiên đạo bất tử — vượt qua là đột phá',
  })
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: '⏱️ Thời gian', value: `**${seconds}** giây`, inline: true },
      { name: '🏆 Pass', value: `**+${PASS_XP}** XP`, inline: true },
      { name: '💀 Fail', value: `**-${FAIL_XP_PENALTY}** XP (sàn)`, inline: true },
    );
}

function buildOutcomeEmbed(
  member: GuildMember,
  outcome: TribulationOutcome,
  xpDelta: number,
): EmbedBuilder {
  if (outcome === 'pass') {
    const description = [
      DIVIDER_DOUBLE,
      `${ICONS.sparkle} **${member} ĐÃ VƯỢT QUA THIÊN KIẾP** ${ICONS.sparkle}`,
      '',
      'Tu vi tiến một bước, cảnh giới rộng mở.',
      DIVIDER_DOUBLE,
    ].join('\n');
    return themedEmbed('success', {
      title: `${ICONS.crown} Đột phá thành công ${ICONS.crown}`,
      description,
      footer: 'Tiến lên đi đệ tử!',
    })
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .addFields({ name: '🎁 Phần thưởng', value: `**+${xpDelta} XP**`, inline: false });
  }

  const isTimeout = outcome === 'timeout';
  const title = isTimeout ? `${ICONS.timeout} Hết thời gian` : '💥 Thất bại';
  const flavor = isTimeout
    ? `${member} không phản ứng kịp Thiên Kiếp.`
    : `${member} không vượt qua được Thiên Kiếp.`;

  const description = [
    DIVIDER,
    flavor,
    '',
    '*Thiên đạo vô tình. Lần sau cố gắng hơn.*',
    DIVIDER,
  ].join('\n');

  return themedEmbed('danger', {
    title,
    description,
    footer: 'Sàn XP ở ngưỡng cảnh giới — không bị demotion',
  })
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .addFields({
      name: '💔 Phạt XP',
      value: `**${xpDelta} XP** (đã floored)`,
      inline: false,
    });
}

function outcomeCard(
  member: GuildMember,
  outcome: TribulationOutcome,
  xpDelta: number,
  tier: TribulationTier,
): Promise<Rendered | null> {
  if (outcome === 'aborted' || outcome === 'pending') return Promise.resolve(null);
  const t = TRIBULATION_TIERS[tier];
  return renderTribulationOutcome({
    name: member.displayName,
    look: getLook(member.id),
    tierName: t.name,
    outcome,
    xpDelta,
    pills: outcome === 'pass' ? t.passPills : 0,
  }).catch(() => null);
}

function buildButtonsForMath(eventId: string, puzzle: MathPuzzle): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (let i = 0; i < puzzle.options.length; i++) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`trib:${eventId}:${i}`)
        .setLabel(String(puzzle.options[i] ?? ''))
        .setStyle(ButtonStyle.Primary),
    );
  }
  return row;
}

function buildButtonsForReaction(
  eventId: string,
  game: ReactionGame,
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (let i = 0; i < game.options.length; i++) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`trib:${eventId}:${i}`)
        .setEmoji(String(game.options[i] ?? ''))
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return row;
}

async function persistEventStart(
  eventId: string,
  discordId: string,
  game: TribulationGameType,
  expected: string,
): Promise<SectEvent> {
  const event: SectEvent = {
    id: eventId,
    name: 'Thiên Kiếp',
    type: 'tribulation',
    started_at: Date.now(),
    ended_at: null,
    metadata: { discord_id: discordId, game, expected },
  };
  await getStore().events.set(event);
  return event;
}

async function persistEventEnd(
  event: SectEvent,
  outcome: TribulationOutcome,
  clicked: string | null,
  xpDelta: number,
): Promise<void> {
  await getStore().events.set({
    ...event,
    ended_at: Date.now(),
    metadata: { ...(event.metadata ?? {}), outcome, clicked, xp_delta: xpDelta },
  });
}

async function applyOutcomeRewards(
  member: GuildMember,
  outcome: TribulationOutcome,
  tier: TribulationTier,
): Promise<number> {
  const t = TRIBULATION_TIERS[tier];
  if (outcome === 'pass') {
    const result = await awardXp({
      discordId: member.id,
      username: member.user.username,
      displayName: member.displayName,
      amount: t.passXp,
      source: 'tribulation_pass',
      metadata: { event: 'tribulation', tier },
    });
    // Phase 12 — pass also grants +5 pills (Đan dược độ kiếp).
    const store = (await import('../../db/index.js')).getStore();
    const user = store.users.get(member.id);
    if (user) {
      await store.users.set({ ...user, pills: (user.pills ?? 0) + t.passPills });
    }
    // Phase 14 quest — tribulation_pass.
    {
      const { incrementProgress } = await import('../quests/daily-quest.js');
      void incrementProgress(member.id, 'tribulation_pass', 1);
    }
    // Phase 14 — title award eligibility check (tribulation_passes counter
    // is derived from xp_logs source='tribulation_pass' which we just
    // appended via awardXp).
    {
      const { awardEligibleTitles } = await import('../titles/index.js');
      void awardEligibleTitles(member.id);
    }
    return result.newXp - (result.newXp - t.passXp); // i.e., the tier's pass XP
  }
  // fail OR timeout → penalty (floored)
  const penalty = await applyXpPenalty(member.id, t.failXp);
  return -penalty.applied;
}

/**
 * Run one tribulation event. Returns the outcome + actual XP delta
 * applied. Posts intro embed + collects button → posts outcome embed.
 */
export async function runTribulation(
  member: GuildMember,
  opts: {
    game?: TribulationGameType;
    /** Hands the private Thiên Kiếp Đài link to the member; false = fall back to a DM. */
    deliverLink?: (url: string) => Promise<boolean>;
  } = {},
): Promise<TribulationResult> {
  const channel = findTribulationChannel(member);
  if (!channel) {
    logger.error(
      { guild: member.guild.id, expected: ANNOUNCEMENT_CHANNELS.tribulation },
      'tribulation: channel missing',
    );
    return { outcome: 'aborted', xpDelta: 0, eventId: '', game: 'math' };
  }

  const eventId = ulid();
  const user = getStore().users.get(member.id);
  const level = user?.level ?? 10;
  const tier = opts.game ? 'loi' : tierForRank(user?.cultivation_rank ?? 'pham_nhan');
  const game = opts.game ?? (playedGame(tier) === 'quiz' ? 'quiz' : pickGameType());

  if (
    !opts.game &&
    (tier === 'tam_ma' || tier === 'cuu_thien') &&
    runnerAvailable() &&
    env.PUBLIC_BASE_URL &&
    webSecret()
  ) {
    return startJudgeTrial(member, channel, tier, opts.deliverLink);
  }

  if (game === 'quiz') {
    const quizTier = tier === 'loi' ? 'phong' : tier;
    const event = await persistEventStart(eventId, member.id, 'quiz', 'quiz');
    const run = await runPhongKiep(member, channel, eventId, TRIBULATION_TIERS[quizTier].name);
    const xpDelta = await applyOutcomeRewards(member, run.outcome, quizTier);
    await persistEventEnd(
      event,
      run.outcome,
      run.asked.map((a) => `${a.id}:${a.chosen ?? '-'}`).join(','),
      xpDelta,
    );
    try {
      await channel.send(
        withCard(
          buildOutcomeEmbed(member, run.outcome, xpDelta),
          await outcomeCard(member, run.outcome, xpDelta, quizTier),
        ),
      );
    } catch (err) {
      logger.warn({ err }, 'tribulation: quiz outcome post failed');
    }
    return { outcome: run.outcome, xpDelta, eventId, game };
  }

  let question: string;
  let row: ActionRowBuilder<ButtonBuilder>;
  let expected: string;
  let timeoutMs: number;

  if (game === 'math') {
    const puzzle = generateMathPuzzle(level);
    question = puzzle.question;
    expected = puzzle.expected;
    row = buildButtonsForMath(eventId, puzzle);
    timeoutMs = MATH_TIMEOUT_MS;
  } else {
    const r = generateReactionGame();
    question = '';
    expected = r.target;
    row = buildButtonsForReaction(eventId, r);
    timeoutMs = REACTION_TIMEOUT_MS;
  }

  const event = await persistEventStart(eventId, member.id, game, expected);

  let sent: Message;
  try {
    const introCard = await renderTribulationIntro({
      name: member.displayName,
      look: getLook(member.id),
      rankName: rankById(user?.cultivation_rank ?? 'pham_nhan').name,
      question: game === 'math' ? question : null,
      seconds: Math.floor(timeoutMs / 1000),
      passXp: PASS_XP,
      failXp: FAIL_XP_PENALTY,
    }).catch(() => null);
    sent = await channel.send({
      content: `${member}`,
      ...withCard(buildIntroEmbed(member, game, question, timeoutMs), introCard),
      components: [row],
      allowedMentions: { users: [member.id] },
    });
  } catch (err) {
    logger.error({ err, discord_id: member.id }, 'tribulation: intro post failed');
    await persistEventEnd(event, 'aborted', null, 0);
    return { outcome: 'aborted', xpDelta: 0, eventId, game };
  }

  return await new Promise<TribulationResult>((resolve) => {
    const collector = sent.createMessageComponentCollector({
      filter: (i) => i.user.id === member.id,
      time: timeoutMs,
      max: 1,
    });

    collector.on('collect', async (i) => {
      const parts = i.customId.split(':');
      const idx = Number.parseInt(parts[2] ?? '-1', 10);
      // The label/emoji at idx is the "answer" for that button.
      // Pull it from the underlying game state via the row.
      const button = row.components[idx]?.data as
        | { label?: string; emoji?: { name?: string } }
        | undefined;
      const clicked = button?.label ?? button?.emoji?.name ?? '';
      const passed = clicked === expected;
      const outcome: TribulationOutcome = passed ? 'pass' : 'fail';
      const xpDelta = await applyOutcomeRewards(member, outcome, 'loi');
      await persistEventEnd(event, outcome, clicked, xpDelta);
      try {
        await i.deferUpdate();
        await sent.edit({ components: [] });
        await channel.send(
          withCard(buildOutcomeEmbed(member, outcome, xpDelta), await outcomeCard(member, outcome, xpDelta, 'loi')),
        );
      } catch (err) {
        logger.warn({ err }, 'tribulation: outcome post failed');
      }
      resolve({ outcome, xpDelta, eventId, game });
    });

    collector.on('end', async (collected) => {
      if (collected.size > 0) return; // already resolved by 'collect'
      const outcome: TribulationOutcome = 'timeout';
      const xpDelta = await applyOutcomeRewards(member, outcome, 'loi');
      await persistEventEnd(event, outcome, null, xpDelta);
      try {
        await sent.edit({ components: [] });
        await channel.send(
          withCard(buildOutcomeEmbed(member, outcome, xpDelta), await outcomeCard(member, outcome, xpDelta, 'loi')),
        );
      } catch (err) {
        logger.warn({ err }, 'tribulation: timeout post failed');
      }
      resolve({ outcome, xpDelta, eventId, game });
    });
  });
}

// Exposed constants for tests + slash command messaging.
export const TRIBULATION_CONSTANTS = {
  PASS_XP,
  FAIL_XP_PENALTY,
  SERVER_COOLDOWN_MS,
  TRIBULATION_LEVEL_MIN,
  MATH_TIMEOUT_MS,
  REACTION_TIMEOUT_MS,
} as const;

// ---------------------------------------------------------------- Thiên Kiếp Đài

export function judgeLinkRow(url: string, label: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url),
  );
}

/**
 * Tâm Ma / Cửu Thiên: open a web trial, announce it, hand the member their
 * private link. The outcome is applied by the trial hook (wireJudgeTribulations).
 */
async function startJudgeTrial(
  member: GuildMember,
  channel: TextChannel,
  tier: 'tam_ma' | 'cuu_thien',
  deliver?: (url: string) => Promise<boolean>,
): Promise<TribulationResult> {
  const t = TRIBULATION_TIERS[tier];
  const shape = TRIAL_SHAPE[tier];
  const trial = await createTrial({
    discordId: member.id,
    mode: 'tribulation',
    tier,
    problems: pickProblems(tier),
    durationMs: shape.durationMs,
  });
  const url = `${env.PUBLIC_BASE_URL}/judge?t=${encodeURIComponent(trialToken(trial, webSecret()))}`;
  const titles = trial.meta.problems.map((slug) => judgeProblem(slug)?.title ?? slug);
  const minutes = Math.round(shape.durationMs / 60_000);
  const user = getStore().users.get(member.id);
  const card = await renderTribulationIntro({
    name: member.displayName,
    look: getLook(member.id),
    rankName: rankById(user?.cultivation_rank ?? 'pham_nhan').name,
    tierName: t.name,
    question: null,
    box: { title: `Thiên Kiếp Đài · ${titles.length} bài giải thuật`, lines: titles },
    seconds: 0,
    timeText: `${minutes} phút trên web · giờ chạy khi mở trang`,
    passXp: t.passXp,
    passPills: t.passPills,
    failXp: t.failXp,
  }).catch(() => null);
  const embed = themedEmbed('cultivation', {
    title: `${ICONS.tribulation} ${t.name}`,
    description: [
      `${member} bước lên **Thiên Kiếp Đài**: giải ${titles.length} bài giải thuật trong ${minutes} phút.`,
      'Link riêng đã được gửi cho đạo hữu, giờ chỉ bắt đầu chạy khi mở trang.',
    ].join('\n'),
    footer: 'Code bằng Python, JavaScript hoặc C# · Tàng Kinh Các mở sẵn bài nền tảng',
  });
  try {
    await channel.send({
      content: `${member}`,
      ...withCard(embed, card),
      allowedMentions: { users: [member.id] },
    });
  } catch (err) {
    logger.warn({ err }, 'tribulation: judge announce failed');
  }
  let delivered = false;
  if (deliver) delivered = await deliver(url).catch(() => false);
  if (!delivered) {
    delivered = await member
      .send({
        content: `⚡ **${t.name}**: link Thiên Kiếp Đài của bạn (chỉ mình bạn dùng, mở trong 24 giờ, mở ra là bắt đầu tính ${minutes} phút).`,
        components: [judgeLinkRow(url, 'Vào Thiên Kiếp Đài')],
      })
      .then(() => true)
      .catch(() => false);
  }
  if (!delivered) {
    logger.warn({ discord_id: member.id }, 'tribulation: judge link could not be delivered');
    await channel
      .send({
        content: `${member} chưa nhận được link riêng (DM đang tắt). Gõ \`/breakthrough\` lần nữa để lấy lại link.`,
        allowedMentions: { users: [member.id] },
      })
      .catch(() => undefined);
  }
  return { outcome: 'pending', xpDelta: 0, eventId: trial.id, game: 'judge' };
}

/** The member's open Thiên Kiếp Đài link, to hand out again. */
export function judgeLinkFor(discordId: string): { url: string; tierName: string } | null {
  const trial = openTrialOf(discordId, 'tribulation');
  if (!trial || !env.PUBLIC_BASE_URL || !webSecret()) return null;
  return {
    url: `${env.PUBLIC_BASE_URL}/judge?t=${encodeURIComponent(trialToken(trial, webSecret()))}`,
    tierName: trial.meta.tier ? TRIBULATION_TIERS[trial.meta.tier].name : 'Thiên Kiếp',
  };
}

/** Applies a finished Thiên Kiếp Đài trial: rewards, record, public result. */
export function wireJudgeTribulations(client: Client): void {
  onTrialFinished(async (trial) => {
    if (trial.meta.mode !== 'tribulation' || !trial.meta.tier) return;
    const tier = trial.meta.tier;
    const guild = client.guilds.cache.get(env.DISCORD_GUILD_ID);
    const member = await guild?.members.fetch(trial.meta.discord_id).catch(() => null);
    if (!member) {
      logger.warn({ trial: trial.id }, 'tribulation: judge member gone, no rewards');
      return;
    }
    const outcome: TribulationOutcome =
      trial.meta.status === 'passed' ? 'pass' : trial.meta.status === 'expired' ? 'timeout' : 'fail';
    const xpDelta = await applyOutcomeRewards(member, outcome, tier);
    const store = getStore();
    const e = store.events.get(trial.id);
    if (e)
      await store.events.set({
        ...e,
        metadata: { ...(e.metadata ?? {}), outcome, xp_delta: xpDelta },
      });
    const channel = findTribulationChannel(member);
    if (!channel) return;
    const lessons = trial.meta.problems
      .map((slug) => judgeProblem(slug))
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .slice(0, 5);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      lessons.map((p) =>
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel(`Lời giải: ${p.title}`.slice(0, 80))
          .setURL(`${DOCS_ORIGIN}${p.docs}`),
      ),
    );
    try {
      await channel.send({
        ...withCard(
          buildOutcomeEmbed(member, outcome, xpDelta),
          await outcomeCard(member, outcome, xpDelta, tier),
        ),
        components: lessons.length ? [row] : [],
      });
    } catch (err) {
      logger.warn({ err }, 'tribulation: judge outcome post failed');
    }
  });
}
