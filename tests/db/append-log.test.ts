import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppendOnlyLog } from '../../src/db/append-log.js';
import type { StoreOp } from '../../src/db/operations.js';
import { mkTmpDir } from '../helpers/tmp-dir.js';

describe('AppendOnlyLog', () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let walPath: string;

  beforeEach(async () => {
    ({ dir, cleanup } = await mkTmpDir('wal'));
    walPath = path.join(dir, 'wal.jsonl');
  });

  afterEach(async () => {
    await cleanup();
  });

  it('ensureExists creates an empty file', async () => {
    const log = new AppendOnlyLog(walPath, false);
    await log.ensureExists();
    const content = await fs.readFile(walPath, 'utf-8');
    expect(content).toBe('');
  });

  it('append then replay yields the same ops in order', async () => {
    const log = new AppendOnlyLog(walPath, false);
    await log.ensureExists();

    const ops: StoreOp[] = [
      { op: 'SET', coll: 'users', key: 'u1', value: { xp: 10 }, ts: 1 },
      { op: 'APPEND', coll: 'xp_logs', value: { id: 'log1' }, ts: 2 },
      { op: 'INCR', coll: 'users', key: 'u1', field: 'xp', delta: 5, ts: 3 },
      { op: 'DEL', coll: 'users', key: 'u2', ts: 4 },
    ];
    for (const op of ops) await log.append(op);

    const replayed: StoreOp[] = [];
    for await (const op of log.replay()) replayed.push(op);
    expect(replayed).toEqual(ops);
  });

  it('replay skips corrupt JSON lines without crashing', async () => {
    const log = new AppendOnlyLog(walPath, false);
    await log.ensureExists();
    await log.append({ op: 'SET', coll: 'c', key: 'k1', value: 1, ts: 1 });
    // Inject corrupt line in the middle (simulating partial write / disk
    // corruption / manual edit gone wrong).
    await fs.appendFile(walPath, '{this is not valid json}\n');
    await log.append({ op: 'SET', coll: 'c', key: 'k2', value: 2, ts: 2 });

    const ops: StoreOp[] = [];
    for await (const op of log.replay()) ops.push(op);
    expect(ops).toHaveLength(2);
    expect(ops[0]?.op).toBe('SET');
    if (ops[0]?.op === 'SET') expect(ops[0].key).toBe('k1');
    if (ops[1]?.op === 'SET') expect(ops[1].key).toBe('k2');
  });

  it('replay skips shape-invalid ops', async () => {
    const log = new AppendOnlyLog(walPath, false);
    await log.ensureExists();
    // Valid JSON but wrong shape.
    await fs.appendFile(walPath, `${JSON.stringify({ op: 'SET', coll: 'c' })}\n`);
    await fs.appendFile(walPath, `${JSON.stringify({ wrong: true })}\n`);
    await log.append({ op: 'SET', coll: 'c', key: 'k', value: 1, ts: 1 });

    const ops: StoreOp[] = [];
    for await (const op of log.replay()) ops.push(op);
    expect(ops).toHaveLength(1);
  });

  it('replay handles a trailing partial line (crash mid-write)', async () => {
    const log = new AppendOnlyLog(walPath, false);
    await log.ensureExists();
    await log.append({ op: 'SET', coll: 'c', key: 'k1', value: 1, ts: 1 });
    // Tail bytes without newline — simulates power loss mid-fwrite.
    await fs.appendFile(walPath, '{"op":"SET","coll":"c","key":"k2"');

    const ops: StoreOp[] = [];
    for await (const op of log.replay()) ops.push(op);
    // readline emits the trailing chunk as a final line; it's invalid JSON →
    // skipped. We get back the first complete op only.
    expect(ops).toHaveLength(1);
  });

  it('truncate empties the file', async () => {
    const log = new AppendOnlyLog(walPath, false);
    await log.ensureExists();
    await log.append({ op: 'SET', coll: 'c', key: 'k', value: 1, ts: 1 });
    expect(await log.size()).toBeGreaterThan(0);
    await log.truncate();
    expect(await log.size()).toBe(0);
  });

  it('concurrent appends serialize (no interleaved bytes)', async () => {
    const log = new AppendOnlyLog(walPath, false);
    await log.ensureExists();
    const N = 200;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        log.append({ op: 'SET', coll: 'c', key: `k${i}`, value: i, ts: i }),
      ),
    );

    const ops: StoreOp[] = [];
    for await (const op of log.replay()) ops.push(op);
    expect(ops).toHaveLength(N);
    // Every key present exactly once.
    const keys = new Set<string>();
    for (const op of ops) {
      if (op.op === 'SET') keys.add(op.key);
    }
    expect(keys.size).toBe(N);
  });

  it('fsync mode also roundtrips correctly', async () => {
    const log = new AppendOnlyLog(walPath, true);
    await log.ensureExists();
    await log.append({ op: 'SET', coll: 'c', key: 'k1', value: 1, ts: 1 });
    await log.append({ op: 'SET', coll: 'c', key: 'k2', value: 2, ts: 2 });
    const ops: StoreOp[] = [];
    for await (const op of log.replay()) ops.push(op);
    expect(ops).toHaveLength(2);
  });

  it('replay on missing file yields nothing (no crash)', async () => {
    const log = new AppendOnlyLog(walPath, false);
    // Note: did NOT call ensureExists.
    const ops: StoreOp[] = [];
    for await (const op of log.replay()) ops.push(op);
    expect(ops).toHaveLength(0);
  });

  it('runExclusive blocks concurrent appends', async () => {
    const log = new AppendOnlyLog(walPath, false);
    await log.ensureExists();
    let appendStarted = false;
    let appendFinished = false;

    // Hold the writer mutex; meanwhile try to append.
    const holdHandle = log.runExclusive(async () => {
      // Schedule an append that should be blocked.
      void log.append({ op: 'SET', coll: 'c', key: 'k', value: 1, ts: 1 }).then(() => {
        appendFinished = true;
      });
      // Give the append a chance to start (it shouldn't be able to).
      await new Promise((r) => setTimeout(r, 20));
      appendStarted = appendFinished; // false expected
    });

    await holdHandle;
    // After releasing, append eventually completes.
    await new Promise((r) => setTimeout(r, 50));
    expect(appendStarted).toBe(false);
    expect(appendFinished).toBe(true);
  });
});
