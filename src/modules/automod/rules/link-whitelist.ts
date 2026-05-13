import type { Message } from 'discord.js';
import { loadAutomodConfig } from '../../../config/automod.js';
import type { AutomodRule, RuleHit } from '../types.js';

/**
 * Link whitelist: any URL whose hostname (or registrable parent) is not
 * in the whitelist is deleted + warned. Whitelist is JSON-config, so
 * adding `example.com` covers `sub.example.com` too via suffix match.
 *
 * Matches http://, https://, and bare domain.tld/path forms.
 */

// Captures something like "https://foo.bar.com/path" or "foo.bar.com/x".
// Restrict TLD to letters so "foo.123" isn't treated as a URL.
const URL_RE = /\b(?:https?:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:\/[^\s]*)?/gi;

/**
 * Pure helper, exported for tests. Returns the list of non-whitelisted
 * hostnames found in the text, or empty array.
 */
export function findNonWhitelistedHosts(text: string, whitelist: readonly string[]): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(URL_RE)) {
    const hostname = (match[1] ?? '').toLowerCase();
    if (!hostname) continue;
    const isWhitelisted = whitelist.some(
      (w) => hostname === w.toLowerCase() || hostname.endsWith(`.${w.toLowerCase()}`),
    );
    if (!isWhitelisted) found.add(hostname);
  }
  return [...found];
}

export const linkWhitelistRule: AutomodRule = {
  id: 'link',
  name: 'Non-whitelisted link',
  severity: 2,
  action: 'warn',
  warnText:
    '⚠️ Tin nhắn bị xoá vì chứa liên kết ngoài danh sách cho phép. Liên hệ mod nếu cần thêm domain vào whitelist.',
  async detect(message: Message): Promise<RuleHit | null> {
    const config = await loadAutomodConfig();
    const hits = findNonWhitelistedHosts(message.content, config.linkWhitelist);
    if (hits.length === 0) return null;
    return {
      reason: `non-whitelisted link(s): ${hits.join(', ')}`,
      context: { hosts: hits },
    };
  },
};
