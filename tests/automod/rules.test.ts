import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AutomodConfig, __setAutomodConfigForTesting } from '../../src/config/automod.js';
import { capsRatio } from '../../src/modules/automod/rules/caps-lock.js';
import { findNonWhitelistedHosts } from '../../src/modules/automod/rules/link-whitelist.js';
import { findProfanity } from '../../src/modules/automod/rules/profanity.js';

const TEST_CONFIG: AutomodConfig = {
  thresholds: {
    massMentionCount: 6,
    capsRatioThreshold: 0.7,
    capsMinLength: 10,
    spamDuplicates: 5,
    spamWindowMs: 300_000,
    timeoutDurationMs: 600_000,
  },
  linkPolicy: 'strict',
  linkWhitelist: ['github.com', 'discord.com', 'youtube.com'],
  linkBlacklist: [],
  linkShorteners: [],
  linkSuspectTlds: [],
  profanityWords: ['địt', 'fuck', 'shit'],
};

beforeEach(() => {
  __setAutomodConfigForTesting(TEST_CONFIG);
});

afterEach(() => {
  __setAutomodConfigForTesting(null);
});

describe('capsRatio (pure)', () => {
  it('all caps → 1.0', () => {
    expect(capsRatio('HELLO WORLD')).toBe(1);
  });

  it('all lower → 0', () => {
    expect(capsRatio('hello world')).toBe(0);
  });

  it('mixed → ratio of letters only (ignores digits + emoji)', () => {
    expect(capsRatio('HELLO123!!!')).toBe(1); // 5/5 letters are caps
    expect(capsRatio('Hello123')).toBe(0.2); // 1/5
  });

  it('no letters → null (cannot evaluate)', () => {
    expect(capsRatio('🔥🔥🔥')).toBeNull();
    expect(capsRatio('!!!!!!!')).toBeNull();
    expect(capsRatio('')).toBeNull();
  });
});

describe('findNonWhitelistedHosts (pure)', () => {
  it('whitelisted root domain → no hit', () => {
    expect(findNonWhitelistedHosts('check https://github.com/foo', ['github.com'])).toEqual([]);
  });

  it('whitelisted subdomain → no hit (suffix match)', () => {
    expect(findNonWhitelistedHosts('see api.github.com/users', ['github.com'])).toEqual([]);
  });

  it('non-whitelisted host → hit', () => {
    expect(findNonWhitelistedHosts('go to evil.com/click', ['github.com'])).toEqual(['evil.com']);
  });

  it('multiple URLs → all non-whitelisted reported, deduped', () => {
    expect(
      findNonWhitelistedHosts('https://github.com/x and evil.com/a and evil.com/b and spam.io', [
        'github.com',
      ]).sort(),
    ).toEqual(['evil.com', 'spam.io']);
  });

  it('bare domain without scheme → still detected', () => {
    expect(findNonWhitelistedHosts('visit shady.net for prizes', ['github.com'])).toEqual([
      'shady.net',
    ]);
  });

  it('no URLs → no hits', () => {
    expect(findNonWhitelistedHosts('just a normal message', ['github.com'])).toEqual([]);
  });
});

describe('findProfanity (pure)', () => {
  it('exact match → returns the matched word', () => {
    expect(findProfanity('this is shit', ['shit'])).toBe('shit');
  });

  it('case-insensitive', () => {
    expect(findProfanity('FUCK that', ['fuck'])).toBe('fuck');
  });

  it('Vietnamese diacritics → tolerant match', () => {
    expect(findProfanity('địt mẹ', ['địt'])).toBe('địt');
    expect(findProfanity('DIT thật', ['địt'])).toBe('địt'); // normalized
  });

  it('partial match → no hit (word boundary)', () => {
    expect(findProfanity('classroom', ['ass'])).toBeNull();
    expect(findProfanity('hello shitless world', ['shit'])).toBeNull();
  });

  it('non-match → null', () => {
    expect(findProfanity('hello world', ['shit', 'fuck'])).toBeNull();
  });

  it('first match wins (list order)', () => {
    expect(findProfanity('this is fuck shit', ['shit', 'fuck'])).toBe('shit');
  });
});
