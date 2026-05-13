import { EventEmitter } from 'node:events';
import type { GuildMember, Message, TextChannel } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setStoreForTesting } from '../../src/db/index.js';
import { Store } from '../../src/db/store.js';
import type { User } from '../../src/db/types.js';
import { runTribulation } from '../../src/modules/events/tribulation.js';
import { cumulativeXpForLevel } from '../../src/modules/leveling/engine.js';
import { mkTmpDir } from '../helpers/tmp-dir.js';

/**
 * Integration: runTribulation full path with mocked channel + collector.
 * The orchestrator calls `channel.send` then `sent.createMessageComponentCollector`,
 * then awaits a Promise that resolves on 'collect' or 'end' (timeout).
 * We use EventEmitter to fake the collector and synchronously fire the
 * events after one microtask so the orchestrator's listeners are
 * attached first.
 */

const NEVER = 99_999_999;

function makeUser(over: Partial<User>): User {
  return {
    discord_id: 'u-trib',
    username: 'u',
    display_name: null,
    xp: 0,
    level: 12,
    cultivation_rank: 'truc_co',
    sub_title: null,
    joined_at: 0,
    verified_at: 0,
    last_message_at: null,
    last_daily_at: null,
    daily_streak: 0,
    is_suspect: false,
    notes: null,
    ...over,
  };
}

interface MockFakes {
  member: GuildMember;
  channelSend: ReturnType<typeof vi.fn>;
  collector: EventEmitter;
  sentMessageEdit: ReturnType<typeof vi.fn>;
}

function buildFakes(): MockFakes {
  const collector = new EventEmitter();
  const sentMessageEdit = vi.fn().mockResolvedValue(undefined);
  // Track what got sent so the second call (outcome embed) doesn't fail.
  const channelSend = vi.fn().mockResolvedValue({
    createMessageComponentCollector: () => collector,
    edit: sentMessageEdit,
  } as unknown as Message);

  const member = {
    id: 'u-trib',
    toString: () => '<@u-trib>',
    displayName: 'Tester',
    user: {
      username: 'Tester',
      tag: 'Tester#0001',
      displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/u-trib/avatar.png',
    },
    guild: {
      channels: {
        cache: {
          find: (pred: (c: unknown) => boolean) => {
            const fake = {
              name: 'tribulation',
              isTextBased: () => true,
              send: channelSend,
            };
            return pred(fake) ? (fake as unknown as TextChannel) : undefined;
          },
        },
      },
    },
  } as unknown as GuildMember;

  return { member, channelSend, collector, sentMessageEdit };
}

function fakeButtonInteraction(customId: string, userId: string) {
  return {
    customId,
    user: { id: userId },
    deferUpdate: vi.fn().mockResolvedValue(undefined),
  };
}

describe('runTribulation integration', () => {
  let store: Store;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await mkTmpDir('trib-int');
    cleanup = tmp.cleanup;
    store = new Store({ dataDir: tmp.dir, snapshotIntervalMs: NEVER, fsync: false });
    await store.init();
    __setStoreForTesting(store);
  });

  afterEach(async () => {
    __setStoreForTesting(null);
    await store.shutdown();
    await cleanup();
  });

  it('aborted when #tribulation channel missing', async () => {
    await store.users.set(makeUser({ discord_id: 'u-trib' }));
    const member = {
      id: 'u-trib',
      toString: () => '<@u-trib>',
      displayName: 'Tester',
      user: { username: 'Tester', tag: 'Tester#0001' },
      guild: { channels: { cache: { find: () => undefined } } },
    } as unknown as GuildMember;

    const r = await runTribulation(member, { game: 'math' });
    expect(r.outcome).toBe('aborted');
    expect(r.xpDelta).toBe(0);
    expect(store.events.count()).toBe(0);
  });

  it('correct button click → pass, +500 XP, event persisted with outcome', async () => {
    const baseXp = cumulativeXpForLevel(12) + 200;
    await store.users.set(makeUser({ discord_id: 'u-trib', level: 12, xp: baseXp }));
    const { member, channelSend, collector } = buildFakes();

    const promise = runTribulation(member, { game: 'reaction' });
    // Wait until orchestrator has posted (channel.send called) AND
    // persisted the event start — only then are collector listeners
    // attached + event metadata readable.
    await vi.waitFor(
      () => {
        expect(channelSend).toHaveBeenCalledTimes(1);
        expect(store.events.count()).toBeGreaterThan(0);
      },
      { timeout: 2000 },
    );

    // Find the eventId from the persisted event record.
    const event = store.events.all()[0];
    expect(event).toBeDefined();
    expect(event?.type).toBe('tribulation');
    const eventId = event?.id ?? '';
    const expected = String(event?.metadata?.expected ?? '');

    // Locate the button matching `expected` (target emoji 🐉). The
    // orchestrator's row.components have label/emoji on .data. We
    // emit using the customId trib:{eventId}:{idx}; the orchestrator
    // reads back the row component at idx, so it'll see the target.
    // For reaction game, target = '🐉'; we know index won't matter
    // because the orchestrator constructs the row from the same
    // generator. To find which index holds '🐉', emit collect for
    // index 0..4 sequentially via a loop checking the outcome.
    // Simpler: query the post payload to find the index.
    const sendArgs = channelSend.mock.calls[0]?.[0] as {
      components: { components: { data: { emoji?: { name?: string }; label?: string } }[] }[];
    };
    const rowComponents = sendArgs.components[0]?.components ?? [];
    const targetIdx = rowComponents.findIndex(
      (b) => b.data.emoji?.name === expected || b.data.label === expected,
    );
    expect(targetIdx).toBeGreaterThanOrEqual(0);

    collector.emit('collect', fakeButtonInteraction(`trib:${eventId}:${targetIdx}`, 'u-trib'));
    const result = await promise;

    expect(result.outcome).toBe('pass');
    expect(result.xpDelta).toBe(500);
    expect(store.users.get('u-trib')?.xp).toBe(baseXp + 500);

    // Event end-state persisted.
    const finalEvent = store.events.get(eventId);
    expect(finalEvent?.ended_at).not.toBeNull();
    expect(finalEvent?.metadata?.outcome).toBe('pass');

    // Channel.send called twice: once for intro, once for outcome.
    expect(channelSend).toHaveBeenCalledTimes(2);
  });

  it('wrong button click → fail, -100 XP penalty', async () => {
    const baseXp = cumulativeXpForLevel(12) + 200;
    await store.users.set(makeUser({ discord_id: 'u-trib', level: 12, xp: baseXp }));
    const { member, channelSend, collector } = buildFakes();

    const promise = runTribulation(member, { game: 'reaction' });
    await vi.waitFor(
      () => {
        expect(channelSend).toHaveBeenCalledTimes(1);
        expect(store.events.count()).toBeGreaterThan(0);
      },
      { timeout: 2000 },
    );

    const event = store.events.all()[0];
    const eventId = event?.id ?? '';
    const expected = String(event?.metadata?.expected ?? '');

    const sendArgs = channelSend.mock.calls[0]?.[0] as {
      components: { components: { data: { emoji?: { name?: string }; label?: string } }[] }[];
    };
    const rowComponents = sendArgs.components[0]?.components ?? [];
    const wrongIdx = rowComponents.findIndex(
      (b) => b.data.emoji?.name !== expected && b.data.label !== expected,
    );
    expect(wrongIdx).toBeGreaterThanOrEqual(0);

    collector.emit('collect', fakeButtonInteraction(`trib:${eventId}:${wrongIdx}`, 'u-trib'));
    const result = await promise;

    expect(result.outcome).toBe('fail');
    expect(result.xpDelta).toBe(-100);
    expect(store.users.get('u-trib')?.xp).toBe(baseXp - 100);

    const finalEvent = store.events.get(eventId);
    expect(finalEvent?.metadata?.outcome).toBe('fail');
  });

  it('timeout (collector end without collect) → fail-style penalty', async () => {
    const baseXp = cumulativeXpForLevel(12) + 200;
    await store.users.set(makeUser({ discord_id: 'u-trib', level: 12, xp: baseXp }));
    const { member, channelSend, collector } = buildFakes();

    const promise = runTribulation(member, { game: 'math' });
    await vi.waitFor(
      () => {
        expect(channelSend).toHaveBeenCalledTimes(1);
        expect(store.events.count()).toBeGreaterThan(0);
      },
      { timeout: 2000 },
    );

    // Simulate the collector ending with no collects (timeout).
    collector.emit('end', new Map());
    const result = await promise;

    expect(result.outcome).toBe('timeout');
    expect(result.xpDelta).toBe(-100);
    expect(store.users.get('u-trib')?.xp).toBe(baseXp - 100);

    const eventId = result.eventId;
    expect(store.events.get(eventId)?.metadata?.outcome).toBe('timeout');
  });

  it('fail penalty floors at level threshold (no demotion)', async () => {
    const floor = cumulativeXpForLevel(12);
    // Just 30 XP above floor; -100 penalty caps at 30 lost.
    await store.users.set(makeUser({ discord_id: 'u-trib', level: 12, xp: floor + 30 }));
    const { member, channelSend, collector } = buildFakes();

    const promise = runTribulation(member, { game: 'math' });
    await vi.waitFor(
      () => {
        expect(channelSend).toHaveBeenCalledTimes(1);
        expect(store.events.count()).toBeGreaterThan(0);
      },
      { timeout: 2000 },
    );

    collector.emit('end', new Map());
    const result = await promise;

    expect(result.outcome).toBe('timeout');
    expect(result.xpDelta).toBe(-30); // capped
    expect(store.users.get('u-trib')?.xp).toBe(floor);
  });
});
