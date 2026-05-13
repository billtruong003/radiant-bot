import { promises as fs } from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger.js';
import { AppendOnlyLog } from './append-log.js';
import { AppendOnlyCollection } from './append-only-collection.js';
import { Collection, type WalApplicable } from './collection.js';
import type { StoreOp } from './operations.js';
import { SingletonCollection } from './singleton-collection.js';
import type {
  AutomodLog,
  RaidState,
  ReactionRolesConfig,
  SectEvent,
  User,
  Verification,
  VoiceSession,
  XpLog,
} from './types.js';

const SNAPSHOT_VERSION = 1;
const WAL_FILE = 'wal.jsonl';
const SNAPSHOT_FILE = 'snapshot.json';

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
    let replayCount = 0;
    let replaySkipped = 0;
    for await (const op of this.log.replay()) {
      const applied = this.applyOp(op);
      if (applied) replayCount++;
      else replaySkipped++;
    }
    if (replayCount > 0 || replaySkipped > 0) {
      logger.info({ applied: replayCount, skipped: replaySkipped }, 'store: wal replay complete');
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
   * Atomic snapshot: serialize → write tmp → rename → truncate WAL.
   * The entire sequence runs under the WAL writer mutex so concurrent
   * writes can't slip an op in between the snapshot and the truncate.
   */
  async snapshot(): Promise<void> {
    if (!this.initialized) throw new Error('Store not initialized');

    await this.log.runExclusive(async () => {
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
      };

      const tmpPath = `${this.snapshotPath}.tmp`;
      const payload = JSON.stringify(data);
      await fs.writeFile(tmpPath, payload);
      // POSIX rename is atomic; Windows rename is atomic on same volume in
      // Node >= 14 (uses MoveFileEx with replace).
      await fs.rename(tmpPath, this.snapshotPath);
      await this.log._truncateNoLock();

      logger.debug(
        {
          users: data.users.length,
          xp_logs: data.xp_logs.length,
          bytes: payload.length,
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
