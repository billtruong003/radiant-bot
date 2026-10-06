import { api, countdown, h, token } from './dom';

/** Tạo hình tu sĩ: pick layers, preview live, save back to the bot. */

interface Option {
  label: string;
  swatch: string;
  locked: boolean;
  need: string | null;
}
interface Layer {
  key: string;
  label: string;
  options: Option[];
}
interface State {
  ok: boolean;
  name: string;
  rankName: string;
  expiresAt: number;
  look: Record<string, number>;
  hasLook: boolean;
  layers: Layer[];
}

const SCALE = 6;
const TW = 32 * SCALE;
const TH = 48 * SCALE;
// Sheet sizes in tiles: [columns, rows]. Order of layers = paint order.
const SHEETS: [string, number, number, (l: Record<string, number>) => [number, number] | null][] = [
  ['back', 3, 1, (l) => ((l.back ?? 0) >= 3 ? null : [l.back ?? 0, 0])],
  ['skin', 8, 1, (l) => [l.skin ?? 0, 0]],
  ['eyes', 6, 1, (l) => [l.eyes ?? 0, 0]],
  ['shoes', 2, 1, () => [0, 0]],
  ['robe', 5, 3, (l) => [l.robe_color ?? 0, l.robe_style ?? 0]],
  ['hair', 13, 5, (l) => [l.hair_style ?? 0, l.hair_color ?? 0]],
];

const LOCK =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="7" width="10" height="7"></rect><path d="M5 7V5a3 3 0 0 1 6 0v2"></path></svg>';

async function main(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;
  const { status, data } = await api<State>(`/avatar/api/state?t=${encodeURIComponent(token())}`);
  if (status !== 200 || !data.ok) {
    location.reload();
    return;
  }
  const look = { ...data.look };
  let dirty = false;

  const preview = h('div', {
    role: 'img',
    style: `position:relative;width:${TW}px;height:${TH}px;margin-bottom:44px`,
    class: 'bob',
  });
  const summary = h('div', { class: 'muted', style: 'text-align:center' });
  const notice = h('div', { class: 'notice', style: 'display:none' });
  const timer = h('span', {});
  const saveBtn = h(
    'button',
    { class: 'btn primary', style: 'flex:2 1 0', type: 'button' },
    'Lưu tạo hình',
  ) as HTMLButtonElement;
  const groups = h('div', {
    style: 'flex:999 1 560px;min-width:0;display:flex;flex-direction:column;gap:16px',
  });

  const say = (kind: 'ok' | 'err', msg: string) => {
    notice.className = `notice ${kind}`;
    notice.textContent = msg;
    notice.style.display = '';
  };

  const describe = () => {
    const name = (key: string) =>
      data.layers.find((l) => l.key === key)?.options[look[key] ?? 0]?.label ?? '';
    const parts = [
      `${name('hair_style')} ${name('hair_color').toLowerCase()}`,
      `${name('robe_style')} ${name('robe_color').toLowerCase()}`,
    ];
    if ((look.back ?? 0) < 3) parts.push(name('back').toLowerCase());
    return `${name('skin')} · ${parts.join(' · ')}`;
  };

  const drawPreview = () => {
    preview.replaceChildren(
      ...SHEETS.flatMap(([file, cols, rows, pos]) => {
        const at = pos(look);
        if (!at) return [];
        return [
          h('div', {
            class: 'px',
            style: `position:absolute;inset:0;background:url(/cult/sprites/${file}.png) no-repeat;image-rendering:pixelated;background-size:${cols * TW}px ${rows * TH}px;background-position:${-at[0] * TW}px ${-at[1] * TH}px`,
          }),
        ];
      }),
    );
    preview.setAttribute('aria-label', describe());
    summary.textContent = describe();
  };

  const drawGroups = () => {
    groups.replaceChildren(
      ...data.layers.map((layer) =>
        h(
          'div',
          { style: 'display:flex;flex-direction:column;gap:8px' },
          h('span', { class: 'kicker' }, layer.label.toUpperCase()),
          h(
            'div',
            { style: 'display:flex;flex-wrap:wrap;gap:8px' },
            ...layer.options.map((o, i) => {
              const on = look[layer.key] === i;
              const b = h(
                'button',
                {
                  type: 'button',
                  'aria-pressed': on ? 'true' : 'false',
                  disabled: o.locked,
                  title: o.locked && o.need ? `Mở ở ${o.need}` : undefined,
                  style: `display:flex;align-items:center;gap:8px;padding:4px 12px 4px 6px;background:${on ? '#2e2939' : '#201c2b'};color:${o.locked ? '#6e6780' : '#efe6cf'};border:3px solid ${on ? '#d4a94a' : '#3a3348'}`,
                  onclick: () => {
                    look[layer.key] = i;
                    dirty = true;
                    notice.style.display = 'none';
                    drawPreview();
                    drawGroups();
                  },
                },
                h('span', {
                  style: `width:24px;height:24px;flex-shrink:0;background:${o.swatch};border:2px solid #0e0c13`,
                }),
              );
              if (o.locked) b.insertAdjacentHTML('beforeend', LOCK);
              b.append(o.locked && o.need ? `${o.label} · ${o.need}` : o.label);
              return b;
            }),
          ),
        ),
      ),
    );
  };

  const randomize = () => {
    for (const layer of data.layers) {
      const open = layer.options.map((o, i) => ({ o, i })).filter(({ o }) => !o.locked);
      look[layer.key] = open[Math.floor(Math.random() * open.length)]?.i ?? 0;
    }
    dirty = true;
    drawPreview();
    drawGroups();
  };

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    const r = await api<{ ok: boolean; error?: string; summary?: string }>('/avatar/api/save', {
      t: token(),
      look,
    });
    saveBtn.disabled = false;
    if (r.data.ok) {
      dirty = false;
      say(
        'ok',
        'Đã lưu. Tin nhắn của bot trong Discord đã đổi sang hình mới. Vẫn sửa tiếp được tới khi link hết hạn.',
      );
    } else say('err', r.data.error ?? 'Lưu không được, thử lại sau.');
  });

  window.addEventListener('beforeunload', (e) => {
    if (dirty) e.preventDefault();
  });

  app.replaceChildren(
    h(
      'div',
      { class: 'head' },
      h(
        'div',
        { style: 'display:flex;flex-direction:column' },
        h('span', { class: 'kicker' }, 'RADIANT TECH SECT'),
        h('span', { class: 'h1' }, 'Tạo hình tu sĩ'),
      ),
      h(
        'div',
        { style: 'display:flex;flex-direction:column;align-items:flex-end' },
        h('span', {}, 'Đang tạo cho: ', h('span', { style: 'color:var(--gold)' }, data.name)),
        h('span', { class: 'muted' }, `Cảnh giới ${data.rankName} · món có ổ khóa mở khi đột phá`),
        h('span', { class: 'muted' }, 'Link riêng còn ', timer),
      ),
    ),
    h(
      'div',
      { style: 'display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start' },
      h(
        'div',
        { style: 'flex:1 1 320px;min-width:0;display:flex;flex-direction:column;gap:12px' },
        h(
          'div',
          {
            style:
              'position:relative;background:#201c2b;border:4px solid #d4a94a;box-shadow:inset 0 0 0 4px #15131c,inset 0 0 0 6px #5a4a2a;height:380px;display:flex;align-items:flex-end;justify-content:center;overflow:hidden',
          },
          h('div', {
            style:
              'position:absolute;left:0;right:0;bottom:0;height:56px;background:#2a2536;border-top:4px solid #3a3348',
          }),
          preview,
        ),
        summary,
        h(
          'div',
          { style: 'display:flex;gap:10px' },
          h(
            'button',
            { class: 'btn', style: 'flex:1 1 0', type: 'button', onclick: randomize },
            'Ngẫu nhiên',
          ),
          saveBtn,
        ),
        notice,
      ),
      groups,
    ),
  );
  const style = document.createElement('style');
  style.textContent =
    '@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}.bob{animation:bob 1.4s steps(2,jump-none) infinite}';
  document.head.append(style);
  countdown(timer, data.expiresAt, () => {
    saveBtn.disabled = true;
    say('err', 'Link đã hết hạn. Gõ /profile avatar trong Discord để lấy link mới.');
  });
  drawPreview();
  drawGroups();
  if (!data.hasLook) say('ok', 'Bạn chưa có tạo hình. Chọn đồ bên phải rồi bấm Lưu.');
}

void main();
