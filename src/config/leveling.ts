/**
 * Tunable balance constants for the leveling + tribulation systems.
 *
 * Why centralize: these are the dials the operator turns when tuning
 * server economy. Previously they were scattered across cooldown.ts,
 * tracker.ts, voice-xp.ts, messageReactionAdd.ts, daily.ts, and
 * tribulation.ts. Now: edit here, restart, done.
 *
 * NOT included: the XP curve coefficients (5L² + 50L + 100) which
 * are part of the engine, not balance tuning. See `engine.ts`.
 */

// ---------- Message XP ----------

/** Per-message XP roll bounds. SPEC §3: random(15, 25). */
export const MESSAGE_XP_MIN = 15;
export const MESSAGE_XP_MAX = 25;

/** Anti-grind cooldown between message XP awards per user. SPEC §3 sacred. */
export const MESSAGE_XP_COOLDOWN_MS = 60_000;

/** Minimum substantive (post-emoji-strip) chars to earn message XP. */
export const MESSAGE_XP_MIN_CHARS = 5;

// ---------- Voice XP ----------

/** Default voice XP per minute in non-Working channels (≥ 2 humans). */
export const VOICE_XP_PER_MIN = 10;

/** Bonus rate for channels in WORKING_VOICE_CHANNEL_NAMES. */
export const VOICE_WORKING_XP_PER_MIN = 15;

// ---------- Reaction XP ----------

/** XP awarded to a message AUTHOR per reaction received. */
export const REACTION_XP_AMOUNT = 2;

/** Max reactions on one message that count toward XP (anti-vote-spam). */
export const REACTION_MAX_PER_MESSAGE = 10;

/** Per-reactor cooldown across any target message. */
export const REACTION_XP_COOLDOWN_MS = 10_000;

// ---------- Daily check-in ----------

export const DAILY_BASE_XP = 100;

/** Streak-day → bonus XP. Fired ONCE on the milestone day, not recurring. */
export const DAILY_STREAK_BONUSES: ReadonlyMap<number, number> = new Map([
  [7, 50],
  [14, 150],
  [30, 500],
]);

// ---------- Tribulation ----------

export const TRIBULATION_PASS_XP = 500;
export const TRIBULATION_FAIL_PENALTY = 100;
export const TRIBULATION_MIN_LEVEL = 10;

/** Server-wide cooldown after any tribulation (cron or /breakthrough). */
export const TRIBULATION_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Math puzzle answer window. */
export const TRIBULATION_MATH_TIMEOUT_MS = 30_000;

/** Reaction-speed click window. */
export const TRIBULATION_REACTION_TIMEOUT_MS = 5_000;

/** Daily 18:00 VN cron — probability that a tribulation actually fires. */
export const TRIBULATION_DAILY_TRIGGER_CHANCE = 0.25;
