import { describe, expect, it } from 'vitest';
import {
  type ConversationTurn,
  scoreTurn,
  selectRelevantTurns,
} from '../../src/modules/aki/conversation.js';

/**
 * Relevance selection. The property that matters: a message the user
 * explicitly pointed at must outrank newer, unrelated chatter — the old
 * last-N window got this backwards by construction.
 */

const NOW = 1_700_000_000_000;
const min = (n: number): number => NOW - n * 60_000;

const turn = (over: Partial<ConversationTurn> & { messageId: string }): ConversationTurn => ({
  authorId: 'other',
  authorName: 'Ai đó',
  role: 'user',
  content: 'nội dung',
  timestamp: min(1),
  ...over,
});

describe('scoreTurn', () => {
  const ctx = {
    turns: [],
    askerId: 'asker-1',
    botId: 'bot-1',
    question: 'unity urp hdrp vr',
    now: NOW,
  };

  it('ranks the directly replied-to message above newer unrelated chatter', () => {
    const replied = turn({ messageId: 'R', content: 'chuyện cũ', timestamp: min(30) });
    const newer = turn({ messageId: 'N', content: 'ăn gì trưa nay', timestamp: min(0) });
    const withReply = { ...ctx, repliedToId: 'R' };
    expect(scoreTurn(replied, withReply)).toBeGreaterThan(scoreTurn(newer, withReply));
  });

  it('ranks Aki’s own prior reply above a stranger’s message of equal age', () => {
    const aki = turn({ messageId: 'A', role: 'assistant', authorName: 'Aki (bạn)' });
    const stranger = turn({ messageId: 'S' });
    expect(scoreTurn(aki, ctx)).toBeGreaterThan(scoreTurn(stranger, ctx));
  });

  it('ranks the asker’s own message above an unrelated third party', () => {
    const mine = turn({ messageId: 'M', authorId: 'asker-1' });
    const theirs = turn({ messageId: 'T', authorId: 'someone-else' });
    expect(scoreTurn(mine, ctx)).toBeGreaterThan(scoreTurn(theirs, ctx));
  });

  it('rewards topical overlap with the question', () => {
    const onTopic = turn({ messageId: 'O', content: 'unity urp hdrp khác nhau chỗ nào' });
    const offTopic = turn({ messageId: 'F', content: 'trời hôm nay mưa quá' });
    expect(scoreTurn(onTopic, ctx)).toBeGreaterThan(scoreTurn(offTopic, ctx));
  });
});

describe('selectRelevantTurns', () => {
  it('returns turns in chronological order, not score order', () => {
    const turns = [
      turn({ messageId: '1', timestamp: min(10) }),
      turn({ messageId: '2', timestamp: min(5), authorId: 'asker-1' }),
      turn({ messageId: '3', timestamp: min(1) }),
    ];
    const out = selectRelevantTurns({
      turns,
      askerId: 'asker-1',
      botId: 'bot-1',
      question: 'gì đó',
      now: NOW,
    });
    const times = out.map((t) => t.timestamp);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('keeps the replied-to message even when many newer messages exist', () => {
    const turns = [
      turn({ messageId: 'OLD', content: 'câu quan trọng', timestamp: min(60) }),
      ...Array.from({ length: 25 }, (_, i) =>
        turn({ messageId: `n${i}`, content: `tán gẫu ${i}`, timestamp: min(i) }),
      ),
    ];
    const out = selectRelevantTurns({
      turns,
      askerId: 'asker-1',
      botId: 'bot-1',
      repliedToId: 'OLD',
      question: 'thế nào',
      now: NOW,
    });
    expect(out.map((t) => t.messageId)).toContain('OLD');
  });

  it('caps the number of turns', () => {
    const turns = Array.from({ length: 40 }, (_, i) =>
      turn({ messageId: `m${i}`, content: 'x'.repeat(20), timestamp: min(i) }),
    );
    const out = selectRelevantTurns({
      turns,
      askerId: 'a',
      botId: 'b',
      question: 'q',
      now: NOW,
    });
    expect(out.length).toBeLessThanOrEqual(15);
  });

  it('discards low-value turns whole rather than truncating everything', () => {
    // 40 turns x 300 chars far exceeds the 3000-char budget.
    const turns = Array.from({ length: 40 }, (_, i) =>
      turn({ messageId: `m${i}`, content: 'y'.repeat(300), timestamp: min(i) }),
    );
    const out = selectRelevantTurns({
      turns,
      askerId: 'a',
      botId: 'b',
      question: 'q',
      now: NOW,
    });
    const total = out.reduce((n, t) => n + t.content.length, 0);
    expect(total).toBeLessThanOrEqual(3000);
    // Whatever survived kept its full content.
    for (const t of out) expect(t.content.length).toBe(300);
  });
});
