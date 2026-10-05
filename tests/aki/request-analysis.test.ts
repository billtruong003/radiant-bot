import { describe, expect, it } from 'vitest';
import {
  type RequestAnalysis,
  preflight,
  shouldSkipArchiveLookup,
  shouldSkipWebLookup,
  taskForAnalysis,
} from '../../src/modules/aki/request-analysis.js';

/**
 * The preflight is the thing that keeps free quota from being spent on
 * questions plain code can classify. These tests pin the cases that were
 * previously mis-routed by the length heuristic.
 */

const base = { hasImage: false, hasReply: false, recentCount: 0 };

describe('preflight (no model call)', () => {
  it('routes a code fence to coding regardless of length', () => {
    // The old rule was `length < 60 → easy`. This is 30 chars.
    const a = preflight({ ...base, question: '```js\nfoo()\n```' });
    expect(a?.intent).toBe('coding');
    expect(taskForAnalysis(a as RequestAnalysis)).toBe('aki-answer-coding');
  });

  it('routes a short coding request to coding, not chitchat', () => {
    const a = preflight({ ...base, question: 'sửa hộ cái regex này' });
    expect(a?.intent).toBe('coding');
    expect(taskForAnalysis(a as RequestAnalysis)).toBe('aki-answer-coding');
  });

  it('routes a stack trace to debugging', () => {
    const a = preflight({
      ...base,
      question: 'TypeError: Cannot read properties of undefined (reading \'content\') bị lỗi',
    });
    expect(a?.intent).toBe('debugging');
  });

  it('routes a bare greeting to trivial chat', () => {
    const a = preflight({ ...base, question: 'ê' });
    expect(a?.intent).toBe('casual');
    expect(a?.complexity).toBe('trivial');
    expect(taskForAnalysis(a as RequestAnalysis)).toBe('aki-answer-trivial');
  });

  it('does NOT treat a reply as a bare greeting', () => {
    // "ừ" replying to something is a follow-up, not an idle noise.
    const a = preflight({ ...base, question: 'ừ', hasReply: true, recentCount: 5 });
    expect(a?.intent).not.toBe('casual');
    expect(a?.isFollowUp).toBe(true);
  });

  it('detects a dangling reference as a resolvable follow-up', () => {
    const a = preflight({ ...base, question: 'còn cái đó thì sao?', recentCount: 5 });
    expect(a?.isFollowUp).toBe(true);
    expect(a?.ambiguity).toBe('resolvable');
    // Crucially NOT the weakest chain — the subject is unknown.
    expect(taskForAnalysis(a as RequestAnalysis)).not.toBe('aki-answer-trivial');
  });

  it('routes server vocabulary to the server intent', () => {
    const a = preflight({ ...base, question: 'cảnh giới tiếp theo cần bao nhiêu xp?' });
    expect(a?.intent).toBe('server');
  });

  it('flags freshness questions as needing the web', () => {
    const a = preflight({ ...base, question: 'phiên bản mới nhất của Node là gì?' });
    expect(a?.needsWeb).toBe(true);
    expect(a?.intent).toBe('current_info');
  });

  it('routes an image to vision unconditionally', () => {
    const a = preflight({ ...base, question: 'cái gì đây', hasImage: true });
    expect(a?.intent).toBe('vision');
    expect(taskForAnalysis(a as RequestAnalysis)).toBe('aki-answer-vision');
  });

  it('sends very long input down the long-context chain', () => {
    const a = preflight({ ...base, question: 'a '.repeat(4000) });
    expect(a?.contextDependency).toBe('long_context');
    expect(taskForAnalysis(a as RequestAnalysis)).toBe('aki-answer-long-context');
  });

  it('returns null (defers to classifier) on a genuinely ambiguous request', () => {
    const a = preflight({
      ...base,
      question:
        'ừm cái này thì mình nghĩ nó cũng tuỳ vào việc bạn muốn hướng tới điều gì hơn nhỉ, bạn thấy sao',
    });
    expect(a).toBeNull();
  });
});

describe('quota savers', () => {
  const mk = (over: Partial<RequestAnalysis>): RequestAnalysis => ({
    intent: 'casual',
    complexity: 'trivial',
    isFollowUp: false,
    contextDependency: 'standalone',
    needsWeb: false,
    needsArchive: false,
    needsVision: false,
    ambiguity: 'none',
    confidence: 0.9,
    source: 'preflight',
    ...over,
  });

  it('skips web + archive lookups for a confident greeting', () => {
    const a = mk({});
    expect(shouldSkipWebLookup(a)).toBe(true);
    expect(shouldSkipArchiveLookup(a)).toBe(true);
  });

  it('never skips when the analysis says the lookup IS needed', () => {
    expect(shouldSkipWebLookup(mk({ intent: 'current_info', needsWeb: true }))).toBe(false);
    expect(shouldSkipArchiveLookup(mk({ intent: 'archive', needsArchive: true }))).toBe(false);
  });

  it('never skips on low confidence — a missed lookup means a stale answer', () => {
    expect(shouldSkipWebLookup(mk({ confidence: 0.5 }))).toBe(false);
    expect(shouldSkipArchiveLookup(mk({ confidence: 0.5 }))).toBe(false);
  });

  it('still runs the web check for knowledge questions', () => {
    expect(shouldSkipWebLookup(mk({ intent: 'knowledge', complexity: 'normal' }))).toBe(false);
  });
});
