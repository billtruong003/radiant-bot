import {
  type Guild,
  type TextChannel,
  type ThreadChannel,
  ChannelType,
  EmbedBuilder,
} from 'discord.js';
import { matchesChannelName } from '../../config/channels.js';
import type { DocContribution } from '../../db/types.js';
import { themedEmbed } from '../../utils/embed.js';
import { logger } from '../../utils/logger.js';

/**
 * Phase 12.6/3 — Docs auto-publish.
 *
 * When `submitContribution()` lands an `approved` doc, we publish it as a
 * **public thread inside `#📚-docs-📚`**. Each approved doc gets its own
 * thread (title = doc title), starter message = themed embed with full
 * body + classification + optional image.
 *
 * Why thread-in-text channel (not Forum channel):
 *   - No need to re-type the existing live channel (Discord cannot convert).
 *   - No new channel needed (server stays tidy).
 *   - Image attachments work natively in thread starter messages.
 *   - Side-panel thread list in Discord UX is browse-equivalent to Forum.
 *
 * Behaviour:
 *   - Non-throwing — any failure logs + returns a `skipped` outcome. The
 *     contribution is already persisted in the store with `thread_id=null`;
 *     a follow-up `/sync-pinned`-style retry could republish.
 *   - Best-effort thread name (max 100 chars, trimmed).
 *   - Best-effort pin on the starter message (ignored if bot lacks
 *     ManageMessages on the channel).
 *
 * Returns the new thread id on success so the caller can update the
 * `DocContribution.thread_id` field.
 */

const DOCS_CANONICAL_CHANNEL = 'docs';
const MAX_THREAD_NAME = 100;
const SECTION_LABELS: Record<string, string> = {
  tech: '🛠️ Tech',
  cultivation: '🌌 Tu Hành',
  lore: '📜 Lore',
  dev: '💻 Dev',
  'data-science': '📊 Data Science',
  community: '🤝 Community',
};
const DIFFICULTY_LABELS: Record<string, string> = {
  easy: '🌱 Easy',
  medium: '⚡ Medium',
  hard: '🔥 Hard',
};

export interface PublishResult {
  status: 'published' | 'channel-missing' | 'wrong-channel-type' | 'no-permission' | 'error';
  threadId?: string;
  detail?: string;
}

function findDocsChannel(guild: Guild): TextChannel | null {
  for (const ch of guild.channels.cache.values()) {
    if (ch.type !== ChannelType.GuildText) continue;
    if (matchesChannelName(ch, DOCS_CANONICAL_CHANNEL)) return ch as TextChannel;
  }
  return null;
}

function truncateThreadName(title: string): string {
  if (title.length <= MAX_THREAD_NAME) return title;
  return `${title.slice(0, MAX_THREAD_NAME - 1)}…`;
}

function buildStarterEmbed(contribution: DocContribution, authorTag: string): EmbedBuilder {
  const sectionLabel = contribution.section
    ? (SECTION_LABELS[contribution.section] ?? contribution.section)
    : '—';
  const difficultyLabel = contribution.difficulty
    ? (DIFFICULTY_LABELS[contribution.difficulty] ?? contribution.difficulty)
    : '—';
  const tagsLine = contribution.tags.length
    ? contribution.tags.map((t) => `\`${t}\``).join(' ')
    : '_không có_';

  const embed = themedEmbed('plain', {
    color: 0xb09bd3,
    title: `📖 ${contribution.title}`,
    description: contribution.body,
    timestamp: true,
  });
  embed.addFields(
    {
      name: '📊 Aki Score',
      value: `${contribution.score ?? '?'}/100`,
      inline: true,
    },
    { name: '🎯 Độ Khó', value: difficultyLabel, inline: true },
    { name: '📂 Section', value: sectionLabel, inline: true },
    { name: '🏷️ Tags', value: tagsLine, inline: false },
    { name: '👤 Tác giả', value: authorTag, inline: false },
  );
  embed.setFooter({ text: `contribution_id: ${contribution.id} · approved by Aki` });
  if (contribution.image_url) {
    embed.setImage(contribution.image_url);
  }
  return embed;
}

/**
 * Publish an approved doc as a public thread in `#docs`. The contribution
 * must already be in the store with status='approved'. Caller should write
 * the returned `threadId` back into `contribution.thread_id` if status is
 * 'published'.
 */
export async function publishApprovedDoc(
  guild: Guild,
  contribution: DocContribution,
  authorTag: string,
): Promise<PublishResult> {
  if (contribution.status !== 'approved') {
    return { status: 'error', detail: `contribution status is ${contribution.status}, expected approved` };
  }
  const channel = findDocsChannel(guild);
  if (!channel) {
    logger.warn(
      { contribution_id: contribution.id, canonical: DOCS_CANONICAL_CHANNEL },
      'docs-publish: #docs channel not found',
    );
    return { status: 'channel-missing', detail: `no #${DOCS_CANONICAL_CHANNEL} text channel` };
  }
  const me = guild.members.me;
  if (
    !me ||
    !channel
      .permissionsFor(me)
      ?.has(['SendMessages', 'CreatePublicThreads', 'SendMessagesInThreads'])
  ) {
    return {
      status: 'no-permission',
      detail: 'bot lacks SendMessages / CreatePublicThreads / SendMessagesInThreads in #docs',
    };
  }

  try {
    const starter = await channel.send({
      embeds: [buildStarterEmbed(contribution, authorTag)],
      allowedMentions: { parse: [] },
    });

    let thread: ThreadChannel;
    try {
      thread = await starter.startThread({
        name: truncateThreadName(`📖 ${contribution.title}`),
        autoArchiveDuration: 10080, // 7 days (max for non-boosted servers)
        reason: 'docs-publish: approved contribution thread',
      });
    } catch (err) {
      logger.error(
        { err, contribution_id: contribution.id },
        'docs-publish: thread start failed (channel may not allow public threads)',
      );
      return { status: 'error', detail: `thread start: ${(err as Error).message}` };
    }

    // Best-effort: pin the starter inside the thread so it's visible at
    // the top when someone opens the thread later. Ignore failures.
    try {
      await starter.pin('docs-publish: anchor starter');
    } catch (err) {
      logger.debug(
        { err, contribution_id: contribution.id },
        'docs-publish: pin starter failed (ignored)',
      );
    }

    logger.info(
      {
        contribution_id: contribution.id,
        thread_id: thread.id,
        channel: channel.name,
        score: contribution.score,
        section: contribution.section,
        difficulty: contribution.difficulty,
      },
      'docs-publish: published',
    );

    return { status: 'published', threadId: thread.id };
  } catch (err) {
    logger.error(
      { err, contribution_id: contribution.id },
      'docs-publish: unexpected publish failure',
    );
    return { status: 'error', detail: (err as Error).message ?? 'unknown' };
  }
}

export const __for_testing = {
  findDocsChannel,
  truncateThreadName,
  buildStarterEmbed,
  DOCS_CANONICAL_CHANNEL,
  MAX_THREAD_NAME,
};
