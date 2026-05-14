import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutomodConfig } from '../../src/config/automod.js';
import { Store } from '../../src/db/store.js';
import { mkTmpDir } from '../helpers/tmp-dir.js';

/**
 * Phase 11.2 / A6 — verify the graduated profanity flow in applyDecision:
 *   - count 1–4   → gentle nudge via Aki, NO delete, NO log
 *   - count 5–14  → stern nudge via Aki, NO delete, NO log
 *   - count 15+   → existing delete + DM + automod log + narration
 *
 * Each test loads applyDecision + makeMockMessage fresh after wiring the
 * LLM mock (router has to see the doMock at import time, hence
 * vi.resetModules + dynamic import). Store + config are re-bound onto
 * the freshly imported singletons inside `loadWithLlmMock`.
 */

const NEVER = 99_999_999;

const TEST_CONFIG: AutomodConfig = {
  thresholds: {
    massMentionCount: 6,
    capsRatioThreshold: 0.7,
    capsMinLength: 10,
    spamDuplicates: 5,
    spamWindowMs: 300_000,
    timeoutDurationMs: 600_000,
  },
  linkWhitelist: ['github.com'],
  profanityWords: ['fuck', 'shit', 'địt'],
};

interface LoadedActions {
  applyDecision: typeof import('../../src/modules/automod/actions.js')['applyDecision'];
  actionsForTesting: typeof import('../../src/modules/automod/actions.js')['__for_testing'];
  automodEngine: typeof import('../../src/modules/automod/index.js')['automodEngine'];
  makeMockMessage: typeof import('./__mocks__/message.js')['makeMockMessage'];
  counter: typeof import('../../src/modules/automod/profanity-counter.js');
  llmCompleteSpy: ReturnType<typeof vi.fn>;
}

async function loadWithLlmMock(
  store: Store,
  config: AutomodConfig,
  completeImpl: () => unknown,
): Promise<LoadedActions> {
  vi.resetModules();
  const llmCompleteSpy = vi.fn(completeImpl);
  vi.doMock('../../src/modules/llm/index.js', () => ({
    llm: { complete: llmCompleteSpy },
  }));
  // vi.resetModules() invalidates singletons in db/index.js + automod/config.
  // Re-import + re-set them on the FRESH instances the loaded action chain
  // will consume.
  const dbMod = await import('../../src/db/index.js');
  dbMod.__setStoreForTesting(store);
  const automodConfigMod = await import('../../src/config/automod.js');
  automodConfigMod.__setAutomodConfigForTesting(config);
  const counter = await import('../../src/modules/automod/profanity-counter.js');
  counter.reset();
  // Spam tracker is also a singleton; reset per-user authors used in tests.
  const spamMod = await import('../../src/modules/automod/rules/spam-detection.js');
  for (const id of ['u-grad-1', 'u-stern', 'u-tip', 'u-cool', 'u-silent']) {
    spamMod.spamTracker.reset(id);
  }
  const actionsMod = await import('../../src/modules/automod/actions.js');
  const engineMod = await import('../../src/modules/automod/index.js');
  const mocksMod = await import('./__mocks__/message.js');
  return {
    applyDecision: actionsMod.applyDecision,
    actionsForTesting: actionsMod.__for_testing,
    automodEngine: engineMod.automodEngine,
    makeMockMessage: mocksMod.makeMockMessage,
    counter,
    llmCompleteSpy,
  };
}

describe('graduated profanity flow (Phase 11.2 / A6)', () => {
  let store: Store;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await mkTmpDir('grad-prof');
    cleanup = tmp.cleanup;
    store = new Store({ dataDir: tmp.dir, snapshotIntervalMs: NEVER, fsync: false });
    await store.init();
  });

  afterEach(async () => {
    vi.doUnmock('../../src/modules/llm/index.js');
    vi.restoreAllMocks();
    await store.shutdown();
    await cleanup();
  });

  it('count=1 → gentle nudge, no delete, no log', async () => {
    const { applyDecision, automodEngine, makeMockMessage, llmCompleteSpy } = await loadWithLlmMock(
      store,
      TEST_CONFIG,
      () =>
        Promise.resolve({
          text: 'Aki nghe rồi đó tiền bối ٩(◕‿◕)۶ Kiềm chế chút nha.',
          tokensIn: 50,
          tokensOut: 15,
          costUsd: 0,
          provider: 'groq',
          model: 'llama-3.1-8b-instant',
          durationMs: 30,
          routeIndex: 0,
        }),
    );
    const replySpy = vi.fn().mockResolvedValue(undefined);
    const { message, spies } = makeMockMessage({ content: 'shit happens', authorId: 'u-grad-1' });
    (message as unknown as { reply: typeof replySpy }).reply = replySpy;

    const d = await automodEngine.evaluate(message);
    if (!d || d.rule.id !== 'profanity') throw new Error('expected profanity decision');
    await applyDecision(message, d);

    // Nudge path: no delete, no DM, no log, no kick/timeout.
    expect(spies.delete).not.toHaveBeenCalled();
    expect(spies.dmSend).not.toHaveBeenCalled();
    expect(spies.timeout).not.toHaveBeenCalled();
    expect(spies.kick).not.toHaveBeenCalled();
    expect(store.automodLogs.count()).toBe(0);
    // LLM was called with aki-nudge task
    expect(llmCompleteSpy).toHaveBeenCalledTimes(1);
    expect(llmCompleteSpy).toHaveBeenCalledWith('aki-nudge', expect.anything());
    expect(replySpy).toHaveBeenCalledTimes(1);
  });

  it('count=5 → stern nudge tier (severity flips, still no delete)', async () => {
    const { applyDecision, automodEngine, makeMockMessage, llmCompleteSpy, counter } =
      await loadWithLlmMock(store, TEST_CONFIG, () =>
        Promise.resolve({
          text: 'Aki đếm rồi đó (¬_¬) Dừng đi.',
          tokensIn: 50,
          tokensOut: 12,
          costUsd: 0,
          provider: 'groq',
          model: 'llama-3.1-8b-instant',
          durationMs: 30,
          routeIndex: 0,
        }),
      );

    // Pre-fill 4 hits into the FRESH counter instance so detect() bumps us to count=5.
    for (let i = 0; i < 4; i++) counter.recordHit('u-stern');
    const { message } = makeMockMessage({ content: 'shit shit', authorId: 'u-stern' });
    (message as unknown as { reply: ReturnType<typeof vi.fn> }).reply = vi
      .fn()
      .mockResolvedValue(undefined);

    const d = await automodEngine.evaluate(message);
    if (!d || d.rule.id !== 'profanity') throw new Error('expected profanity decision');
    expect(d.hit.context?.profanityCount).toBe(5);
    await applyDecision(message, d);

    expect(store.automodLogs.count()).toBe(0);
    const callArgs = llmCompleteSpy.mock.calls[0]?.[1] as { systemPrompt: string } | undefined;
    expect(callArgs?.systemPrompt).toContain('STERN');
  });

  it('count=15 → retroactive sweep + DM + log + narration', async () => {
    const { applyDecision, automodEngine, makeMockMessage, counter } = await loadWithLlmMock(
      store,
      TEST_CONFIG,
      () => Promise.resolve(null), // LLM down → narration uses static fallback
    );

    // Pre-fill 14 hits spread over the last 50s so the 60s tier window
    // sees them all (count = 14 + current = 15) but firstHitMs reaches
    // back ~50s — far enough to cover msg-old-1 (40s ago) in the sweep.
    const baseTs = Date.now();
    for (let i = 0; i < 14; i++) {
      counter.recordHit('u-tip', baseTs - 50_000 + i * 3_000);
    }
    const { message, spies } = makeMockMessage({ content: 'shit again', authorId: 'u-tip' });

    // Inject a stub channel with messages.fetch + bulkDelete for the sweep.
    const fetchedMessages = new Map<string, unknown>([
      [
        'msg-old-1',
        {
          id: 'msg-old-1',
          author: { id: 'u-tip' },
          createdTimestamp: baseTs - 40_000, // 40s ago → inside sweep cutoff (firstHitMs ≈ 50s ago)
          deletable: true,
        },
      ],
      [
        'msg-other',
        {
          id: 'msg-other',
          author: { id: 'someone-else' },
          createdTimestamp: baseTs - 30_000,
          deletable: true,
        },
      ],
      [
        'msg-too-old',
        {
          id: 'msg-too-old',
          author: { id: 'u-tip' },
          createdTimestamp: baseTs - 30 * 60_000, // 30 min ago → past 15min sweep cap
          deletable: true,
        },
      ],
      [
        'msg-current',
        {
          id: 'msg-test-1',
          author: { id: 'u-tip' },
          createdTimestamp: baseTs,
          deletable: true,
        },
      ],
    ]);
    const fetchSpy = vi.fn().mockResolvedValue(fetchedMessages);
    const bulkDeleteSpy = vi.fn().mockResolvedValue(undefined);
    (message as unknown as { channel: unknown }).channel = {
      messages: { fetch: fetchSpy },
      bulkDelete: bulkDeleteSpy,
      send: vi.fn().mockResolvedValue(undefined),
    };

    const d = await automodEngine.evaluate(message);
    if (!d || d.rule.id !== 'profanity') throw new Error('expected profanity decision');
    expect(d.hit.context?.profanityCount).toBe(15);
    await applyDecision(message, d);

    // Sweep ran instead of single tryDelete on message.delete().
    expect(spies.delete).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith({ limit: 100 });
    expect(bulkDeleteSpy).toHaveBeenCalledTimes(1);
    // Should bulk delete 2 messages from u-tip within sweep window
    // (msg-old-1 + msg-current). msg-too-old (30min) and msg-other
    // (different user) are excluded.
    const deletedArg = bulkDeleteSpy.mock.calls[0]?.[0] as Array<{ id: string }>;
    const deletedIds = deletedArg.map((m) => m.id).sort();
    expect(deletedIds).toEqual(['msg-old-1', 'msg-test-1']);

    expect(spies.dmSend).toHaveBeenCalledTimes(1);
    expect(store.automodLogs.count()).toBe(1);
    const log = store.automodLogs.recent(1)[0];
    expect(log?.rule).toBe('profanity');
    expect(log?.action).toBe('warn');
  });

  it('30s nudge cooldown skips back-to-back LLM calls', async () => {
    const { applyDecision, automodEngine, makeMockMessage, actionsForTesting, llmCompleteSpy } =
      await loadWithLlmMock(store, TEST_CONFIG, () =>
        Promise.resolve({
          text: 'Kiềm chế nha đạo hữu (◕‿◕)',
          tokensIn: 30,
          tokensOut: 10,
          costUsd: 0,
          provider: 'groq',
          model: 'llama-3.1-8b-instant',
          durationMs: 20,
          routeIndex: 0,
        }),
      );

    actionsForTesting.lastNudgeAt.clear();

    // 1st profanity hit → nudge fires
    {
      const { message } = makeMockMessage({ content: 'shit', authorId: 'u-cool' });
      (message as unknown as { reply: ReturnType<typeof vi.fn> }).reply = vi
        .fn()
        .mockResolvedValue(undefined);
      const d = await automodEngine.evaluate(message);
      if (!d) throw new Error('expected decision');
      await applyDecision(message, d);
    }

    // 2nd hit immediately after → cooldown active, no LLM call
    {
      const { message } = makeMockMessage({ content: 'fuck', authorId: 'u-cool' });
      (message as unknown as { reply: ReturnType<typeof vi.fn> }).reply = vi
        .fn()
        .mockResolvedValue(undefined);
      const d = await automodEngine.evaluate(message);
      if (!d) throw new Error('expected decision');
      await applyDecision(message, d);
    }

    expect(llmCompleteSpy).toHaveBeenCalledTimes(1);
  });

  it('LLM null in nudge tier → silent skip (no reply)', async () => {
    const { applyDecision, automodEngine, makeMockMessage } = await loadWithLlmMock(
      store,
      TEST_CONFIG,
      () => Promise.resolve(null),
    );
    const replySpy = vi.fn().mockResolvedValue(undefined);
    const { message } = makeMockMessage({ content: 'shit', authorId: 'u-silent' });
    (message as unknown as { reply: typeof replySpy }).reply = replySpy;

    const d = await automodEngine.evaluate(message);
    if (!d) throw new Error('expected decision');
    await applyDecision(message, d);

    expect(replySpy).not.toHaveBeenCalled();
    expect(store.automodLogs.count()).toBe(0);
  });

  it('staff at count=15+ stays in nudge tier (never deleted)', async () => {
    const { applyDecision, automodEngine, makeMockMessage, counter } = await loadWithLlmMock(
      store,
      TEST_CONFIG,
      () =>
        Promise.resolve({
          text: 'Tông Chủ ơi đệ tử mạn phép nhắc (◕‿◕) Lời lẽ kiềm chế chút.',
          tokensIn: 50,
          tokensOut: 15,
          costUsd: 0,
          provider: 'groq',
          model: 'llama-3.1-8b-instant',
          durationMs: 30,
          routeIndex: 0,
        }),
    );

    // Pre-fill 20 hits — well past the 15-count delete threshold.
    for (let i = 0; i < 20; i++) counter.recordHit('u-staff');
    const { message, spies } = makeMockMessage({ content: 'shit staff', authorId: 'u-staff' });
    // Inject staff role on the mock member.
    (message as unknown as { member: { roles: { cache: Map<string, { name: string }> } } }).member =
      {
        ...(message.member ?? {}),
        roles: { cache: new Map([['role-cm', { name: 'Chưởng Môn' }]]) },
      } as never;
    (message as unknown as { reply: ReturnType<typeof vi.fn> }).reply = vi
      .fn()
      .mockResolvedValue(undefined);

    const d = await automodEngine.evaluate(message);
    if (!d || d.rule.id !== 'profanity') throw new Error('expected profanity decision');
    expect(d.hit.context?.profanityCount).toBe(21);
    await applyDecision(message, d);

    // Staff path: no delete, no DM, no log, no Thiên Đạo. Just nudge.
    expect(spies.delete).not.toHaveBeenCalled();
    expect(spies.dmSend).not.toHaveBeenCalled();
    expect(store.automodLogs.count()).toBe(0);
  });
});
