import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { csharp } from '@codemirror/legacy-modes/mode/clike';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { api, countdown, h, token } from './dom';

/**
 * Thiên Kiếp Đài: read the problem, write code, try it on the examples,
 * submit for the hidden tests. Python and JavaScript try-runs happen in a
 * Web Worker in the browser (Pyodide for Python), so they cost nothing;
 * C# try-runs and every submit go to the bot's judge.
 */

type Lang = 'python' | 'javascript' | 'csharp';
interface Case {
  a: unknown[];
  e: unknown;
}
interface Problem {
  slug: string;
  title: string;
  difficulty: string;
  story: string;
  statement: string;
  constraints: string;
  params: { name: string; type: string }[];
  returns: string;
  examples: Case[];
  entry: Record<Lang, string>;
  starter: Record<Lang, string>;
  compare: 'exact' | 'sorted' | 'groups';
  solved: boolean;
  lesson: string | null;
}
interface State {
  ok: boolean;
  error?: string;
  name: string;
  rankName: string;
  title: string;
  mode: string;
  status: 'open' | 'passed' | 'failed' | 'expired';
  openedAt: number | null;
  deadline: number | null;
  graceMs: number;
  submitsLeft: number;
  runsLeft: number;
  online: boolean;
  langs: { id: Lang; label: string }[];
  foundation: { title: string; url: string }[];
  problems: Problem[];
}
interface Result {
  verdict: string;
  label: string;
  passed: number;
  total: number;
  ms: number | null;
  failedAt?: number;
  message?: string;
  detail?: { index: number; input: string; expected: string; got: string };
}

const CSS = `
.jgrid{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:16px}
@media (max-width:900px){.jgrid{grid-template-columns:1fr}}
.tabs{display:flex;gap:6px;flex-wrap:wrap}
.tab{background:var(--panel);border:3px solid var(--line);color:var(--muted);padding:0 14px}
.tab.on{background:var(--gold);color:var(--bg);border-color:#f0c860}
.tab.done{border-color:var(--green)}
.story{color:var(--muted);font-size:20px}
.stmt{font-size:22px;color:var(--bright)}
.ex{background:var(--deep);border:2px solid var(--line);padding:8px 10px;font-family:ui-monospace,Consolas,monospace;font-size:14px;white-space:pre-wrap;word-break:break-all}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.editor{border:3px solid var(--line);background:#0b0f14;min-height:360px}
.editor .cm-editor{height:420px}
.editor .cm-scroller{font-family:ui-monospace,Consolas,monospace;font-size:14px}
select{font-family:VT323,monospace;font-size:22px;background:var(--panel);color:var(--ink);border:3px solid var(--line);min-height:44px;padding:0 8px}
.clock{font-size:40px;color:var(--gold)}
.clock.low{color:var(--red)}
.pill{display:inline-block;border:2px solid var(--line);padding:0 8px;color:var(--muted)}
.res pre{white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Consolas,monospace;font-size:13px;margin:6px 0 0}
.banner{font-size:34px;text-align:center;padding:18px}
`;

const style = document.createElement('style');
style.textContent = CSS;
document.head.append(style);

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#b48ef0' },
  { tag: [tags.string, tags.special(tags.string)], color: '#8fd18a' },
  { tag: tags.number, color: '#f0b84a' },
  { tag: tags.comment, color: '#6e6780', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.definition(tags.variableName)], color: '#7fd0d8' },
  { tag: tags.typeName, color: '#e8806e' },
]);
const theme = EditorView.theme(
  {
    '&': { color: '#efe6cf', backgroundColor: '#0b0f14' },
    '.cm-content': { caretColor: '#f0d060' },
    '.cm-gutters': { backgroundColor: '#0e0c13', color: '#6e6780', border: 'none' },
    '.cm-activeLine': { backgroundColor: '#161c24' },
    '.cm-activeLineGutter': { backgroundColor: '#161c24' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: '#2a3a48' },
  },
  { dark: true },
);
const langExt = (l: Lang) =>
  l === 'python' ? python() : l === 'javascript' ? javascript() : StreamLanguage.define(csharp);

// ---------------------------------------------------------------- compare (same as the server)

function canonical(v: unknown, mode: Problem['compare']): string {
  if (mode === 'sorted' && Array.isArray(v))
    return JSON.stringify(
      [...v].sort((a, b) => (Number(a) > Number(b) ? 1 : Number(a) < Number(b) ? -1 : 0)),
    );
  if (mode === 'groups' && Array.isArray(v))
    return JSON.stringify(
      v
        .map((g) => (Array.isArray(g) ? [...g].map(String).sort() : [String(g)]))
        .map((g) => g.join('\u0001'))
        .sort(),
    );
  return JSON.stringify(v);
}

// ---------------------------------------------------------------- browser runners

const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';

const WORKER_SRC = `
let py = null;
self.onmessage = async (ev) => {
  const { lang, code, entry, cases } = ev.data;
  const out = [];
  try {
    if (lang === 'javascript') {
      const fn = new Function(code + '\\n;return ' + entry + ';')();
      for (const c of cases) {
        try { out.push({ ok: true, v: JSON.stringify(fn.apply(null, JSON.parse(JSON.stringify(c)))) }); }
        catch (e) { out.push({ ok: false, err: String((e && e.name) || 'Error') + ': ' + String((e && e.message) || e) }); }
      }
    } else {
      if (!py) { importScripts('${PYODIDE}pyodide.js'); py = await loadPyodide({ indexURL: '${PYODIDE}' }); }
      const ns = py.globals.get('dict')();
      py.runPython(code, { globals: ns });
      for (const c of cases) {
        try {
          ns.set('__args', JSON.stringify(c));
          const v = py.runPython('import json\\njson.dumps(' + entry + '(*json.loads(__args)), separators=(",", ":"))', { globals: ns });
          out.push({ ok: true, v });
        } catch (e) { out.push({ ok: false, err: String(e.message || e).split('\\n').filter(Boolean).slice(-1)[0] }); }
      }
    }
    self.postMessage({ ok: true, out });
  } catch (e) {
    self.postMessage({ ok: false, err: String((e && e.message) || e) });
  }
};
`;

/** Runs the examples in a worker; a stuck loop is killed after the timeout. */
function runInBrowser(
  lang: 'python' | 'javascript',
  code: string,
  entry: string,
  cases: unknown[][],
) {
  return new Promise<{
    ok: boolean;
    out?: { ok: boolean; v?: string; err?: string }[];
    err?: string;
  }>((resolve) => {
    const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    const w = new Worker(url);
    // Pyodide downloads ~10 MB the first time, so Python gets longer.
    const limit = lang === 'python' ? 60_000 : 8_000;
    const timer = setTimeout(() => {
      w.terminate();
      resolve({ ok: false, err: 'Chạy quá lâu (có thể là vòng lặp vô hạn).' });
    }, limit);
    w.onmessage = (ev) => {
      clearTimeout(timer);
      w.terminate();
      URL.revokeObjectURL(url);
      resolve(ev.data);
    };
    w.onerror = (ev) => {
      clearTimeout(timer);
      w.terminate();
      resolve({ ok: false, err: ev.message || 'Lỗi khi chạy.' });
    };
    w.postMessage({ lang, code, entry, cases });
  });
}

// ---------------------------------------------------------------- page

const app = document.getElementById('app') as HTMLElement;
const t = token();
let state: State;
let current = 0;
let lang: Lang = 'python';
let view: EditorView | null = null;
const langSlot = new Compartment();
let resultBox: HTMLElement;
let busy = false;
let autoSubmitted = false;

const storeKey = (slug: string, l: Lang) => `judge:${t.slice(0, 24)}:${slug}:${l}`;
function loadCode(p: Problem, l: Lang): string {
  try {
    return localStorage.getItem(storeKey(p.slug, l)) ?? p.starter[l];
  } catch {
    return p.starter[l];
  }
}
function saveCode(): void {
  const p = state.problems[current];
  if (!p || !view) return;
  try {
    localStorage.setItem(storeKey(p.slug, lang), view.state.doc.toString());
  } catch {
    /* storage off: code just is not remembered */
  }
}

function fmtArgs(p: Problem, c: Case): string {
  return p.params.map((x, i) => `${x.name} = ${JSON.stringify(c.a[i])}`).join('\n');
}

function showResult(r: Result | null, extra?: string, ok?: boolean): void {
  resultBox.replaceChildren();
  if (!r && !extra) return;
  const cls = (ok ?? r?.verdict === 'accepted') ? 'notice ok res' : 'notice err res';
  const box = h('div', { class: cls });
  if (r) {
    box.append(
      h(
        'div',
        {},
        h('b', {}, r.label),
        ` · qua ${r.passed}/${r.total} test`,
        r.ms !== null ? ` · ${r.ms} ms` : '',
      ),
    );
    if (r.failedAt && !r.detail)
      box.append(h('div', { class: 'muted' }, `Test ẩn số ${r.failedAt} chưa qua.`));
    if (r.detail)
      box.append(
        h(
          'pre',
          {},
          `Ví dụ ${r.detail.index}\n${r.detail.input}\nMong đợi: ${r.detail.expected}\nNhận được: ${r.detail.got}`,
        ),
      );
    if (r.message) box.append(h('pre', {}, r.message));
  }
  if (extra) box.append(h('div', {}, extra));
  resultBox.append(box);
}

async function tryRun(): Promise<void> {
  const p = state.problems[current];
  if (!p || !view || busy) return;
  busy = true;
  saveCode();
  const code = view.state.doc.toString();
  try {
    if (lang === 'csharp') {
      showResult(null, 'Đang chạy trên máy chấm…', true);
      const r = await api<{ ok: boolean; error?: string; result?: Result; state?: State }>(
        '/judge/api/run',
        {
          t,
          slug: p.slug,
          lang,
          code,
        },
      );
      if (r.data.state) state = r.data.state;
      if (!r.data.ok || !r.data.result) showResult(null, r.data.error ?? 'Không chạy được.', false);
      else showResult(r.data.result, `Còn ${state.runsLeft} lần chạy C# trên máy chấm.`);
      return;
    }
    showResult(
      null,
      lang === 'python' ? 'Đang tải Python trong trình duyệt (lần đầu hơi lâu)…' : 'Đang chạy…',
      true,
    );
    const out = await runInBrowser(
      lang,
      code,
      p.entry[lang],
      p.examples.map((c) => c.a),
    );
    if (!out.ok || !out.out) return showResult(null, out.err ?? 'Không chạy được.', false);
    let passed = 0;
    for (const [i, c] of p.examples.entries()) {
      const o = out.out[i];
      if (!o?.ok) {
        return showResult({
          verdict: 'runtime-error',
          label: 'Lỗi khi chạy',
          passed,
          total: p.examples.length,
          ms: null,
          message: o?.err,
        });
      }
      let got: unknown;
      try {
        got = JSON.parse(o.v ?? 'null');
      } catch {
        got = o.v;
      }
      if (canonical(got, p.compare) !== canonical(c.e, p.compare))
        return showResult({
          verdict: 'wrong',
          label: 'Sai kết quả',
          passed,
          total: p.examples.length,
          ms: null,
          detail: {
            index: i + 1,
            input: fmtArgs(p, c),
            expected: JSON.stringify(c.e),
            got: o.v ?? '',
          },
        });
      passed++;
    }
    showResult(
      { verdict: 'accepted', label: 'Qua các ví dụ', passed, total: p.examples.length, ms: null },
      'Ví dụ chỉ là khởi đầu: test ẩn có cả trường hợp biên và dữ liệu lớn. Nộp bài để thử thật.',
    );
  } finally {
    busy = false;
  }
}

async function submit(auto = false): Promise<void> {
  const p = state.problems[current];
  if (!p || !view || busy) return;
  if (!auto && !confirm(`Nộp bài "${p.title}"? Còn ${state.submitsLeft} lần nộp.`)) return;
  busy = true;
  saveCode();
  showResult(null, 'Đang chấm toàn bộ test ẩn…', true);
  try {
    const r = await api<{ ok: boolean; error?: string; result?: Result; state?: State }>(
      '/judge/api/submit',
      {
        t,
        slug: p.slug,
        lang,
        code: view.state.doc.toString(),
      },
    );
    if (r.data.state) state = r.data.state;
    if (!r.data.ok || !r.data.result) showResult(null, r.data.error ?? 'Không nộp được.', false);
    else showResult(r.data.result, `Còn ${state.submitsLeft} lần nộp.`);
    render(false);
  } finally {
    busy = false;
  }
}

async function autoSubmitAll(): Promise<void> {
  if (autoSubmitted || state.status !== 'open') return;
  autoSubmitted = true;
  for (const [i, p] of state.problems.entries()) {
    if (p.solved) continue;
    const code = (() => {
      try {
        return localStorage.getItem(storeKey(p.slug, lang));
      } catch {
        return null;
      }
    })();
    if (i === current && view) saveCode();
    const latest = i === current && view ? view.state.doc.toString() : code;
    if (!latest || latest === p.starter[lang]) continue;
    current = i;
    busy = false;
    const r = await api<{ state?: State }>('/judge/api/submit', {
      t,
      slug: p.slug,
      lang,
      code: latest,
    });
    if (r.data.state) state = r.data.state;
  }
  await reload();
}

async function reload(): Promise<void> {
  const r = await api<State>(`/judge/api/state?t=${encodeURIComponent(t)}`);
  if (r.data.ok) state = r.data;
  render(true);
}

function header(): HTMLElement {
  const clock = h('div', { class: 'clock' }, '--:--');
  if (state.status === 'open' && state.deadline) {
    countdown(clock, state.deadline, () => {
      clock.classList.add('low');
      void autoSubmitAll();
    });
    const tick = setInterval(() => {
      if (!state.deadline || state.status !== 'open') return clearInterval(tick);
      clock.classList.toggle('low', state.deadline - Date.now() < 5 * 60_000);
    }, 5000);
  } else clock.textContent = '';
  return h(
    'div',
    { class: 'head' },
    h(
      'div',
      {},
      h('div', { class: 'kicker' }, `THIÊN KIẾP ĐÀI · ${state.name} · ${state.rankName}`),
      h('div', { class: 'h1' }, state.title),
    ),
    h(
      'div',
      { class: 'row' },
      h('span', { class: 'pill' }, `Nộp còn ${state.submitsLeft}`),
      state.online
        ? h('span', { class: 'pill' }, 'Máy chấm sẵn sàng')
        : h('span', { class: 'pill', style: 'color:var(--red)' }, 'Máy chấm đang nghỉ'),
      clock,
    ),
  );
}

function finishedBanner(): HTMLElement | null {
  if (state.status === 'open') return null;
  const text =
    state.status === 'passed'
      ? 'Vượt kiếp thành công! Kết quả đã gửi về Discord.'
      : state.status === 'expired'
        ? 'Link đã quá hạn mở.'
        : 'Kiếp này đã kết thúc. Xem lời giải ở Tàng Kinh Các rồi thử lại lần sau.';
  return h(
    'div',
    { class: `panel banner ${state.status === 'passed' ? 'notice ok' : 'notice err'}` },
    text,
  );
}

function render(rebuildEditor: boolean): void {
  const p = state.problems[current];
  if (!p) return;
  const keep = view && !rebuildEditor ? view.state.doc.toString() : null;
  app.replaceChildren();
  app.append(header());
  const banner = finishedBanner();
  if (banner) app.append(banner);
  if (state.problems.length > 1)
    app.append(
      h(
        'div',
        { class: 'tabs' },
        ...state.problems.map((q, i) =>
          h(
            'button',
            {
              class: `tab${i === current ? ' on' : ''}${q.solved ? ' done' : ''}`,
              onclick: () => {
                saveCode();
                current = i;
                render(true);
              },
            },
            `${q.solved ? '✓ ' : ''}Đề ${i + 1}: ${q.title}`,
          ),
        ),
      ),
    );

  const left = h(
    'div',
    { class: 'panel', style: 'display:flex;flex-direction:column;gap:10px' },
    h(
      'div',
      { class: 'kicker' },
      `${p.difficulty === 'easy' ? 'DỄ' : p.difficulty === 'medium' ? 'VỪA' : 'KHÓ'}${p.solved ? ' · ĐÃ QUA' : ''}`,
    ),
    h('div', { class: 'h1', style: 'font-size:36px;line-height:36px' }, p.title),
    h('div', { class: 'story' }, p.story),
    h('div', { class: 'stmt' }, p.statement),
    h('div', { class: 'muted' }, `Giới hạn: ${p.constraints}`),
    ...p.examples.map((c, i) =>
      h('div', { class: 'ex' }, `Ví dụ ${i + 1}\n${fmtArgs(p, c)}\n→ ${JSON.stringify(c.e)}`),
    ),
    h(
      'div',
      {},
      h('div', { class: 'kicker' }, 'TÀNG KINH CÁC'),
      ...state.foundation.map((f) =>
        h('div', {}, h('a', { href: f.url, target: '_blank', rel: 'noopener' }, f.title)),
      ),
      p.lesson
        ? h(
            'div',
            {},
            h(
              'a',
              { href: p.lesson, target: '_blank', rel: 'noopener' },
              'Bài giảng và lời giải của đề này',
            ),
          )
        : h('div', { class: 'faint' }, 'Bài giảng lời giải mở khi kiếp kết thúc.'),
    ),
  );

  const select = h(
    'select',
    {
      'aria-label': 'Ngôn ngữ',
      onchange: (e: Event) => {
        saveCode();
        lang = (e.target as HTMLSelectElement).value as Lang;
        render(true);
      },
    },
    ...state.langs.map((l) => h('option', { value: l.id, selected: l.id === lang }, l.label)),
  ) as HTMLSelectElement;
  const editorBox = h('div', { class: 'editor' });
  resultBox = h('div', {});
  const open = state.status === 'open';
  const right = h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:10px' },
    h(
      'div',
      { class: 'row' },
      select,
      h('span', { class: 'muted' }, `Hàm cần viết: ${p.entry[lang]}`),
    ),
    editorBox,
    h(
      'div',
      { class: 'row' },
      h(
        'button',
        { class: 'btn', onclick: () => void tryRun(), disabled: !open },
        'Chạy thử ví dụ',
      ),
      h(
        'button',
        {
          class: 'btn primary',
          onclick: () => void submit(),
          disabled: !open || !state.online || p.solved,
        },
        p.solved ? 'Đã qua' : 'Nộp bài',
      ),
      h(
        'button',
        {
          class: 'btn',
          onclick: () => {
            if (view && confirm('Xóa code hiện tại, quay về khung ban đầu?'))
              view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: p.starter[lang] },
              });
          },
          disabled: !open,
        },
        'Viết lại',
      ),
      open
        ? h(
            'button',
            {
              class: 'btn',
              style: 'margin-left:auto',
              onclick: async () => {
                if (!confirm('Bỏ cuộc? Kiếp sẽ tính là trượt.')) return;
                const r = await api<State>('/judge/api/forfeit', { t });
                if (r.data.ok) state = r.data;
                render(true);
              },
            },
            'Bỏ cuộc',
          )
        : null,
    ),
    resultBox,
  );
  app.append(h('div', { class: 'jgrid' }, left, right));

  view?.destroy();
  view = new EditorView({
    parent: editorBox,
    state: EditorState.create({
      doc: keep ?? loadCode(p, lang),
      extensions: [
        basicSetup,
        langSlot.of(langExt(lang)),
        theme,
        syntaxHighlighting(highlight),
        EditorState.readOnly.of(!open),
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              void tryRun();
              return true;
            },
          },
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) saveCode();
        }),
      ],
    }),
  });
}

async function boot(): Promise<void> {
  app.replaceChildren(h('div', { class: 'center' }, 'Đang mở Thiên Kiếp Đài…'));
  const r = await api<State>('/judge/api/start', { t });
  if (!r.data.ok) {
    app.replaceChildren(h('div', { class: 'center' }, r.data.error ?? 'Link không còn dùng được.'));
    return;
  }
  state = r.data;
  try {
    const saved = localStorage.getItem('judge:lang') as Lang | null;
    if (saved && state.langs.some((l) => l.id === saved)) lang = saved;
  } catch {
    /* ignore */
  }
  addEventListener('beforeunload', saveCode);
  const remember = () => {
    try {
      localStorage.setItem('judge:lang', lang);
    } catch {
      /* ignore */
    }
  };
  addEventListener('pagehide', remember);
  render(true);
  if (state.status === 'open' && state.deadline && Date.now() > state.deadline)
    void autoSubmitAll();
}

void boot();
