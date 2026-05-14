import { describe, expect, it } from 'vitest';
import { modelSupportsReasoningFormat } from '../../src/modules/llm/providers/groq.js';

/**
 * Phase 11.2 post-deploy 2026-05-14 — Groq returns HTTP 400 if
 * `reasoning_format` is sent to a non-reasoning model. This gate
 * prevents the prod outage where Llama 3.3 70B + Llama 4 Scout all
 * failed for narration after we tried to send the flag everywhere.
 */
describe('modelSupportsReasoningFormat', () => {
  it('Qwen 3 family supports reasoning_format', () => {
    expect(modelSupportsReasoningFormat('qwen/qwen3-32b')).toBe(true);
    expect(modelSupportsReasoningFormat('qwen/qwen3-8b')).toBe(true);
    expect(modelSupportsReasoningFormat('QWEN/QWEN3-32B')).toBe(true);
  });

  it('gpt-oss family supports reasoning_format', () => {
    expect(modelSupportsReasoningFormat('openai/gpt-oss-120b')).toBe(true);
    expect(modelSupportsReasoningFormat('openai/gpt-oss-20b')).toBe(true);
  });

  it('Llama 3.x DOES NOT support reasoning_format (returns 400 in prod)', () => {
    expect(modelSupportsReasoningFormat('llama-3.3-70b-versatile')).toBe(false);
    expect(modelSupportsReasoningFormat('llama-3.1-8b-instant')).toBe(false);
  });

  it('Llama 4 DOES NOT support reasoning_format', () => {
    expect(modelSupportsReasoningFormat('meta-llama/llama-4-scout-17b-16e-instruct')).toBe(false);
  });

  it('unknown models default to false (safe — skip the flag)', () => {
    expect(modelSupportsReasoningFormat('some-future-model')).toBe(false);
    expect(modelSupportsReasoningFormat('')).toBe(false);
  });
});
