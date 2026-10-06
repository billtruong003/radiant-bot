import { describe, expect, it } from 'vitest';
import { TRIBULATION_TIERS } from '../../src/config/leveling.js';
import { loadPhongKiepQuestions } from '../../src/config/phong-kiep.js';
import { judge, pickQuestions, runPhongKiep } from '../../src/modules/events/phong-kiep.js';
import { playedGame, tierForRank } from '../../src/modules/events/tribulation.js';

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

describe('phong kiep question bank', () => {
  it('loads, every question links a docs lesson and has 4 distinct options', () => {
    const bank = loadPhongKiepQuestions();
    expect(bank.length).toBeGreaterThanOrEqual(40);
    for (const q of bank) {
      expect(q.docs.startsWith('/docs/')).toBe(true);
      expect(new Set(q.options).size).toBe(4);
    }
    expect(bank.some((q) => q.kind === 'english')).toBe(true);
    for (const lang of ['python', 'csharp', 'javascript'])
      expect(bank.some((q) => q.lang === lang)).toBe(true);
  });

  it('picks one English question plus code questions, and tracks the shuffled answer', () => {
    for (let s = 1; s < 40; s++) {
      const asked = pickQuestions(3, seeded(s));
      expect(asked).toHaveLength(3);
      expect(asked.filter((a) => a.question.kind === 'english')).toHaveLength(1);
      expect(new Set(asked.map((a) => a.question.id)).size).toBe(3);
      for (const a of asked)
        expect(a.options[a.correct]).toBe(a.question.options[a.question.answer]);
    }
  });
});

describe('phong kiep judging', () => {
  const asked = pickQuestions(3, seeded(7));
  const right = asked.map((a) => a.correct);
  const wrong = asked.map((a) => (a.correct + 1) % 4);

  it('passes on two right answers, even when the run stops early', () => {
    expect(judge([right[0] ?? 0, right[1] ?? 0], asked.slice(0, 2))).toBe('pass');
    expect(judge([wrong[0] ?? 0, right[1] ?? 0, right[2] ?? 0], asked)).toBe('pass');
  });

  it('fails on two wrong answers, times out when nothing was answered', () => {
    expect(judge([wrong[0] ?? 0, wrong[1] ?? 0], asked.slice(0, 2))).toBe('fail');
    expect(judge([right[0] ?? 0, null, null], asked)).toBe('fail');
    expect(judge([null, null], asked.slice(0, 2))).toBe('timeout');
  });
});

describe('tribulation tiers', () => {
  it('routes realms to their tier', () => {
    expect(tierForRank('truc_co')).toBe('loi');
    expect(tierForRank('kim_dan')).toBe('loi');
    expect(tierForRank('nguyen_anh')).toBe('phong');
    expect(tierForRank('hoa_than')).toBe('phong');
    expect(tierForRank('luyen_hu')).toBe('tam_ma');
    expect(tierForRank('do_kiep')).toBe('cuu_thien');
    expect(playedGame('loi')).toBe('loi');
    expect(playedGame('tam_ma')).toBe('quiz');
  });

  it('pays more for each higher tier', () => {
    const order = ['loi', 'phong', 'tam_ma', 'cuu_thien'] as const;
    for (let i = 1; i < order.length; i++) {
      const lo = TRIBULATION_TIERS[order[i - 1] as (typeof order)[number]];
      const hi = TRIBULATION_TIERS[order[i] as (typeof order)[number]];
      expect(hi.passXp).toBeGreaterThan(lo.passXp);
      expect(hi.passPills).toBeGreaterThan(lo.passPills);
    }
  });
});

describe('phong kiep run', () => {
  /** A channel whose messages answer each question with `pick(question index, correct)`. */
  function fakeChannel(pick: (qi: number, correct: number) => number | null) {
    const asked = pickQuestions(3, seeded(11));
    const posts: { components: unknown[] }[] = [];
    const edits: unknown[] = [];
    let qi = 0;
    const channel = {
      send: async (msg: { components: unknown[] }) => {
        posts.push(msg);
        const my = qi++;
        return {
          awaitMessageComponent: async () => {
            const choice = pick(my, asked[my]?.correct ?? 0);
            if (choice === null) throw new Error('time');
            return { customId: `pk:e1:${my}:${choice}`, deferUpdate: async () => undefined };
          },
          edit: async (e: unknown) => {
            edits.push(e);
          },
        };
      },
    };
    const member = { id: 'm1', displayName: 'Tester', toString: () => '<@m1>' };
    return { asked, posts, edits, channel, member };
  }

  it('passes after two right answers and stops asking', async () => {
    const f = fakeChannel((_qi, correct) => correct);
    const run = await runPhongKiep(
      f.member as never,
      f.channel as never,
      'e1',
      'Phong Kiếp',
      f.asked,
    );
    expect(run.outcome).toBe('pass');
    expect(f.posts).toHaveLength(2);
    expect(f.edits).toHaveLength(2);
  }, 30_000);

  it('fails after two wrong answers', async () => {
    const f = fakeChannel((_qi, correct) => (correct + 1) % 4);
    const run = await runPhongKiep(
      f.member as never,
      f.channel as never,
      'e1',
      'Phong Kiếp',
      f.asked,
    );
    expect(run.outcome).toBe('fail');
    expect(run.correct).toBe(0);
  }, 30_000);

  it('asks the third question when the first two split', async () => {
    const f = fakeChannel((qi, correct) => (qi === 0 ? (correct + 1) % 4 : correct));
    const run = await runPhongKiep(
      f.member as never,
      f.channel as never,
      'e1',
      'Phong Kiếp',
      f.asked,
    );
    expect(f.posts).toHaveLength(3);
    expect(run.outcome).toBe('pass');
  }, 30_000);

  it('times out when nothing is answered', async () => {
    const f = fakeChannel(() => null);
    const run = await runPhongKiep(
      f.member as never,
      f.channel as never,
      'e1',
      'Phong Kiếp',
      f.asked,
    );
    expect(run.outcome).toBe('timeout');
  }, 30_000);
});
