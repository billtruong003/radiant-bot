import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureFont, measure, newCanvas } from '../../src/modules/pixel/canvas.js';
import {
  congPhapIcon,
  drawIcon,
  nhanIcon,
  phapKhiIcon,
  weaponIcon,
} from '../../src/modules/pixel/icons.js';
import { renderGif, renderPng } from '../../src/modules/pixel/output.js';

const cfg = (f: string) =>
  JSON.parse(readFileSync(path.join('src', 'config', f), 'utf8')).items as Record<string, string>[];
const iconFile = (name: string, dir: string) =>
  path.join('assets', 'cultivation', dir, `${name}.png`);

describe('item icons', () => {
  it('every catalog item has an icon at 32 and 64 px', () => {
    const names = [
      ...cfg('weapon-catalog.json').map((w) => weaponIcon(w as never)),
      ...cfg('phap-khi-catalog.json').map((p) => phapKhiIcon(p as never)),
      ...cfg('nhan-catalog.json').map((n) => nhanIcon(n as never)),
      ...cfg('cong-phap-catalog.json').map((c) => congPhapIcon(c as never)),
    ];
    const missing = names.filter(
      (n) => !existsSync(iconFile(n, 'icons')) || !existsSync(iconFile(n, 'icons32')),
    );
    expect(missing).toEqual([]);
  });

  it('refuses to draw pixel art at a non-whole scale', async () => {
    const { ctx } = newCanvas(100, 100);
    await expect(drawIcon(ctx, 'jian_sword__forged_iron', 0, 0, 32)).resolves.toBeUndefined();
    await expect(drawIcon(ctx, 'coin', 0, 0, 64)).resolves.toBeUndefined();
  });
});

describe('pixel font', () => {
  beforeAll(() => ensureFont());

  it('has every Vietnamese letter', () => {
    const vn = 'Đột phá thành công · Lôi Kiếp Chân Nhân · Huyết tộc ỹ Ữ';
    const unknown = measure(null, '?', 24);
    for (const ch of vn.replace(/\s/g, ''))
      if (ch !== '?') expect([ch, measure(null, ch, 24) > 0]).toEqual([ch, true]);
    expect(unknown).toBeGreaterThan(0);
  });
});

describe('output', () => {
  it('renders a PNG and a looping GIF', async () => {
    const png = await renderPng(40, 20, (ctx) => ctx.fillRect(0, 0, 10, 10), 'a');
    expect(png.buffer.subarray(1, 4).toString()).toBe('PNG');
    expect(png.name).toBe('a.png');
    const gif = await renderGif(40, 20, (ctx, t) => ctx.fillRect(t * 30, 0, 10, 10), 'b', {
      frames: 4,
    });
    expect(gif.buffer.subarray(0, 6).toString()).toBe('GIF89a');
    expect(gif.animated).toBe(true);
  });
});

describe('render queue', () => {
  it('runs GIFs one at a time and drains', async () => {
    const { renderGif, renderQueueDepth } = await import('../../src/modules/pixel/output.js');
    const order: string[] = [];
    const job = (name: string) =>
      renderGif(
        8,
        8,
        () => {
          order.push(name);
        },
        name,
        { frames: 2 },
      );
    const all = Promise.all([job('a'), job('b')]);
    expect(renderQueueDepth()).toBe(2);
    await all;
    expect(order).toEqual(['a', 'a', 'b', 'b']);
    expect(renderQueueDepth()).toBe(0);
  });
});
