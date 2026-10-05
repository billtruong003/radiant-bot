import { writeFileSync } from 'node:fs';
import {
  FREE_PRODUCTION_MODELS,
  assertModelAllowedForProduction,
  getModelConfig,
} from '../src/modules/llm/registry.js';
import { geminiProvider } from '../src/modules/llm/providers/gemini.js';
import { groqProvider } from '../src/modules/llm/providers/groq.js';
import { opencodeZenProvider } from '../src/modules/llm/providers/opencode-zen.js';
import {
  type LlmProvider,
  LlmProviderError,
  LlmRateLimitError,
  type ProviderName,
} from '../src/modules/llm/types.js';

/**
 * Capability discovery for the zero-cost pool.  `npm run probe:free-models`
 *
 * Answers the questions the gateway will not: does this model actually
 * respond, does it return usable JSON, can it see an image, how slow is it,
 * and does it hand back an empty string when asked to think.
 *
 * Explicitly NOT a stress test. A handful of small requests per model,
 * sequential, with backoff — hammering a free tier to measure it is how you
 * lose access to it. Paid and unknown-cost models are never probed: the
 * registry guard is asserted before every call.
 */

const PROVIDERS: Record<ProviderName, LlmProvider> = {
  groq: groqProvider,
  gemini: geminiProvider,
  'opencode-zen': opencodeZenProvider,
};

interface ProbeResult {
  modelId: string;
  provider: ProviderName;
  available: boolean;
  textOk: boolean;
  jsonOk: boolean;
  visionOk: boolean | 'not_advertised';
  latencyMs: number | null;
  emptyResponse: boolean;
  rateLimited: boolean;
  error?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Public domain test image (1x1 red pixel served over https). */
const PROBE_IMAGE = 'https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png';

async function callOnce(
  modelId: string,
  opts: {
    systemPrompt: string;
    userPrompt: string;
    maxOutputTokens: number;
    responseFormat?: 'text' | 'json';
    imageUrl?: string;
  },
): Promise<{ text: string; ms: number } | { error: string; rateLimited: boolean }> {
  assertModelAllowedForProduction(modelId);
  const cfg = getModelConfig(modelId);
  if (!cfg) return { error: 'unregistered', rateLimited: false };
  const provider = PROVIDERS[cfg.provider];
  if (!provider.isEnabled()) return { error: 'provider disabled (no API key)', rateLimited: false };

  const started = Date.now();
  try {
    const r = await provider.complete({
      systemPrompt: opts.systemPrompt,
      userPrompt: opts.userPrompt,
      model: modelId,
      maxOutputTokens: opts.maxOutputTokens,
      temperature: 0,
      ...(opts.responseFormat ? { responseFormat: opts.responseFormat } : {}),
      ...(opts.imageUrl ? { imageUrl: opts.imageUrl } : {}),
    });
    return { text: r.text, ms: Date.now() - started };
  } catch (err) {
    if (err instanceof LlmRateLimitError) return { error: '429 rate limit', rateLimited: true };
    if (err instanceof LlmProviderError) return { error: err.message, rateLimited: false };
    return { error: String(err), rateLimited: false };
  }
}

async function probeModel(modelId: string): Promise<ProbeResult> {
  const cfg = getModelConfig(modelId);
  if (!cfg) throw new Error(`unregistered model in probe list: ${modelId}`);

  const out: ProbeResult = {
    modelId,
    provider: cfg.provider,
    available: false,
    textOk: false,
    jsonOk: false,
    visionOk: cfg.supportsVision ? false : 'not_advertised',
    latencyMs: null,
    emptyResponse: false,
    rateLimited: false,
  };

  // 1. Plain text completion.
  const text = await callOnce(modelId, {
    systemPrompt: 'Trả lời ngắn gọn bằng tiếng Việt.',
    userPrompt: 'Một cộng một bằng mấy? Trả lời đúng một câu.',
    maxOutputTokens: cfg.minOutputTokens ?? 800,
  });
  if ('error' in text) {
    out.error = text.error;
    out.rateLimited = text.rateLimited;
    return out;
  }
  out.available = true;
  out.latencyMs = text.ms;
  out.textOk = text.text.trim().length > 0;
  out.emptyResponse = text.text.trim().length === 0;

  await sleep(1500);

  // 2. Structured output.
  const json = await callOnce(modelId, {
    systemPrompt: 'Chỉ in ra JSON, không markdown, không giải thích.',
    userPrompt: 'Trả về {"ok": true, "n": 2}',
    maxOutputTokens: cfg.minOutputTokens ?? 800,
    responseFormat: 'json',
  });
  if (!('error' in json)) {
    const m = json.text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        JSON.parse(m[0]);
        out.jsonOk = true;
      } catch {
        out.jsonOk = false;
      }
    }
  }

  // 3. Vision — only where the registry claims support.
  if (cfg.supportsVision) {
    await sleep(1500);
    const vis = await callOnce(modelId, {
      systemPrompt: 'Mô tả ảnh ngắn gọn bằng tiếng Việt.',
      userPrompt: 'Trong ảnh có gì?',
      maxOutputTokens: cfg.minOutputTokens ?? 800,
      imageUrl: PROBE_IMAGE,
    });
    out.visionOk = !('error' in vis) && vis.text.trim().length > 0;
  }

  return out;
}

async function main(): Promise<void> {
  const models = [...FREE_PRODUCTION_MODELS].sort();
  console.log(`\n🔬 Probing ${models.length} zero-cost models (paid/unknown never contacted)\n`);

  const results: ProbeResult[] = [];
  for (const id of models) {
    process.stdout.write(`  ${id.padEnd(32)}`);
    const r = await probeModel(id);
    results.push(r);
    if (!r.available) {
      console.log(`❌ ${r.rateLimited ? '429 (quota)' : (r.error ?? 'unavailable')}`);
    } else {
      const vis =
        r.visionOk === 'not_advertised' ? 'vision:n/a' : r.visionOk ? 'vision:OK' : 'vision:FAIL';
      console.log(
        `✅ ${String(r.latencyMs).padStart(6)}ms  text:${r.textOk ? 'OK' : 'EMPTY'}  json:${r.jsonOk ? 'OK' : 'FAIL'}  ${vis}`,
      );
    }
    await sleep(2000); // Be a good citizen on a shared free tier.
  }

  const ok = results.filter((r) => r.available);
  const limited = results.filter((r) => r.rateLimited);
  console.log(
    `\n📊 ${ok.length}/${results.length} reachable · ${limited.length} rate-limited · ` +
      `${ok.filter((r) => r.jsonOk).length} produce valid JSON`,
  );

  const path = 'probe-results.json';
  writeFileSync(path, JSON.stringify({ probedAt: new Date().toISOString(), results }, null, 2));
  console.log(`📄 ${path}\n`);
}

main().catch((err) => {
  console.error('probe failed:', err);
  process.exit(1);
});
