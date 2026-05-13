import type { Guild, GuildMember, Role, TextChannel } from 'discord.js';
import { vi } from 'vitest';

/**
 * Test-only fake builders for the verification flow. The fakes implement
 * exactly the methods/fields touched by `flow.ts` + `audit.ts` —
 * `as unknown as GuildMember` casts narrow the surface area. Each call
 * site is grep-able if discord.js adds a new dependency.
 */

export interface MockMember {
  member: GuildMember;
  spies: {
    kick: ReturnType<typeof vi.fn>;
    dmSend: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>; // member.send for confirmation
    rolesAdd: ReturnType<typeof vi.fn>;
    rolesRemove: ReturnType<typeof vi.fn>;
    channelSend: ReturnType<typeof vi.fn>;
  };
}

export interface MockMemberOpts {
  id?: string;
  username?: string;
  ageDays?: number;
  hasAvatar?: boolean;
  isBot?: boolean;
  dmFails?: boolean;
  /** Role IDs the member currently has. */
  roleIds?: readonly string[];
  /** Guild role-name → role-id map for the find() lookups. */
  roleMap?: Record<string, string>;
  /** Guild channel-name → text channel for #verify fallback post. */
  channelMap?: Record<string, TextChannel | undefined>;
  /** If set, `guild.members.fetch(id)` resolves to this member. */
  fetchSelf?: boolean;
}

const NOW = 1_700_000_000_000;
const DEFAULT_ROLES = {
  'Phàm Nhân': 'role-pham-nhan',
  'Chưa Xác Minh': 'role-chua-xac-minh',
};

export function makeMockMember(opts: MockMemberOpts = {}): MockMember {
  const id = opts.id ?? 'u-test-1';
  const username = opts.username ?? 'TestUser';
  const ageDays = opts.ageDays ?? 30;
  const hasAvatar = opts.hasAvatar ?? true;
  const isBot = opts.isBot ?? false;
  const dmFails = opts.dmFails ?? false;
  const roleMap = { ...DEFAULT_ROLES, ...opts.roleMap };

  const kick = vi.fn().mockResolvedValue(undefined);
  const dmSend = dmFails
    ? vi.fn().mockRejectedValue(new Error('Cannot send messages to this user'))
    : vi.fn().mockResolvedValue(undefined);
  const send = vi.fn().mockResolvedValue(undefined);
  const rolesAdd = vi.fn().mockResolvedValue(undefined);
  const rolesRemove = vi.fn().mockResolvedValue(undefined);
  const channelSend = vi.fn().mockResolvedValue(undefined);

  // Set of role IDs this member currently holds.
  const heldRoleIds = new Set(opts.roleIds ?? []);
  const rolesCache = {
    has: (roleId: string) => heldRoleIds.has(roleId),
    keys: () => heldRoleIds.keys(),
    values: () => {
      const arr: Role[] = [];
      for (const rid of heldRoleIds) {
        const name = Object.entries(roleMap).find(([_, id]) => id === rid)?.[0] ?? 'Unknown';
        arr.push({ id: rid, name } as Role);
      }
      return arr.values();
    },
  };

  // Guild's role + channel cache lookups go through .find() which iterates.
  const guildRoles = Object.entries(roleMap).map(([name, rid]) => ({ id: rid, name }) as Role);
  const verifyChannel = opts.channelMap?.verify;
  const guildChannels = Object.entries(opts.channelMap ?? {}).map(([name, ch]) => {
    const channel = ch as TextChannel | undefined;
    return { id: `channel-${name}`, name, isTextBased: () => true, ...channel };
  });

  // member.guild — only the fields flow.ts actually reads.
  const member = {
    id,
    // Real Discord.js GuildMember serializes to `<@id>` mention via toString.
    // Reproducing here so template-literal mentions in flow/rank-promoter
    // render the expected `<@u1>` string instead of `[object Object]`.
    toString: () => `<@${id}>`,
    user: {
      bot: isBot,
      tag: `${username}#0001`,
      username,
      avatar: hasAvatar ? 'avatar-hash' : null,
      createdTimestamp: NOW - ageDays * 24 * 60 * 60 * 1000,
      displayAvatarURL: () => `https://cdn.discordapp.com/avatars/${id}/avatar.png`,
    },
    displayName: username,
    joinedTimestamp: NOW,
    roles: {
      cache: rolesCache,
      add: rolesAdd.mockImplementation((role: Role) => {
        heldRoleIds.add(role.id);
        return Promise.resolve();
      }),
      remove: rolesRemove.mockImplementation((role: Role) => {
        heldRoleIds.delete(role.id);
        return Promise.resolve();
      }),
    },
    createDM: vi.fn().mockResolvedValue({ send: dmSend }),
    kick,
    send,
    guild: {
      id: 'guild-test',
      roles: {
        cache: {
          find: (pred: (r: Role) => boolean) => guildRoles.find(pred),
        },
      },
      channels: {
        cache: {
          find: (pred: (c: unknown) => boolean) =>
            verifyChannel
              ? {
                  name: 'verify',
                  isTextBased: () => true,
                  send: channelSend,
                  ...(verifyChannel as object),
                }
              : guildChannels.find(pred),
        },
      },
      members: {
        fetch: vi
          .fn()
          .mockImplementation((fetchId: string) =>
            opts.fetchSelf && fetchId === id
              ? Promise.resolve(member)
              : Promise.reject(new Error('not found')),
          ),
      },
    },
  };

  return {
    member: member as unknown as GuildMember,
    spies: { kick, dmSend, send, rolesAdd, rolesRemove, channelSend },
  };
}

/**
 * Make a fake Guild for cleanup cron tests (member.fetch lookup).
 * Returns the guild + a map of member-id → fake member.
 */
export function makeMockGuild(members: Record<string, MockMember>): Guild {
  return {
    id: 'guild-test',
    roles: { cache: { find: () => undefined } },
    channels: { cache: { find: () => undefined } },
    members: {
      fetch: vi.fn().mockImplementation((id: string) => {
        const m = members[id];
        if (!m) return Promise.reject(new Error(`member ${id} not found`));
        return Promise.resolve(m.member);
      }),
    },
  } as unknown as Guild;
}
