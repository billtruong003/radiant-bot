import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  ComponentType,
} from 'discord.js';
import { env } from '../../config/env.js';
import { DOCS_ORIGIN } from '../../config/phong-kiep.js';
import { getStore } from '../../db/index.js';
import type { DailyQuest } from '../../db/types.js';
import { logger } from '../../utils/logger.js';
import { webSecret } from '../avatar/web.js';
import { LETTERS, renderQuizCard } from '../cards/quiz-card.js';
import { pickQuestions } from '../events/phong-kiep.js';
import { runnerAvailable } from '../judge/runners.js';
import {
  TRIAL_SHAPE,
  type TrialMeta,
  createTrial,
  onTrialFinished,
  openTrialOf,
  pickProblems,
  trialToken,
} from '../judge/trial.js';
import { getTodayQuests, incrementProgress, vnDayStart } from './daily-quest.js';

/**
 * Buttons under /quest for the study row: "Vào Tàng Kinh Các" opens a
 * practice problem on the web (counts for study_solve when solved), "Ôn
 * bài" runs a 3-question docs quiz right here (each right answer counts
 * for study_read).
 */

export const QUEST_PRACTICE_ID = 'quest:practice';
export const QUEST_STUDY_ID = 'quest:study';
/** Practice trials a member may open per day (each submit spends a runner credit). */
export const PRACTICE_PER_DAY = 2;
/** Docs quiz rounds per day. */
export const STUDY_ROUNDS_PER_DAY = 3;
const QUIZ_TIMEOUT_MS = 60_000;

const studyRounds = new Map<string, { day: number; n: number }>();

/** Buttons for the open study quest, if any. */
export function questButtons(quests: DailyQuest[]): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const q of quests) {
    if (q.completed_at !== null) continue;
    if (q.quest_type === 'study_solve')
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(QUEST_PRACTICE_ID)
          .setLabel('Vào Tàng Kinh Các (web)')
          .setStyle(ButtonStyle.Primary),
      );
    if (q.quest_type === 'study_read')
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(QUEST_STUDY_ID)
          .setLabel('Ôn bài')
          .setStyle(ButtonStyle.Primary),
      );
  }
  return row.components.length ? [row] : [];
}

function practiceToday(discordId: string, now: number): number {
  const start = vnDayStart(now);
  return getStore().events.query((e) => {
    const m = e.metadata as TrialMeta | null;
    return (
      m?.kind === 'judge' &&
      m.mode === 'practice' &&
      m.discord_id === discordId &&
      e.started_at >= start
    );
  }).length;
}

async function handlePractice(interaction: ButtonInteraction): Promise<void> {
  const id = interaction.user.id;
  if (!runnerAvailable() || !env.PUBLIC_BASE_URL || !webSecret()) {
    await interaction.reply({
      content: '🌫️ Máy chấm Tàng Kinh Các đang nghỉ. Thử lại sau nhé.',
      ephemeral: true,
    });
    return;
  }
  let trial = openTrialOf(id, 'practice');
  if (!trial) {
    if (practiceToday(id, Date.now()) >= PRACTICE_PER_DAY) {
      await interaction.reply({
        content: `📚 Hôm nay bạn đã mở ${PRACTICE_PER_DAY} bài luyện rồi. Mai quay lại nhé.`,
        ephemeral: true,
      });
      return;
    }
    trial = await createTrial({
      discordId: id,
      mode: 'practice',
      tier: null,
      problems: pickProblems('practice'),
      durationMs: TRIAL_SHAPE.practice.durationMs,
    });
  }
  const url = `${env.PUBLIC_BASE_URL}/judge?t=${encodeURIComponent(trialToken(trial, webSecret()))}`;
  await interaction.reply({
    content: `📚 Bài luyện Tàng Kinh Các của bạn: ${Math.round(TRIAL_SHAPE.practice.durationMs / 60_000)} phút, tính từ lúc mở trang. Giải xong là hoàn thành nhiệm vụ học tập.`,
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Mở bài luyện').setURL(url),
      ),
    ],
    ephemeral: true,
  });
}

async function handleStudy(interaction: ButtonInteraction): Promise<void> {
  const id = interaction.user.id;
  const now = Date.now();
  const day = vnDayStart(now);
  const used = studyRounds.get(id);
  const n = used && used.day === day ? used.n : 0;
  if (n >= STUDY_ROUNDS_PER_DAY) {
    await interaction.reply({ content: '📖 Hôm nay ôn đủ rồi, mai ôn tiếp nhé.', ephemeral: true });
    return;
  }
  studyRounds.set(id, { day, n: n + 1 });

  const asked = pickQuestions(3);
  let correct = 0;
  let current: ButtonInteraction = interaction;
  let first = true;
  for (const [qi, a] of asked.entries()) {
    const view = {
      tierName: 'Ôn bài Tàng Kinh Các',
      name: interaction.user.displayName,
      index: qi + 1,
      total: asked.length,
      correctSoFar: correct,
      seconds: Math.round(QUIZ_TIMEOUT_MS / 1000),
      prompt: a.question.prompt,
      code: a.question.code,
      lang: a.question.lang,
      options: a.options,
    };
    const card = await renderQuizCard(view);
    const answers = new ActionRowBuilder<ButtonBuilder>().addComponents(
      LETTERS.map((l, i) =>
        new ButtonBuilder()
          .setCustomId(`study:${qi}:${i}`)
          .setLabel(l)
          .setStyle(ButtonStyle.Primary),
      ),
    );
    const payload = {
      files: [new AttachmentBuilder(card.buffer, { name: card.name })],
      components: [answers],
      attachments: [],
    };
    const msg = first
      ? await current.reply({ ...payload, ephemeral: true, fetchReply: true })
      : await current.update({ ...payload, fetchReply: true });
    first = false;
    let chosen: number | null = null;
    try {
      const click = await msg.awaitMessageComponent({
        filter: (i) => i.user.id === id && i.customId.startsWith(`study:${qi}:`),
        componentType: ComponentType.Button,
        time: QUIZ_TIMEOUT_MS,
      });
      chosen = Number(click.customId.split(':')[2]);
      current = click;
    } catch {
      await interaction
        .editReply({ content: '⏱️ Hết giờ, phiên ôn bài dừng ở đây.', components: [] })
        .catch(() => undefined);
      return;
    }
    const right = chosen === a.correct;
    if (right) {
      correct++;
      await incrementProgress(id, 'study_read', 1).catch((err: unknown) =>
        logger.warn({ err }, 'quest: study progress failed'),
      );
    }
    const reveal = await renderQuizCard({
      ...view,
      correctSoFar: correct,
      reveal: { chosen, correct: a.correct, explain: a.question.explain },
    });
    const next = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Đọc bài ở Tàng Kinh Các')
        .setURL(`${DOCS_ORIGIN}${a.question.docs}`),
      new ButtonBuilder()
        .setCustomId(`study:next:${qi}`)
        .setLabel(qi + 1 < asked.length ? 'Câu tiếp' : 'Xong')
        .setStyle(ButtonStyle.Secondary),
    );
    const shown = await current.update({
      files: [new AttachmentBuilder(reveal.buffer, { name: reveal.name })],
      components: [next],
      attachments: [],
      fetchReply: true,
    });
    if (qi + 1 >= asked.length) break;
    try {
      current = await shown.awaitMessageComponent({
        filter: (i) => i.user.id === id && i.customId === `study:next:${qi}`,
        componentType: ComponentType.Button,
        time: 5 * 60_000,
      });
    } catch {
      return;
    }
  }
  const board = getTodayQuests(id).find((q) => q.quest_type === 'study_read');
  await interaction
    .followUp({
      content: `📖 Đúng ${correct}/${asked.length} câu.${
        board
          ? ` Nhiệm vụ ôn bài: ${Math.min(board.progress, board.target)}/${board.target}${board.completed_at ? ' ✅' : ''}.`
          : ''
      }`,
      ephemeral: true,
    })
    .catch(() => undefined);
}

export async function handleQuestButton(interaction: ButtonInteraction): Promise<boolean> {
  if (interaction.customId === QUEST_PRACTICE_ID) {
    await handlePractice(interaction);
    return true;
  }
  if (interaction.customId === QUEST_STUDY_ID) {
    await handleStudy(interaction);
    return true;
  }
  return false;
}

/** A solved practice trial completes the study_solve quest. */
export function wireQuestDiscord(): void {
  onTrialFinished(async (t) => {
    if (t.meta.mode === 'practice' && t.meta.status === 'passed')
      await incrementProgress(t.meta.discord_id, 'study_solve', 1);
  });
}

export function resetStudyRounds(): void {
  studyRounds.clear();
}
