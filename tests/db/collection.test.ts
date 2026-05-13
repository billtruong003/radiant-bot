import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppendOnlyLog } from '../../src/db/append-log.js';
import { Collection } from '../../src/db/collection.js';
import type { StoreOp } from '../../src/db/operations.js';
import { mkTmpDir } from '../helpers/tmp-dir.js';

interface Counter extends Record<string, unknown> {
  id: string;
  count: number;
  label: string;
}

describe('Collection<T>', () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let log: AppendOnlyLog;
  let coll: Collection<Counter>;

  beforeEach(async () => {
    ({ dir, cleanup } = await mkTmpDir('coll'));
    log = new AppendOnlyLog(path.join(dir, 'wal.jsonl'), false);
    await log.ensureExists();
    coll = new Collection<Counter>('counters', log, (c) => c.id);
  });

  afterEach(async () => {
    await cleanup();
  });

  async function readWal(): Promise<StoreOp[]> {
    const ops: StoreOp[] = [];
    for await (const op of log.replay()) ops.push(op);
    return ops;
  }

  it('set + get roundtrip', async () => {
    const item: Counter = { id: 'c1', count: 5, label: 'first' };
    await coll.set(item);
    expect(coll.get('c1')).toEqual(item);
    expect(coll.has('c1')).toBe(true);
    expect(coll.count()).toBe(1);
  });

  it('set writes a SET op to WAL', async () => {
    await coll.set({ id: 'c1', count: 5, label: 'a' });
    const ops = await readWal();
    expect(ops).toHaveLength(1);
    expect(ops[0]?.op).toBe('SET');
    if (ops[0]?.op === 'SET') {
      expect(ops[0].coll).toBe('counters');
      expect(ops[0].key).toBe('c1');
    }
  });

  it('delete removes and writes DEL op', async () => {
    await coll.set({ id: 'c1', count: 1, label: 'a' });
    const existed = await coll.delete('c1');
    expect(existed).toBe(true);
    expect(coll.has('c1')).toBe(false);
    const ops = await readWal();
    expect(ops.some((o) => o.op === 'DEL' && o.key === 'c1')).toBe(true);
  });

  it('delete on missing key returns false and does not log', async () => {
    const existed = await coll.delete('missing');
    expect(existed).toBe(false);
    const ops = await readWal();
    expect(ops).toHaveLength(0);
  });

  it('incr updates field atomically', async () => {
    await coll.set({ id: 'c1', count: 10, label: 'a' });
    const after = await coll.incr('c1', 'count', 5);
    expect(after?.count).toBe(15);
    expect(coll.get('c1')?.count).toBe(15);
  });

  it('incr on missing key returns null', async () => {
    const result = await coll.incr('missing', 'count', 1);
    expect(result).toBeNull();
  });

  it('incr on non-number field throws', async () => {
    await coll.set({ id: 'c1', count: 1, label: 'a' });
    await expect(coll.incr('c1', 'label', 1)).rejects.toThrow(/non-number/i);
  });

  it('100 parallel incr calls land exactly +100 (mutex serializes)', async () => {
    await coll.set({ id: 'c1', count: 0, label: 'a' });
    const N = 100;
    await Promise.all(Array.from({ length: N }, () => coll.incr('c1', 'count', 1)));
    expect(coll.get('c1')?.count).toBe(N);
  });

  it('query / all / count', async () => {
    await coll.set({ id: 'a', count: 1, label: 'x' });
    await coll.set({ id: 'b', count: 5, label: 'y' });
    await coll.set({ id: 'c', count: 3, label: 'x' });
    expect(coll.count()).toBe(3);
    expect(coll.all()).toHaveLength(3);
    const xs = coll.query((c) => c.label === 'x');
    expect(xs).toHaveLength(2);
    expect(xs.map((c) => c.id).sort()).toEqual(['a', 'c']);
  });

  it('_bulkLoad replaces all data without writing to WAL', async () => {
    await coll.set({ id: 'existing', count: 99, label: 'old' });
    coll._bulkLoad([
      { id: 'a', count: 1, label: 'A' },
      { id: 'b', count: 2, label: 'B' },
    ]);
    expect(coll.count()).toBe(2);
    expect(coll.get('existing')).toBeUndefined();
    expect(coll.get('a')?.count).toBe(1);
    const ops = await readWal();
    // Only the original set is in WAL; bulk load bypasses it.
    expect(ops).toHaveLength(1);
  });

  it('_serialize returns array of all current values', async () => {
    await coll.set({ id: 'a', count: 1, label: 'A' });
    await coll.set({ id: 'b', count: 2, label: 'B' });
    const arr = coll._serialize();
    expect(arr).toHaveLength(2);
    expect(arr.map((c) => c.id).sort()).toEqual(['a', 'b']);
  });

  it('_applyIncr on missing key is no-op (does not throw)', () => {
    expect(() => coll._applyIncr('missing', 'count', 1)).not.toThrow();
  });

  it('_applyIncr on non-number field is no-op (does not throw)', async () => {
    await coll.set({ id: 'c1', count: 1, label: 'a' });
    expect(() => coll._applyIncr('c1', 'label', 1)).not.toThrow();
    // Original value preserved.
    expect(coll.get('c1')?.label).toBe('a');
  });

  it('parallel set on same key — last one wins, all serialized', async () => {
    await Promise.all([
      coll.set({ id: 'k', count: 1, label: 'a' }),
      coll.set({ id: 'k', count: 2, label: 'b' }),
      coll.set({ id: 'k', count: 3, label: 'c' }),
    ]);
    expect(coll.count()).toBe(1);
    const ops = await readWal();
    expect(ops.filter((o) => o.op === 'SET')).toHaveLength(3);
  });
});
