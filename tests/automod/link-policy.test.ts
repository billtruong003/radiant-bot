import { describe, expect, it } from 'vitest';
import {
  type LinkPolicyConfig,
  findSuspiciousLinks,
} from '../../src/modules/automod/rules/link-whitelist.js';

/**
 * Phase 11.2 (post-deploy) — verify the two link policy modes:
 *
 *   - permissive (default 2026-05-14): allow any link by default; flag
 *     only when it trips a heuristic (blacklist / shortener / suspect
 *     TLD / IP-only / punycode). Bill: "ng ta muốn đc tự do add link
 *     thì sao? chỉ check các link đáng ngờ thôi".
 *   - strict: legacy mode — anything outside the whitelist is flagged.
 *     Use during raids.
 */

const BASE: LinkPolicyConfig = {
  policy: 'permissive',
  whitelist: ['github.com', 'discord.com', 'billthedev.com'],
  blacklist: ['known-bad.example', 'phishing.test'],
  shorteners: ['bit.ly', 'tinyurl.com'],
  suspectTlds: ['tk', 'click', 'top'],
};

describe('findSuspiciousLinks · permissive mode', () => {
  it('allows arbitrary new domain like billthedev.com', () => {
    const hits = findSuspiciousLinks('check https://www.billthedev.com/portfolio', BASE);
    expect(hits).toEqual([]);
  });

  it('allows any .com / .vn / random domain by default', () => {
    expect(findSuspiciousLinks('see foo.com/x and bar.vn/y', BASE)).toEqual([]);
  });

  it('flags blacklisted domain', () => {
    const hits = findSuspiciousLinks('try known-bad.example/free', BASE);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ host: 'known-bad.example', reason: 'blacklist' });
  });

  it('flags URL shorteners (any bit.ly link is suspect)', () => {
    const hits = findSuspiciousLinks('click https://bit.ly/abc123', BASE);
    expect(hits[0]?.reason).toBe('shortener');
  });

  it('flags suspect TLDs (.tk / .click / .top)', () => {
    const hits = findSuspiciousLinks('visit shady.tk/free and click.click/x', BASE);
    const reasons = hits.map((h) => h.reason);
    expect(reasons).toContain('suspect-tld');
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it('flags IP-only URLs', () => {
    const hits = findSuspiciousLinks('go to http://1.2.3.4/path', BASE);
    expect(hits[0]?.reason).toBe('ip-host');
  });

  it('flags punycode (xn--) domains', () => {
    const hits = findSuspiciousLinks('xn--cmple-mra.com/path', BASE);
    expect(hits[0]?.reason).toBe('punycode');
  });

  it('whitelist bypasses all checks (even if domain looks like it could match a heuristic)', () => {
    // billthedev.com would be allowed by permissive anyway, but whitelist
    // is the fast-path that runs first.
    expect(findSuspiciousLinks('https://billthedev.com/blog', BASE)).toEqual([]);
  });

  it('subdomain of whitelisted root is allowed', () => {
    expect(findSuspiciousLinks('api.github.com/users', BASE)).toEqual([]);
  });
});

describe('findSuspiciousLinks · strict mode', () => {
  const STRICT: LinkPolicyConfig = { ...BASE, policy: 'strict' };

  it('allows whitelist only', () => {
    expect(findSuspiciousLinks('check github.com/foo', STRICT)).toEqual([]);
  });

  it('flags everything non-whitelisted (including normal .com)', () => {
    const hits = findSuspiciousLinks('go to foo.com/x', STRICT);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.reason).toBe('not-whitelisted');
  });

  it('subdomain suffix match still passes', () => {
    expect(findSuspiciousLinks('see api.github.com/users', STRICT)).toEqual([]);
  });
});

describe('findSuspiciousLinks · edge cases', () => {
  it('no URL in text → no hits in either mode', () => {
    expect(findSuspiciousLinks('just chatting normally', BASE)).toEqual([]);
    expect(findSuspiciousLinks('just chatting normally', { ...BASE, policy: 'strict' })).toEqual(
      [],
    );
  });

  it('deduplicates repeated hosts', () => {
    const hits = findSuspiciousLinks('bit.ly/a and bit.ly/b and bit.ly/c', BASE);
    expect(hits).toHaveLength(1);
  });

  it('multiple distinct hosts each reported once', () => {
    const hits = findSuspiciousLinks('bit.ly/a and shady.tk/b and 1.2.3.4', BASE);
    expect(hits).toHaveLength(3);
  });
});
