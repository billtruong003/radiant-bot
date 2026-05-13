import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setStoreForTesting } from '../../src/db/index.js';
import { Store } from '../../src/db/store.js';
import {
  DEFAULT_SUBTITLE_MAPPINGS,
  handleReactionAdd,
  handleReactionRemove,
  saveReactionRolesConfig,
} from '../../src/modules/reactionRoles/index.js';
import { mkTmpDir } from '../helpers/tmp-dir.js';
import { makeMockMember } from '../verification/__mocks__/member.js';

const NEVER = 99_999_999;

/**
 * Integration: full handleReactionAdd/Remove path with mocked
 * GuildMember. Verifies role.add/remove get called when reaction is
 * on the configured message, and NOT called for off-target messages.
 */

describe('reactionRoles handlers (integration)', () => {
  let store: Store;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await mkTmpDir('rr-int');
    cleanup = tmp.cleanup;
    store = new Store({ dataDir: tmp.dir, snapshotIntervalMs: NEVER, fsync: false });
    await store.init();
    __setStoreForTesting(store);
    await saveReactionRolesConfig('chan-1', 'msg-rr', DEFAULT_SUBTITLE_MAPPINGS);
  });

  afterEach(async () => {
    __setStoreForTesting(null);
    await store.shutdown();
    await cleanup();
  });

  it('add reaction on RR message + known emoji → role.add called', async () => {
    const { member, spies } = makeMockMember({
      id: 'u1',
      fetchSelf: true,
      roleMap: { 'Kiếm Tu': 'role-kiem-tu', 'Đan Sư': 'role-dan-su' },
    });
    const matched = await handleReactionAdd(member.guild, 'u1', 'msg-rr', '⚔️');
    expect(matched).toBe(true);
    expect(spies.rolesAdd).toHaveBeenCalledTimes(1);
    const [role] = spies.rolesAdd.mock.calls[0] ?? [];
    expect((role as { name: string }).name).toBe('Kiếm Tu');
  });

  it('add reaction on RR message + unknown emoji → matched=true, role.add NOT called', async () => {
    const { member, spies } = makeMockMember({
      id: 'u1',
      fetchSelf: true,
      roleMap: { 'Kiếm Tu': 'role-kiem-tu' },
    });
    const matched = await handleReactionAdd(member.guild, 'u1', 'msg-rr', '🎲');
    expect(matched).toBe(true);
    expect(spies.rolesAdd).not.toHaveBeenCalled();
  });

  it('add reaction on different message → matched=false, no role action', async () => {
    const { member, spies } = makeMockMember({
      id: 'u1',
      fetchSelf: true,
      roleMap: { 'Kiếm Tu': 'role-kiem-tu' },
    });
    const matched = await handleReactionAdd(member.guild, 'u1', 'other-msg', '⚔️');
    expect(matched).toBe(false);
    expect(spies.rolesAdd).not.toHaveBeenCalled();
  });

  it('remove reaction → role.remove called with the matching role', async () => {
    const { member, spies } = makeMockMember({
      id: 'u1',
      fetchSelf: true,
      roleIds: ['role-kiem-tu'],
      roleMap: { 'Kiếm Tu': 'role-kiem-tu' },
    });
    const matched = await handleReactionRemove(member.guild, 'u1', 'msg-rr', '⚔️');
    expect(matched).toBe(true);
    expect(spies.rolesRemove).toHaveBeenCalledTimes(1);
  });

  it('add reaction but member already has role → no-op (idempotent)', async () => {
    const { member, spies } = makeMockMember({
      id: 'u1',
      fetchSelf: true,
      roleIds: ['role-kiem-tu'],
      roleMap: { 'Kiếm Tu': 'role-kiem-tu' },
    });
    await handleReactionAdd(member.guild, 'u1', 'msg-rr', '⚔️');
    expect(spies.rolesAdd).not.toHaveBeenCalled();
  });

  it('target role missing in guild → matched=true, role.add NOT called, no throw', async () => {
    const { member, spies } = makeMockMember({
      id: 'u1',
      fetchSelf: true,
      roleMap: {}, // empty role map — Kiếm Tu role doesn't exist
    });
    const matched = await handleReactionAdd(member.guild, 'u1', 'msg-rr', '⚔️');
    expect(matched).toBe(true);
    expect(spies.rolesAdd).not.toHaveBeenCalled();
  });

  it('member not found via fetch → matched=true, no role action', async () => {
    const { member } = makeMockMember({
      id: 'u1',
      roleMap: { 'Kiếm Tu': 'role-kiem-tu' },
    });
    // override fetch so it rejects
    // biome-ignore lint/suspicious/noExplicitAny: extend mock
    (member.guild.members as any).fetch = vi.fn().mockRejectedValue(new Error('not found'));
    const matched = await handleReactionAdd(member.guild, 'gone-user', 'msg-rr', '⚔️');
    expect(matched).toBe(true); // routing matched, but member fetch failed
  });
});
