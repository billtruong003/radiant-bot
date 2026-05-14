import type { Message } from 'discord.js';
import { loadAutomodConfig } from '../../../config/automod.js';
import type { AutomodRule, RuleHit } from '../types.js';

/**
 * Link moderation — two modes, picked by `linkPolicy` in automod.json
 * (default `permissive` as of 2026-05-14 per Bill: "ng ta muốn đc tự
 * do add link thì sao? chỉ check các link đáng ngờ thôi").
 *
 * Mode `permissive` (default):
 *   ALLOW any link UNLESS the host trips one of:
 *     - is in `linkBlacklist` (known bad)
 *     - is a known URL shortener (`linkShorteners`)
 *     - has a TLD in `linkSuspectTlds` (free TLDs commonly abused)
 *     - is an IP literal (rare-in-Discord, almost always sketchy)
 *     - is a punycode domain (`xn--`, often homograph attacks)
 *   Whitelisted hosts skip every check (fast path).
 *
 * Mode `strict`:
 *   Legacy behavior. Only whitelisted hosts pass; everything else is
 *   blocked. Use during raids.
 */

// Captures `https://foo.bar.com/path` or bare `foo.bar.com/x`.
// Restrict TLD to letters so "foo.123" isn't treated as a URL.
const URL_RE = /\b(?:https?:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:\/[^\s]*)?/gi;
// Bare IP-host form, e.g. `http://1.2.3.4/...`
const IP_HOST_RE = /\b(?:https?:\/\/)?((?:\d{1,3}\.){3}\d{1,3})(?::\d+)?(?:\/[^\s]*)?/gi;

export interface LinkPolicyConfig {
  policy: 'permissive' | 'strict';
  whitelist: readonly string[];
  blacklist: readonly string[];
  shorteners: readonly string[];
  suspectTlds: readonly string[];
}

interface LinkHit {
  host: string;
  reason: 'blacklist' | 'shortener' | 'suspect-tld' | 'ip-host' | 'punycode' | 'not-whitelisted';
}

function hostMatches(host: string, candidate: string): boolean {
  const h = host.toLowerCase();
  const c = candidate.toLowerCase();
  return h === c || h.endsWith(`.${c}`);
}

function isInList(host: string, list: readonly string[]): boolean {
  for (const c of list) {
    if (hostMatches(host, c)) return true;
  }
  return false;
}

function getTld(host: string): string {
  const idx = host.lastIndexOf('.');
  return idx === -1 ? '' : host.slice(idx + 1).toLowerCase();
}

/**
 * Pure helper, exported for tests. Returns the list of link hits.
 * `permissive`: only sketchy links fire. `strict`: everything outside
 * the whitelist fires (legacy behavior).
 */
export function findSuspiciousLinks(text: string, cfg: LinkPolicyConfig): LinkHit[] {
  const seen = new Set<string>();
  const hits: LinkHit[] = [];

  // First pass: IP-literal hosts (always sketchy in permissive mode).
  for (const m of text.matchAll(IP_HOST_RE)) {
    const ip = (m[1] ?? '').toLowerCase();
    if (!ip || seen.has(ip)) continue;
    seen.add(ip);
    if (cfg.policy === 'permissive') {
      hits.push({ host: ip, reason: 'ip-host' });
    } else {
      hits.push({ host: ip, reason: 'not-whitelisted' });
    }
  }

  // Second pass: normal domain URLs.
  for (const m of text.matchAll(URL_RE)) {
    const host = (m[1] ?? '').toLowerCase();
    if (!host || seen.has(host)) continue;
    // Don't double-process IP literals (already handled above).
    if (/^\d/.test(host)) continue;
    seen.add(host);

    // Whitelist is the fast-pass in BOTH modes.
    if (isInList(host, cfg.whitelist)) continue;

    if (cfg.policy === 'strict') {
      hits.push({ host, reason: 'not-whitelisted' });
      continue;
    }

    // Permissive mode: only flag if a heuristic trips.
    if (isInList(host, cfg.blacklist)) {
      hits.push({ host, reason: 'blacklist' });
      continue;
    }
    if (isInList(host, cfg.shorteners)) {
      hits.push({ host, reason: 'shortener' });
      continue;
    }
    if (host.startsWith('xn--')) {
      hits.push({ host, reason: 'punycode' });
      continue;
    }
    const tld = getTld(host);
    if (tld && cfg.suspectTlds.includes(tld)) {
      hits.push({ host, reason: 'suspect-tld' });
    }
    // Otherwise: permissive lets it through.
  }
  return hits;
}

const REASON_VN: Record<LinkHit['reason'], string> = {
  blacklist: 'domain bị chặn',
  shortener: 'link rút gọn (URL shortener) — không rõ điểm đến',
  'suspect-tld': 'TLD đáng ngờ (thường dùng cho spam/phishing)',
  'ip-host': 'link IP-only — bất thường',
  punycode: 'domain punycode (có thể là homograph)',
  'not-whitelisted': 'domain ngoài whitelist',
};

function buildWarnText(hits: LinkHit[]): string {
  const first = hits[0];
  if (!first) return '⚠️ Tin nhắn bị xoá vì chứa liên kết đáng ngờ.';
  return `⚠️ Tin nhắn bị xoá vì chứa liên kết đáng ngờ (${REASON_VN[first.reason]}). Nếu là domain hợp lệ, liên hệ mod để thêm vào whitelist.`;
}

/** Back-compat helper preserved for any caller still expecting the old API. */
export function findNonWhitelistedHosts(text: string, whitelist: readonly string[]): string[] {
  const hits = findSuspiciousLinks(text, {
    policy: 'strict',
    whitelist,
    blacklist: [],
    shorteners: [],
    suspectTlds: [],
  });
  return hits.map((h) => h.host);
}

export const linkWhitelistRule: AutomodRule = {
  id: 'link',
  name: 'Suspicious link',
  severity: 2,
  action: 'warn',
  warnText:
    '⚠️ Tin nhắn bị xoá vì chứa liên kết đáng ngờ. Nếu là domain hợp lệ, nhắn mod để thêm vào whitelist.',
  async detect(message: Message): Promise<RuleHit | null> {
    const config = await loadAutomodConfig();
    const hits = findSuspiciousLinks(message.content, {
      policy: config.linkPolicy,
      whitelist: config.linkWhitelist,
      blacklist: config.linkBlacklist,
      shorteners: config.linkShorteners,
      suspectTlds: config.linkSuspectTlds,
    });
    if (hits.length === 0) return null;
    return {
      reason: `link flagged: ${hits.map((h) => `${h.host}(${h.reason})`).join(', ')}`,
      context: {
        hosts: hits.map((h) => h.host),
        reasons: hits.map((h) => h.reason),
      },
    };
  },
};

// Re-export internal helper for VN reason mapping (used in tests / future
// dynamic DM customisation).
export { buildWarnText };
