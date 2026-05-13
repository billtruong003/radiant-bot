import type { Message } from 'discord.js';
import { vi } from 'vitest';

/**
 * Fake `Message` for automod tests. Implements only the fields/methods
 * automod actually reads: `content`, `author`, `member`, `mentions`,
 * `deletable`, `delete`, plus the `kickable`/`moderatable`/`kick`/`timeout`
 * on the member side.
 *
 * Mock Spies live on the returned `spies` object so tests can assert
 * `expect(spies.delete).toHaveBeenCalled()`.
 */

export interface MockMessageOpts {
  authorId?: string;
  authorTag?: string;
  content: string;
  userMentions?: number;
  roleMentions?: number;
  /** Member exists (default true). If false, `member` is null. */
  hasMember?: boolean;
  moderatable?: boolean;
  kickable?: boolean;
}

export interface MockMessage {
  message: Message;
  spies: {
    delete: ReturnType<typeof vi.fn>;
    dmSend: ReturnType<typeof vi.fn>;
    timeout: ReturnType<typeof vi.fn>;
    kick: ReturnType<typeof vi.fn>;
  };
}

export function makeMockMessage(opts: MockMessageOpts): MockMessage {
  const authorId = opts.authorId ?? 'u-author';
  const authorTag = opts.authorTag ?? 'TestUser#0001';
  const userMentions = opts.userMentions ?? 0;
  const roleMentions = opts.roleMentions ?? 0;
  const hasMember = opts.hasMember ?? true;
  const moderatable = opts.moderatable ?? true;
  const kickable = opts.kickable ?? true;

  const deleteSpy = vi.fn().mockResolvedValue(undefined);
  const dmSendSpy = vi.fn().mockResolvedValue(undefined);
  const timeoutSpy = vi.fn().mockResolvedValue(undefined);
  const kickSpy = vi.fn().mockResolvedValue(undefined);

  const member = hasMember
    ? {
        moderatable,
        kickable,
        timeout: timeoutSpy,
        kick: kickSpy,
      }
    : null;

  // mentions.users / mentions.roles are Collections in real discord.js;
  // automod only reads `.size`, so a plain object works.
  const mentions = {
    users: { size: userMentions },
    roles: { size: roleMentions },
  };

  const message = {
    id: 'msg-test-1',
    content: opts.content,
    channelId: 'channel-test',
    deletable: true,
    delete: deleteSpy,
    author: {
      id: authorId,
      tag: authorTag,
      bot: false,
      send: dmSendSpy,
    },
    member,
    guild: hasMember ? { id: 'guild-test' } : null,
    mentions,
  };

  return {
    message: message as unknown as Message,
    spies: { delete: deleteSpy, dmSend: dmSendSpy, timeout: timeoutSpy, kick: kickSpy },
  };
}
