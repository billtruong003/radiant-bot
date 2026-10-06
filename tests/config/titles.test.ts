import { describe, expect, it } from 'vitest';
import { TITLES } from '../../src/config/titles.js';

describe('honor titles', () => {
  it('use real emoji, which Discord requires in select menu options', () => {
    // A symbol such as ✦ is not an emoji, and one bad option makes Discord reject the whole menu.
    for (const title of TITLES) expect(title.emoji, title.id).toMatch(/^\p{Extended_Pictographic}️?$/u);
  });
});
