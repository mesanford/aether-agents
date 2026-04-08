import { Pool, PoolConfig } from "pg";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

/**
 * A lightweight shim wrapping node-postgres (pg) to provide an API surface
 * visually similar to better-sqlite3, easing the migration while enforcing
 * async/await for all network queries.
 */
export class PostgresShim {
  public pool: Pool;

  constructor(config?: PoolConfig) {
    // Connect to PG. If DATABASE_URL is not set, tries default localhost config.
    this.pool = new Pool(config || {
      connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/agencyos",
    });
  }

  /**
   * Helper to convert SQLite `?` placeholders to PostgreSQL `$1, $2` placeholders.
   * Very simplistic: skips `?` inside single quotes.
   */
  private convertSql(sql: string): string {
    let index = 1;
    let converted = "";
    let inString = false;
    for (let i = 0; i < sql.length; i++) {
      if (sql[i] === "'") inString = !inString;
      
      if (sql[i] === "?" && !inString) {
        converted += `$${index++}`;
      } else {
        converted += sql[i];
      }
    }
    return converted;
  }

  /**
   * Replaces the synchronous `db.prepare(sql)` from better-sqlite3
   */
  prepare(sql: string) {
    const pgSql = this.convertSql(sql);

    return {
      run: async (...args: any[]) => {
        // Flatten args if they are passed as an array to simulate better-sqlite3 flexible args
        const flatArgs = Array.isArray(args[0]) && args.length === 1 ? args[0] : args;
        const result = await this.pool.query(pgSql, flatArgs);
        // Better sqlite3 `run` returns { changes, lastInsertRowid }.
        // Note: lastInsertRowid won't be accurate unless `RETURNING id` is appended manually to the query, 
        // but we handle `changes` (rowCount).
        return { changes: result.rowCount || 0, lastInsertRowid: result.rows?.[0]?.id };
      },
      get: async (...args: any[]) => {
        const flatArgs = Array.isArray(args[0]) && args.length === 1 ? args[0] : args;
        const { rows } = await this.pool.query(pgSql, flatArgs);
        return rows[0] || undefined;
      },
      all: async (...args: any[]) => {
        const flatArgs = Array.isArray(args[0]) && args.length === 1 ? args[0] : args;
        const { rows } = await this.pool.query(pgSql, flatArgs);
        return rows;
      }
    };
  }

  /**
   * Replaces `db.exec(sql)` for schema migrations and raw statements without args.
   */
  async exec(sql: string) {
    // Often contains multiple statements delimited by ;
    await this.pool.query(sql);
  }
}

// Export a singleton instance
export const db = new PostgresShim();
export default db;
