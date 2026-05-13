import { loadAutomodConfig } from '../../config/automod.js';
import { automodEngine } from '../../modules/automod/index.js';
import { spamTracker } from '../../modules/automod/rules/spam-detection.js';
import type { BotCliService } from '../service.js';

/**
 * Dry-run preview of automod evaluation. Pipe a phrase + (optional)
 * user id + (optional) repeat count → CLI runs the rule engine and
 * prints the resulting decision (or "no rule fired").
 *
 * No Discord client connection, no store writes, no DM sent. Pure
 * inspection of the rule pipeline against a synthetic message.
 *
 * Examples:
 *   npm run bot -- simulate-automod "STOP YELLING AT ME RIGHT NOW"
 *   npm run bot -- simulate-automod "check evil.com/free"
 *   npm run bot -- simulate-automod "buy crypto now" --repeat=5
 *   npm run bot -- simulate-automod "hey" --mentions=7
 */

interface ParsedArgs {
  text: string;
  userId: string;
  mentions: number;
  repeat: number;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  let userId = 'cli-simulate-user';
  let mentions = 0;
  let repeat = 1;
  const positional: string[] = [];
  for (const a of args) {
    if (a.startsWith('--user-id=')) userId = a.slice('--user-id='.length);
    else if (a.startsWith('--mentions='))
      mentions = Number.parseInt(a.slice('--mentions='.length), 10) || 0;
    else if (a.startsWith('--repeat='))
      repeat = Math.max(1, Number.parseInt(a.slice('--repeat='.length), 10) || 1);
    else positional.push(a);
  }
  return { text: positional.join(' '), userId, mentions, repeat };
}

/**
 * Build a minimal fake Message that the rule engine can inspect.
 * Mirrors the surface from tests/automod/__mocks__/message.ts but
 * lighter (no spies needed — this is a dry-run).
 */
function makeFakeMessage(text: string, userId: string, mentions: number): unknown {
  return {
    id: 'simulate-cli',
    content: text,
    channelId: 'simulate-cli',
    author: { id: userId, tag: `${userId}#0000`, bot: false },
    mentions: {
      users: { size: mentions },
      roles: { size: 0 },
    },
  };
}

export const simulateAutomod: BotCliService = {
  name: 'simulate-automod',
  description: 'Dry-run preview of automod evaluation for a given message text',
  usage: 'simulate-automod <text...> [--user-id=<id>] [--mentions=N] [--repeat=N]',
  needsClient: false,
  async execute(_ctx, args) {
    const parsed = parseArgs(args);
    if (!parsed.text) {
      throw new Error('must provide a text phrase: simulate-automod "your message here"');
    }

    const config = await loadAutomodConfig();
    spamTracker.reset(parsed.userId); // fresh state per CLI invocation

    const lines: string[] = [
      '',
      '=== simulate-automod (DRY-RUN) ===',
      `Text     : "${parsed.text}"`,
      `User id  : ${parsed.userId}`,
      `Mentions : ${parsed.mentions}`,
      `Repeats  : ${parsed.repeat}`,
      '',
      'Config thresholds:',
      `  mass_mention ≥ ${config.thresholds.massMentionCount}`,
      `  caps ratio ≥ ${(config.thresholds.capsRatioThreshold * 100).toFixed(0)}% (min ${config.thresholds.capsMinLength} chars)`,
      `  spam ≥ ${config.thresholds.spamDuplicates} dupes / ${Math.floor(config.thresholds.spamWindowMs / 60_000)}m`,
      '',
    ];

    for (let i = 1; i <= parsed.repeat; i++) {
      const msg = makeFakeMessage(parsed.text, parsed.userId, parsed.mentions);
      // biome-ignore lint/suspicious/noExplicitAny: dry-run mock; cast at boundary
      const decision = await automodEngine.evaluate(msg as any);
      if (parsed.repeat > 1) lines.push(`Run ${i}/${parsed.repeat}:`);
      if (decision) {
        lines.push(
          `  → FIRES: rule=${decision.rule.id}, action=${decision.rule.action}, severity=${decision.rule.severity}`,
        );
        lines.push(`    reason: ${decision.hit.reason}`);
        if (decision.hit.context && Object.keys(decision.hit.context).length > 0) {
          lines.push(`    context: ${JSON.stringify(decision.hit.context)}`);
        }
      } else {
        lines.push('  → no rule fired (message would pass through)');
      }
      if (parsed.repeat > 1) lines.push('');
    }

    lines.push('');
    lines.push('No Discord side-effects. SpamTracker state reset after this run.');
    lines.push('');
    process.stdout.write(lines.join('\n'));
    spamTracker.reset(parsed.userId);
  },
};
