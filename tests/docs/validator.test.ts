import { describe, expect, it } from 'vitest';
import { __for_testing } from '../../src/modules/docs/validator.js';

const { parseLlmResponse, ALLOWED_SECTIONS, APPROVE_SCORE_THRESHOLD } = __for_testing;

describe('docs validator · parseLlmResponse', () => {
  it('parses well-formed JSON', () => {
    const raw = JSON.stringify({
      approved: true,
      combined_score: 85,
      clarity: 90,
      technical_correctness: 80,
      safety: 100,
      relevance: 75,
      difficulty: 'medium',
      section: 'tech',
      tags: ['git', 'rebase', 'typescript'],
      rejection_reason: null,
    });
    const r = parseLlmResponse(raw);
    expect(r?.approved).toBe(true);
    expect(r?.combined_score).toBe(85);
    expect(r?.difficulty).toBe('medium');
    expect(r?.tags).toEqual(['git', 'rebase', 'typescript']);
  });

  it('strips markdown code fence', () => {
    const raw =
      '```json\n{"approved":false,"combined_score":30,"difficulty":"easy","section":"tech","tags":["test"]}\n```';
    const r = parseLlmResponse(raw);
    expect(r?.approved).toBe(false);
    expect(r?.combined_score).toBe(30);
  });

  it('strips <think> reasoning leak', () => {
    const raw =
      '<think>let me see</think>\n{"approved":true,"combined_score":70,"difficulty":"hard","section":"dev","tags":[]}';
    const r = parseLlmResponse(raw);
    expect(r?.approved).toBe(true);
    expect(r?.difficulty).toBe('hard');
  });

  it('clamps out-of-range scores', () => {
    const raw = JSON.stringify({
      approved: true,
      combined_score: 150,
      clarity: -10,
      technical_correctness: 'broken',
      safety: 50,
      relevance: 60,
      difficulty: 'medium',
      section: 'tech',
      tags: [],
    });
    const r = parseLlmResponse(raw);
    expect(r?.combined_score).toBe(100);
    expect(r?.clarity).toBe(0);
    expect(r?.technical_correctness).toBe(0);
  });

  it('falls back to "medium" + "community" on invalid classification', () => {
    const raw = JSON.stringify({
      approved: true,
      combined_score: 70,
      difficulty: 'wat',
      section: 'totally-fake-section',
      tags: [],
    });
    const r = parseLlmResponse(raw);
    expect(r?.difficulty).toBe('medium');
    expect(r?.section).toBe('community');
  });

  it('normalises tags (lowercase, kebab-case, max 5)', () => {
    const raw = JSON.stringify({
      approved: true,
      combined_score: 70,
      difficulty: 'easy',
      section: 'tech',
      tags: ['Git Rebase', 'TypeScript', 'NodeJS', 'tag4', 'tag5', 'tag6-trimmed'],
    });
    const r = parseLlmResponse(raw);
    expect(r?.tags).toEqual(['git-rebase', 'typescript', 'nodejs', 'tag4', 'tag5']);
  });

  it('returns null on broken JSON', () => {
    expect(parseLlmResponse('not json')).toBeNull();
    expect(parseLlmResponse('{broken')).toBeNull();
  });

  it('constants are sane', () => {
    expect(APPROVE_SCORE_THRESHOLD).toBe(60);
    expect(ALLOWED_SECTIONS).toContain('tech');
    expect(ALLOWED_SECTIONS).toContain('cultivation');
  });
});
