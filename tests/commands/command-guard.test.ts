import { describe, expect, it, vi } from 'vitest';
import { PermissionsBitField } from 'discord.js';
import { requireAdmin, requireSectMaster } from '../../src/utils/command-guard.js';

function interaction(opts: {
  inGuild?: boolean;
  perms?: bigint | null;
  roleNames?: string[] | null;
}) {
  const reply = vi.fn().mockResolvedValue(undefined);
  return {
    obj: {
      commandName: 'test',
      user: { id: 'u1', username: 'tester' },
      inGuild: () => opts.inGuild !== false,
      memberPermissions: opts.perms == null ? null : new PermissionsBitField(opts.perms),
      member:
        opts.roleNames == null
          ? null
          : { roles: { cache: opts.roleNames.map((name) => ({ name })) } },
      reply,
    } as never,
    reply,
  };
}

const ADMIN = PermissionsBitField.Flags.Administrator;
const MANAGE = PermissionsBitField.Flags.ManageMessages;

describe('requireAdmin', () => {
  // setDefaultMemberPermissions only sets the DEFAULT Discord shows in
  // Server Settings; anyone who can manage the server can override it and
  // the bot would then run the command without ever checking.
  it('allows an administrator', async () => {
    const i = interaction({ perms: ADMIN });
    expect(await requireAdmin(i.obj)).toBe(true);
    expect(i.reply).not.toHaveBeenCalled();
  });

  it('rejects a moderator who is not an administrator', async () => {
    const i = interaction({ perms: MANAGE });
    expect(await requireAdmin(i.obj)).toBe(false);
    expect(i.reply).toHaveBeenCalled();
  });

  it('rejects when permissions are unknown', async () => {
    expect(await requireAdmin(interaction({ perms: null }).obj)).toBe(false);
  });

  it('rejects outside a guild', async () => {
    expect(await requireAdmin(interaction({ inGuild: false, perms: ADMIN }).obj)).toBe(false);
  });
});

describe('requireSectMaster', () => {
  it('allows the Chưởng Môn', async () => {
    const i = interaction({ roleNames: ['Hóa Thần', 'Chưởng Môn'] });
    expect(await requireSectMaster(i.obj)).toBe(true);
  });

  // Narrower than requireAdmin on purpose: a permission bit can be handed
  // to any role, but this identifies the owner himself.
  it('rejects an administrator who is not Chưởng Môn', async () => {
    const i = interaction({ perms: ADMIN, roleNames: ['Trưởng Lão'] });
    expect(await requireSectMaster(i.obj)).toBe(false);
    expect(i.reply).toHaveBeenCalled();
  });

  it('rejects when roles cannot be resolved by name', async () => {
    expect(await requireSectMaster(interaction({ roleNames: null }).obj)).toBe(false);
  });
});
