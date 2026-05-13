import { describe, expect, it } from 'vitest';
import {
  generateImageCaptcha,
  parseHardReply,
  verifyImageReply,
} from '../../src/modules/verification/captcha-image.js';
import {
  generateMathChallenge,
  renderMathChallenge,
  verifyMathReply,
} from '../../src/modules/verification/captcha-math.js';

describe('math captcha', () => {
  it('generates a + b within bounds and expected = a+b', () => {
    for (let i = 0; i < 50; i++) {
      const c = generateMathChallenge({ minA: 1, maxA: 5, minB: 1, maxB: 5 });
      expect(c.a).toBeGreaterThanOrEqual(1);
      expect(c.a).toBeLessThanOrEqual(5);
      expect(c.b).toBeGreaterThanOrEqual(1);
      expect(c.b).toBeLessThanOrEqual(5);
      expect(c.expected).toBe(String(c.a + c.b));
    }
  });

  it('rendered DM includes the operands', () => {
    const c = { a: 7, b: 12, expected: '19' };
    const text = renderMathChallenge(c);
    expect(text).toContain('7');
    expect(text).toContain('12');
  });

  it('verifyMathReply: exact digit match wins', () => {
    expect(verifyMathReply('19', '19')).toBe(true);
    expect(verifyMathReply(' 19 ', '19')).toBe(true);
    expect(verifyMathReply('20', '19')).toBe(false);
    expect(verifyMathReply('', '19')).toBe(false);
    expect(verifyMathReply('nineteen', '19')).toBe(false);
  });
});

describe('image captcha', () => {
  it('generates 6 chars from confusion-resistant alphabet', () => {
    const c = generateImageCaptcha();
    expect(c.text).toHaveLength(6);
    expect(c.text).toMatch(/^[A-Z2-9]+$/);
    // No O, 0, I, 1, L.
    expect(c.text).not.toMatch(/[OIL01]/);
  });

  it('returns a non-empty PNG buffer', () => {
    const c = generateImageCaptcha();
    expect(c.buffer.length).toBeGreaterThan(100);
    // PNG magic: 0x89 0x50 0x4E 0x47.
    expect(c.buffer[0]).toBe(0x89);
    expect(c.buffer[1]).toBe(0x50);
  });

  it('verifyImageReply is case-insensitive + whitespace-tolerant', () => {
    expect(verifyImageReply('ABCXYZ', 'ABCXYZ')).toBe(true);
    expect(verifyImageReply('abcxyz', 'ABCXYZ')).toBe(true);
    expect(verifyImageReply('  ABCXYZ  ', 'ABCXYZ')).toBe(true);
    expect(verifyImageReply('ABCXY', 'ABCXYZ')).toBe(false);
    expect(verifyImageReply('', 'ABCXYZ')).toBe(false);
  });

  it('parseHardReply splits two tokens', () => {
    expect(parseHardReply('ABCXYZ 19')).toEqual({ imageText: 'ABCXYZ', mathAnswer: '19' });
    expect(parseHardReply('  ABCXYZ\t19  ')).toEqual({ imageText: 'ABCXYZ', mathAnswer: '19' });
    expect(parseHardReply('only-one')).toBeNull();
    expect(parseHardReply('three tokens here')).toBeNull();
    expect(parseHardReply('')).toBeNull();
  });
});
