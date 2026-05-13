import { initStore, shutdownStore } from '../../db/index.js';
import { generateMathPuzzle } from '../../modules/events/games/math-puzzle.js';
import { generateReactionGame } from '../../modules/events/games/reaction-speed.js';
import {
  TRIBULATION_CONSTANTS,
  isTribulationOnCooldown,
  pickEligibleUserId,
} from '../../modules/events/tribulation.js';
import type { BotCliService } from '../service.js';

/**
 * Dry-run preview for tribulation events. Two modes:
 *
 *   simulate-tribulation                  : show gating status —
 *     cooldown active? eligible users? what would trigger?
 *
 *   simulate-tribulation --game=math|reaction [--level=N]
 *     show what the game payload would look like (question, options).
 *
 * Reads the live store for the gating check, so it reflects what
 * /breakthrough or the 18:00 cron would decide RIGHT NOW. Pure
 * read-only inspection — no events persisted, no Discord posts.
 */

interface ParsedArgs {
  game: 'math' | 'reaction' | null;
  level: number;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  let game: 'math' | 'reaction' | null = null;
  let level = 10;
  for (const a of args) {
    if (a === '--game=math') game = 'math';
    else if (a === '--game=reaction') game = 'reaction';
    else if (a.startsWith('--level='))
      level = Number.parseInt(a.slice('--level='.length), 10) || 10;
  }
  return { game, level };
}

export const simulateTribulation: BotCliService = {
  name: 'simulate-tribulation',
  description: 'Dry-run gating preview + sample game payload for tribulation events',
  usage: 'simulate-tribulation [--game=math|reaction] [--level=N]',
  needsClient: false,
  async execute(_ctx, args) {
    const parsed = parseArgs(args);
    const store = await initStore();
    try {
      const lines: string[] = [
        '',
        '=== simulate-tribulation (DRY-RUN) ===',
        '',
        '--- Gating status (live store) ---',
        `Cooldown active        : ${isTribulationOnCooldown() ? 'YES (24h not elapsed)' : 'no'}`,
        `Eligible level         : ≥ ${TRIBULATION_CONSTANTS.TRIBULATION_LEVEL_MIN}`,
        `Total users in store   : ${store.users.count()}`,
      ];
      const eligible = store.users.query(
        (u) => u.level >= TRIBULATION_CONSTANTS.TRIBULATION_LEVEL_MIN,
      );
      lines.push(`Eligible users (≥ 10)  : ${eligible.length}`);
      if (eligible.length > 0) {
        const names = eligible
          .slice(0, 5)
          .map((u) => `${u.display_name ?? u.username} (lvl ${u.level})`);
        lines.push(
          `  Sample: ${names.join(', ')}${eligible.length > 5 ? ` … +${eligible.length - 5}` : ''}`,
        );
      }
      const picked = pickEligibleUserId();
      lines.push(`Random pick (this run): ${picked ?? '<none>'}`);
      lines.push('');
      lines.push('--- Reward constants ---');
      lines.push(`Pass XP        : +${TRIBULATION_CONSTANTS.PASS_XP}`);
      lines.push(
        `Fail penalty   : -${TRIBULATION_CONSTANTS.FAIL_XP_PENALTY} (floored at level threshold)`,
      );
      lines.push(`Math timeout   : ${TRIBULATION_CONSTANTS.MATH_TIMEOUT_MS / 1000}s`);
      lines.push(`Reaction timeout: ${TRIBULATION_CONSTANTS.REACTION_TIMEOUT_MS / 1000}s`);
      lines.push(`Server cooldown: ${TRIBULATION_CONSTANTS.SERVER_COOLDOWN_MS / 3_600_000}h`);
      lines.push('');

      if (parsed.game === 'math') {
        const p = generateMathPuzzle(parsed.level);
        lines.push(`--- Math puzzle preview (level ${parsed.level}) ---`);
        lines.push(`Question: ${p.question}`);
        lines.push(`Expected: ${p.expected}`);
        lines.push(`Options : ${p.options.join(' | ')}`);
        lines.push('');
      } else if (parsed.game === 'reaction') {
        const g = generateReactionGame();
        lines.push('--- Reaction game preview ---');
        lines.push(`Target  : ${g.target}`);
        lines.push(`Options : ${g.options.join(' ')}`);
        lines.push(`Target at index: ${g.options.indexOf(g.target)} / ${g.options.length - 1}`);
        lines.push('');
      } else {
        lines.push('Pass --game=math [--level=N] or --game=reaction to preview a game payload.');
        lines.push('');
      }

      lines.push('No event persisted. No Discord post. No XP changes.');
      lines.push('');
      process.stdout.write(lines.join('\n'));
    } finally {
      await shutdownStore();
    }
  },
};
