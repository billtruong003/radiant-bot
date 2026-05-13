import { Mutex } from 'async-mutex';
import { logger } from '../utils/logger.js';
import type { AppendOnlyLog } from './append-log.js';
import type { WalApplicable } from './collection.js';

const SINGLETON_KEY = '_singleton';

/**
 * Singleton state. Exactly one record. Useful for global state like
 * raid_state. Writes go through WAL as SET op with fixed key `_singleton`.
 */
export class SingletonCollection<T extends Record<string, unknown>> implements WalApplicable {
  private data: T;
  private readonly mutex = new Mutex();

  constructor(
    public readonly name: string,
    private readonly log: AppendOnlyLog,
    initial: T,
  ) {
    this.data = initial;
  }

  get(): T {
    return this.data;
  }

  async set(value: T): Promise<void> {
    return this.mutex.runExclusive(async () => {
      this.data = value;
      await this.log.append({
        op: 'SET',
        coll: this.name,
        key: SINGLETON_KEY,
        value,
        ts: Date.now(),
      });
    });
  }

  async update(patch: Partial<T>): Promise<T> {
    return this.mutex.runExclusive(async () => {
      this.data = { ...this.data, ...patch };
      await this.log.append({
        op: 'SET',
        coll: this.name,
        key: SINGLETON_KEY,
        value: this.data,
        ts: Date.now(),
      });
      return this.data;
    });
  }

  _applySet(_key: string, value: unknown): void {
    this.data = value as T;
  }

  _applyDelete(_key: string): void {
    logger.warn({ coll: this.name }, 'wal replay: DEL op on singleton, ignoring');
  }

  _applyIncr(_key: string, _field: string, _delta: number): void {
    logger.warn({ coll: this.name }, 'wal replay: INCR op on singleton, ignoring');
  }

  _applyAppend(_value: unknown): void {
    logger.warn({ coll: this.name }, 'wal replay: APPEND op on singleton, ignoring');
  }

  _bulkLoad(value: T): void {
    this.data = value;
  }

  _serialize(): T {
    return this.data;
  }
}
