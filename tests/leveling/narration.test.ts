import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Phase 11.2 / A8 — chronicler narration unit tests for rank promotions.
 * Mocks `llm.complete` and verifies happy path + cache + static fallback.
 */

type NarrationModule = typeof import('../../src/modules/leveling/narration.js');

async function loadWith(completeImpl: () => unknown): Promise<{
  mod: NarrationModule;
  spy: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  const spy = vi.fn(completeImpl);
  vi.doMock('../../src/modules/llm/index.js', () => ({
    llm: { complete: spy },
  }));
  const mod = await import('../../src/modules/leveling/narration.js');
  mod.clearCacheForTesting();
  return { mod, spy };
}

function mockLlmText(text: string) {
  return {
    text,
    tokensIn: 100,
    tokensOut: 30,
    costUsd: 0,
    provider: 'groq',
    model: 'qwen/qwen3-32b',
    durationMs: 50,
    routeIndex: 0,
  };
}

describe('leveling narration (chronicler)', () => {
  afterEach(() => {
    vi.doUnmock('../../src/modules/llm/index.js');
    vi.restoreAllMocks();
  });

  it('substitutes user name into LLM prose', async () => {
    const { mod } = await loadWith(() =>
      Promise.resolve(
        mockLlmText(
          '**__USER__** vừa đột phá **Trúc Cơ kỳ**, đạo tâm vững như đá nền — đường tu vạn dặm bắt đầu.',
        ),
      ),
    );
    const out = await mod.narrateRankPromotion({
      userDisplayName: 'Alice',
      oldRank: 'luyen_khi',
      newRank: 'truc_co',
    });
    expect(out).toContain('Alice');
    expect(out).not.toContain('__USER__');
  });

  it('caches by (oldRank, newRank) pair', async () => {
    const { mod, spy } = await loadWith(() =>
      Promise.resolve(mockLlmText('**__USER__** vừa đột phá **Trúc Cơ kỳ** — đường tu vạn dặm.')),
    );

    const first = await mod.narrateRankPromotion({
      userDisplayName: 'Alice',
      oldRank: 'luyen_khi',
      newRank: 'truc_co',
    });
    const second = await mod.narrateRankPromotion({
      userDisplayName: 'Bob',
      oldRank: 'luyen_khi',
      newRank: 'truc_co',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(first).toContain('Alice');
    expect(second).toContain('Bob');
    expect(first).not.toContain('Bob');
    expect(second).not.toContain('Alice');
  });

  it('different pairs do NOT share cache', async () => {
    const { mod, spy } = await loadWith(() =>
      Promise.resolve(mockLlmText('**__USER__** đột phá thành công — đạo tâm vững như đá nền.')),
    );
    await mod.narrateRankPromotion({
      userDisplayName: 'A',
      oldRank: 'luyen_khi',
      newRank: 'truc_co',
    });
    await mod.narrateRankPromotion({
      userDisplayName: 'B',
      oldRank: 'truc_co',
      newRank: 'kim_dan',
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('falls back to static template when LLM returns null', async () => {
    const { mod } = await loadWith(() => Promise.resolve(null));
    const out = await mod.narrateRankPromotion({
      userDisplayName: 'Z',
      oldRank: 'pham_nhan',
      newRank: 'luyen_khi',
    });
    expect(out).toContain('Z');
    expect(out).toContain('Luyện Khí');
    expect(out).toContain('Phàm Nhân');
  });

  it('falls back when LLM returns suspiciously short text', async () => {
    const { mod } = await loadWith(() => Promise.resolve(mockLlmText('ok')));
    const out = await mod.narrateRankPromotion({
      userDisplayName: 'Z',
      oldRank: 'truc_co',
      newRank: 'kim_dan',
    });
    expect(out).toContain('Z');
    expect(out).toContain('Kim Đan');
  });

  it('collapses multi-line LLM output to one line', async () => {
    const { mod } = await loadWith(() =>
      Promise.resolve(
        mockLlmText('**__USER__** đã đột phá\n**Kim Đan kỳ**\n— phong vân chiêu sinh.'),
      ),
    );
    const out = await mod.narrateRankPromotion({
      userDisplayName: 'M',
      oldRank: 'truc_co',
      newRank: 'kim_dan',
    });
    expect(out.includes('\n')).toBe(false);
  });

  it('cache key format is `${old}:${new}`', async () => {
    const { mod } = await loadWith(() =>
      Promise.resolve(mockLlmText('**__USER__** đột phá thành công.')),
    );
    expect(mod.__for_testing.cacheKey('luyen_khi', 'truc_co')).toBe('luyen_khi:truc_co');
  });
});
