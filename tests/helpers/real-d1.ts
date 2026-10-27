import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { D1Database } from '@cloudflare/workers-types';

/**
 * In-memory SQLite with every migration applied, wrapped in the subset of the
 * D1 API the bot uses (prepare/bind/all/first/run, batch, exec). Use it when a
 * test needs real aggregate SQL semantics instead of a hand-rolled mock.
 */

type SQLInputValue = null | number | bigint | string | Uint8Array;

class RealD1Statement {
  constructor(
    private readonly sqlite: Database.Database,
    readonly sql: string,
    private params: SQLInputValue[] = [],
  ) {}

  bind(...values: SQLInputValue[]): this {
    this.params = values;
    return this;
  }

  async run(): Promise<{ success: true; results: []; meta: { changes: number } }> {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, results: [], meta: { changes: result.changes } };
  }

  async all<T = unknown>(): Promise<{ results: T[]; success: true; meta: Record<string, unknown> }> {
    const results = this.sqlite.prepare(this.sql).all(...this.params) as T[];
    return { results, success: true, meta: {} };
  }

  async first<T = unknown>(column?: string): Promise<T | null> {
    const row = this.sqlite.prepare(this.sql).get(...this.params) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }

  runSync(): void {
    this.sqlite.prepare(this.sql).run(...this.params);
  }
}

export interface RealD1 {
  db: D1Database;
  sqlite: Database.Database;
  rows<T = any>(sql: string, params?: SQLInputValue[]): T[];
}

export function createRealD1(): RealD1 {
  const sqlite = new Database(':memory:');
  const migrationsDir = fileURLToPath(new URL('../../migrations/', import.meta.url));
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  }

  const db = {
    prepare: (sql: string) => new RealD1Statement(sqlite, sql),
    batch: async (statements: RealD1Statement[]) => {
      sqlite.exec('BEGIN');
      try {
        for (const stmt of statements) stmt.runSync();
        sqlite.exec('COMMIT');
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
      return statements.map(() => ({ success: true, results: [], meta: { changes: 1 } }));
    },
    exec: async (sql: string) => {
      sqlite.exec(sql);
      return { count: 1, duration: 0 };
    },
  };

  return {
    db: db as unknown as D1Database,
    sqlite,
    rows: <T = any>(sql: string, params: SQLInputValue[] = []) => sqlite.prepare(sql).all(...params) as T[],
  };
}

export interface UserDayRow {
  chatId: number;
  userId: number;
  day: string;
  messages?: number;
  words?: number;
  profanity?: number;
  criminal?: number;
  criminalSeverity?: number;
}

/** Seeds one stats_daily_user row (and the legacy activity total for its day). */
export function seedUserDay(d1: RealD1, row: UserDayRow): void {
  d1.sqlite
    .prepare(
      `INSERT INTO stats_daily_user (chat_id, day, user_id, message_count, word_count, profanity_count, criminal_count, criminal_severity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat_id, day, user_id) DO UPDATE SET
         message_count = excluded.message_count, word_count = excluded.word_count,
         profanity_count = excluded.profanity_count, criminal_count = excluded.criminal_count,
         criminal_severity = excluded.criminal_severity`,
    )
    .run(
      row.chatId,
      row.day,
      row.userId,
      row.messages ?? 0,
      row.words ?? 0,
      row.profanity ?? 0,
      row.criminal ?? 0,
      row.criminalSeverity ?? 0,
    );
  if (row.messages) {
    d1.sqlite
      .prepare(
        `INSERT INTO activity (chat_id, day, count) VALUES (?, ?, ?)
         ON CONFLICT(chat_id, day) DO UPDATE SET count = activity.count + excluded.count`,
      )
      .run(row.chatId, row.day, row.messages);
  }
}

export function seedUsername(d1: RealD1, chatId: number, userId: number, username: string): void {
  d1.sqlite
    .prepare(
      `INSERT INTO stats_chat_user_profile (chat_id, user_id, username, last_message_ts) VALUES (?, ?, ?, 0)
       ON CONFLICT(chat_id, user_id) DO UPDATE SET username = excluded.username`,
    )
    .run(chatId, userId, username);
}

export function seedHour(d1: RealD1, chatId: number, day: string, hour: number, count: number): void {
  d1.sqlite
    .prepare('INSERT INTO stats_daily_hour (chat_id, day, hour, message_count) VALUES (?, ?, ?, ?)')
    .run(chatId, day, hour, count);
}

export function seedProfanityWord(
  d1: RealD1,
  chatId: number,
  day: string,
  word: string,
  userId: number | null,
  count: number,
): void {
  d1.sqlite
    .prepare(
      `INSERT INTO stats_daily_profanity_word (chat_id, day, word, count) VALUES (?, ?, ?, ?)
       ON CONFLICT(chat_id, day, word) DO UPDATE SET count = stats_daily_profanity_word.count + excluded.count`,
    )
    .run(chatId, day, word, count);
  if (userId === null) return;
  d1.sqlite
    .prepare(
      `INSERT INTO stats_daily_profanity_word_user (chat_id, day, word, user_id, count) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(chat_id, day, word, user_id) DO UPDATE SET count = stats_daily_profanity_word_user.count + excluded.count`,
    )
    .run(chatId, day, word, userId, count);
}
