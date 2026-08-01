import { describe, expect, it } from 'vitest';
import type { Message } from 'discord.js';
import { shouldArchive } from '../../src/events/messageCreate.js';

const BOT_ID = 'aki-self';

function msg(opts: { authorId: string; bot: boolean; content: string }): Message {
  return {
    content: opts.content,
    author: { id: opts.authorId, bot: opts.bot },
    client: { user: { id: BOT_ID } },
  } as unknown as Message;
}

describe('archive gate', () => {
  it('archives a member message', () => {
    expect(shouldArchive(msg({ authorId: 'u1', bot: false, content: 'cách build iOS?' }))).toBe(
      true,
    );
  });

  // The regression: this predicate used to sit below `if (author.bot)
  // return`, so /tra-cuu searched every question and none of the answers.
  it("archives Aki's own reply", () => {
    expect(shouldArchive(msg({ authorId: BOT_ID, bot: true, content: 'Solar2D build được nha' }))).toBe(
      true,
    );
  });

  it('skips other bots', () => {
    expect(shouldArchive(msg({ authorId: 'mee6', bot: true, content: 'level up!' }))).toBe(false);
  });

  it('skips empty content (embed/attachment-only)', () => {
    expect(shouldArchive(msg({ authorId: 'u1', bot: false, content: '   ' }))).toBe(false);
  });
});
