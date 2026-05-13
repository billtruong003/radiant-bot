import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { AKI_FILTER_SYSTEM_PROMPT, preFilterObvious } from './persona-filter.js';

/**
 * Gemini Flash filter stage. Sits BEFORE Grok in /ask. Classifies the
 * question:
 *   - legit=true  → caller forwards to Grok for the real answer
 *   - legit=false → Gemini wrote a sass-tier rejection itself, return it
 *                   and skip Grok entirely (saves $$$)
 *
 * Uses the Gemini REST API directly (fetch) — no SDK needed. Endpoint:
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key=...
 *
 * Pricing (Gemini 2.0 Flash, per 1M tokens):
 *   - input  : $0.075
 *   - output : $0.30
 *
 * Typical filter call: ~800 prompt tokens (system+question) + ~80 output
 * = ~$0.000084/call. Cheap enough that we run it on EVERY /ask call.
 */

const PRICING = {
  inputPer1M: 0.075,
  outputPer1M: 0.3,
} as const;

export interface FilterResult {
  /** True = forward to Grok. False = use `response` directly. */
  legit: boolean;
  /** Mean-Aki rejection. Only set when legit=false. */
  response: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  /** Attribution for logging — see AkiCallLog.filter_stage. */
  source: 'gemini' | 'pre-filter' | 'fail-open' | 'disabled';
}

export function isFilterEnabled(): boolean {
  return env.GEMINI_API_KEY.length > 0;
}

function computeCost(tokensIn: number, tokensOut: number): number {
  return (tokensIn * PRICING.inputPer1M + tokensOut * PRICING.outputPer1M) / 1_000_000;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

/**
 * Strip markdown fences if Gemini wrapped the JSON despite the prompt
 * telling it not to. Defensive — Flash sometimes ignores the rule.
 */
function stripFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('```')) {
    // remove opening ```json or ```
    s = s.replace(/^```(?:json)?\s*\n?/i, '');
    // remove closing ```
    s = s.replace(/\n?```\s*$/i, '');
  }
  return s.trim();
}

function parseFilterJson(raw: string): { legit: boolean; response: string | null } | null {
  try {
    const cleaned = stripFences(raw);
    const parsed = JSON.parse(cleaned) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const obj = parsed as { legit?: unknown; response?: unknown };
    if (typeof obj.legit !== 'boolean') return null;
    if (obj.legit) {
      return { legit: true, response: null };
    }
    if (typeof obj.response !== 'string' || obj.response.trim().length === 0) {
      return null;
    }
    return { legit: false, response: obj.response.trim() };
  } catch {
    return null;
  }
}

/**
 * Call Gemini Flash with the filter persona. Returns FilterResult.
 *
 * Fail-open policy: if Gemini errors, returns `{legit: true}` so the
 * /ask call falls through to Grok. Rationale: filter being down should
 * never block legit users — worst case is we don't save Grok tokens
 * for that single call. The cost cap on Grok still protects budget.
 */
export async function runFilter(question: string): Promise<FilterResult> {
  // 0. Cheap pre-filter for the truly obvious — skip Gemini call.
  const obvious = preFilterObvious(question);
  if (obvious) {
    return {
      legit: false,
      response: obvious,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      source: 'pre-filter',
    };
  }

  // 1. Service disabled — fail open (forward all to Grok).
  if (!isFilterEnabled()) {
    return {
      legit: true,
      response: null,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      source: 'disabled',
    };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    env.AKI_FILTER_MODEL,
  )}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

  const body = {
    systemInstruction: {
      parts: [{ text: AKI_FILTER_SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: question }],
      },
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 200,
      responseMimeType: 'application/json',
    },
    safetySettings: [
      // Filter persona is intentionally sassy — relax thresholds so
      // Gemini doesn't block its own outputs. We still self-censor in
      // the persona prompt.
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
    ],
  };

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    logger.warn({ err }, 'aki-filter: network error, failing open');
    return {
      legit: true,
      response: null,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      source: 'fail-open',
    };
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    logger.warn(
      { status: resp.status, body: text.slice(0, 500) },
      'aki-filter: non-OK, failing open',
    );
    return {
      legit: true,
      response: null,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      source: 'fail-open',
    };
  }

  let json: GeminiResponse;
  try {
    json = (await resp.json()) as GeminiResponse;
  } catch (err) {
    logger.warn({ err }, 'aki-filter: bad JSON, failing open');
    return {
      legit: true,
      response: null,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      source: 'fail-open',
    };
  }

  const tokensIn = json.usageMetadata?.promptTokenCount ?? 0;
  const tokensOut = json.usageMetadata?.candidatesTokenCount ?? 0;
  const costUsd = computeCost(tokensIn, tokensOut);

  const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const parsed = parseFilterJson(rawText);

  if (!parsed) {
    logger.warn(
      { raw: rawText.slice(0, 300), finishReason: json.candidates?.[0]?.finishReason },
      'aki-filter: unparseable response, failing open',
    );
    return { legit: true, response: null, tokensIn, tokensOut, costUsd, source: 'fail-open' };
  }

  logger.info(
    {
      legit: parsed.legit,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost_usd: costUsd.toFixed(6),
    },
    'aki-filter: classified',
  );

  return {
    legit: parsed.legit,
    response: parsed.response,
    tokensIn,
    tokensOut,
    costUsd,
    source: 'gemini',
  };
}
