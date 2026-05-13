import { promises as fs } from 'node:fs';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { env } from '../../config/env.js';
import { getStore } from '../../db/index.js';
import { logger } from '../../utils/logger.js';

/**
 * Nightly GitHub backup — pushes `snapshot.json` + `wal.jsonl` to a
 * private repo. Per SPEC §6.9. Skipped silently if env vars not set
 * so dev runs don't fail.
 *
 * Flow:
 *   1. Force snapshot so WAL is flushed into snapshot.json.
 *   2. Clone backup repo into `./backup-repo` (or pull if exists).
 *   3. Copy data files over the working tree.
 *   4. git add + commit + push.
 *
 * Recovery (SPEC §6.10): clone backup repo → copy snapshot/wal into
 * DATA_DIR on the new VM → start bot → WAL replay restores state.
 */

const BACKUP_DIR = './backup-repo';

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function backupToGitHub(): Promise<{ skipped: boolean; pushed?: boolean }> {
  if (!env.BACKUP_GITHUB_REPO || !env.BACKUP_GITHUB_TOKEN) {
    logger.info('backup: skipped (BACKUP_GITHUB_REPO / BACKUP_GITHUB_TOKEN not set)');
    return { skipped: true };
  }

  // Force a fresh snapshot so backup includes everything in memory.
  try {
    await getStore().snapshot();
  } catch (err) {
    logger.warn({ err }, 'backup: pre-flight snapshot failed, will back up existing files');
  }

  const remoteUrl = `https://${env.BACKUP_GITHUB_TOKEN}@github.com/${env.BACKUP_GITHUB_REPO}.git`;
  const repoExists = await fileExists(BACKUP_DIR);

  try {
    if (!repoExists) {
      logger.info({ dir: BACKUP_DIR, repo: env.BACKUP_GITHUB_REPO }, 'backup: cloning repo');
      await simpleGit().clone(remoteUrl, BACKUP_DIR);
    } else {
      await simpleGit(BACKUP_DIR).pull();
    }

    const snapshotSrc = path.join(env.DATA_DIR, 'snapshot.json');
    const walSrc = path.join(env.DATA_DIR, 'wal.jsonl');
    const snapshotDst = path.join(BACKUP_DIR, 'snapshot.json');
    const walDst = path.join(BACKUP_DIR, 'wal.jsonl');

    if (await fileExists(snapshotSrc)) {
      await fs.copyFile(snapshotSrc, snapshotDst);
    }
    if (await fileExists(walSrc)) {
      await fs.copyFile(walSrc, walDst);
    }

    const git = simpleGit(BACKUP_DIR);
    await git.add('./*');
    const status = await git.status();
    if (status.files.length === 0) {
      logger.info('backup: no changes to commit');
      return { skipped: false, pushed: false };
    }

    const date = new Date().toISOString().slice(0, 16).replace('T', ' ');
    await git.commit(`backup ${date}`);
    await git.push('origin', 'main');

    logger.info({ date, files: status.files.map((f) => f.path) }, 'backup: pushed to GitHub');
    return { skipped: false, pushed: true };
  } catch (err) {
    logger.error({ err }, 'backup: failed');
    return { skipped: false, pushed: false };
  }
}
