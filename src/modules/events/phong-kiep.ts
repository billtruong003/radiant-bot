import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type GuildMember,
  type Message,
  type TextChannel,
} from 'discord.js';
import {
  PHONG_KIEP_QUESTIONS,
  PHONG_KIEP_TIMEOUT_MS,
  PHONG_KIEP_TO_PASS,
} from '../../config/leveling.js';
import {
  DOCS_ORIGIN,
  type PhongKiepQuestion,
  loadPhongKiepQuestions,
} from '../../config/phong-kiep.js';
import { logger } from '../../utils/logger.js';
import { LETTERS, renderQuizCard } from '../cards/quiz-card.js';

/**
 * Phong Kiếp — the second tribulation tier. Three questions in a row
 * (developer English or "what does this code print"), 45 s each, two
 * right answers pass. The run stops as soon as the result is settled.
 * After each answer the card shows the right option and a button to the
 * docs lesson that teaches it.
 */

export interface AskedQuestion {
  question: PhongKiepQuestion;
  /** Options in the order shown, and where the right one ended up. */
  options: string[];
  correct: number;
}

export interface PhongKiepRun {
  outcome: 'pass' | 'fail' | 'timeout';
  correct: number;
  asked: { id: string; chosen: number | null; right: boolean }[];
}

function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

/** One English question and the rest code output, each in a different language when possible. */
export function pickQuestions(
  n: number = PHONG_KIEP_QUESTIONS,
  rand: () => number = Math.random,
  bank: PhongKiepQuestion[] = loadPhongKiepQuestions(),
): AskedQuestion[] {
  const english = shuffle(
    bank.filter((q) => q.kind === 'english'),
    rand,
  );
  const output = shuffle(
    bank.filter((q) => q.kind === 'output'),
    rand,
  );
  const picked: PhongKiepQuestion[] = english.slice(0, 1);
  const langs = new Set<string>();
  for (const q of output) {
    if (picked.length >= n) break;
    if (q.lang && langs.has(q.lang) && langs.size < 3) continue;
    picked.push(q);
    if (q.lang) langs.add(q.lang);
  }
  for (const q of [...output, ...english]) {
    if (picked.length >= n) break;
    if (!picked.includes(q)) picked.push(q);
  }
  return shuffle(picked, rand).map((question) => {
    const order = shuffle([0, 1, 2, 3], rand);
    return {
      question,
      options: order.map((i) => question.options[i] ?? ''),
      correct: order.indexOf(question.answer),
    };
  });
}

/** Pass, fail or (nothing answered at all) timeout. */
export function judge(answers: (number | null)[], asked: AskedQuestion[]): PhongKiepRun['outcome'] {
  const right = answers.filter((a, i) => a !== null && a === asked[i]?.correct).length;
  if (right >= PHONG_KIEP_TO_PASS) return 'pass';
  if (answers.every((a) => a === null)) return 'timeout';
  return 'fail';
}

function answerRow(eventId: string, qi: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    LETTERS.map((l, i) =>
      new ButtonBuilder()
        .setCustomId(`pk:${eventId}:${qi}:${i}`)
        .setLabel(l)
        .setStyle(ButtonStyle.Primary),
    ),
  );
}

function docsRow(q: PhongKiepQuestion): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Đọc bài ở Tàng Kinh Các')
      .setURL(`${DOCS_ORIGIN}${q.docs}`),
  );
}

export async function runPhongKiep(
  member: GuildMember,
  channel: TextChannel,
  eventId: string,
  tierName: string,
  asked: AskedQuestion[] = pickQuestions(),
): Promise<PhongKiepRun> {
  const answers: (number | null)[] = [];
  const seconds = Math.round(PHONG_KIEP_TIMEOUT_MS / 1000);
  for (const [qi, a] of asked.entries()) {
    const right = answers.filter((x, i) => x !== null && x === asked[i]?.correct).length;
    const wrong = answers.length - right;
    // Stop once the result can no longer change.
    if (right >= PHONG_KIEP_TO_PASS || wrong > asked.length - PHONG_KIEP_TO_PASS) break;
    const view = {
      tierName,
      name: member.displayName,
      index: qi + 1,
      total: asked.length,
      correctSoFar: right,
      seconds,
      prompt: a.question.prompt,
      code: a.question.code,
      lang: a.question.lang,
      options: a.options,
    };
    const card = await renderQuizCard(view);
    let sent: Message;
    try {
      sent = await channel.send({
        content:
          qi === 0
            ? `🌪️ ${member} — **${tierName}** giáng lâm. Trả lời đúng ${PHONG_KIEP_TO_PASS}/${asked.length} câu để vượt kiếp.`
            : `${member}`,
        files: [new AttachmentBuilder(card.buffer, { name: card.name })],
        components: [answerRow(eventId, qi)],
        allowedMentions: { users: [member.id] },
      });
    } catch (err) {
      logger.warn({ err, discord_id: member.id }, 'phong-kiep: question post failed');
      answers.push(null);
      continue;
    }
    let chosen: number | null = null;
    try {
      const click = await sent.awaitMessageComponent({
        filter: (i) => i.user.id === member.id && i.customId.startsWith(`pk:${eventId}:${qi}:`),
        componentType: ComponentType.Button,
        time: PHONG_KIEP_TIMEOUT_MS,
      });
      chosen = Number.parseInt(click.customId.split(':')[3] ?? '-1', 10);
      if (!(chosen >= 0 && chosen < 4)) chosen = null;
      await click.deferUpdate().catch(() => undefined);
    } catch {
      chosen = null; // time ran out
    }
    answers.push(chosen);
    try {
      const reveal = await renderQuizCard({
        ...view,
        correctSoFar: right + (chosen === a.correct ? 1 : 0),
        reveal: { chosen, correct: a.correct, explain: a.question.explain },
      });
      await sent.edit({
        files: [new AttachmentBuilder(reveal.buffer, { name: reveal.name })],
        attachments: [],
        components: [docsRow(a.question)],
      });
    } catch (err) {
      logger.warn({ err }, 'phong-kiep: reveal edit failed');
    }
  }
  const shown = asked.slice(0, answers.length);
  return {
    outcome: judge(answers, shown),
    correct: answers.filter((x, i) => x !== null && x === shown[i]?.correct).length,
    asked: shown.map((a, i) => ({
      id: a.question.id,
      chosen: answers[i] ?? null,
      right: answers[i] === a.correct,
    })),
  };
}
