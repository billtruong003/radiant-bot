/**
 * Public LLM module entry. Single API surface: `llm.complete(task, input)`.
 *
 * Usage:
 *   import { llm } from '../llm/index.js';
 *   const r = await llm.complete('aki-filter', {
 *     systemPrompt: AKI_FILTER_SYSTEM_PROMPT,
 *     userPrompt: question,
 *     responseFormat: 'json',
 *     maxOutputTokens: 200,
 *   });
 *   if (!r) {
 *     // Both providers unavailable — apply task-specific degradation.
 *   } else {
 *     parseAndUse(r.text);
 *   }
 */

import { type RouterInput, type RouterResult, complete } from './router.js';
import type { TaskId } from './types.js';

export type { RouterInput, RouterResult, TaskId };
export { LlmProviderError, LlmRateLimitError } from './types.js';

export const llm = {
  complete,
} as const;
