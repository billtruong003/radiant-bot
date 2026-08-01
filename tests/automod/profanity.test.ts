import { describe, expect, it } from 'vitest';
import { findProfanity } from '../../src/modules/automod/rules/profanity.js';

const WORDS = ['địt', 'đm', 'lồn', 'cặc', 'đụ', 'fuck'];

describe('findProfanity — diacritic false positives (regression, 2026-07-29)', () => {
  // Stripping diacritics made "các" → "cac" collide with "cặc", and
  // "đủ" → "du" collide with "đụ". Both are everyday Vietnamese ("các"
  // is the plural marker), so ordinary questions were flagged as
  // profanity — and because automod short-circuits messageCreate, those
  // messages never reached Aki at all. Found from a live message:
  // "Làm sao để hiểu đầy đủ toàn bộ các nguyên âm trong tiếng hàn".
  it('does not flag ordinary words that collide after stripping accents', () => {
    const innocent = [
      'Làm sao để hiểu đầy đủ toàn bộ các nguyên âm trong tiếng hàn',
      'các bạn ơi cho hỏi',
      'tôi đã làm đủ rồi',
      'file này lớn quá',
      'dù sao cũng cảm ơn',
    ];
    for (const text of innocent) {
      expect(findProfanity(text, WORDS), text).toBeNull();
    }
  });

  it('still catches real profanity written with diacritics', () => {
    expect(findProfanity('cặc', WORDS)).not.toBeNull();
    expect(findProfanity('địt mẹ', WORDS)).not.toBeNull();
    expect(findProfanity('đm thằng này', WORDS)).not.toBeNull();
  });

  // The whole reason normalisation exists: catch accent-stripped evasion.
  it('still catches accent-stripped evasion', () => {
    expect(findProfanity('DIT me', WORDS)).not.toBeNull();
    expect(findProfanity('what the FUCK', WORDS)).not.toBeNull();
  });

  it('anchors on word boundaries (no partial matches)', () => {
    expect(findProfanity('classic assessment', WORDS)).toBeNull();
    expect(findProfanity('fuckery', WORDS)).toBeNull();
  });

  it('returns null on empty input', () => {
    expect(findProfanity('', WORDS)).toBeNull();
    expect(findProfanity('hello', [])).toBeNull();
  });
});
