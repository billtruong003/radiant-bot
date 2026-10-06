/**
 * HTML shell for the bot's web pages (tạo hình, Thiên Kiếp Đài, bí cảnh).
 * Same tokens as the Discord cards: dark ink, VT323 everywhere, hard edges.
 */

export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function page(o: { title: string; body: string; script?: string; data?: unknown }): string {
  const data =
    o.data === undefined
      ? ''
      : `<script id="boot" type="application/json">${escapeHtml(JSON.stringify(o.data))}</script>`;
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(o.title)} · Radiant Tech Sect</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=VT323&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
${o.body}
${data}
${o.script ? `<script src="/app/${o.script}.js" defer></script>` : ''}
</body>
</html>`;
}

const CSS = `
:root{--bg:#15131c;--deep:#0e0c13;--panel:#201c2b;--line:#3a3348;--ink:#efe6cf;--bright:#f6e7c8;--muted:#a89f8a;--faint:#6e6780;--gold:#d4a94a;--green:#6fbf73;--red:#e8806e;--blue:#5fa8e8;--purple:#b48ef0}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--ink);font-family:VT323,monospace;font-size:21px;line-height:1.15}
a{color:var(--gold)}a:hover{color:#f0c860}
button{font-family:VT323,monospace;font-size:22px;cursor:pointer;min-height:44px}
button:focus-visible,a:focus-visible{outline:3px solid var(--bright);outline-offset:2px}
button:disabled{cursor:not-allowed}
.wrap{max-width:1180px;margin:0 auto;padding:20px 20px 40px;display:flex;flex-direction:column;gap:18px}
.head{display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:flex-end;border-bottom:4px solid #2e2939;padding-bottom:12px}
.kicker{font-size:20px;color:var(--muted);letter-spacing:1px}
.h1{font-size:44px;line-height:42px;color:var(--bright);text-shadow:1px 0 0 currentColor}
.panel{background:var(--panel);border:2px solid var(--line);padding:12px 14px}
.muted{color:var(--muted)}.faint{color:var(--faint)}
.btn{background:var(--panel);color:var(--ink);border:3px solid var(--line);padding:0 16px}
.btn.primary{background:var(--gold);color:var(--bg);border-color:#f0c860}
.btn.green{background:var(--green);color:var(--bg);border-color:#c8f0c0}
.px{image-rendering:pixelated}
.notice{border:2px solid var(--line);padding:10px 12px}
.notice.ok{border-color:var(--green);background:#1d2a22}
.notice.err{border-color:var(--red);background:#2a1a1c}
.center{min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}
`;

/** Small full-page message (expired link, errors). */
export function messagePage(title: string, body: string, status = 'Radiant Tech Sect'): string {
  return page({
    title,
    body: `<main class="center"><div class="panel" style="max-width:520px;display:flex;flex-direction:column;gap:12px;align-items:center">
<span class="kicker">${escapeHtml(status)}</span><div class="h1" style="font-size:38px">${escapeHtml(title)}</div>
<p class="muted" style="margin:0">${body}</p></div></main>`,
  });
}
