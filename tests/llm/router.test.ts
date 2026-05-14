import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Router unit tests. Mocks `src/modules/llm/providers/groq.ts` and
 * `src/modules/llm/providers/gemini.ts` via vi.doMock + dynamic
 * re-import so we can drive both primary and fallback paths
 * deterministically without hitting real APIs.
 */

type RouterModule = typeof import('../../src/modules/llm/router.js');

interface ProviderStub {
  name: 'groq' | 'gemini';
  isEnabled: ReturnType<typeof vi.fn>;
  complete: ReturnType<typeof vi.fn>;
}

async function loadRouterWith(opts: {
  groq?: (types: typeof import('../../src/modules/llm/types.js')) => Partial<ProviderStub>;
  gemini?: (types: typeof import('../../src/modules/llm/types.js')) => Partial<ProviderStub>;
}): Promise<{
  router: RouterModule;
  types: typeof import('../../src/modules/llm/types.js');
}> {
  vi.resetModules();

  // Provider stubs are built lazily AFTER reset so the LlmRateLimitError /
  // LlmProviderError instances they throw come from the same `types.js`
  // module instance the router resolves (instanceof needs identity).
  const types = await import('../../src/modules/llm/types.js');

  const groqOverride = opts.groq?.(types) ?? {};
  const geminiOverride = opts.gemini?.(types) ?? {};

  const makeStub = (name: 'groq' | 'gemini', override: Partial<ProviderStub>): ProviderStub => ({
    name,
    isEnabled: override.isEnabled ?? vi.fn().mockReturnValue(true),
    complete:
      override.complete ??
      vi.fn().mockResolvedValue({
        text: '{"legit": true, "response": null}',
        tokensIn: 100,
        tokensOut: 10,
        costUsd: 0,
        provider: name,
        model: 'stub-model',
        durationMs: 50,
      }),
  });

  vi.doMock('../../src/modules/llm/providers/groq.js', () => ({
    groqProvider: makeStub('groq', groqOverride),
  }));
  vi.doMock('../../src/modules/llm/providers/gemini.js', () => ({
    geminiProvider: makeStub('gemini', geminiOverride),
  }));

  const router = await import('../../src/modules/llm/router.js');
  return { router, types };
}

describe('LLM router', () => {
  afterEach(() => {
    vi.doUnmock('../../src/modules/llm/providers/groq.js');
    vi.doUnmock('../../src/modules/llm/providers/gemini.js');
    vi.restoreAllMocks();
  });

  describe('happy path', () => {
    it('uses primary provider when enabled and not throttled', async () => {
      const { router } = await loadRouterWith({});
      router.__for_testing.throttledUntil.clear();

      const result = await router.complete('aki-filter', {
        systemPrompt: 'sys',
        userPrompt: 'usr',
      });

      expect(result).not.toBeNull();
      expect(result?.provider).toBe('groq');
      expect(result?.routePosition).toBe('primary');
    });

    it('passes the correct model from TASK_ROUTES to primary provider', async () => {
      const completeSpy = vi.fn().mockResolvedValue({
        text: '{}',
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        durationMs: 0,
      });
      const { router } = await loadRouterWith({ groq: () => ({ complete: completeSpy }) });
      router.__for_testing.throttledUntil.clear();

      await router.complete('narration', { systemPrompt: 's', userPrompt: 'u' });

      expect(completeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'llama-3.3-70b-versatile' }),
      );
    });
  });

  describe('failover', () => {
    it('falls back to gemini when groq throws LlmProviderError', async () => {
      const { router } = await loadRouterWith({
        groq: (types) => ({
          complete: vi.fn().mockRejectedValue(new types.LlmProviderError('boom')),
        }),
      });
      router.__for_testing.throttledUntil.clear();

      const result = await router.complete('aki-filter', { systemPrompt: 's', userPrompt: 'u' });
      expect(result?.provider).toBe('gemini');
      expect(result?.routePosition).toBe('fallback');
    });

    it('throttles primary on 429 and uses fallback', async () => {
      const { router } = await loadRouterWith({
        groq: (types) => ({
          complete: vi.fn().mockRejectedValue(new types.LlmRateLimitError('429', 60_000)),
        }),
      });
      router.__for_testing.throttledUntil.clear();

      const result = await router.complete('aki-filter', { systemPrompt: 's', userPrompt: 'u' });
      expect(result?.provider).toBe('gemini');
      expect(router.__for_testing.throttledUntil.has('groq')).toBe(true);
    });

    it('skips throttled primary on subsequent calls until window expires', async () => {
      const groqComplete = vi.fn();
      const { router } = await loadRouterWith({
        groq: () => ({ complete: groqComplete }),
      });
      router.__for_testing.throttledUntil.set('groq', Date.now() + 60_000);

      const result = await router.complete('aki-filter', { systemPrompt: 's', userPrompt: 'u' });
      expect(result?.provider).toBe('gemini');
      expect(groqComplete).not.toHaveBeenCalled();
    });

    it('returns null when both providers disabled', async () => {
      const { router } = await loadRouterWith({
        groq: () => ({ isEnabled: vi.fn().mockReturnValue(false) }),
        gemini: () => ({ isEnabled: vi.fn().mockReturnValue(false) }),
      });
      router.__for_testing.throttledUntil.clear();

      const result = await router.complete('aki-filter', { systemPrompt: 's', userPrompt: 'u' });
      expect(result).toBeNull();
    });

    it('returns null when both providers fail', async () => {
      const { router } = await loadRouterWith({
        groq: (types) => ({
          complete: vi.fn().mockRejectedValue(new types.LlmProviderError('groq down')),
        }),
        gemini: (types) => ({
          complete: vi.fn().mockRejectedValue(new types.LlmProviderError('gemini down')),
        }),
      });
      router.__for_testing.throttledUntil.clear();

      const result = await router.complete('aki-filter', { systemPrompt: 's', userPrompt: 'u' });
      expect(result).toBeNull();
    });
  });

  describe('task routes', () => {
    it('aki-filter uses llama-3.1-8b-instant (high RPD model)', async () => {
      const { router } = await loadRouterWith({});
      expect(router.__for_testing.TASK_ROUTES['aki-filter'].primary.model).toBe(
        'llama-3.1-8b-instant',
      );
    });

    it('narration uses llama-3.3-70b-versatile (prose model)', async () => {
      const { router } = await loadRouterWith({});
      expect(router.__for_testing.TASK_ROUTES.narration.primary.model).toBe(
        'llama-3.3-70b-versatile',
      );
    });

    it('aki-nudge shares 8B model with filter (cost-light task)', async () => {
      const { router } = await loadRouterWith({});
      expect(router.__for_testing.TASK_ROUTES['aki-nudge'].primary.model).toBe(
        'llama-3.1-8b-instant',
      );
    });

    it('all tasks use gemini as fallback', async () => {
      const { router } = await loadRouterWith({});
      for (const taskId of ['aki-filter', 'aki-nudge', 'narration'] as const) {
        expect(router.__for_testing.TASK_ROUTES[taskId].fallback.provider).toBe('gemini');
      }
    });
  });
});
