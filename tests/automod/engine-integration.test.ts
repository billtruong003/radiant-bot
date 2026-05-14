import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AutomodConfig, __setAutomodConfigForTesting } from '../../src/config/automod.js';
import { __setStoreForTesting } from '../../src/db/index.js';
import { Store } from '../../src/db/store.js';
import { __for_testing as actionsForTesting } from '../../src/modules/automod/actions.js';
import { applyDecision, automodEngine } from '../../src/modules/automod/index.js';
import * as profanityCounter from '../../src/modules/automod/profanity-counter.js';
import { spamTracker } from '../../src/modules/automod/rules/spam-detection.js';
import { mkTmpDir } from '../helpers/tmp-dir.js';
import { makeMockMessage } from './__mocks__/message.js';

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
  linkWhitelist: ['github.com', 'youtube.com'],
  profanityWords: ['fuck', 'shit', 'địt'],
};

describe('automod engine integration', () => {
  let store: Store;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await mkTmpDir('automod-int');
    cleanup = tmp.cleanup;
    store = new Store({ dataDir: tmp.dir, snapshotIntervalMs: NEVER, fsync: false });
    await store.init();
    __setStoreForTesting(store);
    __setAutomodConfigForTesting(TEST_CONFIG);
    spamTracker.reset('u1');
    spamTracker.reset('u-author');
    profanityCounter.reset();
    actionsForTesting.lastNudgeAt.clear();
  });

  afterEach(async () => {
    __setStoreForTesting(null);
    __setAutomodConfigForTesting(null);
    spamTracker.reset('u1');
    spamTracker.reset('u-author');
    profanityCounter.reset();
    actionsForTesting.lastNudgeAt.clear();
    await store.shutdown();
    await cleanup();
  });

  describe('evaluate — single-rule cases', () => {
    it('clean message → no decision', async () => {
      const { message } = makeMockMessage({ content: 'hello world, just chatting' });
      expect(await automodEngine.evaluate(message)).toBeNull();
    });

    it('profanity → decision with rule.id=profanity', async () => {
      const { message } = makeMockMessage({ content: 'this is fuck' });
      const d = await automodEngine.evaluate(message);
      expect(d?.rule.id).toBe('profanity');
      expect(d?.rule.action).toBe('warn');
      expect(d?.hit.reason).toContain('profanity match');
    });

    it('mass mention → decision with rule.id=mass_mention', async () => {
      const { message } = makeMockMessage({
        content: 'hey @a @b @c @d @e @f',
        userMentions: 6,
      });
      const d = await automodEngine.evaluate(message);
      expect(d?.rule.id).toBe('mass_mention');
      expect(d?.rule.action).toBe('timeout');
    });

    it('non-whitelisted link → decision with rule.id=link', async () => {
      const { message } = makeMockMessage({ content: 'check out evil.com/free' });
      const d = await automodEngine.evaluate(message);
      expect(d?.rule.id).toBe('link');
      expect(d?.rule.action).toBe('warn');
    });

    it('whitelisted link → no decision', async () => {
      const { message } = makeMockMessage({ content: 'check https://github.com/foo/bar' });
      expect(await automodEngine.evaluate(message)).toBeNull();
    });

    it('caps-lock → decision with rule.id=caps', async () => {
      const { message } = makeMockMessage({ content: 'STOP YELLING AT ME RIGHT NOW' });
      const d = await automodEngine.evaluate(message);
      expect(d?.rule.id).toBe('caps');
      expect(d?.rule.action).toBe('delete');
    });

    it('caps too short to trigger → no decision', async () => {
      const { message } = makeMockMessage({ content: 'OK!' });
      expect(await automodEngine.evaluate(message)).toBeNull();
    });
  });

  describe('evaluate — priority ordering', () => {
    it('profanity (sev 2) wins over caps (sev 1) in the same message', async () => {
      // All caps + profanity: profanity (sev 2) should fire first.
      const { message } = makeMockMessage({
        content: 'WHAT THE FUCK IS GOING ON HERE',
      });
      const d = await automodEngine.evaluate(message);
      expect(d?.rule.id).toBe('profanity');
    });

    it('mass mention (sev 3) wins over profanity (sev 2)', async () => {
      const { message } = makeMockMessage({
        content: 'hey @a @b @c @d @e @f shit',
        userMentions: 6,
      });
      const d = await automodEngine.evaluate(message);
      expect(d?.rule.id).toBe('mass_mention');
    });
  });

  describe('evaluate — spam tracker', () => {
    it('5th duplicate within window → spam fires', async () => {
      let last: Awaited<ReturnType<typeof automodEngine.evaluate>> = null;
      for (let i = 0; i < 5; i++) {
        const { message } = makeMockMessage({
          authorId: 'u-spammer',
          content: 'buy crypto now',
        });
        last = await automodEngine.evaluate(message);
      }
      expect(last?.rule.id).toBe('spam');
      expect(last?.rule.action).toBe('timeout');
    });

    it('4 dupes only → no spam fire (under threshold)', async () => {
      let last: Awaited<ReturnType<typeof automodEngine.evaluate>> = null;
      for (let i = 0; i < 4; i++) {
        const { message } = makeMockMessage({
          authorId: 'u-spammer-2',
          content: 'this is fine content',
        });
        last = await automodEngine.evaluate(message);
      }
      expect(last).toBeNull();
    });
  });

  describe('applyDecision — side effects', () => {
    it('action=delete: msg.delete() called, log appended, no kick/timeout', async () => {
      const { message, spies } = makeMockMessage({
        content: 'STOP YELLING AT ME RIGHT NOW',
      });
      const d = await automodEngine.evaluate(message);
      if (!d) throw new Error('expected decision');
      await applyDecision(message, d);

      expect(spies.delete).toHaveBeenCalledTimes(1);
      expect(spies.timeout).not.toHaveBeenCalled();
      expect(spies.kick).not.toHaveBeenCalled();
      expect(store.automodLogs.count()).toBe(1);
      const log = store.automodLogs.recent(1)[0];
      expect(log?.rule).toBe('caps');
      expect(log?.action).toBe('delete');
    });

    it('action=warn: msg.delete + DM warn sent (link rule)', async () => {
      // Link-whitelist rule is also action=warn but skips the Phase 11.2
      // graduated profanity branch, so it cleanly exercises the warn
      // side effects without needing 15 prior hits in the counter.
      const { message, spies } = makeMockMessage({ content: 'check out evil.com/free' });
      const d = await automodEngine.evaluate(message);
      if (!d) throw new Error('expected decision');
      expect(d.rule.id).toBe('link');
      await applyDecision(message, d);

      expect(spies.delete).toHaveBeenCalledTimes(1);
      expect(spies.dmSend).toHaveBeenCalledTimes(1);
      expect(spies.timeout).not.toHaveBeenCalled();
      expect(store.automodLogs.count()).toBe(1);
    });

    it('action=timeout: msg.delete + member.timeout(ms) called', async () => {
      const { message, spies } = makeMockMessage({
        content: 'hey @a @b @c @d @e @f',
        userMentions: 6,
      });
      const d = await automodEngine.evaluate(message);
      if (!d) throw new Error('expected decision');
      await applyDecision(message, d);

      expect(spies.delete).toHaveBeenCalledTimes(1);
      expect(spies.timeout).toHaveBeenCalledTimes(1);
      // First arg of timeout is the duration in ms.
      const [duration] = spies.timeout.mock.calls[0] ?? [];
      expect(duration).toBe(TEST_CONFIG.thresholds.timeoutDurationMs);
    });

    it('automodLog context preserves rule hit context + message metadata', async () => {
      const { message } = makeMockMessage({ content: 'check out evil.com/click' });
      const d = await automodEngine.evaluate(message);
      if (!d) throw new Error('expected decision');
      await applyDecision(message, d);

      const log = store.automodLogs.recent(1)[0];
      expect(log?.context).toMatchObject({
        hosts: ['evil.com'],
        reason: expect.stringContaining('non-whitelisted'),
        message_id: 'msg-test-1',
        channel_id: 'channel-test',
      });
    });
  });
});
