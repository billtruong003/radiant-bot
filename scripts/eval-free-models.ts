import { writeFileSync } from 'node:fs';
import { geminiProvider } from '../src/modules/llm/providers/gemini.js';
import { groqProvider } from '../src/modules/llm/providers/groq.js';
import { opencodeZenProvider } from '../src/modules/llm/providers/opencode-zen.js';
import {
  FREE_PRODUCTION_MODELS,
  assertModelAllowedForProduction,
  getModelConfig,
} from '../src/modules/llm/registry.js';
import {
  type LlmProvider,
  LlmProviderError,
  LlmRateLimitError,
  type ProviderName,
} from '../src/modules/llm/types.js';

/**
 * Radiant-specific evaluation of the zero-cost pool.
 * `npm run eval:free-models [category]`
 *
 * Fixtures are SYNTHETIC and modelled on how this Discord actually talks —
 * Vietnamese chat, slang, cultivation-server questions, TypeScript and
 * discord.js problems, follow-ups that only resolve against prior turns.
 * No real member conversations are sent anywhere.
 *
 * Scoring is automatic and deliberately crude: each fixture declares what a
 * correct answer must and must not contain. That catches the failures that
 * actually matter here — empty output, wrong language, inventing server
 * facts, ignoring the reply chain, malformed JSON — without pretending a
 * regex can judge prose quality. Latency and failure rates come free.
 *
 * Public benchmark scores are irrelevant. The only question is how a model
 * behaves inside Radiant.
 */

const PROVIDERS: Record<ProviderName, LlmProvider> = {
  groq: groqProvider,
  gemini: geminiProvider,
  'opencode-zen': opencodeZenProvider,
};

type Category =
  | 'casual_vn'
  | 'slang_vn'
  | 'followup'
  | 'channel_context'
  | 'server_fact'
  | 'technical'
  | 'coding'
  | 'debugging'
  | 'json'
  | 'hallucination'
  | 'long_context';

interface Fixture {
  id: string;
  category: Category;
  system: string;
  user: string;
  /** All must appear (case-insensitive) for a pass. */
  mustInclude?: readonly string[];
  /** Any appearing = fail. */
  mustNotInclude?: readonly string[];
  /** Response must parse as JSON. */
  expectJson?: boolean;
  /** At least one of these must appear. */
  anyOf?: readonly string[];
  maxTokens?: number;
}

const AKI_SYS =
  'Bạn là Aki, hầu gái của một tông môn tu tiên trên Discord. Trả lời bằng tiếng Việt, ngắn gọn, tự nhiên.';

const FIXTURES: readonly Fixture[] = [
  {
    id: 'casual-greet',
    category: 'casual_vn',
    system: AKI_SYS,
    user: 'ê Aki khỏe không',
    mustNotInclude: ['I am', 'As an AI', '抱歉', '你好'],
    maxTokens: 400,
  },
  {
    id: 'slang-vn',
    category: 'slang_vn',
    system: AKI_SYS,
    user: 'cái này khum ổn lắm, m thấy sao vậy tr?',
    mustNotInclude: ['As an AI', '抱歉'],
    maxTokens: 500,
  },
  {
    id: 'followup-pronoun',
    category: 'followup',
    system: AKI_SYS,
    user: [
      '[Hội thoại gần đây:',
      '  Bill: Aki ơi Unity URP với HDRP khác gì nhau?',
      '  Aki (bạn): URP nhẹ hơn, hợp mobile/VR. HDRP nặng, hợp PC/console cấu hình cao.',
      ']',
      '',
      'vậy còn cái đó thì làm VR được không?',
    ].join('\n'),
    // Resolving "cái đó" requires reading the prior turn.
    anyOf: ['urp', 'hdrp', 'vr'],
    maxTokens: 700,
  },
  {
    id: 'channel-noise',
    category: 'channel_context',
    system: AKI_SYS,
    user: [
      '[Hội thoại gần đây:',
      '  Khoa: hôm nay ăn gì mọi người',
      '  Nam: bún bò đi',
      '  Bill: Aki cho hỏi lệnh nào xem điểm tu vi?',
      '  Khoa: tao thích phở hơn',
      ']',
      '',
      'Trả lời câu hỏi của Bill.',
    ].join('\n'),
    anyOf: ['/me', '/rank', '/stat', 'tu vi', 'lệnh'],
    mustNotInclude: ['bún bò', 'phở'],
    maxTokens: 600,
  },
  {
    id: 'server-fact-honesty',
    category: 'server_fact',
    system: `${AKI_SYS}\n\nBạn KHÔNG có dữ liệu cấu hình server trong ngữ cảnh này. Nếu không chắc con số, hãy nói thẳng là không rõ thay vì đoán.`,
    user: 'Mỗi tin nhắn được cộng chính xác bao nhiêu XP?',
    // The point: admit ignorance rather than invent a number.
    anyOf: ['không rõ', 'không chắc', 'không biết', 'chưa có', 'không nắm'],
    maxTokens: 500,
  },
  {
    id: 'technical-compare',
    category: 'technical',
    system: AKI_SYS,
    user: 'So sánh ngắn gọn giữa WebSocket và SSE, nên dùng cái nào cho bot Discord?',
    anyOf: ['websocket', 'sse'],
    maxTokens: 900,
  },
  {
    id: 'coding-ts',
    category: 'coding',
    system: 'Bạn là lập trình viên TypeScript. Trả lời ngắn, có code.',
    user: 'Viết hàm TypeScript debounce(fn, ms) có kiểu đầy đủ.',
    anyOf: ['function', 'const', '=>'],
    mustInclude: ['setTimeout'],
    maxTokens: 1200,
  },
  {
    id: 'debug-discordjs',
    category: 'debugging',
    system: 'Bạn là lập trình viên Node.js/discord.js. Trả lời ngắn gọn tiếng Việt.',
    user: [
      'Bot discord.js báo lỗi này khi đọc message.content, sửa sao?',
      '```',
      'TypeError: Cannot read properties of undefined (reading \'content\')',
      '```',
    ].join('\n'),
    anyOf: ['intent', 'MessageContent', 'partial', 'quyền', 'fetch'],
    maxTokens: 1000,
  },
  {
    id: 'json-strict',
    category: 'json',
    system: 'Chỉ in ra JSON hợp lệ. Không markdown, không giải thích.',
    user: 'Phân loại câu "sửa hộ tao cái regex này" và trả về {"intent":"...","complexity":"..."}',
    expectJson: true,
    maxTokens: 800,
  },
  {
    id: 'hallucination-resist',
    category: 'hallucination',
    system: `${AKI_SYS}\n\nKiến thức tự nhớ của bạn đã cũ. Với thứ thay đổi theo thời gian mà không có dữ liệu tra cứu, hãy nói thẳng là không rõ.`,
    user: 'Model AI mạnh nhất được phát hành tuần trước là model nào?',
    anyOf: ['không rõ', 'không chắc', 'không biết', 'chưa có', 'không nắm', 'cần tra'],
    maxTokens: 600,
  },
  {
    id: 'long-context',
    category: 'long_context',
    system: AKI_SYS,
    user: [
      '[Hội thoại gần đây:',
      ...Array.from(
        { length: 40 },
        (_, i) => `  Thành viên ${i}: tin nhắn tán gẫu không liên quan số ${i}, nói về thời tiết.`,
      ),
      '  Bill: mật khẩu wifi tông môn là RADIANT2026 nhé mọi người',
      ...Array.from(
        { length: 20 },
        (_, i) => `  Thành viên ${i + 40}: thêm tin nhắn tán gẫu số ${i}, nói về ăn uống.`,
      ),
      ']',
      '',
      'Bill vừa nói mật khẩu wifi là gì?',
    ].join('\n'),
    mustInclude: ['RADIANT2026'],
    maxTokens: 500,
  },
];

interface Score {
  fixtureId: string;
  category: Category;
  passed: boolean;
  latencyMs: number | null;
  empty: boolean;
  rateLimited: boolean;
  failReason?: string;
}

function judge(fx: Fixture, text: string): { passed: boolean; reason?: string } {
  const t = text.trim();
  if (t.length === 0) return { passed: false, reason: 'empty response' };

  if (fx.expectJson) {
    const m = t.match(/\{[\s\S]*\}/);
    if (!m) return { passed: false, reason: 'no JSON object' };
    try {
      JSON.parse(m[0]);
    } catch {
      return { passed: false, reason: 'malformed JSON' };
    }
  }

  const lower = t.toLowerCase();
  for (const need of fx.mustInclude ?? []) {
    if (!lower.includes(need.toLowerCase())) {
      return { passed: false, reason: `missing "${need}"` };
    }
  }
  for (const bad of fx.mustNotInclude ?? []) {
    if (lower.includes(bad.toLowerCase())) {
      return { passed: false, reason: `contains "${bad}"` };
    }
  }
  if (fx.anyOf && !fx.anyOf.some((a) => lower.includes(a.toLowerCase()))) {
    return { passed: false, reason: `none of [${fx.anyOf.join(', ')}]` };
  }
  return { passed: true };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function runFixture(modelId: string, fx: Fixture): Promise<Score> {
  assertModelAllowedForProduction(modelId);
  const cfg = getModelConfig(modelId);
  const base: Score = {
    fixtureId: fx.id,
    category: fx.category,
    passed: false,
    latencyMs: null,
    empty: false,
    rateLimited: false,
  };
  if (!cfg) return { ...base, failReason: 'unregistered' };

  const provider = PROVIDERS[cfg.provider];
  if (!provider.isEnabled()) return { ...base, failReason: 'provider disabled' };

  const started = Date.now();
  try {
    const r = await provider.complete({
      systemPrompt: fx.system,
      userPrompt: fx.user,
      model: modelId,
      maxOutputTokens: Math.max(fx.maxTokens ?? 800, cfg.minOutputTokens ?? 0),
      temperature: 0.3,
      ...(fx.expectJson ? { responseFormat: 'json' as const } : {}),
    });
    const ms = Date.now() - started;
    const verdict = judge(fx, r.text);
    return {
      ...base,
      passed: verdict.passed,
      latencyMs: ms,
      empty: r.text.trim().length === 0,
      ...(verdict.reason ? { failReason: verdict.reason } : {}),
    };
  } catch (err) {
    if (err instanceof LlmRateLimitError) {
      return { ...base, rateLimited: true, failReason: '429' };
    }
    if (err instanceof LlmProviderError) return { ...base, failReason: err.message.slice(0, 80) };
    return { ...base, failReason: String(err).slice(0, 80) };
  }
}

async function main(): Promise<void> {
  const only = process.argv[2];
  const fixtures = only ? FIXTURES.filter((f) => f.category === only) : FIXTURES;
  if (fixtures.length === 0) {
    console.error(`No fixtures for category "${only}"`);
    process.exit(1);
  }

  const models = [...FREE_PRODUCTION_MODELS].sort();
  console.log(
    `\n🧪 Evaluating ${models.length} zero-cost models on ${fixtures.length} Radiant fixtures\n`,
  );

  const all: Record<string, Score[]> = {};
  for (const modelId of models) {
    console.log(`── ${modelId}`);
    const scores: Score[] = [];
    for (const fx of fixtures) {
      const s = await runFixture(modelId, fx);
      scores.push(s);
      const mark = s.passed ? '✅' : s.rateLimited ? '⏳' : '❌';
      console.log(
        `   ${mark} ${fx.id.padEnd(22)} ${String(s.latencyMs ?? '-').padStart(6)}ms ${s.failReason ?? ''}`,
      );
      await sleep(1500);
    }
    all[modelId] = scores;
    const pass = scores.filter((s) => s.passed).length;
    console.log(`   → ${pass}/${scores.length}\n`);
    await sleep(2000);
  }

  // Per-category champion: highest pass count, latency breaks ties.
  const categories = [...new Set(fixtures.map((f) => f.category))];
  const champions: Record<string, string> = {};
  console.log('🏆 Champions by category');
  for (const cat of categories) {
    let best: { model: string; pass: number; ms: number } | null = null;
    for (const [model, scores] of Object.entries(all)) {
      const inCat = scores.filter((s) => s.category === cat);
      const pass = inCat.filter((s) => s.passed).length;
      const lat = inCat.filter((s) => s.latencyMs !== null).map((s) => s.latencyMs ?? 0);
      const ms = lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : Number.MAX_SAFE_INTEGER;
      if (!best || pass > best.pass || (pass === best.pass && ms < best.ms)) {
        best = { model, pass, ms };
      }
    }
    if (best) {
      champions[cat] = best.model;
      console.log(`   ${cat.padEnd(18)} ${best.model.padEnd(32)} (${best.pass} pass)`);
    }
  }

  const path = 'eval-results.json';
  writeFileSync(
    path,
    JSON.stringify({ evaluatedAt: new Date().toISOString(), champions, results: all }, null, 2),
  );
  console.log(`\n📄 ${path}\n`);
}

main().catch((err) => {
  console.error('eval failed:', err);
  process.exit(1);
});
