import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * Phase 16 — searchable message archive.
 *
 * WHY A SEPARATE SQLITE FILE, not the main store:
 * the bot's primary store is in-memory (WAL + snapshot). Message BODIES
 * are high-volume, append-only, and only ever read by search — exactly the
 * shape that made `xp_logs` grow to 140k rows / 47MB of heap. Putting chat
 * text there would be strictly worse (text, not counters) on a box with
 * ~1.2GB RAM free. SQLite keeps it on disk: the heap cost is one open file
 * handle regardless of how many messages accumulate.
 *
 * SPEC.md §6 chose "no SQL" for the game state, and that still holds — this
 * is a different kind of data with different access patterns, not a reversal.
 *
 * Retention: rows older than ARCHIVE_RETENTION_DAYS are deleted by a daily
 * job. Keeping chat forever is a liability, not a feature.
 *
 * Access control is NOT enforced here — this module is the storage layer.
 * The caller (the search tool) checks `CHAT_SEARCH_ROLE_NAMES`.
 */

export interface ArchivedMessage {
  id: string;
  channelId: string;
  channelName: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: number;
}

export interface SearchOptions {
  /** FTS5 query. Empty = filter-only search (e.g. everything by one author). */
  query?: string;
  authorId?: string;
  channelId?: string;
  /** Only messages newer than this many days. */
  days?: number;
  limit?: number;
}

/** Hard ceiling so a bad call can't pull the whole archive into memory. */
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

let db: Database.Database | null = null;

function open(): Database.Database {
  if (db) return db;
  const dir = env.DATA_DIR;
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'messages.db');
  const conn = new Database(file);

  // WAL: readers don't block the ingest writer. Ingest runs on every
  // message, so a blocking reader would stall the event handler.
  conn.pragma('journal_mode = WAL');
  // The archive is reconstructible from Discord; durability matters less
  // than not fsyncing on the message hot path.
  conn.pragma('synchronous = NORMAL');

  conn.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id           TEXT PRIMARY KEY,
      channel_id   TEXT NOT NULL,
      channel_name TEXT NOT NULL,
      author_id    TEXT NOT NULL,
      author_name  TEXT NOT NULL,
      content      TEXT NOT NULL,
      created_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_author  ON messages(author_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);

    -- 'remove_diacritics 2' is the point: Vietnamese members routinely type
    -- without tone marks, so "noi xau" must match "nói xấu". Verified live.
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content,
      content='messages',
      content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2'
    );

    -- Keep FTS in lockstep with the base table. Without these the index
    -- silently drifts and search starts returning stale/missing rows.
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
      INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
  `);

  db = conn;
  logger.info({ file }, 'archive: message store opened');
  return conn;
}

/**
 * Store one message. Idempotent on message id (Discord can redeliver).
 * Never throws — archiving must not break message handling.
 */
export function archiveMessage(msg: ArchivedMessage): void {
  try {
    open()
      .prepare(
        `INSERT INTO messages (id, channel_id, channel_name, author_id, author_name, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        msg.id,
        msg.channelId,
        msg.channelName,
        msg.authorId,
        msg.authorName,
        msg.content,
        msg.createdAt,
      );
  } catch (err) {
    logger.warn({ err, id: msg.id }, 'archive: insert failed');
  }
}

/**
 * FTS5 treats bare punctuation and operators as syntax; a user typing
 * `wtf???` or `a AND` would otherwise throw a parse error. Quote every
 * token so the whole thing is treated as literal terms.
 */
function sanitizeFtsQuery(raw: string): string {
  const tokens = raw
    .replace(/["*()]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, 12);
  if (tokens.length === 0) return '';
  return tokens.map((t) => `"${t}"`).join(' OR ');
}

/** Search the archive. Returns newest-first, capped at MAX_LIMIT. */
export function searchMessages(opts: SearchOptions): ArchivedMessage[] {
  const conn = open();
  const limit = Math.min(Math.max(1, opts.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const where: string[] = [];
  const params: unknown[] = [];

  const ftsQuery = opts.query ? sanitizeFtsQuery(opts.query) : '';
  const from = ftsQuery
    ? 'messages m JOIN messages_fts f ON f.rowid = m.rowid'
    : 'messages m';
  if (ftsQuery) {
    where.push('messages_fts MATCH ?');
    params.push(ftsQuery);
  }
  if (opts.authorId) {
    where.push('m.author_id = ?');
    params.push(opts.authorId);
  }
  if (opts.channelId) {
    where.push('m.channel_id = ?');
    params.push(opts.channelId);
  }
  if (opts.days && opts.days > 0) {
    where.push('m.created_at >= ?');
    params.push(Date.now() - opts.days * 24 * 60 * 60 * 1000);
  }

  const sql = `
    SELECT m.id, m.channel_id, m.channel_name, m.author_id, m.author_name, m.content, m.created_at
    FROM ${from}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY m.created_at DESC
    LIMIT ?`;
  params.push(limit);

  try {
    const rows = conn.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      channelId: r.channel_id as string,
      channelName: r.channel_name as string,
      authorId: r.author_id as string,
      authorName: r.author_name as string,
      content: r.content as string,
      createdAt: r.created_at as number,
    }));
  } catch (err) {
    logger.warn({ err, query: opts.query }, 'archive: search failed');
    return [];
  }
}

/** Delete rows past the retention window. Returns how many went. */
export function pruneOldMessages(retentionDays = env.ARCHIVE_RETENTION_DAYS): number {
  try {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const info = open().prepare('DELETE FROM messages WHERE created_at < ?').run(cutoff);
    const deleted = info.changes;
    if (deleted > 0) {
      // Reclaim the pages; otherwise the file only ever grows on disk even
      // as rows are deleted.
      open().exec('VACUUM');
      logger.info({ deleted, retention_days: retentionDays }, 'archive: pruned old messages');
    }
    return deleted;
  } catch (err) {
    logger.error({ err }, 'archive: prune failed');
    return 0;
  }
}

export function archiveStats(): { messages: number; oldestAt: number | null } {
  try {
    const row = open()
      .prepare('SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM messages')
      .get() as { n: number; oldest: number | null };
    return { messages: row.n, oldestAt: row.oldest };
  } catch {
    return { messages: 0, oldestAt: null };
  }
}

/** Close the handle (shutdown + tests). */
export function closeArchive(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** Point the archive at a different file. Tests only. */
export function __setArchiveDbForTesting(conn: Database.Database | null): void {
  db = conn;
}

export const __for_testing = { sanitizeFtsQuery };
