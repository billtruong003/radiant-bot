import { Mutex } from 'async-mutex';
import { logger } from '../utils/logger.js';
import type { AppendOnlyLog } from './append-log.js';
import type { WalApplicable } from './collection.js';

/**
 * Append-only collection for high-volume logs (xp_logs, automod_logs).
 * No get-by-key, no update, no delete — only push and query.
 */
export class AppendOnlyCollection<T extends Record<string, unknown>> implements WalApplicable {
  private items: T[] = [];
  private readonly mutex = new Mutex();

  constructor(
    public readonly name: string,
    private readonly log: AppendOnlyLog,
  ) {}

  async append(item: T): Promise<void> {
    return this.mutex.runExclusive(async () => {
      this.items.push(item);
      await this.log.append({
        op: 'APPEND',
        coll: this.name,
        value: item,
        ts: Date.now(),
      });
    });
  }

  query(predicate: (item: T) => boolean): T[] {
    const out: T[] = [];
    for (const item of this.items) {
      if (predicate(item)) out.push(item);
    }
    return out;
  }

  recent(n: number): T[] {
    return this.items.slice(-n);
  }

  count(): number {
    return this.items.length;
  }

  /**
   * Drops items older than `keepLast` from the in-memory tail.
   * Note: WAL still contains all ops until next snapshot truncates.
   */
  compact(keepLast: number): void {
    if (this.items.length > keepLast) {
      this.items = this.items.slice(-keepLast);
    }
  }

  _applySet(_key: string, _value: unknown): void {
    logger.warn({ coll: this.name }, 'wal replay: SET op on append-only collection, ignoring');
  }

  _applyDelete(_key: string): void {
    logger.warn({ coll: this.name }, 'wal replay: DEL op on append-only collection, ignoring');
  }

  _applyIncr(_key: string, _field: string, _delta: number): void {
    logger.warn({ coll: this.name }, 'wal replay: INCR op on append-only collection, ignoring');
  }

  _applyAppend(value: unknown): void {
    this.items.push(value as T);
  }

  _bulkLoad(items: readonly T[]): void {
    this.items = [...items];
  }

  _serialize(): T[] {
    return [...this.items];
  }
}
