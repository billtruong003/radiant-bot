import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { preFilterObvious } from '../../src/modules/aki/persona-filter.js';

// Pre-filter / parsing tests are pure and don't need the LLM router.
// Integration tests below mock `src/modules/llm/index.js` so we exercise
// runFilter's full code path without hitting a real provider.
import { __for_testing, isFilterEnabled } from '../../src/modules/aki/filter.js';

const { stripFences, parseFilterJson } = __for_testing;

describe('preFilterObvious', () => {
  it('rejects empty / very short input', () => {
    expect(preFilterObvious('')).not.toBeNull();
    expect(preFilterObvious(' ')).not.toBeNull();
    expect(preFilterObvious('ab')).not.toBeNull();
  });

  it('rejects pure punctuation / emoji', () => {
    expect(preFilterObvious('??!')).not.toBeNull();
    expect(preFilterObvious('🔥🔥🔥')).not.toBeNull();
    expect(preFilterObvious('...')).not.toBeNull();
  });

  it('passes through real questions (returns null)', () => {
    expect(preFilterObvious('git rebase là gì?')).toBeNull();
    expect(preFilterObvious('cách lên cảnh giới Kim Đan')).toBeNull();
    expect(preFilterObvious('abc')).toBeNull();
  });
});

describe('stripFences', () => {
  it('strips ```json ... ``` fences', () => {
    expect(stripFences('```json\n{"legit": true, "response": null}\n```')).toBe(
      '{"legit": true, "response": null}',
    );
  });
  it('strips bare ``` fences', () => {
    expect(stripFences('```\n{"legit": false, "response": "no"}\n```')).toBe(
      '{"legit": false, "response": "no"}',
    );
  });
  it('leaves unfenced JSON untouched', () => {
    const raw = '{"legit": true, "response": null}';
    expect(stripFences(raw)).toBe(raw);
  });
  it('trims leading/trailing whitespace', () => {
    expect(stripFences('   {"legit": true}\n  ')).toBe('{"legit": true}');
  });
});

describe('parseFilterJson', () => {
  it('parses legit=true with null response', () => {
    expect(parseFilterJson('{"legit": true, "response": null}')).toEqual({
      legit: true,
      response: null,
    });
  });
  it('parses legit=false with sass response', () => {
    expect(parseFilterJson('{"legit": false, "response": "Xàm vl ┐(￣ヮ￣)┌"}')).toEqual({
      legit: false,
      response: 'Xàm vl ┐(￣ヮ￣)┌',
    });
  });
  it('strips fences before parsing', () => {
    expect(parseFilterJson('```json\n{"legit": true, "response": null}\n```')).toEqual({
      legit: true,
      response: null,
    });
  });
  it('forces response=null when legit=true (even if model sent text)', () => {
    expect(parseFilterJson('{"legit": true, "response": "ignored"}')).toEqual({
      legit: true,
      response: null,
    });
  });
  it('returns null on invalid JSON', () => {
    expect(parseFilterJson('not json at all')).toBeNull();
    expect(parseFilterJson('{legit: true}')).toBeNull();
  });
  it('returns null when legit field missing or wrong type', () => {
    expect(parseFilterJson('{"response": "hi"}')).toBeNull();
    expect(parseFilterJson('{"legit": "yes"}')).toBeNull();
  });
  it('returns null when legit=false but response missing/empty', () => {
    expect(parseFilterJson('{"legit": false, "response": null}')).toBeNull();
    expect(parseFilterJson('{"legit": false, "response": ""}')).toBeNull();
    expect(parseFilterJson('{"legit": false, "response": "   "}')).toBeNull();
  });
  it('returns null on non-object JSON (array, primitive)', () => {
    expect(parseFilterJson('[1,2,3]')).toBeNull();
    expect(parseFilterJson('"just a string"')).toBeNull();
    expect(parseFilterJson('null')).toBeNull();
  });
  it('trims whitespace inside response', () => {
    expect(parseFilterJson('{"legit": false, "response": "  hi  "}')).toEqual({
      legit: false,
      response: 'hi',
    });
  });
});

describe('isFilterEnabled', () => {
  // Test env defaults both keys to empty → disabled.
  it('is false when neither GROQ_API_KEY nor GEMINI_API_KEY set', () => {
    expect(isFilterEnabled()).toBe(false);
  });
});

describe('runFilter — pre-filter short-circuit (no LLM call)', () => {
  // No need to mock the router — pre-filter intercepts before reaching it.
  it('rejects via pre-filter for short input', async () => {
    const { runFilter } = await import('../../src/modules/aki/filter.js');
    const r = await runFilter('ab');
    expect(r.legit).toBe(false);
    expect(r.source).toBe('pre-filter');
    expect(r.costUsd).toBe(0);
  });
  it('rejects emoji-only via pre-filter', async () => {
    const { runFilter } = await import('../../src/modules/aki/filter.js');
    const r = await runFilter('🔥🔥🔥');
    expect(r.legit).toBe(false);
    expect(r.source).toBe('pre-filter');
  });
});

describe('runFilter — disabled (no provider keys)', () => {
  it('fails open with source=disabled', async () => {
    const { runFilter } = await import('../../src/modules/aki/filter.js');
    const r = await runFilter('git rebase là gì xin giải thích');
    expect(r.legit).toBe(true);
    expect(r.source).toBe('disabled');
    expect(r.response).toBeNull();
  });
});

describe('runFilter — with mocked LLM router', () => {
  // Mock llm.complete so we test runFilter's parsing + source attribution
  // without needing a real provider. Re-import filter after mock so it
  // picks up the stubbed router.
  type FilterModule = typeof import('../../src/modules/aki/filter.js');

  beforeEach(() => {
    vi.resetModules();
    // Stub env so isFilterEnabled returns true (else runFilter short-
    // circuits to 'disabled' before reaching the router).
    vi.doMock('../../src/config/env.js', async () => {
      const actual =
        await vi.importActual<typeof import('../../src/config/env.js')>('../../src/config/env.js');
      return {
        ...actual,
        env: { ...actual.env, GROQ_API_KEY: 'test-groq', GEMINI_API_KEY: '' },
      };
    });
  });

  afterEach(() => {
    vi.doUnmock('../../src/config/env.js');
    vi.doUnmock('../../src/modules/llm/index.js');
    vi.restoreAllMocks();
  });

  async function loadFilterWith(routerMock: {
    complete: ReturnType<typeof vi.fn>;
  }): Promise<FilterModule> {
    vi.doMock('../../src/modules/llm/index.js', () => ({
      llm: { complete: routerMock.complete },
      LlmProviderError: class extends Error {},
      LlmRateLimitError: class extends Error {},
    }));
    return await import('../../src/modules/aki/filter.js');
  }

  it('legit=true → forwards to Grok (source=provider name)', async () => {
    const complete = vi.fn().mockResolvedValue({
      text: '{"legit": true, "response": null}',
      tokensIn: 800,
      tokensOut: 10,
      costUsd: 0,
      provider: 'groq',
      model: 'llama-3.1-8b-instant',
      durationMs: 200,
      routePosition: 'primary',
    });
    const { runFilter } = await loadFilterWith({ complete });
    const r = await runFilter('cách lên cảnh giới Kim Đan?');
    expect(r.legit).toBe(true);
    expect(r.source).toBe('groq');
    expect(r.tokensIn).toBe(800);
  });

  it('legit=false → returns sass + source=provider', async () => {
    const complete = vi.fn().mockResolvedValue({
      text: '{"legit": false, "response": "Test cái gì test (눈‸눈)"}',
      tokensIn: 800,
      tokensOut: 30,
      costUsd: 0,
      provider: 'groq',
      model: 'llama-3.1-8b-instant',
      durationMs: 200,
      routePosition: 'primary',
    });
    const { runFilter } = await loadFilterWith({ complete });
    const r = await runFilter('câu hỏi xàm không có nội dung');
    expect(r.legit).toBe(false);
    expect(r.source).toBe('groq');
    expect(r.response).toBe('Test cái gì test (눈‸눈)');
  });

  it('fallback provider used → source reflects fallback', async () => {
    const complete = vi.fn().mockResolvedValue({
      text: '{"legit": true, "response": null}',
      tokensIn: 800,
      tokensOut: 10,
      costUsd: 0.0001,
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      durationMs: 350,
      routePosition: 'fallback',
    });
    const { runFilter } = await loadFilterWith({ complete });
    const r = await runFilter('câu hỏi hợp lệ');
    expect(r.source).toBe('gemini');
    expect(r.costUsd).toBeCloseTo(0.0001);
  });

  it('router returns null (all providers down) → fail-open', async () => {
    const complete = vi.fn().mockResolvedValue(null);
    const { runFilter } = await loadFilterWith({ complete });
    const r = await runFilter('câu hỏi thật về git');
    expect(r.legit).toBe(true);
    expect(r.source).toBe('fail-open');
  });

  it('router returns unparseable JSON → fail-open with token attribution', async () => {
    const complete = vi.fn().mockResolvedValue({
      text: 'I am sorry but I cannot respond in JSON.',
      tokensIn: 800,
      tokensOut: 20,
      costUsd: 0,
      provider: 'groq',
      model: 'llama-3.1-8b-instant',
      durationMs: 200,
      routePosition: 'primary',
    });
    const { runFilter } = await loadFilterWith({ complete });
    const r = await runFilter('câu hỏi hợp lệ về tech');
    expect(r.legit).toBe(true);
    expect(r.source).toBe('fail-open');
    expect(r.tokensIn).toBe(800); // tokens still attributed
  });
});
