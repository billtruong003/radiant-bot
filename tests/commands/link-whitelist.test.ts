import { describe, expect, it } from 'vitest';
import { __for_testing } from '../../src/commands/link-whitelist.js';

const { normalizeDomain } = __for_testing;

describe('link-whitelist · normalizeDomain', () => {
  it('strips scheme', () => {
    expect(normalizeDomain('https://github.com')).toBe('github.com');
    expect(normalizeDomain('http://github.com')).toBe('github.com');
  });

  it('strips www prefix', () => {
    expect(normalizeDomain('www.billthedev.com')).toBe('billthedev.com');
    expect(normalizeDomain('https://www.billthedev.com')).toBe('billthedev.com');
  });

  it('strips path + trailing slash', () => {
    expect(normalizeDomain('https://github.com/foo/bar')).toBe('github.com');
    expect(normalizeDomain('billthedev.com/')).toBe('billthedev.com');
  });

  it('lowercases', () => {
    expect(normalizeDomain('GitHub.COM')).toBe('github.com');
  });

  it('preserves subdomains', () => {
    expect(normalizeDomain('api.github.com')).toBe('api.github.com');
    expect(normalizeDomain('https://api.github.com/users')).toBe('api.github.com');
  });

  it('rejects malformed inputs', () => {
    expect(normalizeDomain('')).toBeNull();
    expect(normalizeDomain('not-a-domain')).toBeNull();
    expect(normalizeDomain('http://')).toBeNull();
    expect(normalizeDomain('foo')).toBeNull();
  });
});
