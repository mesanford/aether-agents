/**
 * testApp.ts — lightweight test harness for the Aether Agents Express app.
 *
 * Spins up the full Express server with a mock PostgresShim backed by
 * in-memory Maps so tests run without a real PostgreSQL instance.
 */

import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { registerAuthRoutes } from "../../src/server/routes/authRoutes.ts";
import { registerWorkspaceRoutes } from "../../src/server/routes/workspaceRoutes.ts";
import { registerApprovalRoutes } from "../../src/server/routes/approvalRoutes.ts";
import { registerAiRoutes } from "../../src/server/routes/aiRoutes.ts";
import { registerIntegrationsRoutes } from "../../src/server/routes/integrationsRoutes.ts";
import { createSecurityTools } from "../../src/server/security.ts";
import {
  getAllowedAgentUpdate,
  getAllowedTaskCreate,
  getAllowedTaskUpdate,
  getAllowedMessageCreate,
  isNonEmptyString,
} from "../../src/server/validators.ts";

export const TEST_JWT_SECRET = "test-secret-do-not-use-in-prod";

// ---------------------------------------------------------------------------
// Minimal in-memory DB shim
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

/**
 * Creates a fresh in-memory store that mimics the PostgresShim API
 * (prepare → get / all / run).
 */
export function createMockDb() {
  // Tables keyed by table name, rows keyed by numeric id
  const tables: Record<string, Map<number, Row>> = {
    users: new Map(),
    workspaces: new Map(),
    workspace_members: new Map(),
    workspace_invitations: new Map(),
    leads: new Map(),
    agents: new Map(),
    tasks: new Map(),
    messages: new Map(),
    approval_requests: new Map(),
    google_tokens: new Map(),
    sales_sequences: new Map(),
    audit_logs: new Map(),
    knowledge_documents: new Map(),
    media_assets: new Map(),
    automation_jobs: new Map(),
    workspace_automation_settings: new Map(),
    workspace_webhook_secrets: new Map(),
    workspace_google_defaults: new Map(),
    stan_memory_ledger: new Map(),
    sequence_enrollments: new Map(),
    sequence_events: new Map(),
    linkedin_connections: new Map(),
    buffer_connections: new Map(),
    slack_connections: new Map(),
    teams_connections: new Map(),
    notion_connections: new Map(),
    twilio_connections: new Map(),
    wordpress_connections: new Map(),
    hubspot_connections: new Map(),
  };

  let nextId = 1;
  const getId = () => nextId++;

  // Helper: find table name from SQL
  const tableFrom = (sql: string): string => {
    const m = sql.match(/(?:FROM|INTO|UPDATE|JOIN)\s+(\w+)/i);
    return m ? m[1] : "";
  };

  const makeStatement = (sql: string) => {
    const sqlUp = sql.trim().toUpperCase();
    const table = tableFrom(sql);

    return {
      /** Return a single matching row or undefined */
      get: async (...args: unknown[]): Promise<Row | undefined> => {
        const tbl = tables[table];
        if (!tbl) return undefined;

        if (sqlUp.startsWith("SELECT") && sql.includes("COUNT(*)")) {
          // COUNT(*) queries
          const rows = filterRows(sql, tbl, args);
          return { count: rows.length };
        }

        if (sqlUp.startsWith("INSERT")) {
          const id = getId();
          const row = buildInsertRow(sql, args, id);
          tbl.set(id, row);
          return { id, ...row };
        }

        if (sqlUp.startsWith("SELECT")) {
          const rows = filterRows(sql, tbl, args);
          return rows[0];
        }

        if (sqlUp.startsWith("UPDATE")) {
          const rows = filterRows(sql, tbl, args);
          const setFields = parseSetFields(sql, args);
          rows.forEach((r) => {
            const key = [...tbl.entries()].find(([, v]) => v === r)?.[0];
            if (key !== undefined) tbl.set(key, { ...r, ...setFields });
          });
          return rows[0];
        }

        return undefined;
      },

      /** Return all matching rows */
      all: async (...args: unknown[]): Promise<Row[]> => {
        const tbl = tables[table];
        if (!tbl) return [];
        if (sqlUp.startsWith("SELECT")) {
          return filterRows(sql, tbl, args);
        }
        return [];
      },

      /** Execute a mutation, return { changes } */
      run: async (...args: unknown[]): Promise<{ changes: number }> => {
        const tbl = tables[table];
        if (!tbl) return { changes: 0 };

        if (sqlUp.startsWith("INSERT")) {
          const id = getId();
          const row = buildInsertRow(sql, args, id);

          // Handle ON CONFLICT DO NOTHING
          if (sql.toUpperCase().includes("ON CONFLICT") && sql.toUpperCase().includes("DO NOTHING")) {
            const conflictExists = [...tbl.values()].some((r) => rowMatchesWhere(r, sql, args));
            if (conflictExists) return { changes: 0 };
          }

          // Handle ON CONFLICT ... DO UPDATE SET
          if (sql.toUpperCase().includes("ON CONFLICT") && sql.toUpperCase().includes("DO UPDATE")) {
            const existing = [...tbl.entries()].find(([, r]) => r.user_id === row.user_id);
            if (existing) {
              tbl.set(existing[0], { ...existing[1], ...row });
              return { changes: 1 };
            }
          }

          tbl.set(id, row);
          return { changes: 1 };
        }

        if (sqlUp.startsWith("UPDATE")) {
          const setFields = parseSetFields(sql, args);
          const rows = filterRows(sql, tbl, args);
          rows.forEach((r) => {
            const key = [...tbl.entries()].find(([, v]) => v === r)?.[0];
            if (key !== undefined) tbl.set(key, { ...r, ...setFields });
          });
          return { changes: rows.length };
        }

        if (sqlUp.startsWith("DELETE")) {
          const rows = filterRows(sql, tbl, args);
          rows.forEach((r) => {
            const key = [...tbl.entries()].find(([, v]) => v === r)?.[0];
            if (key !== undefined) tbl.delete(key);
          });
          return { changes: rows.length };
        }

        return { changes: 0 };
      },
    };
  };

  /** Build a row from INSERT ... VALUES (?, ?, ...) RETURNING id */
  function buildInsertRow(sql: string, args: unknown[], id: number): Row {
    // Extract column names from INSERT INTO table (col1, col2, ...) VALUES ...
    const colMatch = sql.match(/INSERT\s+INTO\s+\w+\s*\(([^)]+)\)/i);
    if (!colMatch) return { id };
    const cols = colMatch[1].split(",").map((c) => c.trim().replace(/["`]/g, ""));
    const row: Row = { id };
    cols.forEach((col, i) => {
      row[col] = args[i] !== undefined ? args[i] : null;
    });
    return row;
  }

  /**
   * Naive WHERE clause interpreter for the column = ? pattern.
   * Handles AND chains and single predicates.
   */
  function filterRows(sql: string, tbl: Map<number, Row>, args: unknown[]): Row[] {
    const whereMatch = sql.match(/WHERE\s+(.+?)(?:ORDER|LIMIT|RETURNING|$)/is);
    if (!whereMatch) return [...tbl.values()];

    const whereClause = whereMatch[1].trim();

    // Collect ? placeholders in order (args already shifted by SET if UPDATE)
    let argOffset = 0;
    if (/UPDATE\s+\w+\s+SET\s+/is.test(sql)) {
      const setMatch = sql.match(/SET\s+(.+?)\s+WHERE/is);
      if (setMatch) {
        argOffset = (setMatch[1].match(/\?/g) || []).length;
      }
    }

    /**
     * Evaluate one simple predicate against a row.
     * Returns { matched: boolean; argsConsumed: number }
     */
    function evalPredicate(cond: string, row: Row, argIdx: number): { matched: boolean; consumed: number } {
      const clean = cond.trim();

      // Literal comparison: col = 'value' or tbl.col = 'value'
      const literalMatch = clean.match(/(?:\w+\.)?(\w+)\s*=\s*'([^']+)'/i);
      if (literalMatch) {
        return { matched: String(row[literalMatch[1]]) === literalMatch[2], consumed: 0 };
      }

      // Param comparison: col = ? or tbl.col = ?
      const paramMatch = clean.match(/(?:\w+\.)?(\w+)\s*=\s*\?/i);
      if (paramMatch) {
        const val = args[argIdx];
        return { matched: String(row[paramMatch[1]]) === String(val), consumed: 1 };
      }

      // COALESCE / complex — pass through
      return { matched: true, consumed: 0 };
    }

    return [...tbl.values()].filter((row) => {
      let ai = argOffset;

      // Split top-level OR groups first (simple split — no nested parens)
      const orGroups = whereClause.split(/\s+OR\s+/i);

      if (orGroups.length > 1) {
        // Each OR group may consume a fixed number of ?s — we need to track
        // arg position per group.  Pre-count ?s per group.
        const groupArgCounts = orGroups.map((g) => (g.match(/\?/g) || []).length);
        let groupArgIdx = ai;

        for (let gi = 0; gi < orGroups.length; gi++) {
          const andParts = orGroups[gi].split(/\s+AND\s+/i).map((c) => c.trim()).filter(Boolean);
          let partArgIdx = groupArgIdx;
          let groupPass = true;

          for (const part of andParts) {
            const { matched, consumed } = evalPredicate(part, row, partArgIdx);
            partArgIdx += consumed;
            if (!matched) { groupPass = false; break; }
          }

          if (groupPass) return true;
          groupArgIdx += groupArgCounts[gi];
        }
        return false;
      }

      // Pure AND chain (original path, now with alias support)
      const conditions = whereClause.split(/\s+AND\s+/i).map((c) => c.trim()).filter(Boolean);
      return conditions.every((cond) => {
        const { matched, consumed } = evalPredicate(cond, row, ai);
        ai += consumed;
        return matched;
      });
    });
  }


  /** Extract SET field values from UPDATE ... SET col1 = ?, col2 = ? WHERE ... */
  function parseSetFields(sql: string, args: unknown[]): Row {
    const setMatch = sql.match(/SET\s+(.+?)\s+WHERE/is);
    if (!setMatch) return {};
    const setPairs = setMatch[1].split(",").map((s) => s.trim());
    const fields: Row = {};
    let argIdx = 0;
    setPairs.forEach((pair) => {
      const paramMatch = pair.match(/(\w+)\s*=\s*\?/i);
      if (paramMatch && args[argIdx] !== undefined) {
        fields[paramMatch[1]] = args[argIdx];
        argIdx++;
        return;
      }
      const literalMatch = pair.match(/(\w+)\s*=\s*'([^']+)'/i);
      if (literalMatch) {
        fields[literalMatch[1]] = literalMatch[2];
      }
    });
    return fields;
  }

  /** Loose row predicate used for conflict detection */
  function rowMatchesWhere(row: Row, sql: string, args: unknown[]): boolean {
    // Only used for conflict detection — check workspace_id + user_id pair
    const wsIdx = (sql.match(/workspace_id/g) || []).length;
    const uidIdx = (sql.match(/user_id/g) || []).length;
    if (wsIdx > 0 && uidIdx > 0) {
      return row.workspace_id === args[args.length - 2] && row.user_id === args[args.length - 1];
    }
    return false;
  }

  return {
    prepare: (sql: string) => makeStatement(sql),
    tables,
    _reset: () => {
      Object.values(tables).forEach((t) => t.clear());
      nextId = 1;
    },
  };
}

export type MockDb = ReturnType<typeof createMockDb>;

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

export function createTestApp(db: MockDb, aiClient: any = null) {
  const app = express();
  app.use(express.json());

  const { requireAuth, requireWorkspaceAccess, requireWorkspaceRole, createRateLimiter } =
    createSecurityTools(db as any, TEST_JWT_SECRET);

  const authRateLimiter = createRateLimiter({ windowMs: 60_000, max: 100, keyPrefix: "test-auth" });

  const noopSeedWorkspace = async (_: number | bigint) => {};

  const writeAuditLog = () => {};

  registerAuthRoutes({
    app,
    db: db as any,
    jwtSecret: TEST_JWT_SECRET,
    authRateLimiter,
    seedWorkspace: noopSeedWorkspace,
  });

  registerWorkspaceRoutes({
    app,
    db: db as any,
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole,
    getAllowedAgentUpdate,
    getAllowedTaskCreate,
    getAllowedTaskUpdate,
    getAllowedMessageCreate,
    isNonEmptyString,
    writeAuditLog,
    seedWorkspace: noopSeedWorkspace,
  });

  registerApprovalRoutes({ app, db: db as any, requireAuth, requireWorkspaceAccess });

  const aiRateLimiter = createRateLimiter({ windowMs: 60_000, max: 100, keyPrefix: "test-ai" });

  registerAiRoutes({
    app,
    db: db as any,
    aiClient,
    requireAuth,
    requireWorkspaceAccess,
    aiRateLimiter,
    isNonEmptyString,
    buildDataAccessSection: async () => "Mock Data Access",
    buildLiveDataSection: async () => "Mock Live Data",
  });

  registerIntegrationsRoutes({
    app,
    db: db as any,
    getUserIdFromRequest: (req: any) => {
      const auth = req.headers.authorization;
      if (!auth) return null;
      try {
        const decoded = jwt.verify(auth.replace("Bearer ", ""), TEST_JWT_SECRET) as any;
        return decoded.userId;
      } catch {
        return null;
      }
    },
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole,
  });

  // Generic error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("Test server error:", err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

export function makeToken(userId: number): string {
  return jwt.sign({ userId }, TEST_JWT_SECRET, { expiresIn: "1h" });
}

export async function seedTestUser(
  db: MockDb,
  opts: { email?: string; password?: string; name?: string } = {}
): Promise<{ userId: number; workspaceId: number; token: string }> {
  const email = opts.email ?? "test@example.com";
  const password = opts.password ?? "Password123!";
  const name = opts.name ?? "Test User";
  const hashed = await bcrypt.hash(password, 4); // low rounds for test speed

  const userResult = await db
    .prepare("INSERT INTO users (email, password, name) VALUES (?, ?, ?) RETURNING id")
    .get(email, hashed, name);
  const userId = (userResult as any).id as number;

  const wsResult = await db
    .prepare("INSERT INTO workspaces (name, owner_id) VALUES (?, ?) RETURNING id")
    .get(`${name}'s Workspace`, userId);
  const workspaceId = (wsResult as any).id as number;

  await db
    .prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)")
    .run(workspaceId, userId, "owner");

  return { userId, workspaceId, token: makeToken(userId) };
}
