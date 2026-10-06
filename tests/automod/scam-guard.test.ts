import { describe, expect, it } from 'vitest';
import {
  BURST_WINDOW_MS,
  BurstTracker,
  type ScamSignal,
  isBurst,
  judgeMessage,
} from '../../src/modules/automod/scam-guard.js';

const msg = (over: Partial<ScamSignal>): ScamSignal => ({
  content: '',
  attachments: 0,
  embeds: 0,
  pingsEveryone: false,
  ...over,
});

describe('scam guard: one message', () => {
  it('catches the MrBeast raid: @everyone with images', () => {
    expect(judgeMessage(msg({ content: '@everyone', attachments: 4 })).scam).toBe(true);
    expect(judgeMessage(msg({ content: 'hi', pingsEveryone: true, embeds: 1 })).scam).toBe(true);
  });

  it('catches scam words with a link, an image or a mass ping', () => {
    expect(
      judgeMessage(msg({ content: 'MrBeast is giving free money https://bit.ly/x' })).scam,
    ).toBe(true);
    expect(judgeMessage(msg({ content: 'Free Nitro for everyone', attachments: 1 })).scam).toBe(
      true,
    );
    expect(judgeMessage(msg({ content: 'nhận tiền miễn phí @here' })).scam).toBe(true);
  });

  it('leaves ordinary talk alone', () => {
    expect(judgeMessage(msg({ content: 'xem video MrBeast mới chưa' })).scam).toBe(false);
    expect(judgeMessage(msg({ content: 'repo của mình https://github.com/x/y' })).scam).toBe(false);
    expect(judgeMessage(msg({ content: 'ảnh game mới nè', attachments: 2 })).scam).toBe(false);
    expect(judgeMessage(msg({ content: '@everyone họp lúc 9h tối nay' })).scam).toBe(false);
  });
});

describe('scam guard: bursts across channels', () => {
  it('counts distinct channels inside the window only', () => {
    const t = new BurstTracker();
    t.record('u', { channelId: 'a', messageId: '1', at: 0 });
    t.record('u', { channelId: 'a', messageId: '2', at: 1000 });
    const recent = t.record('u', { channelId: 'b', messageId: '3', at: 2000 });
    expect(t.channelsIn(recent)).toBe(2);
    const later = t.record('u', { channelId: 'c', messageId: '4', at: BURST_WINDOW_MS + 5000 });
    expect(t.channelsIn(later)).toBe(1);
  });

  it('needs more channels for plain text than for images, links or pings', () => {
    expect(isBurst(4, msg({ attachments: 4 }))).toBe(true);
    expect(isBurst(4, msg({ content: 'chào cả nhà' }))).toBe(false);
    expect(isBurst(6, msg({ content: 'chào cả nhà' }))).toBe(true);
    expect(isBurst(3, msg({ content: '@everyone', attachments: 4 }))).toBe(false);
  });
});
