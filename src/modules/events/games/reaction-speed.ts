/**
 * Reaction-speed game for tribulation events. Bot posts 5 emoji
 * buttons; one is the **dragon** (🐉). Player must click the dragon
 * within the timeout window (5s default, set by the orchestrator).
 *
 * The decoy emojis are all "animal/beast" themed to fit the
 * "Thiên kiếp" (heavenly tribulation) cultivation vibe without
 * being obviously trivial.
 */

const TARGET_EMOJI = '🐉';

const DECOY_POOL: readonly string[] = ['🐺', '🦊', '🦅', '🐅', '🦁', '🦌', '🐍', '🦇', '🦂'];

export interface ReactionGame {
  target: string;
  /** 5 unique emojis in random order; exactly one is `target`. */
  options: readonly string[];
}

function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i] as T;
    a[i] = a[j] as T;
    a[j] = tmp;
  }
  return a;
}

export function generateReactionGame(): ReactionGame {
  const decoys = shuffle(DECOY_POOL).slice(0, 4);
  return { target: TARGET_EMOJI, options: shuffle([TARGET_EMOJI, ...decoys]) };
}

export const TARGET = TARGET_EMOJI;
