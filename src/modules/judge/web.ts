import type { IncomingMessage, ServerResponse } from 'node:http';
import { rankById } from '../../config/cultivation.js';
import { judgeProblem } from '../../config/judge-problems.js';
import { TRIBULATION_TIERS } from '../../config/leveling.js';
import { DOCS_ORIGIN } from '../../config/phong-kiep.js';
import { getStore } from '../../db/index.js';
import { webSecret } from '../avatar/web.js';
import { readJsonBody, sendHtml, sendJson } from '../web/router.js';
import { messagePage, page } from '../web/shell.js';
import { JUDGE_LANGS, type JudgeLang, LANG_LABEL, entryName, starterCode } from './harness.js';
import { VERDICT_TEXT } from './judge.js';
import { runnerAvailable } from './runners.js';
import {
  type ActionRefusal,
  DEADLINE_GRACE_MS,
  MAX_SERVER_RUNS,
  MAX_SUBMITS,
  type Trial,
  forfeitTrial,
  openTrial,
  readTrialToken,
  runExamples,
  submitSolution,
} from './trial.js';

/**
 * /judge — the Thiên Kiếp Đài page and its API. The link carries a signed
 * token for one trial; opening the page starts the clock.
 */

const GONE = messagePage(
  'Link không dùng được',
  'Link Thiên Kiếp Đài này không đúng hoặc đã bị thay. Quay lại Discord để xem kết quả hoặc lấy link mới.',
);

const REFUSAL_TEXT: Record<ActionRefusal, string> = {
  closed: 'Kiếp này đã kết thúc.',
  'not-started': 'Tải lại trang để bắt đầu tính giờ.',
  'time-up': 'Hết giờ rồi.',
  'unknown-problem': 'Đề không thuộc kiếp này.',
  'no-submits': `Đã dùng hết ${MAX_SUBMITS} lần nộp.`,
  'no-runs': `Đã dùng hết ${MAX_SERVER_RUNS} lần chạy thử trên máy chấm. Python và JavaScript vẫn chạy thử được ngay trong trình duyệt.`,
};

const FOUNDATION = [
  { title: 'Độ phức tạp Big-O', url: `${DOCS_ORIGIN}/docs/algorithms/do-phuc-tap-big-o/` },
  { title: 'Python', url: `${DOCS_ORIGIN}/docs/python/` },
  { title: 'JavaScript', url: `${DOCS_ORIGIN}/docs/javascript/` },
  { title: 'C#', url: `${DOCS_ORIGIN}/docs/csharp/` },
];

function trialFrom(token: unknown): Trial | null {
  return typeof token === 'string' ? readTrialToken(token, webSecret()) : null;
}

function stateOf(t: Trial) {
  const user = getStore().users.get(t.meta.discord_id);
  const done = t.meta.status !== 'open';
  return {
    ok: true,
    name: user?.display_name ?? user?.username ?? 'Tu sĩ',
    rankName: rankById(user?.cultivation_rank ?? 'pham_nhan').name,
    title: t.meta.tier ? TRIBULATION_TIERS[t.meta.tier].name : 'Luyện đề Tàng Kinh Các',
    mode: t.meta.mode,
    status: t.meta.status,
    openedAt: t.meta.opened_at,
    deadline: t.meta.deadline,
    graceMs: DEADLINE_GRACE_MS,
    submitsLeft: Math.max(0, MAX_SUBMITS - t.meta.submits),
    runsLeft: Math.max(0, MAX_SERVER_RUNS - t.meta.runs),
    online: runnerAvailable(),
    langs: JUDGE_LANGS.map((l) => ({ id: l, label: LANG_LABEL[l] })),
    foundation: FOUNDATION,
    problems: t.meta.problems.map((slug) => {
      const p = judgeProblem(slug);
      if (!p) return null;
      return {
        slug,
        title: p.title,
        difficulty: p.difficulty,
        story: p.story,
        statement: p.statement,
        constraints: p.constraints,
        params: p.params,
        returns: p.returns,
        examples: p.examples,
        entry: Object.fromEntries(JUDGE_LANGS.map((l) => [l, entryName(p, l)])),
        starter: Object.fromEntries(JUDGE_LANGS.map((l) => [l, starterCode(p, l)])),
        compare: p.compare,
        solved: t.meta.solved.includes(slug),
        // The lesson walks through the solution, so it unlocks once the trial is over.
        lesson: done ? `${DOCS_ORIGIN}${p.docs}` : null,
      };
    }),
  };
}

async function body(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  try {
    return ((await readJsonBody(req, 64 * 1024)) ?? {}) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function langOf(v: unknown): JudgeLang | null {
  return typeof v === 'string' && (JUDGE_LANGS as string[]).includes(v) ? (v as JudgeLang) : null;
}

/** Per-trial lock so two tabs cannot submit at once. */
const busy = new Set<string>();

export async function handleJudgeWeb(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const p = url.pathname;
  if (req.method === 'GET' && (p === '/judge' || p === '/judge/')) {
    if (!trialFrom(url.searchParams.get('t'))) return sendHtml(res, 410, GONE);
    sendHtml(
      res,
      200,
      page({ title: 'Thiên Kiếp Đài', body: '<div id="app" class="wrap"></div>', script: 'judge' }),
    );
    return;
  }
  if (req.method === 'GET' && p === '/judge/api/state') {
    const t = trialFrom(url.searchParams.get('t'));
    if (!t) return sendJson(res, 410, { ok: false, error: 'Link không còn dùng được.' });
    return sendJson(res, 200, stateOf(t));
  }
  if (req.method !== 'POST') return sendJson(res, 404, { ok: false, error: 'not found' });

  const b = await body(req);
  if (!b) return sendJson(res, 400, { ok: false, error: 'Dữ liệu gửi lên không đọc được.' });
  const t = trialFrom(b.t);
  if (!t) return sendJson(res, 410, { ok: false, error: 'Link không còn dùng được.' });

  if (p === '/judge/api/start') {
    const opened = await openTrial(t);
    return sendJson(res, 200, stateOf(opened));
  }
  if (p === '/judge/api/forfeit') {
    await forfeitTrial(t);
    return sendJson(res, 200, stateOf(t));
  }
  if (p === '/judge/api/run' || p === '/judge/api/submit') {
    const lang = langOf(b.lang);
    const slug = typeof b.slug === 'string' ? b.slug : '';
    const code = typeof b.code === 'string' ? b.code : '';
    if (!lang || !code.trim())
      return sendJson(res, 400, { ok: false, error: 'Thiếu ngôn ngữ hoặc code.' });
    if (busy.has(t.id))
      return sendJson(res, 429, { ok: false, error: 'Đang chấm bài trước, đợi chút.' });
    busy.add(t.id);
    try {
      const out =
        p === '/judge/api/run'
          ? await runExamples(t, slug, lang, code)
          : await submitSolution(t, slug, lang, code);
      if (!out.ok) return sendJson(res, 409, { ok: false, error: REFUSAL_TEXT[out.reason] });
      return sendJson(res, 200, {
        ok: true,
        result: { ...out.result, label: VERDICT_TEXT[out.result.verdict] },
        state: stateOf(t),
      });
    } finally {
      busy.delete(t.id);
    }
  }
  sendJson(res, 404, { ok: false, error: 'not found' });
}
