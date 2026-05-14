import { describe, expect, it } from 'vitest';
import {
  canonicalChannelName,
  isNoXpChannel,
  isWorkingVoiceChannel,
} from '../../src/config/channels.js';

/**
 * Phase 11 A5: channels now carry decorative icons on both sides
 * (`🔒-verify-🔒`). These helpers normalise the display name to the
 * canonical slug so callers can match against `general`, `verify` etc
 * regardless of icon decoration.
 */

describe('canonicalChannelName', () => {
  it('strips emoji-on-both-sides text channel format', () => {
    expect(canonicalChannelName('💬-general-💬')).toBe('general');
    expect(canonicalChannelName('🔒-verify-🔒')).toBe('verify');
    expect(canonicalChannelName('📋-bot-log-📋')).toBe('bot-log');
    expect(canonicalChannelName('📜-rules-📜')).toBe('rules');
  });

  it('strips emoji with spaces for voice channels', () => {
    expect(canonicalChannelName('🎮 Gaming 🎮')).toBe('gaming');
    expect(canonicalChannelName('🎯 Focus Room 🎯')).toBe('focus-room');
    expect(canonicalChannelName('📚 Quiet Study 📚')).toBe('quiet-study');
    expect(canonicalChannelName('🏛️ Main Hall 🏛️')).toBe('main-hall');
  });

  it('preserves channel numbers', () => {
    expect(canonicalChannelName('🎮 Gaming 2 🎮')).toBe('gaming-2');
  });

  it('is idempotent on already-canonical names', () => {
    expect(canonicalChannelName('general')).toBe('general');
    expect(canonicalChannelName('bot-log')).toBe('bot-log');
    expect(canonicalChannelName('verify')).toBe('verify');
  });

  it('handles empty / whitespace-only input', () => {
    expect(canonicalChannelName('')).toBe('');
    expect(canonicalChannelName('   ')).toBe('');
    expect(canonicalChannelName('---')).toBe('');
  });

  it('lowercases', () => {
    expect(canonicalChannelName('General')).toBe('general');
    expect(canonicalChannelName('🎮 GAMING 🎮')).toBe('gaming');
  });

  it('collapses repeated separators', () => {
    expect(canonicalChannelName('a---b__c')).toBe('a-b-c');
    expect(canonicalChannelName('  many   spaces  ')).toBe('many-spaces');
  });
});

describe('isNoXpChannel', () => {
  it('returns true for canonical no-xp channel names with icons', () => {
    expect(isNoXpChannel('💻-bot-commands-💻')).toBe(true);
    expect(isNoXpChannel('🔧-bot-dev-🔧')).toBe(true);
    expect(isNoXpChannel('📋-bot-log-📋')).toBe(true);
    expect(isNoXpChannel('🔒-verify-🔒')).toBe(true);
  });

  it('returns false for XP-eligible channels', () => {
    expect(isNoXpChannel('💬-general-💬')).toBe(false);
    expect(isNoXpChannel('🎨-art-🎨')).toBe(false);
    expect(isNoXpChannel('🎵-music-🎵')).toBe(false);
  });

  it('works with canonical (icon-free) input too', () => {
    expect(isNoXpChannel('bot-commands')).toBe(true);
    expect(isNoXpChannel('general')).toBe(false);
  });
});

describe('isWorkingVoiceChannel', () => {
  it('returns true for Working voice channels with icons', () => {
    expect(isWorkingVoiceChannel('🎯 Focus Room 🎯')).toBe(true);
    expect(isWorkingVoiceChannel('📚 Quiet Study 📚')).toBe(true);
  });

  it('returns false for non-Working voice channels', () => {
    expect(isWorkingVoiceChannel('🎮 Gaming 🎮')).toBe(false);
    expect(isWorkingVoiceChannel('🏛️ Main Hall 🏛️')).toBe(false);
  });
});
