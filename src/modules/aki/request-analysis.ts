import {
  LEGACY_COMMAND_NAMES,
  SERVER_COMMAND_NAMES,
  SERVER_DOMAIN_TERMS,
} from '../../config/server-vocab.js';
import { llm } from '../llm/index.js';
import type { TaskId } from '../llm/types.js';

/**
 * What kind of request is this, and which zero-cost chain should answer it.
 *
 * Replaces the old easy/hard split, which decided on message LENGTH:
 * `question.length < 60 → easy`. That sent "sửa hộ cái regex này" to the
 * chitchat model and "kể chuyện cười dài dài đi" to the reasoning model.
 *
 * Two stages, cheap first:
 *   1. deterministic preflight — plain code, no model call, no quota
 *   2. LLM classifier — only when the preflight genuinely cannot tell
 *
 * Stage 2 is the exception, not the norm. Free capacity is the scarce
 * resource here, and a classifier call is one fewer answer we can serve.
 */

export type Intent =
  | 'casual'
  | 'knowledge'
  | 'technical'
  | 'coding'
  | 'debugging'
  | 'server'
  | 'current_info'
  | 'archive'
  | 'vision'
  | 'unknown';

export type Complexity = 'trivial' | 'normal' | 'reasoning' | 'deep_reasoning';

export type ContextDependency = 'standalone' | 'recent' | 'reply_chain' | 'long_context';

export interface RequestAnalysis {
  intent: Intent;
  complexity: Complexity;
  isFollowUp: boolean;
  contextDependency: ContextDependency;
  needsWeb: boolean;
  needsArchive: boolean;
  needsVision: boolean;
  ambiguity: 'none' | 'resolvable' | 'missing';
  /** 0-1. Below ~0.6 the preflight defers to the classifier. */
  confidence: number;
  /** Where the verdict came from — surfaced by /ai debug. */
  source: 'preflight' | 'classifier' | 'fallback';
}

export interface AnalyzeInput {
  question: string;
  hasImage: boolean;
  /** The user replied to a specific message. Highest-signal context. */
  hasReply: boolean;
  /** Number of recent channel messages available as context. */
  recentCount: number;
}

// ── Deterministic signals ───────────────────────────────────────────────

const CODE_FENCE = /```|~~~/;
const STACK_TRACE =
  /\bat\s+[\w.$]+\s*\(|Traceback \(most recent call last\)|^\s*at\s|\bTypeError\b|\bReferenceError\b|\bSyntaxError\b|\bNullPointerException\b|:\d+:\d+\)/m;
const DEBUG_WORDS =
  /\b(error|exception|stack\s?trace|traceback|debug|crash|segfault|undefined is not|cannot read|fails?|failing|broken)\b|\blỗi\b|\bbị lỗi\b|\bkhông chạy\b|\bchạy không được\b|\bsập\b/i;
/**
 * Split deliberately. A language NAME alone is weak evidence — "phiên bản
 * mới nhất của Node là gì?" is a current-info question that happens to
 * contain "Node", and routing it to the coding chain meant answering from
 * a stale training set instead of looking it up.
 *
 * An ACTION verb ("sửa hộ cái regex này") is strong evidence and wins
 * outright.
 */
const CODING_ACTION =
  /\b(refactor|implement|debug|compile)\b|viết hàm|viết code|sửa code|sửa hộ|sửa giúp|fix hộ|fix giúp|đoạn code|thuật toán|tối ưu code|giải thích code|sửa .{0,12}\bregex\b|viết .{0,12}\bhàm\b/i;
const CODING_TOPIC =
  /\b(typescript|javascript|python|rust|golang|kotlin|swift|sql|regex|docker|kubernetes|node|npm|react|vue|discord\.?js|async|await|promise|race condition)\b/i;
const REASONING_WORDS =
  /\b(compare|architecture|trade-?off|why|explain|design|scal(e|ing)|benchmark)\b|so sánh|kiến trúc|phân tích|tại sao|vì sao|giải thích|đánh giá|nên chọn|khác nhau|ưu nhược/i;
const FRESH_WORDS =
  /\b(latest|newest|current|today|now|recent|20\d\d|version|release|price)\b|mới nhất|hiện tại|bây giờ|hôm nay|dạo này|gần đây|phiên bản|giá|tin tức/i;
const ARCHIVE_WORDS =
  /\b(said|mentioned|earlier|history)\b|đã nói|có nói|hôm trước|lúc trước|ai nhắc|từng nói|trong kênh|lịch sử chat/i;
const URL_RE = /https?:\/\/\S+/i;
const GREETING =
  /^(ê|ơi|hi|hey|hello|yo|alo|chào|xin chào|thanks?|thank you|cảm ơn|cám ơn|ok(e|ay)?|ừ|uk|umm?|hmm+|:\)|haha|kk+|vl|vcl)\b[\s!.?]*$/i;
/**
 * Pronouns with no antecedent in the message itself. "còn cái đó thì sao?"
 * is unanswerable standalone — it MUST inherit the reply chain or recent
 * turns, and routing it as trivial chitchat is how Aki used to answer a
 * follow-up as if it were a fresh greeting.
 */
const DANGLING_REF =
  /\b(cái (đó|này|kia)|nó|vụ (đó|này)|thằng (đó|này)|chỗ (đó|này)|như (vậy|thế)|vậy còn|còn .{0,20}thì sao|that one|this one)\b/i;
const FOLLOWUP_OPENER = /^(còn|vậy|thế|ừ|à|ok|với lại|thêm|nữa|sao|why|and|but|so)\b/i;

const COMMAND_RE = new RegExp(
  `(^|\\s)/(${[...SERVER_COMMAND_NAMES, ...LEGACY_COMMAND_NAMES]
    .sort((x, y) => y.length - x.length)
    .map((n) => n.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'))
    .join('|')})\\b`,
  'i',
);

function hasServerTerm(q: string): boolean {
  const lower = q.toLowerCase();
  return SERVER_DOMAIN_TERMS.some((t) => lower.includes(t));
}

/** Rough token proxy — char count is fine for a 4k/40k decision. */
const LONG_CONTEXT_CHARS = 6000;

/**
 * Stage 1. Pure function, no I/O, no quota. Returns null only when the
 * request is genuinely ambiguous and worth a classifier call.
 */
export function preflight(input: AnalyzeInput): RequestAnalysis | null {
  const q = input.question.trim();
  const hasReply = input.hasReply;

  const base = {
    isFollowUp: hasReply || FOLLOWUP_OPENER.test(q),
    contextDependency: (hasReply
      ? 'reply_chain'
      : q.length > LONG_CONTEXT_CHARS
        ? 'long_context'
        : input.recentCount > 0
          ? 'recent'
          : 'standalone') as ContextDependency,
    needsArchive: ARCHIVE_WORDS.test(q),
    ambiguity: 'none' as const,
    source: 'preflight' as const,
  };

  // Image present → vision, unconditionally. Only one free model can see
  // it, so nothing downstream gets a say.
  if (input.hasImage) {
    return {
      ...base,
      intent: 'vision',
      complexity: 'normal',
      needsWeb: false,
      needsVision: true,
      confidence: 1,
    };
  }

  // Code fence or stack trace → certain. No model needed to see a ```.
  if (CODE_FENCE.test(q) || STACK_TRACE.test(q)) {
    return {
      ...base,
      intent: DEBUG_WORDS.test(q) ? 'debugging' : 'coding',
      complexity: 'reasoning',
      needsWeb: false,
      needsVision: false,
      confidence: 0.95,
    };
  }

  // Bare greeting / acknowledgement — and NOT a dangling follow-up.
  if (GREETING.test(q) && !hasReply) {
    return {
      ...base,
      intent: 'casual',
      complexity: 'trivial',
      needsWeb: false,
      needsVision: false,
      confidence: 0.9,
    };
  }

  // Explicit slash-command or game vocabulary → answer from server truth.
  if (COMMAND_RE.test(q) || hasServerTerm(q)) {
    return {
      ...base,
      intent: 'server',
      complexity: 'normal',
      needsWeb: false,
      needsVision: false,
      confidence: 0.85,
    };
  }

  const fresh = FRESH_WORDS.test(q) || URL_RE.test(q);
  // An action verb is coding outright; a language name alone yields to a current-info question.
  const coding = CODING_ACTION.test(q) || (CODING_TOPIC.test(q) && !fresh);
  const debugging = DEBUG_WORDS.test(q);
  const reasoning = REASONING_WORDS.test(q);

  if (debugging && (coding || reasoning)) {
    return {
      ...base,
      intent: 'debugging',
      complexity: 'reasoning',
      needsWeb: fresh,
      needsVision: false,
      confidence: 0.85,
    };
  }

  if (coding) {
    return {
      ...base,
      intent: 'coding',
      complexity: q.length > 400 || reasoning ? 'deep_reasoning' : 'reasoning',
      needsWeb: fresh,
      needsVision: false,
      confidence: 0.85,
    };
  }

  // "What's the newest X" — a free model's training data cannot answer
  // this, so the routing must fetch evidence rather than trust the model.
  if (fresh) {
    return {
      ...base,
      intent: 'current_info',
      complexity: 'normal',
      needsWeb: true,
      needsVision: false,
      confidence: 0.8,
    };
  }

  if (base.needsArchive) {
    return {
      ...base,
      intent: 'archive',
      complexity: 'normal',
      needsWeb: false,
      needsVision: false,
      confidence: 0.8,
    };
  }

  if (reasoning) {
    return {
      ...base,
      intent: 'technical',
      complexity: q.length > 400 ? 'deep_reasoning' : 'reasoning',
      needsWeb: false,
      needsVision: false,
      confidence: 0.75,
    };
  }

  // Dangling reference with context to resolve it against: a follow-up,
  // not chitchat — but the SUBJECT is unknown, so keep it mid-tier rather
  // than sending it to the weakest model.
  if (DANGLING_REF.test(q) && (hasReply || input.recentCount > 0)) {
    return {
      ...base,
      intent: 'unknown',
      complexity: 'normal',
      isFollowUp: true,
      needsWeb: false,
      needsVision: false,
      ambiguity: 'resolvable',
      confidence: 0.7,
    };
  }

  // Very short, no markers, nothing to resolve → chitchat.
  if (q.length < 40 && !hasReply && !/\d{3,}/.test(q)) {
    return {
      ...base,
      intent: 'casual',
      complexity: 'trivial',
      needsWeb: false,
      needsVision: false,
      confidence: 0.75,
    };
  }

  // Genuinely long input → context handling matters more than topic.
  if (q.length > LONG_CONTEXT_CHARS) {
    return {
      ...base,
      intent: 'knowledge',
      complexity: 'reasoning',
      contextDependency: 'long_context',
      needsWeb: false,
      needsVision: false,
      confidence: 0.8,
    };
  }

  return null; // Ambiguous → worth one classifier call.
}

const CLASSIFIER_PROMPT = [
  'Bạn phân loại câu hỏi cho một bot Discord. Trả về DUY NHẤT một JSON object,',
  'không markdown, không giải thích:',
  '{"intent":"casual|knowledge|technical|coding|debugging|server|current_info|archive",',
  '"complexity":"trivial|normal|reasoning|deep_reasoning"}',
  '',
  '- casual: chuyện phiếm, chào hỏi, đùa',
  '- knowledge: hỏi kiến thức chung, trả lời được trong vài câu',
  '- technical: giải thích/so sánh kỹ thuật, cần lập luận',
  '- coding: viết/sửa/giải thích code',
  '- debugging: tìm nguyên nhân lỗi',
  '- server: hỏi về server tu tiên này (XP, cảnh giới, lệnh, vật phẩm)',
  '- current_info: cần thông tin mới/hiện tại (giá, phiên bản, tin tức)',
  '- archive: hỏi về lịch sử chat trong server',
].join('\n');

const VALID_INTENTS: readonly Intent[] = [
  'casual',
  'knowledge',
  'technical',
  'coding',
  'debugging',
  'server',
  'current_info',
  'archive',
];
const VALID_COMPLEXITY: readonly Complexity[] = [
  'trivial',
  'normal',
  'reasoning',
  'deep_reasoning',
];

/**
 * Stage 2. One cheap classifier call. Any failure degrades to a safe
 * middle: 'knowledge' + 'normal'. Under-serving beats mis-serving, and
 * this path is rare by construction.
 */
async function classify(input: AnalyzeInput): Promise<RequestAnalysis> {
  const fallback: RequestAnalysis = {
    intent: 'knowledge',
    complexity: 'normal',
    isFollowUp: input.hasReply,
    contextDependency: input.hasReply
      ? 'reply_chain'
      : input.recentCount > 0
        ? 'recent'
        : 'standalone',
    needsWeb: false,
    needsArchive: false,
    needsVision: false,
    ambiguity: 'resolvable',
    confidence: 0.4,
    source: 'fallback',
  };

  try {
    const result = await llm.complete('aki-triage', {
      systemPrompt: CLASSIFIER_PROMPT,
      userPrompt: input.question.slice(0, 1000),
      // Classifier models on this pool emit hidden reasoning before the
      // JSON; the registry floor covers it, this is the ceiling.
      maxOutputTokens: 600,
      temperature: 0,
      responseFormat: 'json',
    });
    if (!result) return fallback;

    const match = result.text.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    const parsed = JSON.parse(match[0]) as { intent?: string; complexity?: string };

    const intent = VALID_INTENTS.find((i) => i === parsed.intent);
    const complexity = VALID_COMPLEXITY.find((c) => c === parsed.complexity);
    if (!intent || !complexity) return fallback;

    return {
      intent,
      complexity,
      isFollowUp: input.hasReply,
      contextDependency: input.hasReply
        ? 'reply_chain'
        : input.recentCount > 0
          ? 'recent'
          : 'standalone',
      needsWeb: intent === 'current_info',
      needsArchive: intent === 'archive',
      needsVision: false,
      ambiguity: 'none',
      confidence: 0.7,
      source: 'classifier',
    };
  } catch {
    return fallback;
  }
}

export async function analyzeRequest(input: AnalyzeInput): Promise<RequestAnalysis> {
  return preflight(input) ?? (await classify(input));
}

/**
 * Quota savers. Before this, one question could burn THREE classifier
 * calls — request triage, web-intent, archive-intent — each a separate
 * round trip against a pool that 429s under load (spec §33).
 *
 * These skip the extra call only where the answer is definitionally "no",
 * never as a guess. A greeting needs no web lookup; a question about XP
 * numbers is answered from server config; a pasted stack trace is not a
 * chat-history query. Anything less certain still pays for the detector,
 * because a missed lookup means Aki answers from stale training memory —
 * a worse failure than one extra call.
 */
export function shouldSkipWebLookup(a: RequestAnalysis): boolean {
  if (a.needsWeb) return false;
  if (a.confidence < 0.85) return false;
  return a.intent === 'casual' || a.intent === 'server' || a.intent === 'vision';
}

export function shouldSkipArchiveLookup(a: RequestAnalysis): boolean {
  if (a.needsArchive) return false;
  if (a.confidence < 0.85) return false;
  return (
    a.intent === 'casual' ||
    a.intent === 'server' ||
    a.intent === 'vision' ||
    a.intent === 'coding' ||
    a.intent === 'debugging'
  );
}

/**
 * Analysis → answer chain. Intent decides the specialist; complexity only
 * escalates within it. Kept as a pure function so routing is testable
 * without a model.
 */
export function taskForAnalysis(a: RequestAnalysis): TaskId {
  if (a.needsVision || a.intent === 'vision') return 'aki-answer-vision';
  if (a.contextDependency === 'long_context') return 'aki-answer-long-context';
  if (a.intent === 'coding' || a.intent === 'debugging') return 'aki-answer-coding';
  if (a.complexity === 'deep_reasoning') return 'aki-answer-reasoning';
  if (a.intent === 'technical') {
    return a.complexity === 'reasoning' ? 'aki-answer-reasoning' : 'aki-answer-technical';
  }
  if (a.intent === 'casual' && a.complexity === 'trivial') return 'aki-answer-trivial';
  // server / knowledge / current_info / archive / unknown → general.
  // These are grounded by retrieved evidence, so the model's job is
  // synthesis rather than recall — the general chain handles that fine.
  return 'aki-answer-general';
}
