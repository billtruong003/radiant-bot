import { describe, expect, it } from 'vitest';
import type { DailyQuestType } from '../../src/db/types.js';
import { renderDailyCard } from '../../src/modules/cards/daily-cards.js';
import { questLabel } from '../../src/modules/quests/daily-quest.js';

describe('daily and quest cards', () => {
  it('names every quest type in Vietnamese, never the raw slug', () => {
    const types: DailyQuestType[] = [
      'message_count',
      'voice_minutes',
      'reaction_count',
      'daily_streak_check',
      'duel_win',
      'spend_contribution',
      'upgrade_attempt',
      'equip_both',
      'tribulation_pass',
    ];
    for (const t of types) {
      const label = questLabel({ quest_type: t, target: 7 });
      expect(label).not.toContain('_');
      expect(label).not.toBe('Nhiệm vụ bí ẩn');
    }
    expect(questLabel({ quest_type: 'message_count', target: 25 })).toBe('Gửi 25 tin nhắn');
  });

  it('wraps long streaks onto a new 30-day board', async () => {
    const card = await renderDailyCard({
      name: 'a',
      look: null,
      streak: 61,
      xp: 100,
      bonus: 0,
      pills: 2,
      coins: 5,
      milestones: [{ day: 30, xp: 500, pills: 12 }],
    });
    expect(card.name).toMatch(/^diem-danh\./);
  });
});
