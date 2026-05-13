/**
 * SPEC §3 anti-abuse: messages shorter than 5 "substantive" chars or
 * emoji-only don't earn XP. Substantive length = char count after
 * stripping custom Discord emojis (`<:name:id>` / `<a:name:id>`) and
 * standard Unicode emojis.
 *
 * Pure functions — no I/O, no Discord types. Easy to unit-test.
 */

const CUSTOM_EMOJI_RE = /<a?:\w+:\d+>/g;
// `\p{Extended_Pictographic}` covers most emoji glyphs; FE0F is the variation
// selector; 200D is zero-width-joiner used in emoji sequences (flags, family).
const UNICODE_EMOJI_RE = /\p{Extended_Pictographic}|\u{FE0F}|\u{200D}/gu;

export function substantiveLength(content: string): number {
  return content.replace(CUSTOM_EMOJI_RE, '').replace(UNICODE_EMOJI_RE, '').trim().length;
}

export function isXpEligibleMessage(content: string): boolean {
  return substantiveLength(content) >= 5;
}
