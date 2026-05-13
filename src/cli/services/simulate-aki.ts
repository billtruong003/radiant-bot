import { env } from '../../config/env.js';
import { initStore, shutdownStore } from '../../db/index.js';
import { getBudgetStatus } from '../../modules/aki/budget.js';
import { askAki, computeCost, isAkiEnabled } from '../../modules/aki/client.js';
import { SYSTEM_PROMPT_TOKEN_ESTIMATE, estimateTokens } from '../../modules/aki/persona.js';
import type { BotCliService } from '../service.js';

/**
 * Dry-run preview of /ask. Two modes:
 *
 *   simulate-aki "câu hỏi"           : token + cost estimate, NO API call
 *   simulate-aki "câu hỏi" --live    : actually call Grok (uses budget!)
 *
 * Live mode requires XAI_API_KEY in env. Use sparingly — it counts
 * against the daily budget cap like a real /ask would.
 */

interface ParsedArgs {
  question: string;
  live: boolean;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  let live = false;
  const positional: string[] = [];
  for (const a of args) {
    if (a === '--live') live = true;
    else positional.push(a);
  }
  return { question: positional.join(' '), live };
}

export const simulateAki: BotCliService = {
  name: 'simulate-aki',
  description: 'Dry-run preview of /ask — token + cost estimate, optional --live for real call',
  usage: 'simulate-aki "<câu hỏi>" [--live]',
  needsClient: false,
  async execute(_ctx, args) {
    const parsed = parseArgs(args);
    if (!parsed.question) {
      throw new Error('must provide a question: simulate-aki "câu hỏi đây"');
    }

    const store = await initStore();
    try {
      const lines: string[] = [
        '',
        `=== simulate-aki ${parsed.live ? '(LIVE — will cost money!)' : '(DRY-RUN)'} ===`,
        `Question : "${parsed.question}"`,
        `Length   : ${parsed.question.length} chars`,
        '',
        '--- Configuration ---',
        `XAI_API_KEY    : ${isAkiEnabled() ? 'set ✓' : 'NOT SET — /ask disabled in prod'}`,
        `Model          : ${env.AKI_MODEL}`,
        `Max output     : ${env.AKI_MAX_OUTPUT_TOKENS} tokens`,
        `Daily budget   : $${env.AKI_DAILY_BUDGET_USD.toFixed(2)}`,
        '',
        '--- Token estimate ---',
        `System prompt  : ~${SYSTEM_PROMPT_TOKEN_ESTIMATE} tokens (cached after 1st call)`,
        `User question  : ~${estimateTokens(parsed.question)} tokens`,
        `Expected output: up to ${env.AKI_MAX_OUTPUT_TOKENS} tokens`,
      ];

      const systemTokens = SYSTEM_PROMPT_TOKEN_ESTIMATE;
      const userTokens = estimateTokens(parsed.question);
      const totalIn = systemTokens + userTokens;
      const expectedOut = Math.min(400, env.AKI_MAX_OUTPUT_TOKENS); // typical ~300-400

      // Worst case: no cache hit on system prompt
      const worstCost = computeCost(totalIn, 0, expectedOut);
      // Best case: full cache hit on system prompt
      const bestCost = computeCost(totalIn, systemTokens, expectedOut);

      lines.push('');
      lines.push('--- Cost estimate (per call) ---');
      lines.push(`Worst case (no cache) : $${worstCost.toFixed(6)}`);
      lines.push(`Best case (full cache): $${bestCost.toFixed(6)}`);
      lines.push('');

      const budget = getBudgetStatus();
      lines.push('--- Budget today (live store) ---');
      lines.push(`Spent     : $${budget.todaySpent.toFixed(4)}`);
      lines.push(`Budget    : $${budget.budget.toFixed(2)}`);
      lines.push(`Remaining : $${budget.remaining.toFixed(4)}`);
      lines.push(`Status    : ${budget.exhausted ? '⚠️ EXHAUSTED' : 'OK'}`);
      lines.push(
        `Total calls today: ${store.akiLogs.query((l) => l.created_at > Date.now() - 86_400_000).length}`,
      );
      lines.push('');

      if (!parsed.live) {
        lines.push('Dry-run mode. Pass --live to actually call Grok.');
        lines.push('');
        process.stdout.write(lines.join('\n'));
        return;
      }

      // Live call
      if (!isAkiEnabled()) {
        lines.push('❌ Cannot run live: XAI_API_KEY not set');
        process.stdout.write(lines.join('\n'));
        return;
      }

      lines.push('--- Live call ---');
      lines.push('Calling Grok...');
      process.stdout.write(lines.join('\n'));

      const result = await askAki({
        discordId: 'cli-simulate',
        question: parsed.question,
      });

      const out: string[] = [
        '',
        '✅ Response received:',
        '---',
        result.reply,
        '---',
        '',
        `Tokens in   : ${result.tokensIn} (cached: ${result.cachedTokens})`,
        `Tokens out  : ${result.tokensOut}`,
        `Cost        : $${result.costUsd.toFixed(6)}`,
        '',
      ];
      process.stdout.write(out.join('\n'));
    } finally {
      await shutdownStore();
    }
  },
};
