import { promises as fs, createReadStream } from 'node:fs';
import readline from 'node:readline';
import { Mutex } from 'async-mutex';
import { logger } from '../utils/logger.js';
import { type StoreOp, isStoreOp } from './operations.js';

/**
 * Append-only durable log. Single-writer guaranteed by a mutex so concurrent
 * `append()` calls don't interleave bytes on disk. Optional `fsync` for
 * crash-durable writes (production: true, tests/dev: false for speed).
 */
export class AppendOnlyLog {
  private readonly mutex = new Mutex();

  constructor(
    private readonly filePath: string,
    private readonly fsync: boolean,
  ) {}

  async ensureExists(): Promise<void> {
    try {
      await fs.access(this.filePath);
    } catch {
      await fs.writeFile(this.filePath, '');
    }
  }

  async append(op: StoreOp): Promise<void> {
    return this.mutex.runExclusive(async () => {
      const line = `${JSON.stringify(op)}\n`;
      if (this.fsync) {
        const fd = await fs.open(this.filePath, 'a');
        try {
          await fd.write(line);
          await fd.sync();
        } finally {
          await fd.close();
        }
      } else {
        await fs.appendFile(this.filePath, line);
      }
    });
  }

  /**
   * Replays the log line-by-line. Corrupt/invalid JSON or shape-invalid ops
   * are logged at WARN level and skipped — they never crash recovery.
   * A partial write at the tail (e.g. crash mid-line) shows up as a corrupt
   * line and gets skipped, which is the desired behavior.
   */
  async *replay(): AsyncIterable<StoreOp> {
    let exists = true;
    try {
      await fs.access(this.filePath);
    } catch {
      exists = false;
    }
    if (!exists) return;

    const stream = createReadStream(this.filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
    let lineNo = 0;
    for await (const line of rl) {
      lineNo++;
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        logger.warn(
          { file: this.filePath, lineNo, err: (err as Error).message },
          'wal: skipping corrupt json line',
        );
        continue;
      }
      if (!isStoreOp(parsed)) {
        logger.warn({ file: this.filePath, lineNo, parsed }, 'wal: skipping shape-invalid op');
        continue;
      }
      yield parsed;
    }
  }

  async truncate(): Promise<void> {
    return this.mutex.runExclusive(() => this._truncateNoLock());
  }

  /**
   * Truncates without acquiring the mutex. Caller MUST already hold it via
   * `runExclusive`. Used by Store.snapshot to truncate inside the snapshot
   * critical section without deadlocking.
   */
  async _truncateNoLock(): Promise<void> {
    await fs.writeFile(this.filePath, '');
  }

  /**
   * Runs a callback while holding the writer mutex. All `append()` calls
   * across the bot are blocked for the duration. Used by Store.snapshot to
   * make the serialize → write-tmp → rename → truncate sequence atomic with
   * respect to concurrent writes.
   */
  runExclusive<R>(fn: () => Promise<R>): Promise<R> {
    return this.mutex.runExclusive(fn);
  }

  async size(): Promise<number> {
    try {
      const st = await fs.stat(this.filePath);
      return st.size;
    } catch {
      return 0;
    }
  }
}
