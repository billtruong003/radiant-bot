/** Tiny DOM helpers shared by the web pages (no framework, no build step besides esbuild). */

type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;

export function h(
  tag: string,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, '').toLowerCase(), v);
    else if (k === 'style') el.setAttribute('style', String(v));
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function token(): string {
  return new URLSearchParams(location.search).get('t') ?? '';
}

export async function api<T>(path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(
    path,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, data };
}

export function countdown(el: HTMLElement, until: number, onEnd?: () => void): void {
  const tick = () => {
    const left = Math.max(0, until - Date.now());
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    el.textContent = `${m}:${String(s).padStart(2, '0')}`;
    if (left <= 0) {
      onEnd?.();
      return;
    }
    setTimeout(tick, 1000);
  };
  tick();
}
