import type { PostgresShim } from "./db.ts";

type DatabaseLike = PostgresShim;

export function createAuditLogger(db: DatabaseLike) {
  return async function writeAuditLog(params: {
    workspaceId?: number;
    userId?: number;
    action: string;
    resource: string;
    details?: Record<string, unknown>;
  }) {
    try {
      await db.prepare(
        "INSERT INTO audit_logs (workspace_id, user_id, action, resource, details) VALUES (?, ?, ?, ?, ?)"
      ).run(
        params.workspaceId ?? null,
        params.userId ?? null,
        params.action,
        params.resource,
        params.details ? JSON.stringify(params.details) : null,
      );
    } catch (error) {
      console.error("Failed to write audit log:", error);
    }
  };
}
