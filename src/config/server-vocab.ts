/**
 * Canonical server vocabulary for request routing.
 *
 * Pure data, zero imports — `src/commands/index.ts` pulls in every command
 * module (including `/ask`, which pulls in Aki's client), so importing the
 * live registry from the analysis path would close an import cycle.
 *
 * The anti-drift measure is a test, not discipline:
 * `tests/config/server-vocab.test.ts` asserts this list still equals the
 * real command registry. Add a command without adding it here and the
 * suite fails — which is the only duplication-control that actually holds.
 */

/** Slash command names, mirrored from `src/commands/index.ts`. */
export const SERVER_COMMAND_NAMES: readonly string[] = [
  'ai-debug',
  'ai-models',
  'aki-memory',
  'arena',
  'ask',
  'ask-akira',
  'ask-meifeng',
  'automod-config',
  'breakthrough',
  'cong-phap',
  'contribute-doc',
  'daily',
  'danh-hieu',
  'duel',
  'grant',
  'help',
  'inventory',
  'leaderboard',
  'link-whitelist',
  'me',
  'nhan',
  'phap-khi',
  'quest',
  'raid-mode',
  'rank',
  'selftest',
  'shop',
  'stat',
  'stat-alloc',
  'stats',
  'sync-pinned',
  'thien-dao',
  'title',
  'tra-cuu',
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
