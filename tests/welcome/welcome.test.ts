import type { GuildMember } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { postWelcome } from '../../src/modules/welcome/index.js';

/**
 * Welcome integration. We build the GuildMember fake inline here
 * (not via makeMockMember) because welcome.ts walks the channel
 * cache and the verification mock factory's channel surface
 * doesn't fit cleanly.
 */

interface BuildOpts {
  channelName?: string | null;
  channelSendRejects?: boolean;
  dmSendRejects?: boolean;
}

function buildMember(opts: BuildOpts = {}): {
  member: GuildMember;
  channelSend: ReturnType<typeof vi.fn>;
  dmSend: ReturnType<typeof vi.fn>;
} {
  const channelSend = opts.channelSendRejects
    ? vi.fn().mockRejectedValue(new Error('rate limited'))
    : vi.fn().mockResolvedValue(undefined);
  const dmSend = opts.dmSendRejects
    ? vi.fn().mockRejectedValue(new Error('DMs closed'))
    : vi.fn().mockResolvedValue(undefined);

  const channels = opts.channelName
    ? [{ name: opts.channelName, isTextBased: () => true, send: channelSend }]
    : [];

  const member = {
    id: 'u1',
    toString: () => '<@u1>',
    displayName: 'Test User',
    joinedAt: new Date('2026-05-13'),
    user: {
      bot: false,
      tag: 'TestUser#0001',
      username: 'TestUser',
      displayAvatarURL: () => 'https://cdn.example/avatar.png',
    },
    send: dmSend,
    guild: {
      id: 'guild-test',
      channels: {
        cache: {
          find: (pred: (c: unknown) => boolean) => channels.find(pred),
        },
      },
    },
  };

  return { member: member as unknown as GuildMember, channelSend, dmSend };
}

describe('postWelcome', () => {
  it('#general present → embed posted there + DM sent', async () => {
    const { member, channelSend, dmSend } = buildMember({ channelName: 'general' });
    await postWelcome(member);

    expect(channelSend).toHaveBeenCalledTimes(1);
    const payload = channelSend.mock.calls[0]?.[0];
    expect(payload.content).toContain('u1');
    expect(payload.embeds).toHaveLength(1);
    expect(payload.embeds[0].data.title).toBe('🌅 Chào mừng tân đệ tử');
    expect(payload.allowedMentions).toEqual({ users: ['u1'] });

    expect(dmSend).toHaveBeenCalledTimes(1);
    const dmText = dmSend.mock.calls[0]?.[0] as string;
    expect(dmText).toContain('/daily');
    expect(dmText).toContain('Radiant Tech Sect');
  });

  it('#general missing but #introductions present → falls back', async () => {
    const { member, channelSend } = buildMember({ channelName: 'introductions' });
    await postWelcome(member);
    expect(channelSend).toHaveBeenCalledTimes(1);
  });

  it('no welcome channel found → DM still attempted, no throw', async () => {
    const { member, channelSend, dmSend } = buildMember({ channelName: null });
    await expect(postWelcome(member)).resolves.toBeUndefined();
    expect(channelSend).not.toHaveBeenCalled();
    expect(dmSend).toHaveBeenCalledTimes(1);
  });

  it('channel.send rejects → no throw, DM still attempted', async () => {
    const { member, channelSend, dmSend } = buildMember({
      channelName: 'general',
      channelSendRejects: true,
    });
    await expect(postWelcome(member)).resolves.toBeUndefined();
    expect(channelSend).toHaveBeenCalled();
    expect(dmSend).toHaveBeenCalled();
  });

  it('DM rejects → no throw, public post still made', async () => {
    const { member, channelSend, dmSend } = buildMember({
      channelName: 'general',
      dmSendRejects: true,
    });
    await expect(postWelcome(member)).resolves.toBeUndefined();
    expect(channelSend).toHaveBeenCalledTimes(1);
    expect(dmSend).toHaveBeenCalled();
  });
});
