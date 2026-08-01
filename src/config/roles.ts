/**
 * Central registry of all Discord role names used in code paths.
 *
 * Why centralize: role names are VN strings that appear in many code
 * paths (verification grant/remove, bulk onboard, automod staff skip,
 * /title, /breakthrough, rank promoter). Hard-coding them everywhere
 * means a rename has to touch ~6 files. With this module:
 *   1. Rename here only.
 *   2. `sync-server` reads from `server-structure.ts` which references
 *      these constants (or doesn't — server-structure is the schema
 *      source of truth for Discord-side names).
 *
 * NOTE: `server-structure.ts` + `cultivation.ts` still hold the
 * "source of truth" for ordering/colors/perm presets. This file is
 * just a deduplicated lookup of NAMES for runtime code.
 */

/** Default rank assigned post-verification. */
export const ROLE_PHAM_NHAN = 'Phàm Nhân';

/** Quarantine role assigned at guildMemberAdd, removed on verification pass. */
export const ROLE_UNVERIFIED = 'Chưa Xác Minh';

/** Admin-grant only — never auto-promote/demote. */
export const ROLE_TIEN_NHAN = 'Tiên Nhân';

/** Sect master — full admin (Discord Administrator perm). */
export const ROLE_SECT_MASTER = 'Chưởng Môn';

/** Bot's decorative flair role. */
export const ROLE_BOT_FLAIR = 'Thiên Đạo';

/** Senior advisor — supermod. */
export const ROLE_ELDER = 'Trưởng Lão';

/** Mod — "law enforcer". */
export const ROLE_MOD = 'Chấp Pháp';

/**
 * Staff roles exempt from automod, message XP filters, and other
 * member-targeted automation. Includes the bot's own flair so a
 * bot message that somehow trips automod never auto-actions.
 */
export const STAFF_ROLE_NAMES: ReadonlySet<string> = new Set([
  ROLE_SECT_MASTER,
  ROLE_ELDER,
  ROLE_MOD,
  ROLE_BOT_FLAIR,
]);

/**
 * Roles allowed to run enforcement commands that alter a member's
 * standing — `/grant` above all, which mints XP, pills and contribution
 * points out of nothing.
 *
 * Chấp Pháp is in; Trưởng Lão is NOT (Bill's call, 2026-08-01). Trưởng
 * Lão is a senior advisor, not a law enforcer — the title is honorary and
 * held more widely, so putting the economy behind it would be putting it
 * behind seniority rather than behind responsibility.
 */
export const ENFORCEMENT_ROLE_NAMES: ReadonlySet<string> = new Set([
  ROLE_SECT_MASTER,
  ROLE_MOD,
]);

/**
 * Roles allowed to search other members' message history.
 *
 * DELIBERATELY NARROWER THAN STAFF (Bill's call, 2026-07-28): Trưởng Lão
 * and Chấp Pháp are staff for automod purposes but must NOT be able to
 * pull up what any given member said. Reading a person's history is a
 * different order of power from muting them — keep it to the top two.
 */
export const CHAT_SEARCH_ROLE_NAMES: ReadonlySet<string> = new Set([
  ROLE_SECT_MASTER,
  ROLE_TIEN_NHAN,
]);
