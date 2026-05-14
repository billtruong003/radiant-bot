import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type EmbedBuilder,
  type GuildMember,
  type Message,
  type TextChannel,
} from 'discord.js';
import { ulid } from 'ulid';
import { ANNOUNCEMENT_CHANNELS, matchesChannelName } from '../../config/channels.js';
import {
  TRIBULATION_COOLDOWN_MS,
  TRIBULATION_FAIL_PENALTY,
  TRIBULATION_MATH_TIMEOUT_MS,
  TRIBULATION_MIN_LEVEL,
  TRIBULATION_PASS_XP,
  TRIBULATION_REACTION_TIMEOUT_MS,
} from '../../config/leveling.js';
import { DIVIDER, DIVIDER_DOUBLE, ICONS } from '../../config/ui.js';
import { getStore } from '../../db/index.js';
import type { SectEvent } from '../../db/types.js';
import { themedEmbed } from '../../utils/embed.js';
import { logger } from '../../utils/logger.js';
import { applyXpPenalty, awardXp } from '../leveling/tracker.js';
import { type MathPuzzle, generateMathPuzzle } from './games/math-puzzle.js';
import { type ReactionGame, generateReactionGame } from './games/reaction-speed.js';

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

export type TribulationGameType = 'math' | 'reaction';
export type TribulationOutcome = 'pass' | 'fail' | 'timeout' | 'aborted';

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
): Promise<number> {
  if (outcome === 'pass') {
    const result = await awardXp({
      discordId: member.id,
      username: member.user.username,
      displayName: member.displayName,
      amount: PASS_XP,
      source: 'tribulation_pass',
      metadata: { event: 'tribulation' },
    });
    // Phase 12 — pass also grants +5 pills (Đan dược độ kiếp).
    const store = (await import('../../db/index.js')).getStore();
    const user = store.users.get(member.id);
    if (user) {
      await store.users.set({ ...user, pills: (user.pills ?? 0) + 5 });
    }
    return result.newXp - (result.newXp - PASS_XP); // i.e., PASS_XP
  }
  // fail OR timeout → penalty (floored)
  const penalty = await applyXpPenalty(member.id, FAIL_XP_PENALTY);
  return -penalty.applied;
}

/**
 * Run one tribulation event. Returns the outcome + actual XP delta
 * applied. Posts intro embed + collects button → posts outcome embed.
 */
export async function runTribulation(
  member: GuildMember,
  opts: { game?: TribulationGameType } = {},
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
  const game = opts.game ?? pickGameType();
  const user = getStore().users.get(member.id);
  const level = user?.level ?? 10;

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
    sent = await channel.send({
      content: `${member}`,
      embeds: [buildIntroEmbed(member, game, question, timeoutMs)],
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
      const xpDelta = await applyOutcomeRewards(member, outcome);
      await persistEventEnd(event, outcome, clicked, xpDelta);
      try {
        await i.deferUpdate();
        await sent.edit({ components: [] });
        await channel.send({ embeds: [buildOutcomeEmbed(member, outcome, xpDelta)] });
      } catch (err) {
        logger.warn({ err }, 'tribulation: outcome post failed');
      }
      resolve({ outcome, xpDelta, eventId, game });
    });

    collector.on('end', async (collected) => {
      if (collected.size > 0) return; // already resolved by 'collect'
      const outcome: TribulationOutcome = 'timeout';
      const xpDelta = await applyOutcomeRewards(member, outcome);
      await persistEventEnd(event, outcome, null, xpDelta);
      try {
        await sent.edit({ components: [] });
        await channel.send({ embeds: [buildOutcomeEmbed(member, outcome, xpDelta)] });
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
