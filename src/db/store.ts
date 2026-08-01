import { promises as fs } from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger.js';
import { AppendOnlyLog } from './append-log.js';
import { AppendOnlyCollection } from './append-only-collection.js';
import { Collection, type WalApplicable } from './collection.js';
import type { StoreOp } from './operations.js';
import { SingletonCollection } from './singleton-collection.js';
import type {
  AkiCallLog,
  ArenaSession,
  AutomodLog,
  CongPhap,
  DailyQuest,
  DocContribution,
  DocReviewLog,
  RaidState,
  ReactionRolesConfig,
  SectEvent,
  Nhan,
  PhapKhi,
  User,
  UserCongPhap,
  UserNhan,
  UserPhapKhi,
  UserTitle,
  UserWeapon,
  Verification,
  VoiceSession,
  Weapon,
  MemberProfile,
  GuardianStrike,
  XpLog,
  XpSource,
} from './types.js';

const SNAPSHOT_VERSION = 1;
const WAL_FILE = 'wal.jsonl';
const SNAPSHOT_FILE = 'snapshot.json';

/**
 * xp_logs retention — see `pruneVolatileXpLogsNoLock()`.
 *
 * 30 days is deliberately generous: the only consumer that reads xp_log
 * ROWS on a time window is the weekly leaderboard (7 days). The margin is
 * there so adding a monthly view later doesn't silently lose data.
 */
const XP_LOG_RETENTION_DAYS = 30;
const XP_LOG_RETENTION_MS = XP_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * High-volume grind sources whose individual rows carry no lasting meaning
 * once they fall out of the leaderboard window — the XP itself already
 * lives on `users.xp`, these rows are only the audit trail.
 *
 * Everything NOT listed here is kept forever. In particular 'duel_win',
 * 'mieu_sat' and 'tribulation_pass' are existence-counted for lifetime
 * honor titles (modules/titles/index.ts) and must never be pruned.
 */
const VOLATILE_XP_SOURCES: ReadonlySet<XpSource> = new Set<XpSource>([
  'message',
  'voice',
  'voice_working',
  'reaction',
  'pin',
]);

interface SnapshotShape {
  version: number;
  created_at: number;
  users: User[];
  voice_sessions: VoiceSession[];
  verifications: Verification[];
  events: SectEvent[];
  xp_logs: XpLog[];
  automod_logs: AutomodLog[];
  raid_state: RaidState;
  reaction_roles_config?: ReactionRolesConfig;
  aki_logs?: AkiCallLog[];
  // Phase 12 additions — all optional so a snapshot from before the
  // schema bump still loads cleanly (collections start empty).
  cong_phap_catalog?: CongPhap[];
  user_cong_phap?: UserCongPhap[];
  daily_quests?: DailyQuest[];
  // Phase 12 Lát 9 — docs threads pipeline.
  doc_contributions?: DocContribution[];
  doc_review_logs?: DocReviewLog[];
  // Phase 13 Lát A — Radiant Arena bridge.
  weapon_catalog?: Weapon[];
  user_weapons?: UserWeapon[];
  arena_sessions?: ArenaSession[];
  // Phase 14 — danh hiệu honor titles.
  user_titles?: UserTitle[];
  // Phase 15 — inferred member knowledge base.
  member_profiles?: MemberProfile[];
  guardian_strikes?: GuardianStrike[];
  // Phase 14 round 3 — pháp khí + nhẫn (V2 multi-slot equipment).
  phap_khi_catalog?: PhapKhi[];
  user_phap_khi?: UserPhapKhi[];
  nhan_catalog?: Nhan[];
  user_nhan?: UserNhan[];
}

const DEFAULT_RAID_STATE: RaidState = {
  is_active: false,
  activated_at: null,
  last_join_at: null,
  recent_joins: [],
};

const DEFAULT_REACTION_ROLES: ReactionRolesConfig = {
  message_id: null,
  channel_id: null,
  mappings: [],
};

export interface StoreOptions {
  dataDir: string;
  snapshotIntervalMs: number;
  fsync: boolean;
}

/**
 * Custom in-memory + WAL + Snapshot store. Replaces SQL/NoSQL.
 *
 * Lifecycle:
 *   - `init()`  : mkdir, load snapshot.json if present, replay wal.jsonl,
 *                 start snapshot timer.
 *   - writes go through collection APIs which apply to memory + append to WAL.
 *   - `snapshot()` runs periodically (and on shutdown): atomic write tmp →
 *     rename → truncate WAL, all under the WAL writer mutex so concurrent
 *     writes can't lose data between serialize and truncate.
 *   - `shutdown()`: clear timer, final snapshot, done.
 */
export class Store {
  readonly users: Collection<User>;
  readonly voiceSessions: Collection<VoiceSession>;
  readonly verifications: Collection<Verification>;
  readonly events: Collection<SectEvent>;
  readonly xpLogs: AppendOnlyCollection<XpLog>;
  readonly automodLogs: AppendOnlyCollection<AutomodLog>;
  readonly raidState: SingletonCollection<RaidState>;
  readonly reactionRolesConfig: SingletonCollection<ReactionRolesConfig>;
  readonly akiLogs: AppendOnlyCollection<AkiCallLog>;
  // Phase 12 — game mechanics collections (Lát 1 foundation).
  readonly congPhapCatalog: Collection<CongPhap>;
  readonly userCongPhap: Collection<UserCongPhap>;
  readonly dailyQuests: Collection<DailyQuest>;
  // Phase 12 Lát 9 — docs threads pipeline.
  readonly docContributions: Collection<DocContribution>;
  readonly docReviewLogs: AppendOnlyCollection<DocReviewLog>;
  // Phase 13 Lát A — Radiant Arena bridge.
  readonly weaponCatalog: Collection<Weapon>;
  readonly userWeapons: Collection<UserWeapon>;
  readonly arenaSessions: Collection<ArenaSession>;
  // Phase 14 — danh hiệu (honor titles) earned by users.
  readonly userTitles: Collection<UserTitle>;
  // Phase 15 — one inferred profile per member (see MemberProfile docs).
  readonly memberProfiles: Collection<MemberProfile>;
  readonly guardianStrikes: Collection<GuardianStrike>;
  // Phase 14 round 3 — V2 multi-slot equipment catalogs + ownership.
  readonly phapKhiCatalog: Collection<PhapKhi>;
  readonly userPhapKhi: Collection<UserPhapKhi>;
  readonly nhanCatalog: Collection<Nhan>;
  readonly userNhan: Collection<UserNhan>;

  private readonly log: AppendOnlyLog;
  private readonly walPath: string;
  private readonly snapshotPath: string;
  private readonly snapshotIntervalMs: number;
  private snapshotTimer: NodeJS.Timeout | null = null;
  private initialized = false;

  private readonly collectionMap: ReadonlyMap<string, WalApplicable>;

  constructor(private readonly options: StoreOptions) {
    this.walPath = path.join(options.dataDir, WAL_FILE);
    this.snapshotPath = path.join(options.dataDir, SNAPSHOT_FILE);
    this.snapshotIntervalMs = options.snapshotIntervalMs;

    this.log = new AppendOnlyLog(this.walPath, options.fsync);

    this.users = new Collection<User>('users', this.log, (u) => u.discord_id);
    this.voiceSessions = new Collection<VoiceSession>(
      'voice_sessions',
      this.log,
      (v) => v.discord_id,
    );
    this.verifications = new Collection<Verification>(
      'verifications',
      this.log,
      (v) => v.discord_id,
    );
    this.events = new Collection<SectEvent>('events', this.log, (e) => e.id);
    this.xpLogs = new AppendOnlyCollection<XpLog>('xp_logs', this.log);
    this.automodLogs = new AppendOnlyCollection<AutomodLog>('automod_logs', this.log);
    this.raidState = new SingletonCollection<RaidState>('raid_state', this.log, {
      ...DEFAULT_RAID_STATE,
    });
    this.reactionRolesConfig = new SingletonCollection<ReactionRolesConfig>(
      'reaction_roles_config',
      this.log,
      { ...DEFAULT_REACTION_ROLES, mappings: [] },
    );
    this.akiLogs = new AppendOnlyCollection<AkiCallLog>('aki_logs', this.log);

    // Phase 12: catalog keyed by slug (stable id); inventory + quests
    // keyed by entity id (ulid).
    this.congPhapCatalog = new Collection<CongPhap>('cong_phap_catalog', this.log, (c) => c.slug);
    this.userCongPhap = new Collection<UserCongPhap>('user_cong_phap', this.log, (u) => u.id);
    this.dailyQuests = new Collection<DailyQuest>('daily_quests', this.log, (q) => q.id);
    // Phase 12 Lát 9 — docs.
    this.docContributions = new Collection<DocContribution>(
      'doc_contributions',
      this.log,
      (d) => d.id,
    );
    this.docReviewLogs = new AppendOnlyCollection<DocReviewLog>('doc_review_logs', this.log);

    // Phase 13 Lát A — Arena weapon catalog + user inventory + session log.
    this.weaponCatalog = new Collection<Weapon>('weapon_catalog', this.log, (w) => w.slug);
    this.userWeapons = new Collection<UserWeapon>('user_weapons', this.log, (uw) => uw.id);
    this.arenaSessions = new Collection<ArenaSession>(
      'arena_sessions',
      this.log,
      (s) => s.session_id,
    );
    // Phase 14 — earned honor title rows (one per user+title).
    this.userTitles = new Collection<UserTitle>('user_titles', this.log, (t) => t.id);
    // Phase 15 — keyed by discord_id so each run updates in place rather
    // than appending a new row (bounded by member count, not by time).
    this.memberProfiles = new Collection<MemberProfile>(
      'member_profiles',
      this.log,
      (p) => p.discord_id,
    );
    // Guardian strike ledger. Keyed by member for the same reason as
    // memberProfiles: bounded by member count, not by message volume.
    this.guardianStrikes = new Collection<GuardianStrike>(
      'guardian_strikes',
      this.log,
      (g) => g.discord_id,
    );
    // Phase 14 round 3 — pháp khí + nhẫn multi-slot equipment.
    this.phapKhiCatalog = new Collection<PhapKhi>('phap_khi_catalog', this.log, (p) => p.slug);
    this.userPhapKhi = new Collection<UserPhapKhi>('user_phap_khi', this.log, (up) => up.id);
    this.nhanCatalog = new Collection<Nhan>('nhan_catalog', this.log, (n) => n.slug);
    this.userNhan = new Collection<UserNhan>('user_nhan', this.log, (un) => un.id);

    const map = new Map<string, WalApplicable>();
    for (const c of [
      this.users,
      this.voiceSessions,
      this.verifications,
      this.events,
      this.xpLogs,
      this.automodLogs,
      this.raidState,
      this.reactionRolesConfig,
      this.akiLogs,
      this.congPhapCatalog,
      this.userCongPhap,
      this.dailyQuests,
      this.docContributions,
      this.docReviewLogs,
      this.weaponCatalog,
      this.userWeapons,
      this.arenaSessions,
      this.userTitles,
      this.memberProfiles,
      this.phapKhiCatalog,
      this.userPhapKhi,
      this.nhanCatalog,
      this.userNhan,
    ]) {
      map.set(c.name, c);
    }
    this.collectionMap = map;
  }

  async init(): Promise<void> {
    if (this.initialized) throw new Error('Store already initialized');

    await fs.mkdir(this.options.dataDir, { recursive: true });
    await this.log.ensureExists();

    // 1. Load snapshot.
    const snapshot = await this.readSnapshot();
    if (snapshot) {
      this.users._bulkLoad(snapshot.users ?? []);
      this.voiceSessions._bulkLoad(snapshot.voice_sessions ?? []);
      this.verifications._bulkLoad(snapshot.verifications ?? []);
      this.events._bulkLoad(snapshot.events ?? []);
      this.xpLogs._bulkLoad(snapshot.xp_logs ?? []);
      this.automodLogs._bulkLoad(snapshot.automod_logs ?? []);
      if (snapshot.raid_state) {
        this.raidState._bulkLoad(snapshot.raid_state);
      }
      if (snapshot.reaction_roles_config) {
        this.reactionRolesConfig._bulkLoad(snapshot.reaction_roles_config);
      }
      this.akiLogs._bulkLoad(snapshot.aki_logs ?? []);
      // Phase 12 collections — optional in snapshot for back-compat.
      this.congPhapCatalog._bulkLoad(snapshot.cong_phap_catalog ?? []);
      this.userCongPhap._bulkLoad(snapshot.user_cong_phap ?? []);
      this.dailyQuests._bulkLoad(snapshot.daily_quests ?? []);
      this.docContributions._bulkLoad(snapshot.doc_contributions ?? []);
      this.docReviewLogs._bulkLoad(snapshot.doc_review_logs ?? []);
      this.weaponCatalog._bulkLoad(snapshot.weapon_catalog ?? []);
      this.userWeapons._bulkLoad(snapshot.user_weapons ?? []);
      this.arenaSessions._bulkLoad(snapshot.arena_sessions ?? []);
      this.userTitles._bulkLoad(snapshot.user_titles ?? []);
      this.memberProfiles._bulkLoad(snapshot.member_profiles ?? []);
      this.guardianStrikes._bulkLoad(snapshot.guardian_strikes ?? []);
      this.phapKhiCatalog._bulkLoad(snapshot.phap_khi_catalog ?? []);
      this.userPhapKhi._bulkLoad(snapshot.user_phap_khi ?? []);
      this.nhanCatalog._bulkLoad(snapshot.nhan_catalog ?? []);
      this.userNhan._bulkLoad(snapshot.user_nhan ?? []);
      logger.info(
        {
          version: snapshot.version,
          users: this.users.count(),
          xp_logs: this.xpLogs.count(),
          created_at: snapshot.created_at,
        },
        'store: snapshot loaded',
      );
    } else {
      logger.info({ data_dir: this.options.dataDir }, 'store: no snapshot, fresh start');
    }

    // 2. Replay WAL on top.
    //
    // Ops at or before the snapshot's timestamp are ALREADY baked into the
    // snapshot we just loaded — replaying them would double-apply.
    // snapshot() renames the new file and only then truncates the WAL; a
    // crash in that window leaves both, and without this guard the next
    // boot would duplicate every APPEND row and double-count every INCR
    // (i.e. hand out XP twice). SET/DEL are naturally idempotent, but
    // APPEND and INCR are not.
    const snapshotAt = snapshot?.created_at ?? 0;
    let replayCount = 0;
    let replaySkipped = 0;
    let replayPreSnapshot = 0;
    for await (const op of this.log.replay()) {
      if (snapshotAt > 0 && typeof op.ts === 'number' && op.ts <= snapshotAt) {
        replayPreSnapshot++;
        continue;
      }
      const applied = this.applyOp(op);
      if (applied) replayCount++;
      else replaySkipped++;
    }
    if (replayCount > 0 || replaySkipped > 0 || replayPreSnapshot > 0) {
      logger.info(
        { applied: replayCount, skipped: replaySkipped, pre_snapshot: replayPreSnapshot },
        'store: wal replay complete',
      );
    }

    // 3. Start periodic snapshot.
    this.snapshotTimer = setInterval(() => {
      this.snapshot().catch((err) => {
        logger.error({ err }, 'store: scheduled snapshot failed');
      });
    }, this.snapshotIntervalMs);
    // Don't keep event loop alive just for the timer.
    this.snapshotTimer.unref();

    this.initialized = true;
  }

  private async readSnapshot(): Promise<SnapshotShape | null> {
    try {
      const raw = await fs.readFile(this.snapshotPath, 'utf-8');
      if (!raw.trim()) return null;
      const parsed = JSON.parse(raw) as SnapshotShape;
      if (parsed.version !== SNAPSHOT_VERSION) {
        logger.warn(
          { found: parsed.version, expected: SNAPSHOT_VERSION },
          'store: snapshot version mismatch, treating as empty',
        );
        return null;
      }
      return parsed;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return null;
      // Corrupt snapshot: log loudly, treat as empty. WAL replay will recover
      // whatever it can.
      logger.error(
        { err, path: this.snapshotPath },
        'store: snapshot read failed, ignoring (will rebuild from WAL)',
      );
      return null;
    }
  }

  private applyOp(op: StoreOp): boolean {
    const coll = this.collectionMap.get(op.coll);
    if (!coll) {
      logger.warn({ coll: op.coll, op: op.op }, 'wal replay: unknown collection, skipping');
      return false;
    }
    switch (op.op) {
      case 'SET':
        coll._applySet(op.key, op.value);
        return true;
      case 'DEL':
        coll._applyDelete(op.key);
        return true;
      case 'INCR':
        coll._applyIncr(op.key, op.field, op.delta);
        return true;
      case 'APPEND':
        coll._applyAppend(op.value);
        return true;
      default: {
        // Exhaustiveness guard.
        const _exhaustive: never = op;
        logger.warn({ op: _exhaustive }, 'wal replay: unknown op');
        return false;
      }
    }
  }

  /**
   * Drops grind-XP rows older than XP_LOG_RETENTION_MS.
   *
   * Why this exists: `xp_logs` was append-only forever. Measured 2026-07-28
   * on prod — 140,559 rows for 63 users (96.6% of them voice ticks), 29.2MB
   * of a 29.3MB snapshot, ~47MB of retained heap, growing ~1,859 rows/day
   * with no upper bound. `AppendOnlyCollection.compact()` was written for
   * this back in Phase 1 but never wired up to a caller.
   *
   * Why selective and not `compact(keepLast)`: tail-truncation would delete
   * the OLDEST rows, and `modules/titles/index.ts` counts lifetime
   * 'duel_win' / 'mieu_sat' / 'tribulation_pass' rows by existence — those
   * are exactly the old, rare rows. Cutting the tail silently revokes
   * titles members already earned. So only VOLATILE_XP_SOURCES get pruned;
   * every rare/event/marker source is kept forever.
   *
   * Safe against the only recency consumer: `topByXpInRange` is called with
   * days=7 (weekly leaderboard, queries/leaderboard.ts:58), well inside the
   * 30-day floor.
   *
   * Caller must already hold the WAL writer mutex — hence NoLock.
   */
  private pruneVolatileXpLogsNoLock(): void {
    const cutoff = Date.now() - XP_LOG_RETENTION_MS;
    const dropped = this.xpLogs.pruneWhere(
      (log) =>
        VOLATILE_XP_SOURCES.has(log.source as XpSource) &&
        typeof log.created_at === 'number' &&
        log.created_at < cutoff,
    );
    if (dropped > 0) {
      logger.info(
        { dropped, remaining: this.xpLogs.count(), retention_days: XP_LOG_RETENTION_DAYS },
        'store: pruned volatile xp_logs',
      );
    }
  }

  /**
   * Atomic snapshot: serialize → write tmp → rename → truncate WAL.
   * The entire sequence runs under the WAL writer mutex so concurrent
   * writes can't slip an op in between the snapshot and the truncate.
   */
  async snapshot(): Promise<void> {
    if (!this.initialized) throw new Error('Store not initialized');

    await this.log.runExclusive(async () => {
      // Retention pass BEFORE serializing — runs inside the WAL writer
      // mutex, and the WAL is truncated at the end of this same block, so
      // memory and disk stay consistent (a pruned row can only come back
      // if we crash between rename and truncate, and it gets pruned again
      // on the next snapshot).
      this.pruneVolatileXpLogsNoLock();

      const data: SnapshotShape = {
        version: SNAPSHOT_VERSION,
        created_at: Date.now(),
        users: this.users._serialize(),
        voice_sessions: this.voiceSessions._serialize(),
        verifications: this.verifications._serialize(),
        events: this.events._serialize(),
        xp_logs: this.xpLogs._serialize(),
        automod_logs: this.automodLogs._serialize(),
        raid_state: this.raidState._serialize(),
        reaction_roles_config: this.reactionRolesConfig._serialize(),
        aki_logs: this.akiLogs._serialize(),
        cong_phap_catalog: this.congPhapCatalog._serialize(),
        user_cong_phap: this.userCongPhap._serialize(),
        daily_quests: this.dailyQuests._serialize(),
        doc_contributions: this.docContributions._serialize(),
        doc_review_logs: this.docReviewLogs._serialize(),
        weapon_catalog: this.weaponCatalog._serialize(),
        user_weapons: this.userWeapons._serialize(),
        arena_sessions: this.arenaSessions._serialize(),
        user_titles: this.userTitles._serialize(),
        member_profiles: this.memberProfiles._serialize(),
        guardian_strikes: this.guardianStrikes._serialize(),
        phap_khi_catalog: this.phapKhiCatalog._serialize(),
        user_phap_khi: this.userPhapKhi._serialize(),
        nhan_catalog: this.nhanCatalog._serialize(),
        user_nhan: this.userNhan._serialize(),
      };

      const tmpPath = `${this.snapshotPath}.tmp`;

      // Stream the write, one top-level key at a time, instead of
      // building the whole document as a single string.
      //
      // `JSON.stringify(data)` materialised the ENTIRE snapshot as one V8
      // string, and `fs.writeFile` then encoded that string into a second
      // full-size Buffer. Measured on the live 30MB snapshot: steady state
      // ~47MB heap → 164MB after stringify → 221MB heap / 320MB RSS during
      // the write. That hourly spike — not the steady-state usage — is what
      // pushed the process toward `max_memory_restart: 500M`. (The
      // stringify step alone cost +58MB rather than +30MB because emoji in
      // channel names force V8 to back the string with 2-byte chars.)
      //
      // Streaming keeps peak extra memory at roughly the largest single
      // collection instead of the whole store.
      const handle = await fs.open(tmpPath, 'w');
      let bytes = 0;
      try {
        const write = async (chunk: string): Promise<void> => {
          bytes += Buffer.byteLength(chunk);
          await handle.write(chunk);
        };
        await write(`{"version":${SNAPSHOT_VERSION},"created_at":${data.created_at}`);
        for (const [key, value] of Object.entries(data)) {
          if (key === 'version' || key === 'created_at') continue;
          await write(`,${JSON.stringify(key)}:${JSON.stringify(value)}`);
        }
        await write('}');
      } finally {
        await handle.close();
      }

      // POSIX rename is atomic; Windows rename is atomic on same volume in
      // Node >= 14 (uses MoveFileEx with replace).
      await fs.rename(tmpPath, this.snapshotPath);
      await this.log._truncateNoLock();

      logger.debug(
        {
          users: data.users.length,
          xp_logs: data.xp_logs.length,
          bytes,
        },
        'store: snapshot written',
      );
    });
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) return;
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    await this.snapshot();
    this.initialized = false;
    logger.info('store: shutdown complete');
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getWalPath(): string {
    return this.walPath;
  }

  getSnapshotPath(): string {
    return this.snapshotPath;
  }
}
