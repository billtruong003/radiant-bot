import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Router unit tests. Providers are mocked via vi.doMock + dynamic
 * re-import so both primary and fallback paths can be driven
 * deterministically without hitting real APIs.
 *
 * Chains are model-id strings now (the provider comes from the registry),
 * so assertions read `chain[0]` rather than `chain[0].model`.
 */

type RouterModule = typeof import('../../src/modules/llm/router.js');
type HealthModule = typeof import('../../src/modules/llm/health.js');

interface ProviderStub {
  name: 'groq' | 'gemini' | 'opencode-zen';
  isEnabled: ReturnType<typeof vi.fn>;
  complete: ReturnType<typeof vi.fn>;
}

async function loadRouterWith(opts: {
  groq?: (types: typeof import('../../src/modules/llm/types.js')) => Partial<ProviderStub>;
  gemini?: (types: typeof import('../../src/modules/llm/types.js')) => Partial<ProviderStub>;
  opencodeZen?: (types: typeof import('../../src/modules/llm/types.js')) => Partial<ProviderStub>;
}): Promise<{
  router: RouterModule;
  health: HealthModule;
  types: typeof import('../../src/modules/llm/types.js');
}> {
  vi.resetModules();

  // Stubs are built AFTER reset so the errors they throw come from the
  // same types.js instance the router resolves (instanceof needs identity).
  const types = await import('../../src/modules/llm/types.js');

  const groqOverride = opts.groq?.(types) ?? {};
  const geminiOverride = opts.gemini?.(types) ?? {};
  const opencodeZenOverride = opts.opencodeZen?.(types) ?? {
    isEnabled: vi.fn().mockReturnValue(false),
  };

  const makeStub = (
    name: 'groq' | 'gemini' | 'opencode-zen',
    override: Partial<ProviderStub>,
  ): ProviderStub => ({
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
  vi.doMock('../../src/modules/llm/providers/opencode-zen.js', () => ({
    opencodeZenProvider: makeStub('opencode-zen', opencodeZenOverride),
  }));

  const router = await import('../../src/modules/llm/router.js');
  const health = await import('../../src/modules/llm/health.js');
  health.__resetHealth();
  return { router, health, types };
}

describe('LLM router', () => {
  afterEach(() => {
    vi.doUnmock('../../src/modules/llm/providers/groq.js');
    vi.doUnmock('../../src/modules/llm/providers/gemini.js');
    vi.doUnmock('../../src/modules/llm/providers/opencode-zen.js');
    vi.restoreAllMocks();
  });

  describe('happy path', () => {
    it('uses the primary route when enabled and healthy', async () => {
      const { router } = await loadRouterWith({
        opencodeZen: () => ({ isEnabled: vi.fn().mockReturnValue(true) }),
      });

      const result = await router.complete('aki-filter', {
        systemPrompt: 'sys',
        userPrompt: 'usr',
      });

      expect(result).not.toBeNull();
      expect(result?.provider).toBe('opencode-zen');
      expect(result?.routeIndex).toBe(0);
    });

    it('passes the model id from TASK_ROUTES to the provider', async () => {
      const completeSpy = vi.fn().mockResolvedValue({
        text: 'prose',
        tokensIn: 0,
        tokensOut: 5,
        costUsd: 0,
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        durationMs: 0,
      });
      const { router } = await loadRouterWith({ groq: () => ({ complete: completeSpy }) });

      await router.complete('narration', { systemPrompt: 's', userPrompt: 'u' });

      expect(completeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'llama-3.3-70b-versatile' }),
      );
    });

    it('raises maxOutputTokens to the registry floor for reasoning models', async () => {
      const completeSpy = vi.fn().mockResolvedValue({
        text: 'ok',
        tokensIn: 1,
        tokensOut: 1,
        costUsd: 0,
        provider: 'opencode-zen',
        model: 'deepseek-v4-flash-free',
        durationMs: 1,
      });
      const { router } = await loadRouterWith({
        opencodeZen: () => ({ isEnabled: vi.fn().mockReturnValue(true), complete: completeSpy }),
      });

      // deepseek-v4-flash-free leads this chain and carries a 3000 floor:
      // under-funded, it spends the whole allowance on hidden reasoning
      // and returns an empty string.
      await router.complete('aki-answer-general', {
        systemPrompt: 's',
        userPrompt: 'u',
        maxOutputTokens: 200,
      });

      expect(completeSpy).toHaveBeenCalledWith(expect.objectContaining({ maxOutputTokens: 3000 }));
    });
  });

  describe('failover', () => {
    it('falls through to the next free route on a provider error', async () => {
      const { router } = await loadRouterWith({
        opencodeZen: (types) => ({
          isEnabled: vi.fn().mockReturnValue(true),
          complete: vi.fn().mockRejectedValue(new types.LlmProviderError('boom')),
        }),
      });

      const result = await router.complete('aki-filter', { systemPrompt: 's', userPrompt: 'u' });
      expect(result?.provider).toBe('gemini');
      expect(result?.routeIndex).toBeGreaterThan(0);
    });

    it('treats an empty completion as a failure and advances', async () => {
      const empty = vi.fn().mockResolvedValue({
        text: '   ',
        tokensIn: 10,
        tokensOut: 600,
        costUsd: 0,
        provider: 'opencode-zen',
        model: 'mimo-v2.5-free',
        durationMs: 900,
      });
      const { router } = await loadRouterWith({
        opencodeZen: () => ({ isEnabled: vi.fn().mockReturnValue(true), complete: empty }),
      });

      const result = await router.complete('aki-filter', { systemPrompt: 's', userPrompt: 'u' });
      expect(result?.provider).toBe('gemini');
    });

    it('records a rate-limited model as unhealthy', async () => {
      const { router, health } = await loadRouterWith({
        opencodeZen: (types) => ({
          isEnabled: vi.fn().mockReturnValue(true),
          complete: vi.fn().mockRejectedValue(new types.LlmRateLimitError('429', 60_000)),
        }),
      });

      await router.complete('aki-filter', { systemPrompt: 's', userPrompt: 'u' });

      const cooling = health
        .snapshot()
        .filter((h) => !h.healthy)
        .map((h) => h.modelId);
      expect(cooling).toContain('mimo-v2.5-free');
    });

    it('skips models whose circuit is open', async () => {
      const zenComplete = vi.fn();
      const { router, health } = await loadRouterWith({
        opencodeZen: () => ({ isEnabled: vi.fn().mockReturnValue(true), complete: zenComplete }),
      });

      // Two consecutive failures = breaker open (threshold is 2).
      for (const model of ['mimo-v2.5-free', 'ling-3.0-tiny-free']) {
        health.recordFailure(model, 'rate_limit', 60_000);
        health.recordFailure(model, 'rate_limit', 60_000);
      }

      const result = await router.complete('aki-filter', { systemPrompt: 's', userPrompt: 'u' });
      expect(result?.provider).toBe('gemini');
      expect(zenComplete).not.toHaveBeenCalled();
    });

    it('returns null when every provider is disabled — never a paid rescue', async () => {
      const { router } = await loadRouterWith({
        groq: () => ({ isEnabled: vi.fn().mockReturnValue(false) }),
        gemini: () => ({ isEnabled: vi.fn().mockReturnValue(false) }),
        opencodeZen: () => ({ isEnabled: vi.fn().mockReturnValue(false) }),
      });

      const result = await router.complete('aki-filter', { systemPrompt: 's', userPrompt: 'u' });
      expect(result).toBeNull();
    });

    it('returns null when every provider fails', async () => {
      const { router } = await loadRouterWith({
        groq: (types) => ({
          complete: vi.fn().mockRejectedValue(new types.LlmProviderError('groq down')),
        }),
        gemini: (types) => ({
          complete: vi.fn().mockRejectedValue(new types.LlmProviderError('gemini down')),
        }),
        opencodeZen: (types) => ({
          isEnabled: vi.fn().mockReturnValue(true),
          complete: vi.fn().mockRejectedValue(new types.LlmProviderError('zen down')),
        }),
      });

      const result = await router.complete('aki-filter', { systemPrompt: 's', userPrompt: 'u' });
      expect(result).toBeNull();
    });
  });

  describe('task routes', () => {
    it('every model in every chain is production-eligible (zero cost)', async () => {
      const { router } = await loadRouterWith({});
      const { isProductionEligible } = await import('../../src/modules/llm/registry.js');
      for (const [task, chain] of Object.entries(router.TASK_ROUTES)) {
        for (const modelId of chain) {
          expect(isProductionEligible(modelId), `${task} routes to non-free ${modelId}`).toBe(true);
        }
      }
    });

    it('contains no retired model aliases', async () => {
      const { router } = await loadRouterWith({});
      // Each of these 404/401'd against its live gateway on 2026-08-13.
      const retired = [
        'ling-3.0-flash-free',
        'north-mini-code-free',
        'meta-llama/llama-4-scout-17b-16e-instruct',
        'qwen/qwen3-32b',
      ];
      const all = Object.values(router.TASK_ROUTES).flat();
      for (const dead of retired) {
        expect(all, `a chain still routes to retired ${dead}`).not.toContain(dead);
      }
    });

    it('vision routes ONLY to models that accept image parts', async () => {
      const { router } = await loadRouterWith({});
      const { getModelConfig } = await import('../../src/modules/llm/registry.js');
      const chain = router.TASK_ROUTES['aki-answer-vision'];
      expect(chain.length).toBeGreaterThan(0);
      for (const modelId of chain) {
        expect(getModelConfig(modelId)?.supportsVision, `${modelId} cannot see images`).toBe(true);
      }
    });

    it('narration leads with a non-reasoning model (tight prose budget)', async () => {
      // A reasoning model here spends the budget on hidden chain-of-thought
      // and ships empty narration — observed in prod 2026-05-14.
      const { router } = await loadRouterWith({});
      expect(router.TASK_ROUTES.narration[0]).toBe('llama-3.3-70b-versatile');
    });

    it('guardian judge and review lead with DIFFERENT models', async () => {
      // Asking one model to review its own verdict just returns the same
      // answer with more confidence.
      const { router } = await loadRouterWith({});
      expect(router.TASK_ROUTES['guardian-judge'][0]).not.toBe(
        router.TASK_ROUTES['guardian-review'][0],
      );
    });

    it('aki-filter keeps 2 gemini tail routes for quota rotation', async () => {
      const { router } = await loadRouterWith({});
      const { getModelConfig } = await import('../../src/modules/llm/registry.js');
      const gemini = router.TASK_ROUTES['aki-filter'].filter(
        (m) => getModelConfig(m)?.provider === 'gemini',
      );
      expect(gemini.length).toBeGreaterThanOrEqual(2);
    });

    it('every answer chain has a fallback beyond its primary', async () => {
      const { router } = await loadRouterWith({});
      for (const [task, chain] of Object.entries(router.TASK_ROUTES)) {
        // Vision is legitimately a chain of one: only MiMo can see.
        if (task === 'aki-answer-vision') continue;
        expect(chain.length, `${task} has no fallback`).toBeGreaterThan(1);
      }
    });
  });
});
