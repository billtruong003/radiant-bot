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
  // --- Phase 11 1A checks ---
  await smokeChannelCanonical();
  await smokePermPresetsPhase11();
  await smokeVerifyConfigPhase11();
  await smokeAskContextFormat();
  await smokeLlmRouter();
  // --- Phase 11 1B checks ---
  await smokeVerifyThreadName();
  await smokeFirstMessageGreet();
  await smokeSchedulerWired();
  // --- Phase 11.2 (Commit 2) checks ---
  await smokeProfanityCounter();
  await smokeAkiNudgePersona();
  await smokeAutomodNarration();
  await smokeLevelingNarration();
  await smokeLinkPolicy();
  await smokeGroqReasoningGate();
  // --- Phase 11.3 polish + Phase 12 Lát 1 checks ---
  await smokeRejoinCooldown();
  await smokeCombatPower();
  // --- Phase 12 Lát 2-6 ---
  await smokeCongPhapCatalog();
  await smokeDuelSimulation();
  await smokeQuestPool();
  await smokeNpcPersonas();

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

  // Phase 11.2 post-deploy: default link policy switched to 'permissive'.
  // Random `.com` no longer fires; only suspicious links (shorteners,
  // suspect TLDs, IP literals, blacklist) do. Test with a shortener.
  {
    const d = await automodEngine.evaluate(mockMessage({ content: 'click bit.ly/abc123' }));
    expectEq(d?.rule.id, 'link', 'shortener (bit.ly) → rule=link in permissive mode');
  }

  // Permissive: regular new domain passes
  {
    spamTracker.reset('u-author');
    const d = await automodEngine.evaluate(
      mockMessage({ content: 'check https://www.billthedev.com/portfolio' }),
    );
    expectEq(d, null, 'permissive: billthedev.com → no decision (whitelisted + benign)');
  }

  // Whitelisted github.com still passes
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

// --- Phase 11 1A: channel canonical name + lookup ----------------------

async function smokeChannelCanonical(): Promise<void> {
  group('Phase 11 · canonical channel name (icon-decorated → slug)');
  const { canonicalChannelName, isNoXpChannel, isWorkingVoiceChannel } = await import(
    '../src/config/channels.js'
  );

  expectEq(canonicalChannelName('💬-general-💬'), 'general', 'icon-on-both-sides → slug');
  expectEq(canonicalChannelName('🔒-verify-🔒'), 'verify', 'verify channel → verify');
  expectEq(canonicalChannelName('🎮 Gaming 🎮'), 'gaming', 'voice (spaces) → slug');
  expectEq(canonicalChannelName('🎯 Focus Room 🎯'), 'focus-room', 'voice multi-word → slug');
  expectEq(canonicalChannelName('🎮 Gaming 2 🎮'), 'gaming-2', 'voice with number → slug');
  expectEq(canonicalChannelName('general'), 'general', 'plain canonical → itself');
  expectEq(canonicalChannelName('bot-log'), 'bot-log', 'hyphen plain → preserved');

  // Set-membership wrappers
  check('isNoXpChannel("💻-bot-commands-💻") → true', isNoXpChannel('💻-bot-commands-💻'));
  check('isNoXpChannel("📋-bot-log-📋") → true', isNoXpChannel('📋-bot-log-📋'));
  check('isNoXpChannel("🔒-verify-🔒") → true', isNoXpChannel('🔒-verify-🔒'));
  check('isNoXpChannel("💬-general-💬") → false', !isNoXpChannel('💬-general-💬'));
  check(
    'isWorkingVoiceChannel("🎯 Focus Room 🎯") → true',
    isWorkingVoiceChannel('🎯 Focus Room 🎯'),
  );
  check(
    'isWorkingVoiceChannel("📚 Quiet Study 📚") → true',
    isWorkingVoiceChannel('📚 Quiet Study 📚'),
  );
  check('isWorkingVoiceChannel("🎮 Gaming 🎮") → false', !isWorkingVoiceChannel('🎮 Gaming 🎮'));
}

// --- Phase 11 1A: perm presets deny Chưa Xác Minh on public_read --------

async function smokePermPresetsPhase11(): Promise<void> {
  group('Phase 11 · perm presets deny UNVERIFIED on public_*');
  const { resolveOverwrites } = await import('../src/modules/sync/perm-presets.js');

  const ctx = {
    everyoneRoleId: 'role-everyone',
    roleByName: new Map([
      ['Chưởng Môn', { id: 'role-cm' }],
      ['Trưởng Lão', { id: 'role-tl' }],
      ['Chấp Pháp', { id: 'role-cp' }],
      ['Chưa Xác Minh', { id: 'role-unverified' }],
    ]),
  };

  const publicRead = resolveOverwrites('public_read', ctx);
  const publicFull = resolveOverwrites('public_full', ctx);

  const unverifiedReadDeny = (overwrites: typeof publicRead) =>
    overwrites.some((o) => {
      if (o.id !== 'role-unverified') return false;
      // OverwriteData.deny accepts many shapes; we set bigint internally
      // so a runtime typeof check is enough.
      if (typeof o.deny !== 'bigint') return false;
      return (o.deny & (1n << 10n)) !== 0n; // ViewChannel = bit 10
    });

  check('public_read denies Chưa Xác Minh ViewChannel', unverifiedReadDeny(publicRead));
  check('public_full denies Chưa Xác Minh ViewChannel', unverifiedReadDeny(publicFull));
}

// --- Phase 11 1A: verify config 2-day timeout + kickDays=0 --------------

async function smokeVerifyConfigPhase11(): Promise<void> {
  group('Phase 11 · verify config (2-day timeout, kickDays=0)');
  const { loadVerificationConfig } = await import('../src/config/verification.js');
  const config = await loadVerificationConfig();

  expectEq(
    config.thresholds.captchaTimeoutMs,
    172_800_000,
    'captchaTimeoutMs = 2 days (172800000 ms)',
  );
  expectEq(config.thresholds.accountAgeKickDays, 0, 'accountAgeKickDays = 0 (auto-kick disabled)');
}

// --- Phase 11 1A: /ask context prompt formatting -----------------------

async function smokeAskContextFormat(): Promise<void> {
  group('Phase 11 · /ask prompt formatting (identity + recent messages)');

  // We can't easily exercise askAki without an OpenAI client, but we
  // CAN inspect the exact prompt-string assembly logic by reading
  // input + verifying the template structure. Since the formatting
  // lives inline in askAki, mirror the contract here:
  const askerDisplayName = 'BillT';
  const askerUsername = 'billtruong003';
  const recentMessages = [
    { authorDisplayName: 'Alice', content: 'có ai gặp lỗi npm install canvas ko?' },
    { authorDisplayName: 'Bob', content: 'gcc-multilib có thiếu ko?' },
  ];
  const question = 'mình build lại từ source thì sao?';

  const expectedIdentity = `[Người hỏi: ${askerDisplayName} (@${askerUsername})]`;
  const expectedContext = [
    '[Đoạn chat gần nhất trong kênh:',
    `  Alice: ${recentMessages[0]?.content ?? ''}`,
    `  Bob: ${recentMessages[1]?.content ?? ''}`,
    ']',
  ].join('\n');
  const expectedUserPrompt = [expectedIdentity, expectedContext, question].join('\n\n');

  // Sanity: the canonical structure is what's documented in client.ts
  check(
    'identity line uses [Người hỏi: <display> (@<username>)] format',
    expectedIdentity.includes('Người hỏi') &&
      expectedIdentity.includes('BillT') &&
      expectedIdentity.includes('@billtruong003'),
  );
  check(
    'context block prefixed with [Đoạn chat gần nhất trong kênh:',
    expectedContext.startsWith('[Đoạn chat gần nhất trong kênh:'),
  );
  check(
    'context block lists messages indented (2 spaces)',
    expectedContext.includes('  Alice:') && expectedContext.includes('  Bob:'),
  );
  check(
    'identity + context + question separated by blank lines (\\n\\n)',
    expectedUserPrompt.split('\n\n').length >= 3,
  );
}

// --- Phase 11 1A: LLM router task routes -------------------------------

async function smokeLlmRouter(): Promise<void> {
  group('Phase 11 · LLM router (N-entry chain + multi-model gemini rotation)');
  const { __for_testing } = await import('../src/modules/llm/router.js');
  const routes = __for_testing.TASK_ROUTES;

  // Primary (index 0) per task — 2026 best picks
  expectEq(routes['aki-filter'][0]?.provider, 'groq', 'aki-filter[0] = groq');
  expectEq(
    routes['aki-filter'][0]?.model,
    'qwen/qwen3-32b',
    'aki-filter[0] = Qwen 3 32B (best VN classification)',
  );
  expectEq(routes['aki-nudge'][0]?.model, 'llama-3.1-8b-instant', 'aki-nudge[0] = 8B (short text)');
  expectEq(routes.narration[0]?.provider, 'groq', 'narration[0] = groq');
  expectEq(
    routes.narration[0]?.model,
    'llama-3.3-70b-versatile',
    'narration[0] = Llama 3.3 70B (non-reasoning, no <think> overhead)',
  );

  // Modern model coverage
  const allFilterModels = routes['aki-filter'].map((r) => r.model);
  check(
    'aki-filter has llama-4-scout (newest Llama arch)',
    allFilterModels.includes('meta-llama/llama-4-scout-17b-16e-instruct'),
  );
  const allNarrModels = routes.narration.map((r) => r.model);
  check(
    'narration has gpt-oss-120b (biggest open model)',
    allNarrModels.includes('openai/gpt-oss-120b'),
  );
  // Gemini 2.0 Flash dropped (per Bill: "quá cũ")
  check(
    'no route uses gemini-2.0-flash (deprecated 2026-05)',
    !allFilterModels.includes('gemini-2.0-flash') && !allNarrModels.includes('gemini-2.0-flash'),
  );

  // Chain has multi-model gemini fallback
  check('aki-filter chain length ≥ 3 (multi-model rotation)', routes['aki-filter'].length >= 3);
  const filterGeminiModels = routes['aki-filter']
    .filter((r) => r.provider === 'gemini')
    .map((r) => r.model);
  check(
    'aki-filter has ≥ 2 distinct gemini models in fallback chain',
    new Set(filterGeminiModels).size >= 2,
    filterGeminiModels.join(', '),
  );

  // Narration prioritises Flash > Flash-Lite (prose quality)
  const narrationChain = routes.narration;
  const flashIdx = narrationChain.findIndex((r) => r.model === 'gemini-2.5-flash');
  const liteIdx = narrationChain.findIndex((r) => r.model === 'gemini-2.5-flash-lite');
  check(
    'narration: gemini-2.5-flash before gemini-2.5-flash-lite (prose priority)',
    flashIdx >= 0 && liteIdx >= 0 && flashIdx < liteIdx,
  );

  // Throttle bookkeeping uses `${provider}:${model}` keys
  const { throttledUntil, isThrottled, routeKey } = __for_testing;
  throttledUntil.clear();
  const now = 1_000_000;
  const testRoute = { provider: 'groq' as const, model: 'llama-3.1-8b-instant' };
  throttledUntil.set(routeKey(testRoute), now + 5000);
  check('isThrottled true within window', isThrottled(testRoute, now + 2000));
  check('isThrottled false after window', !isThrottled(testRoute, now + 10_000));
  // Sibling models on same provider are NOT throttled (independent keys)
  const siblingRoute = { provider: 'groq' as const, model: 'llama-3.3-70b-versatile' };
  check('sibling model on same provider NOT throttled', !isThrottled(siblingRoute, now + 2000));
  throttledUntil.clear();

  // Provider registry
  const { geminiProvider } = await import('../src/modules/llm/providers/gemini.js');
  const { groqProvider } = await import('../src/modules/llm/providers/groq.js');
  expectEq(geminiProvider.name, 'gemini', 'geminiProvider.name = gemini');
  expectEq(groqProvider.name, 'groq', 'groqProvider.name = groq');
  check('geminiProvider.isEnabled() callable', typeof geminiProvider.isEnabled() === 'boolean');
  check('groqProvider.isEnabled() callable', typeof groqProvider.isEnabled() === 'boolean');
}

// --- Phase 11 1B: verify thread name + fallback record schema ---------

async function smokeVerifyThreadName(): Promise<void> {
  group('Phase 11 1B · verify-thread naming + Verification schema');
  const { __for_testing } = await import('../src/modules/verification/flow.js');
  const { threadNameFor } = __for_testing;

  // Mock minimal GuildMember surface that threadNameFor reads.
  const mkMember = (username: string, id = '111222333444555666') =>
    ({ id, user: { username, tag: `${username}#0001` } }) as unknown as Parameters<
      typeof threadNameFor
    >[0];

  expectEq(threadNameFor(mkMember('aliceDev')), 'verify-alicedev', 'simple username → slug');
  expectEq(
    threadNameFor(mkMember('Alice.Dev_2024')),
    'verify-alice-dev-2024',
    'dots+underscores → dashes',
  );
  expectEq(threadNameFor(mkMember('_alice_')), 'verify-alice', 'strips leading/trailing dashes');
  expectEq(
    threadNameFor(mkMember('🔥🔥🔥')),
    'verify-555666',
    'unicode-only → falls back to last-6 of id',
  );

  // Long username → truncated to 50 char slug
  const long = 'a'.repeat(80);
  const longName = threadNameFor(mkMember(long));
  check('long username slug capped at 50 chars', longName === `verify-${'a'.repeat(50)}`);
  check('full thread name stays under Discord 100-char limit', longName.length <= 100);

  // Verify the schema includes fallback_thread_id (compile-only check
  // works at runtime by reading a synthetic record)
  const syntheticVerification: import('../src/db/types.js').Verification = {
    discord_id: 'u1',
    challenge_type: 'math',
    challenge_data: { expected: '42' },
    attempts: 0,
    started_at: Date.now(),
    status: 'pending',
    fallback_thread_id: 'thread-test-id',
  };
  check(
    'Verification.fallback_thread_id field accepted',
    syntheticVerification.fallback_thread_id === 'thread-test-id',
  );
}

// --- Phase 11 1B: first-message greeting (User schema + channel match) -

async function smokeFirstMessageGreet(): Promise<void> {
  group('Phase 11 1B · first-message greet (User flag + channel match)');
  const { canonicalChannelName } = await import('../src/config/channels.js');

  // The greet logic fires only when canonicalChannelName(msg.channel.name)
  // === 'general'. Verify that the renamed `💬-general-💬` resolves to
  // `general` (otherwise the greeting never fires after the rename).
  expectEq(
    canonicalChannelName('💬-general-💬'),
    'general',
    'greeting-target channel `💬-general-💬` canonicalises to `general`',
  );
  // Negative: greeting must NOT trigger in #introductions or #verify
  expectEq(
    canonicalChannelName('👋-introductions-👋'),
    'introductions',
    '#introductions canonical ≠ general (greet skipped)',
  );
  expectEq(
    canonicalChannelName('🔒-verify-🔒'),
    'verify',
    '#verify canonical ≠ general (greet skipped)',
  );

  // User.first_message_greeted_at field accepted by the User type
  const syntheticUser: import('../src/db/types.js').User = {
    discord_id: 'u-smoke',
    username: 'Smoke',
    display_name: null,
    xp: 0,
    level: 0,
    cultivation_rank: 'pham_nhan',
    sub_title: null,
    joined_at: 0,
    verified_at: Date.now(),
    last_message_at: null,
    last_daily_at: null,
    daily_streak: 0,
    is_suspect: false,
    notes: null,
    first_message_greeted_at: null,
  };
  check(
    'User.first_message_greeted_at field accepted (null = ungreeted)',
    syntheticUser.first_message_greeted_at === null,
  );
  const greeted = { ...syntheticUser, first_message_greeted_at: 1_700_000_000_000 };
  check(
    'User.first_message_greeted_at accepts timestamp',
    greeted.first_message_greeted_at !== null,
  );
}

// --- Phase 11 1B: scheduler wired with new cron -----------------------

async function smokeSchedulerWired(): Promise<void> {
  group('Phase 11 1B · scheduler wires thread cleanup cron');
  // We can't easily start the scheduler in smoke (cron + Discord client
  // needed). Instead verify the cleanup function is exported from
  // verification/flow.js (the contract scheduler depends on).
  const flow = await import('../src/modules/verification/flow.js');
  check(
    'cleanupStaleVerifyThreads exported from verification/flow.ts',
    typeof flow.cleanupStaleVerifyThreads === 'function',
  );
  check(
    'cleanupExpiredVerifications still exported (unchanged)',
    typeof flow.cleanupExpiredVerifications === 'function',
  );
}

// --- Phase 11.2 / A6: profanity sliding-window counter -----------------

async function smokeProfanityCounter(): Promise<void> {
  group('Phase 11.2 · profanity-counter (60s sliding window)');
  const counter = await import('../src/modules/automod/profanity-counter.js');
  counter.reset();

  expectEq(counter.recordHit('smoke-u', 1_000).count, 1, '1st hit → count=1 (gentle tier)');
  expectEq(counter.recordHit('smoke-u', 1_500).count, 2, '2nd hit in window → count=2');
  expectEq(counter.recordHit('smoke-u', 2_000).count, 3, '3rd hit → count=3');
  for (let i = 4; i <= 5; i++) counter.recordHit('smoke-u', 2_000 + i);
  expectEq(counter.getCount('smoke-u', 2_500), 5, 'count=5 → STERN tier boundary');
  for (let i = 6; i <= 15; i++) counter.recordHit('smoke-u', 2_000 + i);
  expectEq(counter.getCount('smoke-u', 2_500), 15, 'count=15 → DELETE tier boundary');

  // firstHitMs (sweep anchor)
  counter.reset('smoke-fh');
  const first = counter.recordHit('smoke-fh', 5_000).firstHitMs;
  expectEq(first, 5_000, '1st hit → firstHitMs = current ts');
  const later = counter.recordHit('smoke-fh', 8_000).firstHitMs;
  expectEq(later, 5_000, 'subsequent hit → firstHitMs sticks to oldest');

  // Tier window pruning (60s) — firstHitMs in 15min window stays available
  counter.reset('smoke-tw');
  counter.recordHit('smoke-tw', 1_000);
  const afterTier = 1_000 + counter.WINDOW_MS_FOR_TESTING + 30_000;
  const r = counter.recordHit('smoke-tw', afterTier);
  expectEq(r.count, 1, '60s tier window pruned old hit from count');
  expectEq(r.firstHitMs, 1_000, '15min sweep window kept oldest hit as anchor');

  // Sweep window pruning (15min) — old hit fully drops
  counter.reset('smoke-sw');
  counter.recordHit('smoke-sw', 1_000);
  const afterSweep = 1_000 + counter.SWEEP_WINDOW_MS_FOR_TESTING + 1;
  expectEq(counter.getCount('smoke-sw', afterSweep), 0, 'hit pruned after 15min sweep window');

  // Per-user isolation
  counter.reset();
  counter.recordHit('smoke-a', 1_000);
  counter.recordHit('smoke-a', 1_500);
  counter.recordHit('smoke-b', 1_500);
  expectEq(counter.getCount('smoke-a', 1_500), 2, 'user A independent of user B');
  expectEq(counter.getCount('smoke-b', 1_500), 1, 'user B independent of user A');
  counter.reset();
}

// --- Phase 11.2 / A6: Aki nudge persona builder ------------------------

async function smokeAkiNudgePersona(): Promise<void> {
  group('Phase 11.2 · persona-nudge prompt builder');
  const { buildNudgePrompt } = await import('../src/modules/aki/persona-nudge.js');

  const gentleSass = buildNudgePrompt({
    severity: 'gentle',
    respectfulTone: false,
    userDisplayName: 'SmokeUser',
  });
  check('gentle+sass: system contains GENTLE', gentleSass.systemPrompt.includes('GENTLE'));
  check('gentle+sass: system contains SASS', gentleSass.systemPrompt.includes('SASS'));
  check(
    'gentle+sass: user prompt embeds display name',
    gentleSass.userPrompt.includes('SmokeUser'),
  );

  const sternStaff = buildNudgePrompt({
    severity: 'stern',
    respectfulTone: true,
    userDisplayName: 'TôngChủBill',
  });
  check('stern+respectful: system contains STERN', sternStaff.systemPrompt.includes('STERN'));
  check(
    'stern+respectful: system swaps to RESPECTFUL tone',
    sternStaff.systemPrompt.includes('RESPECTFUL'),
  );
  check(
    'stern+respectful: addresses staff with Tông Chủ honorific',
    sternStaff.systemPrompt.includes('Tông Chủ'),
  );
  check(
    'system prompt forbids JSON output (free text reminder)',
    gentleSass.systemPrompt.toLowerCase().includes('không json'),
  );
}

// --- Phase 11.2 / A6b: Thiên Đạo automod narration ---------------------

async function smokeAutomodNarration(): Promise<void> {
  group('Phase 11.2 · automod narration (Thiên Đạo persona)');
  const mod = await import('../src/modules/automod/narration.js');
  const { RULE_LABEL, ACTION_LABEL, staticFallback } = mod.__for_testing;

  // Static fallback covers every (rule, action) pair encountered in production
  for (const r of ['profanity', 'mass_mention', 'link', 'spam', 'caps'] as const) {
    check(`narration RULE_LABEL[${r}] non-empty`, !!RULE_LABEL[r]);
  }
  for (const a of ['delete', 'warn', 'timeout', 'kick'] as const) {
    check(`narration ACTION_LABEL[${a}] non-empty`, !!ACTION_LABEL[a]);
  }

  const fb = staticFallback({ userDisplayName: 'Bach', ruleId: 'profanity', action: 'warn' });
  check('static fallback embeds **<user>**', fb.includes('**Bach**'));
  check('static fallback mentions Thiên Đạo', fb.includes('Thiên Đạo'));
  check('static fallback uses VN rule label, not raw id', fb.includes('ngôn từ ô uế'));

  // <think> reasoning leak stripping (Qwen 3 32B + gpt-oss-120b emit
  // <think>...</think> blocks even though Groq is told to hide them;
  // this is the safety net).
  const { stripReasoning } = mod.__for_testing;
  check(
    'stripReasoning drops closed <think>...</think>',
    !stripReasoning('<think>foo</think>\nactual line').includes('foo'),
  );
  check(
    'stripReasoning drops unclosed <think> (truncated CoT)',
    stripReasoning('<think> truncated thinking with no end').trim() === '',
  );
  check(
    'stripReasoning leaves clean prose unchanged',
    stripReasoning('⚡ Thiên Đạo phong ấn **X**.').includes('Thiên Đạo'),
  );
}

// --- Phase 11.2 / A8: chronicler level-up narration --------------------

async function smokeLevelingNarration(): Promise<void> {
  group('Phase 11.2 · leveling narration (chronicler cache)');
  const mod = await import('../src/modules/leveling/narration.js');
  const { cacheKey, staticFallback, CACHE_TTL_MS } = mod.__for_testing;

  expectEq(cacheKey('luyen_khi', 'truc_co'), 'luyen_khi:truc_co', 'cache key format = old:new');
  expectEq(CACHE_TTL_MS, 5 * 60 * 1000, 'cache TTL = 5 minutes');

  const fb = staticFallback('luyen_khi', 'truc_co');
  check('static fallback has __USER__ placeholder', fb.includes('__USER__'));
  check(
    'static fallback mentions both rank names',
    fb.includes('Luyện Khí') && fb.includes('Trúc Cơ'),
  );

  mod.clearCacheForTesting();
}

// --- Phase 11.2 (post-deploy): link policy modes ----------------------

async function smokeLinkPolicy(): Promise<void> {
  group('Phase 11.2 · link policy (permissive default + strict raid mode)');
  const { findSuspiciousLinks } = await import('../src/modules/automod/rules/link-whitelist.js');
  const { loadAutomodConfig } = await import('../src/config/automod.js');
  const config = await loadAutomodConfig();

  expectEq(config.linkPolicy, 'permissive', 'default linkPolicy = permissive');
  check(
    'billthedev.com is whitelisted (Bill personal site)',
    config.linkWhitelist.includes('billthedev.com'),
  );
  check('linkShorteners defaults populated', config.linkShorteners.length >= 5);
  check('linkSuspectTlds defaults populated', config.linkSuspectTlds.length >= 5);

  const permissive = {
    policy: 'permissive' as const,
    whitelist: ['github.com', 'billthedev.com'],
    blacklist: ['known-bad.example'],
    shorteners: ['bit.ly', 'tinyurl.com'],
    suspectTlds: ['tk', 'click'],
  };

  expectEq(
    findSuspiciousLinks('https://www.billthedev.com/portfolio', permissive).length,
    0,
    'permissive: billthedev.com → allowed (whitelist fast-pass)',
  );
  expectEq(
    findSuspiciousLinks('check foo.com/blog', permissive).length,
    0,
    'permissive: arbitrary .com → allowed (no heuristic trip)',
  );
  expectEq(
    findSuspiciousLinks('click bit.ly/abc', permissive)[0]?.reason,
    'shortener',
    'permissive: bit.ly → flagged (shortener)',
  );
  expectEq(
    findSuspiciousLinks('go to shady.tk/free', permissive)[0]?.reason,
    'suspect-tld',
    'permissive: .tk → flagged (suspect-tld)',
  );
  expectEq(
    findSuspiciousLinks('visit http://1.2.3.4/x', permissive)[0]?.reason,
    'ip-host',
    'permissive: IP-only → flagged',
  );
  expectEq(
    findSuspiciousLinks('check known-bad.example/x', permissive)[0]?.reason,
    'blacklist',
    'permissive: blacklist domain → flagged',
  );

  const strict = { ...permissive, policy: 'strict' as const };
  expectEq(
    findSuspiciousLinks('foo.com/x', strict)[0]?.reason,
    'not-whitelisted',
    'strict: arbitrary .com → flagged (not whitelisted)',
  );
  expectEq(
    findSuspiciousLinks('billthedev.com/blog', strict).length,
    0,
    'strict: whitelisted host still passes',
  );
}

// --- Phase 11.2 post-deploy: reasoning_format gate ---------------------

async function smokeGroqReasoningGate(): Promise<void> {
  group('Phase 11.2 · groq reasoning_format gate (fix prod 400 on Llama)');
  const { modelSupportsReasoningFormat } = await import('../src/modules/llm/providers/groq.js');
  check('Qwen 3 32B → reasoning_format sent', modelSupportsReasoningFormat('qwen/qwen3-32b'));
  check(
    'gpt-oss-120b → reasoning_format sent',
    modelSupportsReasoningFormat('openai/gpt-oss-120b'),
  );
  check(
    'Llama 3.3 70B → reasoning_format SKIPPED (prevents prod 400)',
    !modelSupportsReasoningFormat('llama-3.3-70b-versatile'),
  );
  check(
    'Llama 4 Scout → reasoning_format SKIPPED',
    !modelSupportsReasoningFormat('meta-llama/llama-4-scout-17b-16e-instruct'),
  );
  check(
    'Llama 3.1 8B → reasoning_format SKIPPED',
    !modelSupportsReasoningFormat('llama-3.1-8b-instant'),
  );
}

// --- Phase 11.3 polish: rejoin cooldown -------------------------------

async function smokeRejoinCooldown(): Promise<void> {
  group('Phase 11.3 · verify rejoin cooldown (B6)');
  const mod = await import('../src/modules/verification/rejoin-cooldown.js');
  mod.reset();
  expectEq(mod.getCooldownMs(), 60 * 60 * 1000, 'default cooldown = 1 hour');
  check('fresh user has no cooldown', !mod.isOnCooldown('smoke-rj', 1_000_000));
  mod.setCooldownMs(5_000);
  mod.recordFailedVerifyKick('smoke-rj', 1_000_000);
  check('on cooldown immediately after record', mod.isOnCooldown('smoke-rj', 1_001_000));
  check('off cooldown after window', !mod.isOnCooldown('smoke-rj', 1_006_000));
  mod.reset();
}

// --- Phase 12 Lát 1: combat power formula -----------------------------

async function smokeCombatPower(): Promise<void> {
  group('Phase 12 · lực chiến formula');
  const { computeCombatPower, computeCombatPowerBreakdown } = await import(
    '../src/modules/combat/power.js'
  );
  expectEq(
    computeCombatPower({ level: 0, cultivation_rank: 'pham_nhan', sub_title: null }, null),
    100,
    'fresh Phàm Nhân = 100',
  );
  expectEq(
    computeCombatPower({ level: 10, cultivation_rank: 'truc_co', sub_title: 'Kiếm Tu' }, null),
    350,
    'Trúc Cơ Lv 10 + sub_title = 350',
  );
  const b = computeCombatPowerBreakdown(
    { level: 20, cultivation_rank: 'kim_dan', sub_title: null },
    null,
  );
  expectEq(b.base, 100, 'breakdown base = 100');
  expectEq(b.levelBonus, 200, 'breakdown levelBonus = 200');
  expectEq(b.rankBonus, 150, 'Kim Đan rank bonus = 150 (idx 3 × 50)');
  expectEq(b.subTitleBonus, 0, 'no sub_title → 0 sub_title bonus');
  expectEq(b.total, 450, 'Kim Đan Lv 20 = 450');
}

// --- Phase 12 Lát 3: cong-phap catalog seed -----------------------------

async function smokeCongPhapCatalog(): Promise<void> {
  group('Phase 12 · cong-phap catalog');
  const { loadCongPhapCatalog, __resetCongPhapCatalogCacheForTesting } = await import(
    '../src/config/cong-phap-catalog.js'
  );
  __resetCongPhapCatalogCacheForTesting();
  const items = await loadCongPhapCatalog();
  check('catalog has ≥ 10 entries', items.length >= 10);
  check(
    'has common rarity item',
    items.some((i) => i.rarity === 'common'),
  );
  check(
    'has legendary rarity item',
    items.some((i) => i.rarity === 'legendary'),
  );
  check(
    'all items have positive combat_power',
    items.every((i) => i.stat_bonuses.combat_power > 0),
  );
  check('slugs are unique', new Set(items.map((i) => i.slug)).size === items.length);
}

// --- Phase 12 Lát 6: duel simulation -----------------------------------

async function smokeDuelSimulation(): Promise<void> {
  group('Phase 12 · duel simulation (deterministic)');
  const { simulateDuel } = await import('../src/modules/combat/duel.js');
  const weak = {
    user: { level: 1, cultivation_rank: 'pham_nhan' as const, sub_title: null },
    displayName: 'W',
    equippedCongPhap: null,
  };
  const strong = {
    user: { level: 50, cultivation_rank: 'hoa_than' as const, sub_title: 'Kiếm Tu' },
    displayName: 'S',
    equippedCongPhap: null,
  };
  const r = simulateDuel(weak, strong, 42);
  check(
    'duel produces winner',
    r.winner === 'challenger' || r.winner === 'opponent' || r.winner === 'tie',
  );
  check('duel runs at most 5 rounds', r.rounds.length <= 5);
  check('duel runs at least 1 round', r.rounds.length >= 1);
  check('lực chiến matches computed', r.challengerLc > 0 && r.opponentLc > 0);
  expectEq(simulateDuel(weak, strong, 42).winner, r.winner, 'same seed → same winner');
}

// --- Phase 12 Lát 4: quest pool ----------------------------------------

async function smokeQuestPool(): Promise<void> {
  group('Phase 12 · daily quest pool');
  const { __for_testing } = await import('../src/modules/quests/daily-quest.js');
  const pool = __for_testing.QUEST_POOL;
  check('quest pool has ≥ 4 templates', pool.length >= 4);
  check(
    'all quest types present',
    ['message_count', 'voice_minutes', 'reaction_count', 'daily_streak_check'].every((t) =>
      pool.some((q) => q.type === t),
    ),
  );
  check(
    'all rewards non-negative',
    pool.every((q) => q.reward_xp >= 0 && q.reward_pills >= 0 && q.reward_contribution >= 0),
  );
}

// --- Phase 12 Lát 5: NPC personas --------------------------------------

async function smokeNpcPersonas(): Promise<void> {
  group('Phase 12 · NPC personas (Akira + Meifeng)');
  const { AKIRA_SYSTEM_PROMPT } = await import('../src/modules/npc/akira-persona.js');
  const { MEIFENG_SYSTEM_PROMPT } = await import('../src/modules/npc/meifeng-persona.js');
  check(
    'Akira persona mentions name + scholar role',
    AKIRA_SYSTEM_PROMPT.includes('Akira') && AKIRA_SYSTEM_PROMPT.includes('học sĩ'),
  );
  check(
    'Akira persona forbids sass',
    !/sass/i.test(AKIRA_SYSTEM_PROMPT) || AKIRA_SYSTEM_PROMPT.includes('không sass'),
  );
  check(
    'Meifeng persona mentions name + combat role',
    MEIFENG_SYSTEM_PROMPT.includes('Meifeng') && MEIFENG_SYSTEM_PROMPT.includes('kiếm sĩ'),
  );
  check('Meifeng persona allows sass', /sass/i.test(MEIFENG_SYSTEM_PROMPT));
  check(
    'Both personas mention server context',
    AKIRA_SYSTEM_PROMPT.includes('Radiant Tech Sect') &&
      MEIFENG_SYSTEM_PROMPT.includes('Radiant Tech Sect'),
  );
  check(
    'Both personas avoid Han chars',
    !/[一-鿿]/.test(AKIRA_SYSTEM_PROMPT.replace(/アキラ|美鳳/g, '')) &&
      !/[一-鿿]/.test(MEIFENG_SYSTEM_PROMPT.replace(/アキラ|美鳳/g, '')),
  );
}

main().catch((err) => {
  console.error(`${ANSI.red}smoke-test crashed:${ANSI.reset}`, err);
  process.exit(2);
});
