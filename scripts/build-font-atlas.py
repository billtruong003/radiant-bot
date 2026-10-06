"""Builds bitmap atlases of VT323 for the pixel cards.

node-canvas cannot load font files on every platform (it fails on Windows),
and pixel text should never be smoothed anyway. So each size we use is
rasterised here once, without anti-aliasing, into assets/fonts/atlas/vt<size>.png
plus a JSON map of glyph positions. Re-run after adding characters or sizes:

    python scripts/build-font-atlas.py
"""
import json
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = os.path.join(ROOT, 'assets', 'fonts', 'VT323-Regular.ttf')
OUT = os.path.join(ROOT, 'assets', 'fonts', 'atlas')

SIZES = [14, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 28, 30, 32, 34, 36, 40, 44, 48, 52, 56, 60, 64, 72, 84]
VN = 'àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ'
CHARS = ''.join(chr(c) for c in range(32, 127)) + VN + VN.upper() + 'Đ·→←↑↓×−…✓✗•–—“”‘’°%₫'


# VT323 has no arrows or check marks: draw them on the font's pixel grid.
MISSING = {
    '→': ['.....', '...#.', '#####', '...#.', '.....'],
    '←': ['.....', '.#...', '#####', '.#...', '.....'],
    '↑': ['..#..', '.###.', '#.#.#', '..#..', '..#..'],
    '↓': ['..#..', '..#..', '#.#.#', '.###.', '..#..'],
    '✓': ['.....', '....#', '...#.', '#.#..', '.#...'],
    '✗': ['.....', '#...#', '.#.#.', '..#..', '.#.#.'],
}


def draw_missing(ch: str, font, line: int):
    rows = MISSING[ch]
    u = max(1, round(font.size / 14))
    adv = int(round(font.getlength('M')))
    w = max(adv, len(rows[0]) * u + u)
    cell = Image.new('L', (w, line), 0)
    d = ImageDraw.Draw(cell)
    top = round(font.getbbox('x')[1] + (font.getbbox('x')[3] - font.getbbox('x')[1]) / 2 - len(rows) * u / 2)
    x0 = (w - len(rows[0]) * u) // 2
    for ry, row in enumerate(rows):
        for rx, c in enumerate(row):
            if c == '#':
                d.rectangle([x0 + rx * u, top + ry * u, x0 + rx * u + u - 1, top + ry * u + u - 1], fill=255)
    return cell, w, w


def build(size: int) -> None:
    font = ImageFont.truetype(FONT, size)
    ascent, descent = font.getmetrics()
    line = ascent + descent
    glyphs = {}
    cells = []
    x = 0
    for ch in dict.fromkeys(CHARS):
        if ch in MISSING:
            cell, w, adv = draw_missing(ch, font, line)
            cells.append((ch, cell, x, w, adv, 0))
            x += w + 1
            continue
        adv = int(round(font.getlength(ch)))
        l, _, r, _ = font.getbbox(ch)
        left = min(0, l)
        w = max(adv, r) - left
        if w <= 0:
            w = max(adv, 1)
        cell = Image.new('L', (w, line), 0)
        d = ImageDraw.Draw(cell)
        d.fontmode = '1'
        d.text((-left, 0), ch, font=font, fill=255)
        cells.append((ch, cell, x, w, adv, left))
        x += w + 1
    atlas = Image.new('LA', (x, line), (255, 0))
    for ch, cell, cx, w, adv, left in cells:
        atlas.paste((255, 255), (cx, 0), cell)
        glyphs[ch] = [cx, w, adv, left]
    atlas.save(os.path.join(OUT, f'vt{size}.png'))
    return {'size': size, 'line': line, 'ascent': ascent, 'glyphs': glyphs}


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    meta = {str(s): build(s) for s in SIZES}
    with open(os.path.join(OUT, 'vt.json'), 'w', encoding='utf8') as f:
        json.dump(meta, f, ensure_ascii=False, separators=(',', ':'))
    print('sizes', len(SIZES), 'chars', len(dict.fromkeys(CHARS)))
