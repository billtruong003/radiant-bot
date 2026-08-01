import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHAT_SEARCH_ROLE_NAMES, STAFF_ROLE_NAMES } from '../../src/config/roles.js';
import {
  __for_testing,
  __setArchiveDbForTesting,
  archiveMessage,
  archiveStats,
  pruneOldMessages,
  searchMessages,
} from '../../src/modules/archive/message-archive.js';

const { sanitizeFtsQuery } = __for_testing;
const DAY = 24 * 60 * 60 * 1000;

/**
 * Build the same schema the module creates, against an in-memory DB, and
 * inject it. Keeps tests off disk without duplicating production logic in
 * a way that could drift — if the schema changes, these tests fail loudly.
 */
function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE messages (
      id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, channel_name TEXT NOT NULL,
      author_id TEXT NOT NULL, author_name TEXT NOT NULL, content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE VIRTUAL TABLE messages_fts USING fts5(
      content, content='messages', content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2'
    );
    CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
    CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
    END;
  `);
  return db;
}

function put(over: Partial<Parameters<typeof archiveMessage>[0]> = {}): void {
  archiveMessage({
    id: `m${Math.random()}`,
    channelId: 'c1',
    channelName: 'general',
    authorId: 'u1',
    authorName: 'Alice',
    content: 'hello world',
    createdAt: Date.now(),
    ...over,
  });
}

describe('message archive', () => {
  beforeEach(() => __setArchiveDbForTesting(makeDb()));
  afterEach(() => __setArchiveDbForTesting(null));

  it('stores and finds a message by keyword', () => {
    put({ content: 'server dạo này lag quá' });
    const hits = searchMessages({ query: 'lag' });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.content).toContain('lag');
  });

  // The reason for remove_diacritics: Vietnamese members constantly type
  // without tone marks, and a search that misses those is useless here.
  it('matches Vietnamese text typed without diacritics', () => {
    put({ content: 'thằng đó nói xấu tao' });
    expect(searchMessages({ query: 'noi xau' }).length).toBeGreaterThan(0);
    expect(searchMessages({ query: 'nói xấu' }).length).toBeGreaterThan(0);
  });

  it('filters by author', () => {
    put({ authorId: 'u1', content: 'aaa bbb' });
    put({ authorId: 'u2', content: 'aaa ccc' });
    const hits = searchMessages({ query: 'aaa', authorId: 'u2' });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.authorId).toBe('u2');
  });

  it('filters by recency window', () => {
    put({ content: 'xxx recent', createdAt: Date.now() - 1 * DAY });
    put({ content: 'xxx ancient', createdAt: Date.now() - 40 * DAY });
    expect(searchMessages({ query: 'xxx', days: 7 })).toHaveLength(1);
    expect(searchMessages({ query: 'xxx' })).toHaveLength(2);
  });

  it('supports author-only search with no keyword', () => {
    put({ authorId: 'u9', content: 'one' });
    put({ authorId: 'u9', content: 'two' });
    put({ authorId: 'other', content: 'three' });
    expect(searchMessages({ authorId: 'u9' })).toHaveLength(2);
  });

  it('is idempotent on message id (Discord can redeliver)', () => {
    archiveMessage({
      id: 'dup', channelId: 'c', channelName: 'g', authorId: 'u',
      authorName: 'A', content: 'once', createdAt: Date.now(),
    });
    archiveMessage({
      id: 'dup', channelId: 'c', channelName: 'g', authorId: 'u',
      authorName: 'A', content: 'once', createdAt: Date.now(),
    });
    expect(archiveStats().messages).toBe(1);
  });

  it('returns newest first', () => {
    put({ content: 'zzz older', createdAt: 1000 });
    put({ content: 'zzz newer', createdAt: 9000 });
    expect(searchMessages({ query: 'zzz' })[0]?.content).toContain('newer');
  });

  it('caps the result limit so a bad call cannot pull everything', () => {
    for (let i = 0; i < 80; i++) put({ content: `spam ${i}` });
    expect(searchMessages({ query: 'spam', limit: 9999 }).length).toBeLessThanOrEqual(50);
  });

  it('prunes past the retention window and keeps recent rows', () => {
    put({ content: 'keep me', createdAt: Date.now() - 10 * DAY });
    put({ content: 'drop me', createdAt: Date.now() - 200 * DAY });
    expect(pruneOldMessages(90)).toBe(1);
    expect(archiveStats().messages).toBe(1);
    expect(searchMessages({ query: 'drop' })).toHaveLength(0);
  });
});

describe('FTS query sanitising', () => {
  // Raw user text goes straight into an FTS5 MATCH; unescaped operators
  // and punctuation are a syntax error, which would surface to the user
  // as a broken search rather than "no results".
  it('neutralises FTS operators and stray punctuation', () => {
    expect(() => sanitizeFtsQuery('a AND b')).not.toThrow();
    expect(sanitizeFtsQuery('wtf???')).toContain('"wtf???"'.slice(0, 4));
    expect(sanitizeFtsQuery('"quoted" (paren) *star*')).not.toContain('*');
  });

  it('returns empty for input with no usable tokens', () => {
    expect(sanitizeFtsQuery('   ')).toBe('');
    expect(sanitizeFtsQuery('***')).toBe('');
  });

  it('does not blow up on very long input', () => {
    const long = Array.from({ length: 200 }, (_, i) => `w${i}`).join(' ');
    expect(sanitizeFtsQuery(long).split(' OR ').length).toBeLessThanOrEqual(12);
  });
});

describe('chat-search privilege', () => {
  // Bill's explicit call: reading someone's history is a higher power than
  // moderating them, so it is NOT the staff set.
  it('is limited to Chưởng Môn and Tiên Nhân', () => {
    expect([...CHAT_SEARCH_ROLE_NAMES].sort()).toEqual(['Chưởng Môn', 'Tiên Nhân']);
  });

  it('excludes Trưởng Lão and Chấp Pháp even though they are staff', () => {
    expect(STAFF_ROLE_NAMES.has('Trưởng Lão')).toBe(true);
    expect(CHAT_SEARCH_ROLE_NAMES.has('Trưởng Lão')).toBe(false);
    expect(CHAT_SEARCH_ROLE_NAMES.has('Chấp Pháp')).toBe(false);
  });
});
