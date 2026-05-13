import type { TextChannel } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VerificationConfig } from '../../src/config/verification.js';
import { __setStoreForTesting, getStore } from '../../src/db/index.js';
import { Store } from '../../src/db/store.js';
import type { AuditResult } from '../../src/modules/verification/audit.js';
import {
  cleanupExpiredVerifications,
  handleDmReply,
  startVerification,
} from '../../src/modules/verification/flow.js';
import { mkTmpDir } from '../helpers/tmp-dir.js';
import { makeMockGuild, makeMockMember } from './__mocks__/member.js';

/**
 * End-to-end test of the verification flow with Discord mocked out.
 * Covers the orchestration logic that the pure-function tests in
 * flow.test.ts don't reach: role grants, kicks, persistence, cleanup,
 * fallback button path.
 */

const NEVER = 99_999_999;

const CONFIG: VerificationConfig = {
  thresholds: {
    accountAgeKickDays: 1,
    accountAgeSuspectDays: 7,
    captchaTimeoutMs: 300_000,
    captchaMaxAttempts: 3,
    raidJoinWindowMs: 60_000,
    raidJoinThreshold: 10,
  },
  botUsernamePatterns: [],
  captcha: {
    mathMinA: 1,
    mathMaxA: 5,
    mathMinB: 1,
    mathMaxB: 5,
    imageChars: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
    imageLength: 6,
  },
};

const KICK_AUDIT: AuditResult = { decision: 'kick', reasons: ['too young'], isSuspect: true };
const CLEAN_AUDIT: AuditResult = { decision: 'clean', reasons: [], isSuspect: false };
const SUSPECT_AUDIT: AuditResult = {
  decision: 'suspect',
  reasons: ['no avatar'],
  isSuspect: true,
};

describe('flow integration (mocked Discord)', () => {
  let store: Store;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await mkTmpDir('flow-int');
    cleanup = tmp.cleanup;
    store = new Store({ dataDir: tmp.dir, snapshotIntervalMs: NEVER, fsync: false });
    await store.init();
    __setStoreForTesting(store);
  });

  afterEach(async () => {
    __setStoreForTesting(null);
    await store.shutdown();
    await cleanup();
  });

  describe('startVerification', () => {
    it('audit kick decision → kicks immediately, no Verification record', async () => {
      const { member, spies } = makeMockMember({ id: 'kid' });
      const r = await startVerification(member, KICK_AUDIT, CONFIG);

      expect(r.status).toBe('kicked-by-audit');
      expect(r.dmDelivered).toBe(false);
      expect(spies.kick).toHaveBeenCalledTimes(1);
      expect(spies.dmSend).not.toHaveBeenCalled();
      expect(getStore().verifications.get('kid')).toBeUndefined();
      // Mod log row written.
      expect(getStore().automodLogs.count()).toBe(1);
    });

    it('clean audit → math challenge persisted + DM sent', async () => {
      const { member, spies } = makeMockMember({ id: 'm-clean' });
      const r = await startVerification(member, CLEAN_AUDIT, CONFIG);

      expect(r.status).toBe('pending');
      expect(r.dmDelivered).toBe(true);
      expect(spies.dmSend).toHaveBeenCalledTimes(1);
      const v = getStore().verifications.get('m-clean');
      expect(v?.status).toBe('pending');
      expect(v?.challenge_type).toBe('math');
      expect(v?.challenge_data.expected).toMatch(/^\d+$/);
    });

    it('suspect audit → image+math challenge + DM with image attachment', async () => {
      const { member, spies } = makeMockMember({ id: 'm-susp' });
      await startVerification(member, SUSPECT_AUDIT, CONFIG);

      expect(spies.dmSend).toHaveBeenCalledTimes(1);
      const dmArg = spies.dmSend.mock.calls[0]?.[0] as { content: string; files?: unknown[] };
      expect(dmArg.files).toBeDefined();
      expect(dmArg.files).toHaveLength(1);
      const v = getStore().verifications.get('m-susp');
      expect(v?.challenge_type).toBe('image+math');
    });

    it('clean audit + forceHard → image+math (raid override)', async () => {
      const { member, spies } = makeMockMember({ id: 'm-raid' });
      await startVerification(member, CLEAN_AUDIT, CONFIG, { forceHard: true });
      const dmArg = spies.dmSend.mock.calls[0]?.[0] as { files?: unknown[] };
      expect(dmArg.files).toHaveLength(1);
      expect(getStore().verifications.get('m-raid')?.challenge_type).toBe('image+math');
    });

    it('bot user → no-op (never DMd, never persisted)', async () => {
      const { member, spies } = makeMockMember({ id: 'bot-1', isBot: true });
      const r = await startVerification(member, CLEAN_AUDIT, CONFIG);
      expect(r.dmDelivered).toBe(false);
      expect(spies.dmSend).not.toHaveBeenCalled();
      expect(getStore().verifications.get('bot-1')).toBeUndefined();
    });

    it('DM fails → fallback button posted in #verify', async () => {
      const verifyCh = { send: vi.fn().mockResolvedValue(undefined) };
      const { member, spies } = makeMockMember({
        id: 'm-dm-blocked',
        dmFails: true,
        channelMap: { verify: verifyCh as unknown as TextChannel },
      });
      const r = await startVerification(member, CLEAN_AUDIT, CONFIG);

      expect(r.dmDelivered).toBe(false);
      expect(spies.dmSend).toHaveBeenCalled(); // attempted
      expect(verifyCh.send).toHaveBeenCalledTimes(1);
      const post = verifyCh.send.mock.calls[0]?.[0];
      expect(post.components).toBeDefined();
      expect(post.content).toMatch(/Bấm nút dưới/);
      // Record still persisted so reply can be matched later.
      expect(getStore().verifications.get('m-dm-blocked')?.status).toBe('pending');
    });
  });

  describe('handleDmReply', () => {
    it('correct math answer → roles granted, status=passed, user upserted', async () => {
      const { member, spies } = makeMockMember({
        id: 'm-pass',
        roleIds: ['role-chua-xac-minh'],
        fetchSelf: true,
      });
      await startVerification(member, CLEAN_AUDIT, CONFIG);
      const expected = getStore().verifications.get('m-pass')?.challenge_data.expected as string;

      const r = await handleDmReply(member.guild, 'm-pass', expected, CONFIG);

      expect(r.outcome).toBe('pass');
      expect(spies.rolesAdd).toHaveBeenCalledTimes(1); // Phàm Nhân
      expect(spies.rolesRemove).toHaveBeenCalledTimes(1); // Chưa Xác Minh
      expect(getStore().verifications.get('m-pass')?.status).toBe('passed');
      const user = getStore().users.get('m-pass');
      expect(user?.cultivation_rank).toBe('pham_nhan');
      expect(user?.verified_at).not.toBeNull();
    });

    it('wrong answer (attempts remaining) → fail-retry, attempts incremented', async () => {
      const { member } = makeMockMember({ id: 'm-fail1', fetchSelf: true });
      await startVerification(member, CLEAN_AUDIT, CONFIG);

      const r = await handleDmReply(member.guild, 'm-fail1', 'wrong-answer', CONFIG);
      expect(r.outcome).toBe('fail-retry');
      expect(r.attemptsLeft).toBe(2); // max=3, used 1
      expect(getStore().verifications.get('m-fail1')?.attempts).toBe(1);
      expect(getStore().verifications.get('m-fail1')?.status).toBe('pending');
    });

    it('wrong answer 3 times → fail-kick on last, status=failed', async () => {
      const { member, spies } = makeMockMember({ id: 'm-3strike', fetchSelf: true });
      await startVerification(member, CLEAN_AUDIT, CONFIG);

      const r1 = await handleDmReply(member.guild, 'm-3strike', 'nope', CONFIG);
      const r2 = await handleDmReply(member.guild, 'm-3strike', 'still-nope', CONFIG);
      const r3 = await handleDmReply(member.guild, 'm-3strike', 'final-nope', CONFIG);

      expect(r1.outcome).toBe('fail-retry');
      expect(r2.outcome).toBe('fail-retry');
      expect(r3.outcome).toBe('fail-kick');
      expect(spies.kick).toHaveBeenCalledTimes(1);
      expect(getStore().verifications.get('m-3strike')?.status).toBe('failed');
      expect(getStore().verifications.get('m-3strike')?.attempts).toBe(3);
    });

    it('no pending verification → outcome=no-pending (DM ignored)', async () => {
      const { member } = makeMockMember({ id: 'random' });
      const r = await handleDmReply(member.guild, 'random', 'anything', CONFIG);
      expect(r.outcome).toBe('no-pending');
    });

    it('image+math: correct combined reply passes', async () => {
      const { member } = makeMockMember({
        id: 'm-hard-pass',
        roleIds: ['role-chua-xac-minh'],
        fetchSelf: true,
      });
      await startVerification(member, SUSPECT_AUDIT, CONFIG);
      const v = getStore().verifications.get('m-hard-pass');
      const reply = `${v?.challenge_data.image_text} ${v?.challenge_data.math_answer}`;

      const r = await handleDmReply(member.guild, 'm-hard-pass', reply, CONFIG);
      expect(r.outcome).toBe('pass');
      expect(getStore().verifications.get('m-hard-pass')?.status).toBe('passed');
    });
  });

  describe('cleanupExpiredVerifications', () => {
    it('past timeout → kicks + marks status=timeout', async () => {
      const { member: m1, spies: spy1 } = makeMockMember({ id: 't1' });
      await startVerification(m1, CLEAN_AUDIT, CONFIG);

      // Rewind started_at far enough to make it stale.
      const v = getStore().verifications.get('t1');
      if (!v) throw new Error('expected verification record');
      await getStore().verifications.set({
        ...v,
        started_at: Date.now() - CONFIG.thresholds.captchaTimeoutMs - 1000,
      });

      const guild = makeMockGuild({ t1: { member: m1, spies: spy1 } });
      const r = await cleanupExpiredVerifications(guild, CONFIG);

      expect(r.expired).toBe(1);
      expect(r.kicked).toBe(1);
      expect(spy1.kick).toHaveBeenCalledTimes(1);
      expect(getStore().verifications.get('t1')?.status).toBe('timeout');
    });

    it('within timeout → no-op', async () => {
      const { member, spies } = makeMockMember({ id: 'fresh' });
      await startVerification(member, CLEAN_AUDIT, CONFIG);

      const guild = makeMockGuild({ fresh: { member, spies } });
      const r = await cleanupExpiredVerifications(guild, CONFIG);
      expect(r.expired).toBe(0);
      expect(r.kicked).toBe(0);
      expect(spies.kick).not.toHaveBeenCalled();
      expect(getStore().verifications.get('fresh')?.status).toBe('pending');
    });

    it('member already left guild → mark timeout, no kick attempt', async () => {
      const { member } = makeMockMember({ id: 'left' });
      await startVerification(member, CLEAN_AUDIT, CONFIG);
      const v = getStore().verifications.get('left');
      if (!v) throw new Error('expected verification');
      await getStore().verifications.set({
        ...v,
        started_at: Date.now() - CONFIG.thresholds.captchaTimeoutMs - 1000,
      });

      // Empty guild — fetch rejects.
      const guild = makeMockGuild({});
      const r = await cleanupExpiredVerifications(guild, CONFIG);
      expect(r.expired).toBe(1);
      expect(r.kicked).toBe(0); // member not in guild
      expect(getStore().verifications.get('left')?.status).toBe('timeout');
    });
  });

  describe('persistence across simulated restart', () => {
    it('pending Verification record survives store reload', async () => {
      const { member } = makeMockMember({ id: 'persist' });
      await startVerification(member, CLEAN_AUDIT, CONFIG);
      const v1 = getStore().verifications.get('persist');
      expect(v1?.status).toBe('pending');

      // Simulate restart by force-snapshot + re-init from same dir.
      await store.snapshot();
      const dir = store.getSnapshotPath().replace(/[/\\]snapshot\.json$/, '');
      await store.shutdown();
      __setStoreForTesting(null);

      const reloaded = new Store({ dataDir: dir, snapshotIntervalMs: NEVER, fsync: false });
      await reloaded.init();
      __setStoreForTesting(reloaded);

      const v2 = reloaded.verifications.get('persist');
      expect(v2?.status).toBe('pending');
      expect(v2?.challenge_data.expected).toBe(v1?.challenge_data.expected);

      store = reloaded; // afterEach shuts this one down
    });
  });
});
