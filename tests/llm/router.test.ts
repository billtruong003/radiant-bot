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
      expect(result?.routeIndex).toBe(0);
    });

    it('passes the correct model from TASK_ROUTES to primary provider', async () => {
      const completeSpy = vi.fn().mockResolvedValue({
        text: '{}',
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        provider: 'groq',
        model: 'qwen/qwen3-32b',
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
      expect(result?.routeIndex).toBeGreaterThan(0);
    });

    it('throttles route on 429 and uses fallback', async () => {
      const { router } = await loadRouterWith({
        groq: (types) => ({
          complete: vi.fn().mockRejectedValue(new types.LlmRateLimitError('429', 60_000)),
        }),
      });
      router.__for_testing.throttledUntil.clear();

      const result = await router.complete('aki-filter', { systemPrompt: 's', userPrompt: 'u' });
      expect(result?.provider).toBe('gemini');
      // Throttle key is now `${provider}:${model}` — verify the route is marked.
      const groqRoute = router.__for_testing.TASK_ROUTES['aki-filter'][0];
      expect(
        router.__for_testing.throttledUntil.has(`${groqRoute?.provider}:${groqRoute?.model}`),
      ).toBe(true);
    });

    it('skips all throttled groq routes and lands on gemini', async () => {
      const groqComplete = vi.fn();
      const { router } = await loadRouterWith({
        groq: () => ({ complete: groqComplete }),
      });
      // aki-filter now has 2 groq routes (70B + 8B). Throttle both so
      // the chain falls through to the first gemini route.
      const chain = router.__for_testing.TASK_ROUTES['aki-filter'];
      for (const route of chain) {
        if (route.provider === 'groq') {
          router.__for_testing.throttledUntil.set(
            `${route.provider}:${route.model}`,
            Date.now() + 60_000,
          );
        }
      }

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
    it('aki-filter primary (index 0) = groq qwen3-32b (best VN classification)', async () => {
      const { router } = await loadRouterWith({});
      const chain = router.__for_testing.TASK_ROUTES['aki-filter'];
      expect(chain[0]?.provider).toBe('groq');
      expect(chain[0]?.model).toBe('qwen/qwen3-32b');
    });

    it('aki-filter chain has llama-3.3-70b + 8B + scout as groq fallbacks', async () => {
      const { router } = await loadRouterWith({});
      const groqModels = router.__for_testing.TASK_ROUTES['aki-filter']
        .filter((r) => r.provider === 'groq')
        .map((r) => r.model);
      expect(groqModels).toContain('llama-3.3-70b-versatile');
      expect(groqModels).toContain('llama-3.1-8b-instant');
      expect(groqModels).toContain('meta-llama/llama-4-scout-17b-16e-instruct');
    });

    it('narration primary (index 0) = Llama 3.3 70B (non-reasoning prose)', async () => {
      // Qwen 3 32B was primary briefly but emitted <think> chain-of-thought
      // even with reasoning_format=hidden, truncating prod narration on
      // 2026-05-14. Swapped to Llama 3.3 70B which has no reasoning step.
      const { router } = await loadRouterWith({});
      const chain = router.__for_testing.TASK_ROUTES.narration;
      expect(chain[0]?.provider).toBe('groq');
      expect(chain[0]?.model).toBe('llama-3.3-70b-versatile');
      // Qwen still in chain as a fallback for diversity.
      const allModels = chain.map((r) => r.model);
      expect(allModels).toContain('qwen/qwen3-32b');
    });

    it('narration chain includes gpt-oss-120b (biggest model)', async () => {
      const { router } = await loadRouterWith({});
      const models = router.__for_testing.TASK_ROUTES.narration.map((r) => r.model);
      expect(models).toContain('openai/gpt-oss-120b');
    });

    it('aki-nudge primary shares 8B model with filter (cost-light task)', async () => {
      const { router } = await loadRouterWith({});
      const chain = router.__for_testing.TASK_ROUTES['aki-nudge'];
      expect(chain[0]?.model).toBe('llama-3.1-8b-instant');
    });

    it('all tasks have at least one gemini fallback', async () => {
      const { router } = await loadRouterWith({});
      for (const taskId of ['aki-filter', 'aki-nudge', 'narration'] as const) {
        const chain = router.__for_testing.TASK_ROUTES[taskId];
        const hasGemini = chain.some((r) => r.provider === 'gemini');
        expect(hasGemini).toBe(true);
      }
    });

    it('aki-filter has ≥4 routes (groq 70B+8B + multi-model gemini rotation)', async () => {
      const { router } = await loadRouterWith({});
      expect(router.__for_testing.TASK_ROUTES['aki-filter'].length).toBeGreaterThanOrEqual(4);
    });

    it('narration prioritises 2.5-flash over flash-lite for prose quality', async () => {
      const { router } = await loadRouterWith({});
      const chain = router.__for_testing.TASK_ROUTES.narration;
      const flashIdx = chain.findIndex((r) => r.model === 'gemini-2.5-flash');
      const liteIdx = chain.findIndex((r) => r.model === 'gemini-2.5-flash-lite');
      expect(flashIdx).toBeGreaterThanOrEqual(0);
      expect(liteIdx).toBeGreaterThanOrEqual(0);
      expect(flashIdx).toBeLessThan(liteIdx);
    });
  });

  describe('multi-model gemini rotation', () => {
    it('throttles first gemini model and rotates to next', async () => {
      const geminiComplete = vi.fn().mockResolvedValue({
        text: '{"legit": true}',
        tokensIn: 50,
        tokensOut: 5,
        costUsd: 0,
        provider: 'gemini',
        model: 'rotated',
        durationMs: 100,
      });
      const { router } = await loadRouterWith({
        groq: () => ({ isEnabled: vi.fn().mockReturnValue(false) }),
        gemini: () => ({ complete: geminiComplete }),
      });
      // Disable all groq routes (already disabled above), throttle the
      // first gemini route in the chain. Router must rotate to next gemini.
      router.__for_testing.throttledUntil.clear();
      const chain = router.__for_testing.TASK_ROUTES['aki-filter'];
      const geminiRoutes = chain.filter((r) => r.provider === 'gemini');
      expect(geminiRoutes.length).toBeGreaterThanOrEqual(2);
      const firstGemini = geminiRoutes[0];
      const secondGemini = geminiRoutes[1];
      router.__for_testing.throttledUntil.set(
        `${firstGemini?.provider}:${firstGemini?.model}`,
        Date.now() + 60_000,
      );

      const result = await router.complete('aki-filter', { systemPrompt: 's', userPrompt: 'u' });
      expect(result?.provider).toBe('gemini');
      // Should have called with the SECOND gemini model (first throttled)
      expect(geminiComplete).toHaveBeenCalledWith(
        expect.objectContaining({ model: secondGemini?.model }),
      );
    });
  });
});
