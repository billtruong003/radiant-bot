import { logger } from '../../utils/logger.js';
import { auditModelRegistry, getModelConfig, isProductionEligible } from './registry.js';
import { TASK_ROUTES } from './router.js';

/**
 * Boot-time proof that production routing cannot cost money.
 *
 * Runs before the Discord client is even constructed. If any task chain
 * references a paid, unknown-cost, or unregistered model, startup FAILS —
 * the alternative is discovering it on a bill, and a bot that refuses to
 * boot is a much cheaper failure than one that quietly starts spending.
 *
 * Also fails on an EMPTY chain: a task whose every model got filtered out
 * would degrade silently forever, which looks identical to "nobody uses
 * that feature".
 */

export class ZeroCostViolationError extends Error {
  constructor(violations: readonly string[]) {
    super(
      `AI production mode: FREE_ONLY — startup blocked by ${violations.length} violation(s):\n  ${violations.join('\n  ')}`,
    );
    this.name = 'ZeroCostViolationError';
  }
}

export function assertZeroCostRouting(): void {
  const violations: string[] = [];

  for (const [task, chain] of Object.entries(TASK_ROUTES)) {
    if (chain.length === 0) {
      violations.push(`${task}: empty chain (would degrade silently forever)`);
      continue;
    }
    for (const modelId of chain) {
      if (isProductionEligible(modelId)) continue;
      const cfg = getModelConfig(modelId);
      violations.push(
        `${task} → ${modelId}: ${
          cfg ? `billing=${cfg.billing}, enabled=${cfg.enabled}` : 'not in MODEL_REGISTRY'
        }`,
      );
    }
  }

  const audit = auditModelRegistry();

  if (violations.length > 0) {
    logger.error({ violations }, 'llm: ZERO-COST VIOLATION — refusing to start');
    throw new ZeroCostViolationError(violations);
  }

  logger.info(
    {
      mode: 'FREE_ONLY',
      enabledFreeModels: audit.freeEnabled.length,
      blockedPaid: audit.paidBlocked.length,
      blockedUnknownCost: audit.unknownBlocked.length,
      blockedDisabled: audit.disabledBlocked.length,
      tasks: Object.keys(TASK_ROUTES).length,
    },
    'llm: billing audit passed — production routing is zero-cost',
  );
}
