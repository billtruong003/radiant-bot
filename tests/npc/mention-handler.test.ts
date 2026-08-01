import { describe, expect, it } from 'vitest';
import { isAddressedToBot } from '../../src/modules/npc/mention-handler.js';

const BOT = 'bot-123';

/** Minimal Message-shaped stub — only the fields the guard actually reads. */
function msg(over: {
  users?: string[];
  everyone?: boolean;
  replyToId?: string;
  repliedUserId?: string;
}): never {
  return {
    mentions: {
      everyone: over.everyone ?? false,
      users: new Map((over.users ?? []).map((u) => [u, {}])),
      repliedUser: over.repliedUserId ? { id: over.repliedUserId } : null,
    },
    reference: over.replyToId ? { messageId: over.replyToId } : null,
  } as never;
}

describe('isAddressedToBot', () => {
  it('true when the bot is directly mentioned', () => {
    expect(isAddressedToBot(msg({ users: [BOT] }), BOT)).toBe(true);
  });

  it('true when replying to a bot message', () => {
    expect(isAddressedToBot(msg({ replyToId: 'm1', repliedUserId: BOT }), BOT)).toBe(true);
  });

  it('false for a plain message', () => {
    expect(isAddressedToBot(msg({}), BOT)).toBe(false);
  });

  it('false when someone else is mentioned', () => {
    expect(isAddressedToBot(msg({ users: ['other'] }), BOT)).toBe(false);
  });

  it('false when replying to a human, not the bot', () => {
    expect(isAddressedToBot(msg({ replyToId: 'm1', repliedUserId: 'human' }), BOT)).toBe(false);
  });

  // @everyone would otherwise drag Aki into every announcement and burn
  // the shared daily quota in one post.
  it('false for @everyone even if the bot is also mentioned', () => {
    expect(isAddressedToBot(msg({ everyone: true, users: [BOT] }), BOT)).toBe(false);
  });
});
