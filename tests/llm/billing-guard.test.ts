import { describe, expect, it, vi } from 'vitest';
import {
  FREE_PRODUCTION_MODELS,
  MODEL_REGISTRY,
  PaidModelBlockedError,
  assertModelAllowedForProduction,
  auditModelRegistry,
  getModelConfig,
  isProductionEligible,
} from '../../src/modules/llm/registry.js';

/**
 * THE critical tests. Radiant's AI runtime is contractually zero-cost;
 * these are the assertions that keep it that way when someone edits a
 * routing array six months from now without reading the doc comment.
 *
 * If any test in this file fails, production can spend money.
 */

describe('billing guard', () => {
  describe('assertModelAllowedForProduction', () => {
    it('allows a registered, enabled, free model', () => {
      expect(() => assertModelAllowedForProduction('mimo-v2.5-free')).not.toThrow();
    });

    it('BLOCKS a paid model', () => {
      // The paid twin of a free SKU on the same gateway — the exact
      // mistake a careless copy-paste would make.
      expect(() => assertModelAllowedForProduction('deepseek-v4-flash')).toThrow(
        PaidModelBlockedError,
      );
    });

    it('BLOCKS an unknown-cost model', () => {
      // big-pickle has no `-free` marker and the gateway exposes no
      // pricing metadata, so its cost could not be established.
      expect(() => assertModelAllowedForProduction('big-pickle')).toThrow(PaidModelBlockedError);
    });

    it('BLOCKS an unregistered model (fail closed, not fail open)', () => {
      expect(() => assertModelAllowedForProduction('gpt-5.5-pro')).toThrow(PaidModelBlockedError);
      expect(() => assertModelAllowedForProduction('claude-opus-5')).toThrow(PaidModelBlockedError);
      expect(() => assertModelAllowedForProduction('totally-made-up')).toThrow(
        PaidModelBlockedError,
      );
    });

    it('BLOCKS a free-but-disabled model', () => {
      const disabled = MODEL_REGISTRY.find((m) => m.billing === 'free' && !m.enabled);
      if (disabled) {
        expect(() => assertModelAllowedForProduction(disabled.id)).toThrow(PaidModelBlockedError);
      }
      // No such model configured today — the assertion above is the guard
      // for when one is added.
      expect(true).toBe(true);
    });

    it('never infers billing from the model NAME', () => {
      // A name ending in `-free` grants nothing on its own: eligibility
      // comes from the registry entry, which requires evidence.
      const fake = 'definitely-not-real-free';
      expect(isProductionEligible(fake)).toBe(false);
      expect(() => assertModelAllowedForProduction(fake)).toThrow(PaidModelBlockedError);
    });
  });

  describe('registry integrity', () => {
    it('every entry carries billing evidence', () => {
      for (const m of MODEL_REGISTRY) {
        expect(m.billingEvidence.length, `${m.id} has no billing evidence`).toBeGreaterThan(20);
      }
    });

    it('the allowlist contains only enabled free models', () => {
      for (const id of FREE_PRODUCTION_MODELS) {
        const cfg = getModelConfig(id);
        expect(cfg?.billing).toBe('free');
        expect(cfg?.enabled).toBe(true);
      }
    });

    it('no duplicate model ids', () => {
      const ids = MODEL_REGISTRY.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('audit accounts for every registered model exactly once', () => {
      const a = auditModelRegistry();
      const total =
        a.freeEnabled.length +
        a.paidBlocked.length +
        a.unknownBlocked.length +
        a.disabledBlocked.length;
      expect(total).toBe(MODEL_REGISTRY.length);
    });
  });

  describe('router cannot execute a non-free model', () => {
    it('does not fall back to a paid model when the whole free pool fails', async () => {
      vi.resetModules();
      const types = await import('../../src/modules/llm/types.js');

      // Every provider is up but every call fails. If any paid escalation
      // existed anywhere, this is where it would fire.
      const failing = (name: 'groq' | 'gemini' | 'opencode-zen') => ({
        name,
        isEnabled: vi.fn().mockReturnValue(true),
        complete: vi.fn().mockRejectedValue(new types.LlmProviderError(`${name} down`)),
      });

      vi.doMock('../../src/modules/llm/providers/groq.js', () => ({
        groqProvider: failing('groq'),
      }));
      vi.doMock('../../src/modules/llm/providers/gemini.js', () => ({
        geminiProvider: failing('gemini'),
      }));
      vi.doMock('../../src/modules/llm/providers/opencode-zen.js', () => ({
        opencodeZenProvider: failing('opencode-zen'),
      }));

      const router = await import('../../src/modules/llm/router.js');
      const health = await import('../../src/modules/llm/health.js');
      health.__resetHealth();

      // Exhausting the free pool must DEGRADE (null), never escalate.
      for (const task of Object.keys(router.TASK_ROUTES) as Array<
        keyof typeof router.TASK_ROUTES
      >) {
        const result = await router.complete(task, { systemPrompt: 's', userPrompt: 'u' });
        expect(result, `${task} produced a result from a failing free pool`).toBeNull();
      }

      vi.doUnmock('../../src/modules/llm/providers/groq.js');
      vi.doUnmock('../../src/modules/llm/providers/gemini.js');
      vi.doUnmock('../../src/modules/llm/providers/opencode-zen.js');
    });

    it('an invalid routing config cannot bypass the guard', async () => {
      vi.resetModules();
      const called: string[] = [];

      const spy = (name: 'groq' | 'gemini' | 'opencode-zen') => ({
        name,
        isEnabled: vi.fn().mockReturnValue(true),
        complete: vi.fn().mockImplementation((input: { model: string }) => {
          called.push(input.model);
          return Promise.resolve({
            text: 'ok',
            tokensIn: 1,
            tokensOut: 1,
            costUsd: 0,
            provider: name,
            model: input.model,
            durationMs: 1,
          });
        }),
      });

      vi.doMock('../../src/modules/llm/providers/groq.js', () => ({ groqProvider: spy('groq') }));
      vi.doMock('../../src/modules/llm/providers/gemini.js', () => ({
        geminiProvider: spy('gemini'),
      }));
      vi.doMock('../../src/modules/llm/providers/opencode-zen.js', () => ({
        opencodeZenProvider: spy('opencode-zen'),
      }));

      const router = await import('../../src/modules/llm/router.js');
      const health = await import('../../src/modules/llm/health.js');
      health.__resetHealth();

      // Simulate the careless edit: splice a paid model into a live chain.
      const chain = router.TASK_ROUTES['aki-answer-general'] as unknown as string[];
      const original = [...chain];
      chain.unshift('deepseek-v4-flash'); // paid twin
      chain.unshift('claude-opus-5'); // unregistered

      const result = await router.complete('aki-answer-general', {
        systemPrompt: 's',
        userPrompt: 'u',
      });

      // The request still succeeds — from the free pool.
      expect(result).not.toBeNull();
      // And neither non-free model was ever handed to a provider.
      expect(called).not.toContain('deepseek-v4-flash');
      expect(called).not.toContain('claude-opus-5');

      chain.splice(0, chain.length, ...original);
      vi.doUnmock('../../src/modules/llm/providers/groq.js');
      vi.doUnmock('../../src/modules/llm/providers/gemini.js');
      vi.doUnmock('../../src/modules/llm/providers/opencode-zen.js');
    });
  });
});
