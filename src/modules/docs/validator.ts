import { ulid } from 'ulid';
import { getStore } from '../../db/index.js';
import type { DocContribution, DocDifficulty, DocReviewLog, DocSource } from '../../db/types.js';
import { logger } from '../../utils/logger.js';
import { sanitizeForLlmBody, sanitizeForLlmPrompt } from '../../utils/sanitize.js';
import { llm } from '../llm/index.js';

/**
 * Phase 12 Lát 9 — Document validation pipeline.
 *
 * User submits via /contribute-doc or POST /api/contribute. We:
 *   1. Persist a `DocContribution` row in status='pending'
 *   2. Call llm.complete('doc-validate', ...) with strict JSON schema
 *   3. Parse score + classification, mark approved/rejected
 *   4. Persist a `DocReviewLog` for analytics
 *   5. Return decision so caller can publish forum thread / send rejection DM
 *
 * Threshold: approved if combined_score >= 60 AND llm says approved=true.
 * Below → rejected with reason.
 */

const APPROVE_SCORE_THRESHOLD = 60;
const ALLOWED_SECTIONS = [
  'tech',
  'cultivation',
  'lore',
  'dev',
  'data-science',
  'community',
] as const;
const MAX_TAGS = 5;
const MAX_BODY_CHARS = 4000;

const SYSTEM_PROMPT = `Bạn là editorial gatekeeper cho Discord server Radiant Tech Sect (tu tiên + tech community). User submit bài viết — bạn chấm điểm 4 trục:

1. **clarity** (0-100): độ rõ ràng, dễ đọc, có cấu trúc.
2. **technical_correctness** (0-100): chính xác kỹ thuật (nếu tech) hoặc consistency lore (nếu cultivation).
3. **safety** (0-100): không có content nguy hiểm (hack tutorials, scams, phishing, hate speech).
4. **relevance** (0-100): phù hợp với server (tech/cultivation/dev/community).

Combined = (clarity + technical_correctness + safety + relevance) / 4.
Approve nếu combined >= 60 VÀ tất cả 4 trục >= 40.

Classify:
- **difficulty**: easy (intro/beginner) / medium (intermediate) / hard (advanced/expert)
- **section**: tech / cultivation / lore / dev / data-science / community (pick best match)
- **tags**: 1-5 keyword tags từ nội dung (lowercase, kebab-case, vd "git-rebase", "kim-dan", "typescript")

# Output — STRICT JSON, no markdown fence

{
  "approved": boolean,
  "combined_score": number (0-100),
  "clarity": number,
  "technical_correctness": number,
  "safety": number,
  "relevance": number,
  "difficulty": "easy" | "medium" | "hard",
  "section": "tech" | "cultivation" | "lore" | "dev" | "data-science" | "community",
  "tags": string[],
  "rejection_reason": string | null  // VN, 1-2 câu, null nếu approved
}

CHỈ output JSON object. KHÔNG markdown fence. KHÔNG preamble.`;

interface ValidationResponse {
  approved: boolean;
  combined_score: number;
  clarity: number;
  technical_correctness: number;
  safety: number;
  relevance: number;
  difficulty: DocDifficulty;
  section: string;
  tags: string[];
  rejection_reason: string | null;
}

export interface SubmitDocInput {
  authorId: string;
  title: string;
  body: string;
  source: DocSource;
}

export interface SubmitDocResult {
  contribution: DocContribution;
  decision: 'approved' | 'rejected' | 'llm-failed';
  reviewLog?: DocReviewLog;
}

function parseLlmResponse(raw: string): ValidationResponse | null {
  // Strip code fences if model ignored instructions.
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .replace(/^<think>[\s\S]*?<\/think>\s*/i, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as Partial<ValidationResponse>;
    // Defensive coercion + clamping.
    return {
      approved: parsed.approved === true,
      combined_score: clamp(Number(parsed.combined_score) || 0, 0, 100),
      clarity: clamp(Number(parsed.clarity) || 0, 0, 100),
      technical_correctness: clamp(Number(parsed.technical_correctness) || 0, 0, 100),
      safety: clamp(Number(parsed.safety) || 0, 0, 100),
      relevance: clamp(Number(parsed.relevance) || 0, 0, 100),
      difficulty:
        parsed.difficulty === 'easy' || parsed.difficulty === 'hard' ? parsed.difficulty : 'medium',
      section: ALLOWED_SECTIONS.includes(parsed.section as never)
        ? (parsed.section as string)
        : 'community',
      tags: Array.isArray(parsed.tags)
        ? parsed.tags
            .filter((t): t is string => typeof t === 'string')
            .slice(0, MAX_TAGS)
            .map((t) => t.toLowerCase().replace(/\s+/g, '-').slice(0, 32))
        : [],
      rejection_reason:
        typeof parsed.rejection_reason === 'string' ? parsed.rejection_reason : null,
    };
  } catch {
    return null;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export async function submitContribution(input: SubmitDocInput): Promise<SubmitDocResult> {
  const store = getStore();
  // Sanitize all user-provided strings before storage AND before LLM.
  // Doc submissions are higher attack surface than chat — long-form,
  // potentially copy-pasted, and Bill's website automation may not
  // pre-clean payloads.
  const safeTitle = sanitizeForLlmPrompt(input.title, { maxLen: 200 });
  const safeBody = sanitizeForLlmBody(input.body, { maxLen: MAX_BODY_CHARS });
  const safeAuthor = sanitizeForLlmPrompt(input.authorId, { maxLen: 32 });
  const contribution: DocContribution = {
    id: ulid(),
    thread_id: null,
    author_id: safeAuthor,
    title: safeTitle,
    body: safeBody,
    status: 'pending',
    score: null,
    difficulty: null,
    tags: [],
    section: null,
    source: input.source,
    rejection_reason: null,
    submitted_at: Date.now(),
    decided_at: null,
  };
  await store.docContributions.set(contribution);

  // LLM judgment.
  const userPrompt = `Bài viết user submit:\n\n**Tiêu đề**: ${safeTitle}\n\n**Nội dung**:\n${safeBody}`;
  const result = await llm.complete('doc-validate', {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    maxOutputTokens: 600,
    temperature: 0.3,
    responseFormat: 'json',
  });

  if (!result) {
    logger.error({ contribution_id: contribution.id }, 'docs: LLM router returned null');
    return { contribution, decision: 'llm-failed' };
  }

  const parsed = parseLlmResponse(result.text);
  if (!parsed) {
    logger.error(
      { contribution_id: contribution.id, raw: result.text.slice(0, 200) },
      'docs: LLM response unparseable',
    );
    return { contribution, decision: 'llm-failed' };
  }

  const approved =
    parsed.approved &&
    parsed.combined_score >= APPROVE_SCORE_THRESHOLD &&
    parsed.clarity >= 40 &&
    parsed.technical_correctness >= 40 &&
    parsed.safety >= 40 &&
    parsed.relevance >= 40;

  const decided: DocContribution = {
    ...contribution,
    status: approved ? 'approved' : 'rejected',
    score: Math.round(parsed.combined_score),
    difficulty: parsed.difficulty,
    section: parsed.section,
    tags: parsed.tags,
    rejection_reason: approved ? null : (parsed.rejection_reason ?? 'Không đạt ngưỡng chất lượng.'),
    decided_at: Date.now(),
  };
  await store.docContributions.set(decided);

  const reviewLog: DocReviewLog = {
    id: ulid(),
    contribution_id: contribution.id,
    llm_provider: result.provider,
    llm_model: result.model,
    llm_tokens_in: result.tokensIn,
    llm_tokens_out: result.tokensOut,
    llm_cost_usd: result.costUsd,
    raw_response: result.text.slice(0, 2000),
    approved,
    created_at: Date.now(),
  };
  await store.docReviewLogs.append(reviewLog);

  logger.info(
    {
      contribution_id: contribution.id,
      author: input.authorId,
      source: input.source,
      approved,
      score: decided.score,
      difficulty: decided.difficulty,
      section: decided.section,
      tags_count: decided.tags.length,
    },
    'docs: contribution decided',
  );

  return { contribution: decided, decision: approved ? 'approved' : 'rejected', reviewLog };
}

export const __for_testing = {
  parseLlmResponse,
  ALLOWED_SECTIONS,
  APPROVE_SCORE_THRESHOLD,
};
