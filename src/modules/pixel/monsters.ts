import { type Ctx, asset } from './canvas.js';

/**
 * Yêu thú. Two kinds of art:
 *  - strip sheets from the monster packs (assets/cultivation/monsters), drawn
 *    frame by frame;
 *  - five small monsters drawn for this server as pixel grids.
 * Every drawer takes the bottom-centre point so monsters stand on the same
 * ground line as the cultivators.
 */

export interface Strip {
  file: string;
  frames: number;
  fw: number;
  fh: number;
  /** Rows of empty space under the feet inside a frame. */
  footPad: number;
  /** Packs that face right are flipped so enemies face the player. */
  facesRight?: boolean;
}

export const STRIPS: Record<string, Strip> = {
  wolf_gray_idle: { file: 'wolf_gray_idle', frames: 4, fw: 48, fh: 32, footPad: 0 },
  wolf_black_idle: { file: 'wolf_black_idle', frames: 4, fw: 48, fh: 32, footPad: 0 },
  wolf_white_idle: { file: 'wolf_white_idle', frames: 4, fw: 48, fh: 32, footPad: 0 },
  wolf_brown_idle: { file: 'wolf_brown_idle', frames: 4, fw: 48, fh: 32, footPad: 0 },
  wolf_gray_attack: { file: 'wolf_gray_attack', frames: 7, fw: 48, fh: 32, footPad: 0 },
  wolf_gray_death: { file: 'wolf_gray_death', frames: 8, fw: 48, fh: 32, footPad: 0 },
  wolf_gray_run: { file: 'wolf_gray_run', frames: 6, fw: 48, fh: 32, footPad: 0 },
  bat_idle: { file: 'bat_idle', frames: 9, fw: 64, fh: 64, footPad: 24 },
  bat_attack: { file: 'bat_attack', frames: 8, fw: 64, fh: 64, footPad: 24 },
  bat_die: { file: 'bat_die', frames: 12, fw: 64, fh: 64, footPad: 14 },
  knight_idle: { file: 'knight_idle', frames: 15, fw: 64, fh: 37, footPad: 2, facesRight: true },
  knight_attack: {
    file: 'knight_attack',
    frames: 22,
    fw: 144,
    fh: 37,
    footPad: 2,
    facesRight: true,
  },
  knight_death: { file: 'knight_death', frames: 15, fw: 96, fh: 37, footPad: 2, facesRight: true },
  paladin_idle: { file: 'paladin_idle', frames: 27, fw: 128, fh: 66, footPad: 2, facesRight: true },
  paladin_attack: {
    file: 'paladin_attack',
    frames: 41,
    fw: 128,
    fh: 66,
    footPad: 2,
    facesRight: true,
  },
  paladin_death: {
    file: 'paladin_death',
    frames: 65,
    fw: 128,
    fh: 66,
    footPad: 2,
    facesRight: true,
  },
};

/** Draws frame `i` (wraps) of a strip with its feet at (cx, groundY). */
export async function drawStrip(
  ctx: Ctx,
  key: string,
  i: number,
  cx: number,
  groundY: number,
  scale: number,
  o: { flip?: boolean; alpha?: number } = {},
): Promise<{ x: number; y: number; w: number; h: number }> {
  const s = STRIPS[key];
  if (!s) throw new Error(`unknown monster strip ${key}`);
  const img = await asset(`cultivation/monsters/${s.file}.png`);
  const f = ((i % s.frames) + s.frames) % s.frames;
  const w = s.fw * scale;
  const h = s.fh * scale;
  const x = Math.round(cx - w / 2);
  const y = Math.round(groundY - h + s.footPad * scale);
  const flip = (o.flip ?? false) !== (s.facesRight ?? false);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
  if (flip) {
    ctx.translate(x + w, y);
    ctx.scale(-1, 1);
    ctx.drawImage(img, f * s.fw, 0, s.fw, s.fh, 0, 0, w, h);
  } else ctx.drawImage(img, f * s.fw, 0, s.fw, s.fh, x, y, w, h);
  ctx.restore();
  return { x, y, w, h };
}

/** Five monsters drawn as pixel grids: char → colour, '.' empty. */
export const GRID_MONSTERS: Record<
  string,
  { name: string; rows: string[]; colors: Record<string, string> }
> = {
  ho_yeu: {
    name: 'Hồ Yêu',
    rows: [
      '.a............a.',
      '.aa..........aa.',
      '.aba........aba.',
      '.abba......abba.',
      '.abbbaaaaaabbba.',
      '..abbbbbbbbbba..',
      '..abcdbbbbdcba..',
      '..abbbbbbbbbba..',
      '...abbbeebbba...',
      '....aabbbbaa....',
      '...abbffffbba.aa',
      '..abbbffffbbbaba',
      '..abbbffffbbbba.',
      '...aaa.aa.aaa...',
    ],
    colors: { a: '#3a1a10', b: '#e8806e', c: '#fff6c8', d: '#15131c', e: '#3a1a10', f: '#f6e7c8' },
  },
  linh_dich: {
    name: 'Linh Dịch',
    rows: [
      '.....aaaa.....',
      '...aabbbbaa...',
      '..abbbbbbbba..',
      '.abbcbbbbcbba.',
      '.abbdbbbbdbba.',
      'abbbbbbbbbbbba',
      'abbbbbeebbbbba',
      'abfbbbbbbbbfba',
      '.aaaaaaaaaaaa.',
    ],
    colors: { a: '#1f4a2a', b: '#6fbf73', c: '#ffffff', d: '#15131c', e: '#1f4a2a', f: '#a8e0a0' },
  },
  doc_xa: {
    name: 'Độc Xà',
    rows: [
      '......aaaa......',
      '.....abbbba.....',
      '....abcbbcba....',
      '....abbbbbba....',
      '.....abbbba.d...',
      '......abba.d....',
      '.....abba.......',
      '....abba........',
      '...abbaaaaa.....',
      '..abbbbbbbba....',
      '..abbaaaaabba...',
      '...aa.....aba...',
      '..........aba...',
      '.....aaaaabba...',
      '....abbbbbba....',
      '.....aaaaaa.....',
    ],
    colors: { a: '#1a2a14', b: '#8fbf3a', c: '#f0d060', d: '#e8806e' },
  },
  thach_quy: {
    name: 'Thạch Quỷ',
    rows: [
      '...aaaaaaaa...',
      '..abbbbbbbba..',
      '..abcbbbbcba..',
      '..abbbbbbbba..',
      '...abbddbba...',
      'aaaabbbbbbaaaa',
      'abbbbbebbbbbba',
      'abbabbbbbbabba',
      'abbabbbbbbabba',
      'aaa.abbbba.aaa',
      '....abbbba....',
      '...abb..bba...',
      '...aaa..aaa...',
    ],
    colors: { a: '#2a2536', b: '#6e6780', c: '#7fd0d8', d: '#15131c', e: '#7fd0d8' },
  },
  nguu_ma: {
    name: 'Huyết Ma Ngưu',
    rows: [
      'h..................h',
      'hh................hh',
      '.hh..............hh.',
      '..hh...aaaaaa...hh..',
      '...hhaabbbbbbaahh...',
      '.....abbbbbbbba.....',
      '....abbcbbbbcbba....',
      '....abbbbbbbbbba....',
      '....abbbbddbbbba....',
      '.....abbdeedbba.....',
      '...aaabbbbbbbbaaa...',
      '..abbbbbbbbbbbbbba..',
      '.abbbbbbbbbbbbbbbba.',
      '.abbaabbbbbbbbaabba.',
      '.abba.abbbbbba.abba.',
      '.aaa..abba.abba.aaa.',
      '......abba.abba.....',
      '......aaa...aaa.....',
    ],
    colors: { a: '#2a0a0a', b: '#9c2a35', c: '#f0d060', d: '#6a1a20', e: '#15131c', h: '#e9e4d6' },
  },
};

export function gridSize(key: string, scale: number): { w: number; h: number } {
  const m = GRID_MONSTERS[key];
  if (!m) return { w: 0, h: 0 };
  return { w: Math.max(...m.rows.map((r) => r.length)) * scale, h: m.rows.length * scale };
}

export function drawGridMonster(
  ctx: Ctx,
  key: string,
  cx: number,
  groundY: number,
  scale: number,
  o: { flip?: boolean; alpha?: number; bob?: number } = {},
): void {
  const m = GRID_MONSTERS[key];
  if (!m) throw new Error(`unknown monster ${key}`);
  const { w, h } = gridSize(key, scale);
  const x0 = Math.round(cx - w / 2);
  const y0 = Math.round(groundY - h - (o.bob ?? 0));
  const width = w / scale;
  ctx.save();
  if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
  m.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = m.colors[row[x] ?? '.'];
      if (!c) continue;
      const px = o.flip ? width - 1 - x : x;
      ctx.fillStyle = c;
      ctx.fillRect(x0 + px * scale, y0 + y * scale, scale, scale);
    }
  });
  ctx.restore();
}
