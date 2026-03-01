/**
 * SQLite adapter wrapping `node:sqlite` DatabaseSync in the async DbAdapter interface.
 */
import { DatabaseSync } from "node:sqlite";
import type { DbAdapter, RunResult, SQLParam } from "./adapter.ts";

type SqliteValue = null | number | bigint | string | Uint8Array;

/** Convert SQLParam values to types accepted by node:sqlite. */
function toSqlite(params: SQLParam[]): SqliteValue[] {
  return params.map((p) =>
    typeof p === "boolean" ? (p ? 1 : 0) : (p as SqliteValue)
  );
}

export class SqliteAdapter implements DbAdapter {
  readonly dialect = "sqlite" as const;
  private db: DatabaseSync;
  private txDepth = 0;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  query<T>(sql: string, ...params: SQLParam[]): Promise<T[]> {
    return Promise.resolve(
      this.db.prepare(sql).all(...toSqlite(params)) as unknown as T[],
    );
  }

  queryOne<T>(sql: string, ...params: SQLParam[]): Promise<T | undefined> {
    return Promise.resolve(
      this.db.prepare(sql).get(...toSqlite(params)) as T | undefined,
    );
  }

  run(sql: string, ...params: SQLParam[]): Promise<RunResult> {
    const result = this.db.prepare(sql).run(...toSqlite(params));
    return Promise.resolve({
      lastInsertId: result.lastInsertRowid,
      changes: Number(result.changes),
    });
  }

  exec(sql: string): Promise<void> {
    this.db.exec(sql);
    return Promise.resolve();
  }

  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    const depth = this.txDepth++;
    const savepoint = `sp_${depth}`;
    if (depth === 0) {
      this.db.exec("BEGIN");
    } else {
      this.db.exec(`SAVEPOINT ${savepoint}`);
    }
    try {
      const result = await fn(this);
      if (depth === 0) {
        this.db.exec("COMMIT");
      } else {
        this.db.exec(`RELEASE ${savepoint}`);
      }
      return result;
    } catch (e) {
      if (depth === 0) {
        this.db.exec("ROLLBACK");
      } else {
        this.db.exec(`ROLLBACK TO ${savepoint}`);
      }
      throw e;
    } finally {
      this.txDepth--;
    }
  }

  columnExists(table: string, column: string): Promise<boolean> {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
      throw new Error(`Invalid table name: ${table}`);
    }
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as {
      name: string;
    }[];
    return Promise.resolve(cols.some((c) => c.name === column));
  }

  close(): Promise<void> {
    this.db.close();
    return Promise.resolve();
  }

  /** Direct access to the underlying DatabaseSync. */
  get raw(): DatabaseSync {
    return this.db;
  }
}
