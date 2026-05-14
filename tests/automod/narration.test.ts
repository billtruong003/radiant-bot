import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Phase 11.2 / A6b — Thiên Đạo narration unit tests. We mock
 * `llm.complete` so we can drive happy + degraded paths without
 * hitting real providers.
 */

type NarrationModule = typeof import('../../src/modules/automod/narration.js');

async function loadNarrationWith(completeImpl: () => unknown): Promise<NarrationModule> {
  vi.resetModules();
  vi.doMock('../../src/modules/llm/index.js', () => ({
    llm: {
      complete: vi.fn(completeImpl),
    },
  }));
  return await import('../../src/modules/automod/narration.js');
}

describe('automod narration (Thiên Đạo persona)', () => {
  afterEach(() => {
    vi.doUnmock('../../src/modules/llm/index.js');
    vi.restoreAllMocks();
  });

  it('returns LLM prose when complete succeeds', async () => {
    const mod = await loadNarrationWith(() =>
      Promise.resolve({
        text: '⚡ Thiên Đạo đã giáng thiên kiếp khiến **Bach** ngưng tu tâm — vong ngôn đã bị phong ấn.',
        tokensIn: 100,
        tokensOut: 30,
        costUsd: 0,
        provider: 'groq',
        model: 'qwen/qwen3-32b',
        durationMs: 50,
        routeIndex: 0,
      }),
    );

    const out = await mod.narratePunishment({
      userDisplayName: 'Bach',
      ruleId: 'profanity',
      action: 'warn',
    });

    expect(out).toContain('Bach');
    expect(out).toContain('Thiên Đạo');
    // No leading/trailing quotes
    expect(out).not.toMatch(/^["'`]/);
  });

  it('strips surrounding quotes from LLM output', async () => {
    const mod = await loadNarrationWith(() =>
      Promise.resolve({
        text: '"⚡ Thiên Đạo phong ấn **X** vì ngôn từ ô uế đã chấn động đạo tâm."',
        tokensIn: 50,
        tokensOut: 25,
        costUsd: 0,
        provider: 'groq',
        model: 'qwen/qwen3-32b',
        durationMs: 30,
        routeIndex: 0,
      }),
    );
    const out = await mod.narratePunishment({
      userDisplayName: 'X',
      ruleId: 'profanity',
      action: 'warn',
    });
    expect(out.startsWith('"')).toBe(false);
    expect(out.endsWith('"')).toBe(false);
  });

  it('falls back to static template when LLM returns null', async () => {
    const mod = await loadNarrationWith(() => Promise.resolve(null));
    const out = await mod.narratePunishment({
      userDisplayName: 'Bach',
      ruleId: 'profanity',
      action: 'warn',
    });
    expect(out).toContain('Bach');
    expect(out).toContain('Thiên Đạo');
    expect(out).toContain('ngôn từ ô uế');
  });

  it('falls back when LLM text is too short to be useful', async () => {
    const mod = await loadNarrationWith(() =>
      Promise.resolve({
        text: 'ok',
        tokensIn: 1,
        tokensOut: 1,
        costUsd: 0,
        provider: 'groq',
        model: 'qwen/qwen3-32b',
        durationMs: 5,
        routeIndex: 0,
      }),
    );
    const out = await mod.narratePunishment({
      userDisplayName: 'Y',
      ruleId: 'spam',
      action: 'timeout',
    });
    // Static fallback for spam+timeout
    expect(out).toContain('Y');
    expect(out).toContain('cấm khẩu');
  });

  it('collapses multi-line LLM output to one line', async () => {
    const mod = await loadNarrationWith(() =>
      Promise.resolve({
        text: '⚡ Thiên Đạo phong ấn\n**Z**\nvì vong ngôn đã chấn động đạo tâm.',
        tokensIn: 30,
        tokensOut: 20,
        costUsd: 0,
        provider: 'groq',
        model: 'qwen/qwen3-32b',
        durationMs: 10,
        routeIndex: 0,
      }),
    );
    const out = await mod.narratePunishment({
      userDisplayName: 'Z',
      ruleId: 'profanity',
      action: 'warn',
    });
    expect(out.includes('\n')).toBe(false);
  });

  it('rule + action labels cover every (rule, action) pair used', async () => {
    const mod = await loadNarrationWith(() => Promise.resolve(null));
    const { RULE_LABEL, ACTION_LABEL } = mod.__for_testing;
    for (const r of ['profanity', 'mass_mention', 'link', 'spam', 'caps'] as const) {
      expect(RULE_LABEL[r]).toBeTruthy();
    }
    for (const a of ['delete', 'warn', 'timeout', 'kick'] as const) {
      expect(ACTION_LABEL[a]).toBeTruthy();
    }
  });
});

describe('automod narration · static fallback', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('embeds user name + bolded marker', async () => {
    const mod = await import('../../src/modules/automod/narration.js');
    const out = mod.__for_testing.staticFallback({
      userDisplayName: 'Bao',
      ruleId: 'caps',
      action: 'delete',
    });
    expect(out).toContain('**Bao**');
    expect(out).toContain('thu hồi tin nhắn');
    expect(out).toContain('gào thét');
  });
});
