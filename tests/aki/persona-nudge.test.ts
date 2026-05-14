import { describe, expect, it } from 'vitest';
import { buildNudgePrompt } from '../../src/modules/aki/persona-nudge.js';

describe('persona-nudge (graduated profanity reminder builder)', () => {
  it('builds gentle sass prompt', () => {
    const p = buildNudgePrompt({
      severity: 'gentle',
      respectfulTone: false,
      userDisplayName: 'TestUser',
    });
    expect(p.systemPrompt).toContain('GENTLE');
    expect(p.systemPrompt).toContain('SASS');
    expect(p.userPrompt).toContain('TestUser');
  });

  it('builds stern sass prompt', () => {
    const p = buildNudgePrompt({
      severity: 'stern',
      respectfulTone: false,
      userDisplayName: 'TestUser',
    });
    expect(p.systemPrompt).toContain('STERN');
    expect(p.systemPrompt).toContain('SASS');
  });

  it('builds respectful gentle prompt (staff offender)', () => {
    const p = buildNudgePrompt({
      severity: 'gentle',
      respectfulTone: true,
      userDisplayName: 'TôngChủBill',
    });
    expect(p.systemPrompt).toContain('GENTLE');
    expect(p.systemPrompt).toContain('RESPECTFUL');
    expect(p.systemPrompt).toContain('Tông Chủ');
    expect(p.userPrompt).toContain('TôngChủBill');
  });

  it('staff stern prompt swaps tone but keeps stern severity', () => {
    const p = buildNudgePrompt({
      severity: 'stern',
      respectfulTone: true,
      userDisplayName: 'TrưởngLão',
    });
    expect(p.systemPrompt).toContain('STERN');
    expect(p.systemPrompt).toContain('RESPECTFUL');
    expect(p.systemPrompt).not.toContain('SASS');
  });

  it('locks output format rules in system prompt', () => {
    const p = buildNudgePrompt({
      severity: 'gentle',
      respectfulTone: false,
      userDisplayName: 'X',
    });
    // Important guards from spec
    expect(p.systemPrompt.toLowerCase()).toContain('không json');
    expect(p.systemPrompt).toContain('icon ASCII');
    expect(p.systemPrompt).toContain('tự kiểm duyệt');
  });
});
