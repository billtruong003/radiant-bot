#!/usr/bin/env tsx
// IMPORTANT: env must be set BEFORE any src/* import runs, because
// src/config/env.ts validates at module load. dotenv first loads .env
// if present; we then fill in fake placeholders for anything missing
// so the smoke test runs even on a fresh checkout without a token.
import 'dotenv/config';
process.env.DISCORD_TOKEN ??= 'smoke-fake-token';
process.env.DISCORD_CLIENT_ID ??= '000000000000000000';
process.env.DISCORD_GUILD_ID ??= '000000000000000000';
process.env.LOG_LEVEL ??= 'warn';
process.env.WAL_FSYNC ??= 'false';

/**
 * Standalone smoke test for Radiant Tech Sect bot rules.
 *
 * Runs production code paths (audit, automod rules, leveling math,
 * daily streak logic, rank promotion, tribulation, Aki filter pre-stage)
 * against synthetic inputs and prints ✅/❌ per case.
 *
 * Use cases:
 *   - Before deploy: verify every rule still matches its spec
 *   - After config change: confirm thresholds behave as expected
 *   - Debugging: reproduce a kick / automod miss with deterministic inputs
 *
 * Requires .env (DISCORD_TOKEN etc. — values not used, just parsed).
 * Does NOT connect to Discord. Does NOT write to the store (uses an
 * in-memory tmp Store for the automod rules that need one).
 *
 * Exit code:
 *   0 — all passed
 *   1 — at least one failure
 *
 * Run: `npm run smoke-test`
 */

import type { GuildMember, Message } from 'discord.js';

// --- Tiny test harness ---------------------------------------------------

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

interface Result {
  group: string;
  name: string;
  ok: boolean;
  detail?: string;
}

const results: Result[] = [];
let currentGroup = '';

function group(name: string): void {
  currentGroup = name;
  console.log(`\n${ANSI.bold}${ANSI.cyan}━━ ${name} ━━${ANSI.reset}`);
}

function check(name: string, ok: boolean, detail?: string): void {
  results.push({ group: currentGroup, name, ok, detail });
  const icon = ok ? `${ANSI.green}✅${ANSI.reset}` : `${ANSI.red}❌${ANSI.reset}`;
  const detailStr = detail ? ` ${ANSI.gray}(${detail})${ANSI.reset}` : '';
  console.log(`  ${icon} ${name}${detailStr}`);
}

function expectEq<T>(actual: T, expected: T, name: string): void {
  const ok = actual === expected;
  check(
    name,
    ok,
    ok ? undefined : `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
  );
}

// --- Synthetic mock builders --------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface MockMemberOpts {
  ageDays?: number;
  hasAvatar?: boolean;
  username?: string;
  isBot?: boolean;
}

function mockMember(opts: MockMemberOpts = {}): GuildMember {
  const now = Date.now();
  const ageDays = opts.ageDays ?? 30;
  const hasAvatar = opts.hasAvatar ?? true;
  const username = opts.username ?? 'TestUser';
  const isBot = opts.isBot ?? false;
  return {
    id: 'u-smoke',
    user: {
      bot: isBot,
      tag: `${username}#0001`,
      username,
      avatar: hasAvatar ? 'avatar-hash' : null,
      createdTimestamp: now - ageDays * MS_PER_DAY,
    },
  } as unknown as GuildMember;
}

interface MockMessageOpts {
  content: string;
  userMentions?: number;
  authorId?: string;
}

function mockMessage(opts: MockMessageOpts): Message {
  return {
    id: 'msg-smoke',
    content: opts.content,
    channelId: 'channel-smoke',
    deletable: true,
    delete: async () => undefined,
    author: {
      id: opts.authorId ?? 'u-author',
      tag: 'Author#0001',
      bot: false,
      send: async () => undefined,
    },
    member: {
      moderatable: true,
      kickable: true,
      timeout: async () => undefined,
      kick: async () => undefined,
    },
    guild: { id: 'guild-smoke' },
    mentions: {
      users: { size: opts.userMentions ?? 0 },
      roles: { size: 0 },
    },
  } as unknown as Message;
}

// --- Main ----------------------------------------------------------------

async function main(): Promise<void> {
  console.log(
    `${ANSI.bold}🧪 Radiant Tech Sect — Smoke Test${ANSI.reset}\n${ANSI.dim}Runs production rule logic against synthetic inputs.${ANSI.reset}`,
  );

  await smokeVerifyAudit();
  await smokeVerifyChallenge();
  await smokeAutomod();
  await smokeLeveling();
  await smokeDaily();
  await smokeRankPromotion();
  await smokeTribulation();
  await smokeAkiFilter();

  // Summary
  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log(`\n${ANSI.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${ANSI.reset}`);
  console.log(
    `${ANSI.bold}Summary:${ANSI.reset} ${ANSI.green}${pass} passed${ANSI.reset}, ${fail > 0 ? ANSI.red : ANSI.gray}${fail} failed${ANSI.reset} / ${results.length} total`,
  );
  if (fail > 0) {
    console.log(`\n${ANSI.red}${ANSI.bold}FAILED:${ANSI.reset}`);
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`  ${ANSI.red}✗${ANSI.reset} [${r.group}] ${r.name} — ${r.detail ?? ''}`);
    }
    process.exit(1);
  }
  console.log(`\n${ANSI.green}${ANSI.bold}All smoke tests passed ٩(◕‿◕)۶${ANSI.reset}\n`);
}

// --- Verify audit -------------------------------------------------------

async function smokeVerifyAudit(): Promise<void> {
  group('Verify · Layer 1 Audit');
  const { auditMember } = await import('../src/modules/verification/audit.js');
  const { loadVerificationConfig } = await import('../src/config/verification.js');
  const config = await loadVerificationConfig();

  console.log(
    `  ${ANSI.gray}config: kickDays=${config.thresholds.accountAgeKickDays} · suspectDays=${config.thresholds.accountAgeSuspectDays}${ANSI.reset}`,
  );

  // Clean account: 30d old, custom avatar, normal name
  {
    const r = auditMember(
      mockMember({ ageDays: 30, hasAvatar: true, username: 'AliceDev' }),
      config,
    );
    expectEq(r.decision, 'clean', 'clean account (30d, avatar, normal name) → decision=clean');
  }

  // Young account: 3d old (under 7d suspect threshold)
  {
    const r = auditMember(
      mockMember({ ageDays: 3, hasAvatar: true, username: 'AliceDev' }),
      config,
    );
    expectEq(r.decision, 'suspect', 'young account (3d) → decision=suspect');
    check(
      'young account reasons mention age',
      r.reasons.some((x) => x.includes('account age')),
      r.reasons.join(' | '),
    );
  }

  // No avatar
  {
    const r = auditMember(
      mockMember({ ageDays: 30, hasAvatar: false, username: 'AliceDev' }),
      config,
    );
    expectEq(r.decision, 'suspect', 'no avatar → decision=suspect');
    check(
      'no-avatar reasons mention avatar',
      r.reasons.some((x) => x.includes('avatar')),
      r.reasons.join(' | '),
    );
  }

  // Bot pattern username (e.g. "azurajoan1996")
  {
    const r = auditMember(
      mockMember({ ageDays: 30, hasAvatar: true, username: 'azurajoan1996' }),
      config,
    );
    expectEq(r.decision, 'suspect', 'bot pattern username → decision=suspect');
    check(
      'bot-pattern reasons mention pattern',
      r.reasons.some((x) => x.includes('bot pattern')),
      r.reasons.join(' | '),
    );
  }

  // Verify auto-kick disabled when kickDays=0
  {
    const r = auditMember(mockMember({ ageDays: 0.01 }), config); // 14min old
    if (config.thresholds.accountAgeKickDays === 0) {
      expectEq(r.decision, 'suspect', 'kickDays=0: brand-new account → suspect (NOT kick)');
    } else {
      expectEq(
        r.decision,
        'kick',
        `kickDays=${config.thresholds.accountAgeKickDays}: <1h old → kick`,
      );
    }
  }
}

// --- Verify challenge ---------------------------------------------------

async function smokeVerifyChallenge(): Promise<void> {
  group('Verify · Challenge Generation');
  const { buildChallenge } = await import('../src/modules/verification/flow.js');
  const { loadVerificationConfig } = await import('../src/config/verification.js');
  const config = await loadVerificationConfig();

  // Clean → math-only challenge
  {
    const r = buildChallenge({ decision: 'clean', reasons: [], isSuspect: false }, config);
    expectEq(r.challenge_type, 'math', 'clean audit → math challenge');
    check('math challenge has no image buffer', r.dmImageBuffer === null);
  }

  // Suspect → image+math
  {
    const r = buildChallenge({ decision: 'suspect', reasons: ['age'], isSuspect: true }, config);
    expectEq(r.challenge_type, 'image+math', 'suspect audit → image+math challenge');
    check(
      'image+math challenge has PNG buffer (≥1KB)',
      r.dmImageBuffer !== null && r.dmImageBuffer.length > 1024,
      r.dmImageBuffer ? `${r.dmImageBuffer.length} bytes` : 'null',
    );
  }

  // forceHard escalates clean to image+math (raid mode)
  {
    const r = buildChallenge({ decision: 'clean', reasons: [], isSuspect: false }, config, {
      forceHard: true,
    });
    expectEq(r.challenge_type, 'image+math', 'forceHard=true → image+math even for clean audit');
  }
}

// --- Automod ------------------------------------------------------------

async function smokeAutomod(): Promise<void> {
  group('Automod · 5 rules');
  const { automodEngine } = await import('../src/modules/automod/index.js');
  const { spamTracker } = await import('../src/modules/automod/rules/spam-detection.js');
  spamTracker.reset('u-author');

  // Clean message
  {
    const d = await automodEngine.evaluate(mockMessage({ content: 'hello world, just chatting' }));
    expectEq(d, null, 'clean message → no decision');
  }

  // Profanity (VN word from default list)
  {
    const d = await automodEngine.evaluate(mockMessage({ content: 'cái này vl thật' }));
    expectEq(d?.rule.id, 'profanity', 'VN profanity ("vl") → rule=profanity');
    expectEq(d?.rule.action, 'warn', 'profanity action = warn');
  }

  // Mass mention (≥6 user mentions)
  {
    const d = await automodEngine.evaluate(
      mockMessage({ content: 'hey @a @b @c @d @e @f', userMentions: 6 }),
    );
    expectEq(d?.rule.id, 'mass_mention', '6 mentions → rule=mass_mention');
    expectEq(d?.rule.action, 'timeout', 'mass_mention action = timeout');
  }

  // Mass mention below threshold (5 mentions)
  {
    const d = await automodEngine.evaluate(
      mockMessage({ content: 'hey @a @b @c @d @e', userMentions: 5 }),
    );
    check('5 mentions → no decision (below threshold of 6)', d === null);
  }

  // Link whitelist — non-whitelisted
  {
    const d = await automodEngine.evaluate(mockMessage({ content: 'check evil.example.com/free' }));
    expectEq(d?.rule.id, 'link', 'non-whitelisted link → rule=link');
  }

  // Link whitelist — whitelisted github.com is clean
  {
    spamTracker.reset('u-author');
    const d = await automodEngine.evaluate(
      mockMessage({ content: 'see https://github.com/foo/bar' }),
    );
    expectEq(d, null, 'whitelisted github link → no decision');
  }

  // Caps lock (>70% caps, ≥10 chars)
  {
    spamTracker.reset('u-author');
    const d = await automodEngine.evaluate(mockMessage({ content: 'HELLO EVERYBODY HOW ARE YOU' }));
    expectEq(d?.rule.id, 'caps', 'all-caps message → rule=caps');
  }

  // Caps but short (< 10 chars) is fine
  {
    spamTracker.reset('u-author');
    const d = await automodEngine.evaluate(mockMessage({ content: 'OK COOL' }));
    expectEq(d, null, 'short caps message (<10 chars) → no decision');
  }

  // Spam: same message 5x within window
  {
    spamTracker.reset('u-author');
    let lastHit: string | null = null;
    for (let i = 0; i < 5; i++) {
      const d = await automodEngine.evaluate(
        mockMessage({ content: 'buy crypto now', authorId: 'u-author' }),
      );
      if (d?.rule.id === 'spam') lastHit = 'spam';
    }
    expectEq(lastHit, 'spam', '5× duplicate message → rule=spam fires by 5th');
  }
}

// --- Leveling math ------------------------------------------------------

async function smokeLeveling(): Promise<void> {
  group('Leveling · XP curve + level math');
  const { xpToNext, levelFromXp, levelProgress, cumulativeXpForLevel } = await import(
    '../src/modules/leveling/engine.js'
  );

  expectEq(xpToNext(0), 100, 'xpToNext(0) = 100 (5·0² + 50·0 + 100)');
  expectEq(xpToNext(1), 155, 'xpToNext(1) = 155 (5·1 + 50 + 100)');
  expectEq(xpToNext(10), 1100, 'xpToNext(10) = 1100 (500 + 500 + 100)');

  expectEq(levelFromXp(0), 0, 'levelFromXp(0) = 0');
  expectEq(levelFromXp(99), 0, 'levelFromXp(99) = 0 (below level-1 threshold)');
  expectEq(levelFromXp(100), 1, 'levelFromXp(100) = 1 (exactly at threshold)');

  // Sum of 5L²+50L+100 for L=0..9 = 4675. (Note: engine.ts doc comment
  // says "≈1,800" which is stale — actual matches SPEC §2 formula.)
  const c10 = cumulativeXpForLevel(10);
  expectEq(c10, 4675, 'cumulativeXpForLevel(10) = 4675 (Σ 5L²+50L+100 for L=0..9)');

  const prog = levelProgress(150);
  expectEq(prog.level, 1, 'levelProgress(150).level = 1');
  expectEq(prog.currentInLevel, 50, 'levelProgress(150).currentInLevel = 50 (150 − 100)');
  expectEq(prog.neededForNext, 155, 'levelProgress(150).neededForNext = 155 (xpToNext(1))');
}

// --- Daily streak --------------------------------------------------------

async function smokeDaily(): Promise<void> {
  group('Daily · Streak + bonus math');
  const { computeDailyAward } = await import('../src/modules/leveling/daily.js');

  const TZ = 'Asia/Ho_Chi_Minh';
  const NOW = Date.parse('2026-05-14T12:00:00+07:00');
  const YESTERDAY = NOW - MS_PER_DAY;

  // First claim ever (no user / never claimed)
  {
    const r = computeDailyAward(null, NOW, TZ);
    expectEq(r.ok, true, 'first claim → ok=true');
    expectEq(r.amount, 100, 'first claim → 100 XP base');
    expectEq(r.newStreak, 1, 'first claim → streak=1');
  }

  // Continuation (claimed yesterday, claim today)
  {
    const user = makeUserFor({ daily_streak: 5, last_daily_at: YESTERDAY });
    const r = computeDailyAward(user, NOW, TZ);
    expectEq(r.ok, true, 'continuation → ok=true');
    expectEq(r.newStreak, 6, 'continuation: streak 5 → 6');
    expectEq(r.bonus, 0, 'streak 6 → no bonus');
  }

  // Streak milestone — day 7 → +50 bonus
  {
    const user = makeUserFor({ daily_streak: 6, last_daily_at: YESTERDAY });
    const r = computeDailyAward(user, NOW, TZ);
    expectEq(r.newStreak, 7, 'streak 6+1 = 7');
    expectEq(r.bonus, 50, 'streak day 7 → +50 bonus');
    expectEq(r.amount, 150, '100 base + 50 bonus = 150');
  }

  // Streak milestone — day 30 → +500 bonus
  {
    const user = makeUserFor({ daily_streak: 29, last_daily_at: YESTERDAY });
    const r = computeDailyAward(user, NOW, TZ);
    expectEq(r.newStreak, 30, 'streak 29+1 = 30');
    expectEq(r.bonus, 500, 'streak day 30 → +500 bonus');
    expectEq(r.amount, 600, '100 base + 500 bonus = 600');
  }

  // Already claimed today
  {
    const user = makeUserFor({ daily_streak: 7, last_daily_at: NOW });
    const r = computeDailyAward(user, NOW, TZ);
    expectEq(r.ok, false, 'claimed today → ok=false');
    expectEq(r.reason, 'already-claimed-today', 'reason=already-claimed-today');
  }

  // Missed yesterday → streak resets
  {
    const user = makeUserFor({ daily_streak: 10, last_daily_at: NOW - 3 * MS_PER_DAY });
    const r = computeDailyAward(user, NOW, TZ);
    expectEq(r.newStreak, 1, 'missed 3 days → streak resets to 1');
  }
}

function makeUserFor(opts: { daily_streak: number; last_daily_at: number | null }) {
  return {
    discord_id: 'u-smoke',
    username: 'Smoke',
    display_name: null,
    xp: 0,
    level: 0,
    cultivation_rank: 'pham_nhan' as const,
    sub_title: null,
    joined_at: 0,
    verified_at: null,
    last_message_at: null,
    last_daily_at: opts.last_daily_at,
    daily_streak: opts.daily_streak,
    is_suspect: false,
    notes: null,
  };
}

// --- Rank promotion ------------------------------------------------------

async function smokeRankPromotion(): Promise<void> {
  group('Rank · level → cảnh giới mapping');
  const { rankForLevel, rankById } = await import('../src/config/cultivation.js');

  expectEq(rankForLevel(0), 'pham_nhan', 'level 0 → Phàm Nhân');
  expectEq(rankForLevel(1), 'luyen_khi', 'level 1 → Luyện Khí');
  expectEq(rankForLevel(9), 'luyen_khi', 'level 9 → Luyện Khí (boundary)');
  expectEq(rankForLevel(10), 'truc_co', 'level 10 → Trúc Cơ');
  expectEq(rankForLevel(20), 'kim_dan', 'level 20 → Kim Đan');
  expectEq(rankForLevel(35), 'nguyen_anh', 'level 35 → Nguyên Anh');
  expectEq(rankForLevel(50), 'hoa_than', 'level 50 → Hóa Thần');
  expectEq(rankForLevel(70), 'luyen_hu', 'level 70 → Luyện Hư');
  expectEq(rankForLevel(90), 'hop_the', 'level 90 → Hợp Thể');
  expectEq(rankForLevel(120), 'dai_thua', 'level 120 → Đại Thừa');
  expectEq(rankForLevel(160), 'do_kiep', 'level 160 → Độ Kiếp');
  expectEq(rankForLevel(999), 'do_kiep', 'level 999 → Độ Kiếp (capped, no Tiên Nhân auto)');

  const phamNhan = rankById('pham_nhan');
  expectEq(phamNhan.name, 'Phàm Nhân', 'rankById(pham_nhan).name = Phàm Nhân');
}

// --- Tribulation balance -------------------------------------------------

async function smokeTribulation(): Promise<void> {
  group('Tribulation · XP balance constants');
  const { TRIBULATION_PASS_XP, TRIBULATION_FAIL_PENALTY, TRIBULATION_MIN_LEVEL } = await import(
    '../src/config/leveling.js'
  );

  expectEq(TRIBULATION_PASS_XP, 500, 'pass reward = 500 XP (per SPEC)');
  expectEq(TRIBULATION_FAIL_PENALTY, 100, 'fail penalty = 100 XP (per SPEC)');
  expectEq(TRIBULATION_MIN_LEVEL, 10, 'min level for breakthrough = 10 (Trúc Cơ)');
}

// --- Aki filter ----------------------------------------------------------

async function smokeAkiFilter(): Promise<void> {
  group('Aki · Pre-filter heuristics');
  const { preFilterObvious } = await import('../src/modules/aki/persona-filter.js');

  check('short input (<3 chars) → rejected', preFilterObvious('ab') !== null);
  check('emoji-only → rejected', preFilterObvious('🔥🔥🔥') !== null);
  check('punctuation-only → rejected', preFilterObvious('???') !== null);
  check(
    'real VN question → passes (null)',
    preFilterObvious('cách lên cảnh giới Kim Đan') === null,
  );
  check('English question → passes (null)', preFilterObvious('what is git rebase?') === null);
}

// --- Run -----------------------------------------------------------------

main().catch((err) => {
  console.error(`${ANSI.red}smoke-test crashed:${ANSI.reset}`, err);
  process.exit(2);
});
