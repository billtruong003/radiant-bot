/**
 * Canonical server vocabulary for request routing.
 *
 * Pure data, zero imports — `src/commands/index.ts` pulls in every command
 * module (including `/ask aki`, which pulls in Aki's client), so importing the
 * live registry from the analysis path would close an import cycle.
 *
 * The anti-drift measure is a test, not discipline:
 * `tests/config/server-vocab.test.ts` asserts this list still equals the
 * real command registry. Add a command without adding it here and the
 * suite fails — which is the only duplication-control that actually holds.
 */

/** Slash command names, mirrored from `src/commands/index.ts`. */
export const SERVER_COMMAND_NAMES: readonly string[] = [
  'admin',
  'ai',
  'ask',
  'breakthrough',
  'contribute-doc',
  'daily',
  'duel',
  'gear',
  'help',
  'hunter',
  'leaderboard',
  'mod',
  'profile',
  'quest',
  'shop',
  'title',
  'tra-cuu',
];

/**
 * Names the commands had before they were merged (/weapon is now /gear
 * weapon). Members keep typing them for a while, so a question that mentions
 * one is still about this server.
 */
export const LEGACY_COMMAND_NAMES: readonly string[] = [
  'ai-debug',
  'ai-models',
  'aki-memory',
  'arena',
  'ask-akira',
  'ask-meifeng',
  'automod-config',
  'cong-phap',
  'danh-hieu',
  'grant',
  'inventory',
  'link-whitelist',
  'me',
  'nhan',
  'phap-khi',
  'raid-mode',
  'rank',
  'selftest',
  'stat',
  'stat-alloc',
  'stats',
  'sync-pinned',
  'thien-dao',
  'trade',
  'tutorial',
  'verify-test',
  'weapon',
];

/**
 * Cultivation/game domain terms. A question containing these is about THIS
 * server, so it should be answered from canonical runtime data rather than
 * from a free model's training memory — which is how Aki invented XP
 * numbers that did not match the config.
 */
export const SERVER_DOMAIN_TERMS: readonly string[] = [
  'tu vi',
  'tu vị',
  'cảnh giới',
  'độ kiếp',
  'thiên đạo',
  'linh thạch',
  'công pháp',
  'pháp khí',
  'danh hiệu',
  'chưởng môn',
  'trưởng lão',
  'chấp pháp',
  'tiên nhân',
  'kiếm tu',
  'đan sư',
  'trận pháp sư',
  'tán tu',
  'tông môn',
  'đấu pháp',
  'luyện khí',
  'trúc cơ',
  'kim đan',
  'nguyên anh',
  'hóa thần',
  'xp',
  'exp',
  'level',
  'cấp độ',
  'điểm kinh nghiệm',
  'leaderboard',
  'bảng xếp hạng',
  'nhiệm vụ',
  'điểm danh',
  'cooldown',
  'hồi chiêu',
];
