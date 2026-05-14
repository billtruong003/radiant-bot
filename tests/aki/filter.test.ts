import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { preFilterObvious } from '../../src/modules/aki/persona-filter.js';

// env is captured at module load — to test the Gemini code path we
// re-import filter.ts after stubbing env. This top-level import is for
// the pre-filter / disabled tests where env=empty key is fine.
import { __for_testing, isFilterEnabled, runFilter } from '../../src/modules/aki/filter.js';

const { stripFences, parseFilterJson, computeCost } = __for_testing;

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
    // 3 chars with a letter is the boundary — still passes
    expect(preFilterObvious('abc')).toBeNull();
  });
});

describe('stripFences', () => {
  it('strips ```json ... ``` fences', () => {
    const wrapped = '```json\n{"legit": true, "response": null}\n```';
    expect(stripFences(wrapped)).toBe('{"legit": true, "response": null}');
  });

  it('strips bare ``` fences', () => {
    const wrapped = '```\n{"legit": false, "response": "no"}\n```';
    expect(stripFences(wrapped)).toBe('{"legit": false, "response": "no"}');
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
    const r = parseFilterJson('{"legit": true, "response": null}');
    expect(r).toEqual({ legit: true, response: null });
  });

  it('parses legit=false with sass response', () => {
    const r = parseFilterJson('{"legit": false, "response": "Xàm vl ┐(￣ヮ￣)┌"}');
    expect(r).toEqual({ legit: false, response: 'Xàm vl ┐(￣ヮ￣)┌' });
  });

  it('strips fences before parsing', () => {
    const r = parseFilterJson('```json\n{"legit": true, "response": null}\n```');
    expect(r).toEqual({ legit: true, response: null });
  });

  it('forces response=null when legit=true (even if Gemini sent text)', () => {
    const r = parseFilterJson('{"legit": true, "response": "ignored"}');
    expect(r).toEqual({ legit: true, response: null });
  });

  it('returns null on invalid JSON', () => {
    expect(parseFilterJson('not json at all')).toBeNull();
    expect(parseFilterJson('{legit: true}')).toBeNull(); // unquoted keys
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
    const r = parseFilterJson('{"legit": false, "response": "  hi  "}');
    expect(r).toEqual({ legit: false, response: 'hi' });
  });
});

describe('computeCost', () => {
  it('uses Gemini 2.0 Flash pricing ($0.075/$0.30 per 1M)', () => {
    // 1M in, 0 out = $0.075
    expect(computeCost(1_000_000, 0)).toBeCloseTo(0.075, 6);
    // 0 in, 1M out = $0.30
    expect(computeCost(0, 1_000_000)).toBeCloseTo(0.3, 6);
    // typical: 800 in, 80 out
    const expected = (800 * 0.075 + 80 * 0.3) / 1_000_000;
    expect(computeCost(800, 80)).toBeCloseTo(expected, 9);
  });

  it('returns 0 for zero tokens', () => {
    expect(computeCost(0, 0)).toBe(0);
  });
});

describe('isFilterEnabled', () => {
  // GEMINI_API_KEY defaults to '' in test env → disabled.
  it('is false when GEMINI_API_KEY empty', () => {
    expect(isFilterEnabled()).toBe(false);
  });
});

describe('runFilter — pre-filter short-circuit', () => {
  it('rejects via pre-filter before any network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await runFilter('ab');
    expect(result.legit).toBe(false);
    expect(result.source).toBe('pre-filter');
    expect(result.response).toMatch(/Tiền bối|viết|hỏi/i);
    expect(result.costUsd).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('rejects emoji-only via pre-filter', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await runFilter('🔥🔥🔥');
    expect(result.legit).toBe(false);
    expect(result.source).toBe('pre-filter');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('runFilter — disabled (no GEMINI_API_KEY)', () => {
  it('fails open with source=disabled when no API key', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await runFilter('git rebase là gì?');
    expect(result.legit).toBe(true);
    expect(result.source).toBe('disabled');
    expect(result.response).toBeNull();
    expect(result.costUsd).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('runFilter — Gemini call (mocked fetch + env)', () => {
  // env is captured by src/config/env.ts at module load. To exercise
  // the Gemini path we vi.doMock the env module and dynamically
  // import the filter so it picks up the stub.
  type FilterModule = typeof import('../../src/modules/aki/filter.js');
  let filterMod: FilterModule;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../../src/config/env.js', async () => {
      const actual =
        await vi.importActual<typeof import('../../src/config/env.js')>('../../src/config/env.js');
      return {
        ...actual,
        env: { ...actual.env, GEMINI_API_KEY: 'test-key', AKI_FILTER_MODEL: 'gemini-2.0-flash' },
      };
    });
    filterMod = await import('../../src/modules/aki/filter.js');
  });

  afterEach(() => {
    vi.doUnmock('../../src/config/env.js');
    vi.restoreAllMocks();
  });

  function mockGemini(
    responseText: string,
    usage = { promptTokenCount: 800, candidatesTokenCount: 80 },
  ) {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: responseText }] }, finishReason: 'STOP' }],
          usageMetadata: usage,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
  }

  it('confirms env stub took effect (isFilterEnabled=true)', () => {
    expect(filterMod.isFilterEnabled()).toBe(true);
  });

  it('returns legit=true when Gemini classifies legit', async () => {
    mockGemini('{"legit": true, "response": null}');
    const result = await filterMod.runFilter('cách lên cảnh giới Kim Đan?');
    expect(result.legit).toBe(true);
    expect(result.source).toBe('gemini');
    expect(result.tokensIn).toBe(800);
    expect(result.tokensOut).toBe(80);
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it('returns legit=false with sass when Gemini rejects', async () => {
    mockGemini('{"legit": false, "response": "Test cái gì test (눈‸눈)"}');
    const result = await filterMod.runFilter('câu hỏi xàm vớ vẩn không có nội dung');
    expect(result.legit).toBe(false);
    expect(result.source).toBe('gemini');
    expect(result.response).toBe('Test cái gì test (눈‸눈)');
  });

  it('handles fenced JSON output from Gemini', async () => {
    mockGemini('```json\n{"legit": true, "response": null}\n```');
    const result = await filterMod.runFilter('what is git rebase?');
    expect(result.legit).toBe(true);
    expect(result.source).toBe('gemini');
  });

  it('fails open when Gemini returns unparseable text', async () => {
    mockGemini('I am sorry but I cannot respond in JSON.');
    const result = await filterMod.runFilter('git rebase là gì xin giải thích');
    expect(result.legit).toBe(true);
    expect(result.source).toBe('fail-open');
  });

  it('fails open on non-OK HTTP', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('quota exceeded', { status: 429 }),
    );
    const result = await filterMod.runFilter('git rebase là gì xin giải thích');
    expect(result.legit).toBe(true);
    expect(result.source).toBe('fail-open');
  });

  it('fails open on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await filterMod.runFilter('git rebase là gì xin giải thích');
    expect(result.legit).toBe(true);
    expect(result.source).toBe('fail-open');
  });

  it('actually calls fetch with the Gemini endpoint URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"legit": true, "response": null}' }] } }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        }),
        { status: 200 },
      ),
    );
    await filterMod.runFilter('câu hỏi thật về git');
    expect(fetchSpy).toHaveBeenCalledOnce();
    const url = fetchSpy.mock.calls[0]?.[0] as string;
    expect(url).toContain('generativelanguage.googleapis.com');
    expect(url).toContain('gemini-2.0-flash');
    expect(url).toContain('key=test-key');
  });
});
