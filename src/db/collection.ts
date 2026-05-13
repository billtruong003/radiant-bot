import { Mutex } from 'async-mutex';
import { logger } from '../utils/logger.js';
import type { AppendOnlyLog } from './append-log.js';

/**
 * Internal interface implemented by every collection so Store can dispatch
 * WAL ops uniformly during replay. Methods are typed as `unknown` because
 * the WAL JSON is untrusted at the boundary; each collection treats it as `T`.
 */
export interface WalApplicable {
  readonly name: string;
  _applySet(key: string, value: unknown): void;
  _applyDelete(key: string): void;
  _applyIncr(key: string, field: string, delta: number): void;
  _applyAppend(value: unknown): void;
}

export class Collection<T extends Record<string, unknown>> implements WalApplicable {
  private readonly data = new Map<string, T>();
  private readonly mutex = new Mutex();

  constructor(
    public readonly name: string,
    private readonly log: AppendOnlyLog,
    private readonly getKey: (item: T) => string,
  ) {}

  async set(item: T): Promise<void> {
    const key = this.getKey(item);
    return this.mutex.runExclusive(async () => {
      this.data.set(key, item);
      await this.log.append({
        op: 'SET',
        coll: this.name,
        key,
        value: item,
        ts: Date.now(),
      });
    });
  }

  async delete(key: string): Promise<boolean> {
    return this.mutex.runExclusive(async () => {
      const existed = this.data.delete(key);
      if (existed) {
        await this.log.append({ op: 'DEL', coll: this.name, key, ts: Date.now() });
      }
      return existed;
    });
  }

  /**
   * Atomic increment of a numeric field. Returns the updated entity, or null
   * if the key doesn't exist. Throws if the field is not a number.
   */
  async incr(key: string, field: keyof T & string, delta: number): Promise<T | null> {
    return this.mutex.runExclusive(async () => {
      const item = this.data.get(key);
      if (!item) return null;
      const current = item[field];
      if (typeof current !== 'number') {
        throw new TypeError(
          `[${this.name}] cannot incr non-number field "${field}" (got ${typeof current})`,
        );
      }
      const next = { ...item, [field]: current + delta } as T;
      this.data.set(key, next);
      await this.log.append({
        op: 'INCR',
        coll: this.name,
        key,
        field,
        delta,
        ts: Date.now(),
      });
      return next;
    });
  }

  get(key: string): T | undefined {
    return this.data.get(key);
  }

  has(key: string): boolean {
    return this.data.has(key);
  }

  query(predicate: (item: T) => boolean): T[] {
    const out: T[] = [];
    for (const item of this.data.values()) {
      if (predicate(item)) out.push(item);
    }
    return out;
  }

  all(): T[] {
    return [...this.data.values()];
  }

  count(): number {
    return this.data.size;
  }

  _applySet(key: string, value: unknown): void {
    this.data.set(key, value as T);
  }

  _applyDelete(key: string): void {
    this.data.delete(key);
  }

  _applyIncr(key: string, field: string, delta: number): void {
    const item = this.data.get(key);
    if (!item) {
      logger.warn({ coll: this.name, key, field }, 'wal replay: incr on missing key, skipping');
      return;
    }
    const current = item[field];
    if (typeof current !== 'number') {
      logger.warn(
        { coll: this.name, key, field, type: typeof current },
        'wal replay: incr on non-number field, skipping',
      );
      return;
    }
    this.data.set(key, { ...item, [field]: current + delta } as T);
  }

  _applyAppend(_value: unknown): void {
    logger.warn({ coll: this.name }, 'wal replay: APPEND op on keyed collection, ignoring');
  }

  _bulkLoad(items: readonly T[]): void {
    this.data.clear();
    for (const item of items) {
      this.data.set(this.getKey(item), item);
    }
  }

  _serialize(): T[] {
    return [...this.data.values()];
  }
}
