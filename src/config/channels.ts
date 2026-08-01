import type { GuildBasedChannel } from 'discord.js';

/**
 * Channel-name helpers.
 *
 * Phase 11 A5: channels now carry decorative icons (e.g. `💬-general-💬`).
 * The cache maps BOTH the raw display name AND a canonical slug-form
 * ("general") to the same channel id, so legacy lookups by canonical
 * name keep working after the rename.
 */

/**
 * Strip emoji + collapse separators to extract the canonical slug.
 *   `💬-general-💬` → `general`
 *   `🎮 Gaming 2 🎮` → `gaming-2`
 *   `bot-log` → `bot-log` (unchanged)
 *
 * Used both at cache build time (to index canonical → id) and at lookup
 * sites that want substring matching.
 */
export function canonicalChannelName(rawName: string): string {
  // Remove anything that's not ASCII alphanumeric / hyphen / underscore /
  // space. This drops emoji + assorted unicode without taking a hard
  // dependency on a unicode property regex.
  let s = rawName.toLowerCase().replace(/[^a-z0-9\-_ ]+/g, '');
  s = s.replace(/[\s_]+/g, '-');
  s = s.replace(/-+/g, '-');
  s = s.replace(/^-+|-+$/g, '');
  return s;
}

/**
 * True if the channel matches the given canonical name (icons & spacing
 * tolerated). Caller-side helper for `channels.cache.find(...)`.
 */
export function matchesChannelName(channel: GuildBasedChannel, canonical: string): boolean {
  return canonicalChannelName(channel.name) === canonical;
}

/**
 * Channels where XP is NOT awarded for messages. Keys are CANONICAL
 * (slug) names; use `isNoXpChannel(raw)` to compare against actual
 * display names which may carry decorative icons.
 */
export const NO_XP_CHANNEL_NAMES: ReadonlySet<string> = new Set([
  'bot-commands',
  'bot-dev',
  'bot-log',
  'verify',
]);

/** Canonical-aware membership check for NO_XP_CHANNEL_NAMES. */
export function isNoXpChannel(rawName: string): boolean {
  return NO_XP_CHANNEL_NAMES.has(canonicalChannelName(rawName));
}

export const ANNOUNCEMENT_CHANNELS = {
  sectLog: 'bot-log',
  levelUp: 'level-up',
  leaderboard: 'leaderboard',
  tribulation: 'tribulation',
  verification: 'verify',
} as const;

/**
 * Voice channels that earn the "Working" XP bonus. Canonical (slugged)
 * names — voice channels can hold spaces but `canonicalChannelName`
 * normalises both forms.
 */
export const WORKING_VOICE_CHANNEL_NAMES: ReadonlySet<string> = new Set([
  'focus-room',
  'quiet-study',
]);

/** Canonical-aware membership check for WORKING_VOICE_CHANNEL_NAMES. */
export function isWorkingVoiceChannel(rawName: string): boolean {
  return WORKING_VOICE_CHANNEL_NAMES.has(canonicalChannelName(rawName));
}
