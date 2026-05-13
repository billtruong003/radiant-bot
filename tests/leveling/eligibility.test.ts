import { describe, expect, it } from 'vitest';
import { isXpEligibleMessage, substantiveLength } from '../../src/modules/leveling/eligibility.js';

describe('substantiveLength', () => {
  it('plain text: returns raw length', () => {
    expect(substantiveLength('hello')).toBe(5);
    expect(substantiveLength('  hello  ')).toBe(5); // trimmed
  });

  it('custom Discord emoji stripped', () => {
    expect(substantiveLength('<:smile:123456>')).toBe(0);
    expect(substantiveLength('hi <:wave:99999>')).toBe(2);
    expect(substantiveLength('<a:dance:111>')).toBe(0); // animated
  });

  it('unicode emoji stripped', () => {
    expect(substantiveLength('🔥')).toBe(0);
    expect(substantiveLength('hi 🔥')).toBe(2);
    expect(substantiveLength('🎉🎊🚀')).toBe(0);
  });

  it('emoji with ZWJ + variation selectors stripped', () => {
    expect(substantiveLength('👨‍💻')).toBe(0); // family / professional ZWJ
    expect(substantiveLength('❤️')).toBe(0); // VS-16
  });

  it('mixed: counts only non-emoji content', () => {
    expect(substantiveLength('great work 🔥🔥🔥')).toBe(10);
    expect(substantiveLength('<:cake:1> happy bday')).toBe(10);
  });
});

describe('isXpEligibleMessage', () => {
  it('< 5 substantive chars → ineligible', () => {
    expect(isXpEligibleMessage('hi')).toBe(false);
    expect(isXpEligibleMessage('lmao')).toBe(false); // 4 chars
    expect(isXpEligibleMessage('     ')).toBe(false);
  });

  it('≥ 5 substantive chars → eligible', () => {
    expect(isXpEligibleMessage('hello')).toBe(true);
    expect(isXpEligibleMessage('great work team')).toBe(true);
  });

  it('emoji-only → ineligible regardless of byte length', () => {
    expect(isXpEligibleMessage('🔥🔥🔥🔥🔥')).toBe(false);
    expect(isXpEligibleMessage('<:smile:123><:wave:456><:cake:789>')).toBe(false);
  });

  it('short text padded with emoji → still ineligible (counts content only)', () => {
    expect(isXpEligibleMessage('hi 🔥🔥🔥🔥')).toBe(false); // 2 substantive
  });
});
