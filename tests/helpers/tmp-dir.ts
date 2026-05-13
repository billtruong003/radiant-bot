import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TMP_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.tmp');

/**
 * Creates a per-test scratch directory under `tests/.tmp/`. Returns the path
 * and an async cleanup function. Names include a counter + ms + random suffix
 * so concurrent test files (Vitest parallel) never collide.
 */
let counter = 0;

export async function mkTmpDir(label = 'test'): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  await fs.mkdir(TMP_ROOT, { recursive: true });
  const id = `${label}-${Date.now()}-${process.pid}-${counter++}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = path.join(TMP_ROOT, id);
  await fs.mkdir(dir, { recursive: true });
  const cleanup = async (): Promise<void> => {
    await fs.rm(dir, { recursive: true, force: true });
  };
  return { dir, cleanup };
}
