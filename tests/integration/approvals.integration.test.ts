/**
 * tests/integration/approvals.integration.test.ts
 * Approvals API integration tests.
 *
 * Run: node --import tsx --test tests/integration/approvals.integration.test.ts
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createMockDb, createTestApp, makeToken, seedTestUser } from "../setup/testApp.ts";
import { injectRequest } from "../setup/injectRequest.ts";

async function request(
  app: ReturnType<typeof createTestApp>,
  method: string,
  path: string,
  opts: { body?: unknown; token?: string } = {}
): Promise<{ status: number; body: unknown }> {
  const result = await injectRequest(app as any, method, path, opts);
  return { status: result.status, body: result.body };
}

// ---------------------------------------------------------------------------
// Helpers — seed an approval_request row directly into the mock DB
// ---------------------------------------------------------------------------

async function seedApproval(
  db: ReturnType<typeof createMockDb>,
  opts: {
    workspaceId: number;
    agentId?: string;
    actionType?: string;
    status?: string;
    payload?: unknown;
  }
) {
  const row = await db
    .prepare(
      "INSERT INTO approval_requests (workspace_id, task_id, agent_id, agent_name, action_type, payload, status, requested_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .get(
      opts.workspaceId,
      1,
      opts.agentId ?? "stan",
      "STAN",
      opts.actionType ?? "linkedin_post",
      JSON.stringify(opts.payload ?? { text: "Hello LinkedIn!" }),
      opts.status ?? "pending",
      new Date().toISOString()
    );
  return (row as any).id as number;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let db: ReturnType<typeof createMockDb>;
let app: ReturnType<typeof createTestApp>;

describe("Approvals API", () => {
  beforeEach(() => {
    db = createMockDb();
    app = createTestApp(db);
  });

  // ------------------------------------------------------------------
  // GET /api/workspaces/:workspaceId/approvals
  // ------------------------------------------------------------------
  describe("GET /api/workspaces/:workspaceId/approvals", () => {
    test("returns empty list when no approvals exist", async () => {
      const { userId, workspaceId, token } = await seedTestUser(db);
      const { status, body } = await request(
        app,
        "GET",
        `/api/workspaces/${workspaceId}/approvals`,
        { token }
      );
      assert.equal(status, 200);
      assert.ok(Array.isArray(body), "should return array");
      assert.equal((body as any[]).length, 0);
    });

    test("returns pending approvals by default", async () => {
      const { workspaceId, token } = await seedTestUser(db);
      await seedApproval(db, { workspaceId, status: "pending" });
      await seedApproval(db, { workspaceId, status: "approved" });

      const { status, body } = await request(
        app,
        "GET",
        `/api/workspaces/${workspaceId}/approvals`,
        { token }
      );
      assert.equal(status, 200);
      const list = body as any[];
      assert.equal(list.length, 1, "only pending approval returned by default");
      assert.equal(list[0].status, "pending");
    });

    test("returns all approvals when status=all", async () => {
      const { workspaceId, token } = await seedTestUser(db);
      await seedApproval(db, { workspaceId, status: "pending" });
      await seedApproval(db, { workspaceId, status: "approved" });
      await seedApproval(db, { workspaceId, status: "rejected" });

      const { status, body } = await request(
        app,
        "GET",
        `/api/workspaces/${workspaceId}/approvals?status=all`,
        { token }
      );
      assert.equal(status, 200);
      assert.equal((body as any[]).length, 3);
    });

    test("returns 400 for invalid status filter", async () => {
      const { workspaceId, token } = await seedTestUser(db);
      const { status } = await request(
        app,
        "GET",
        `/api/workspaces/${workspaceId}/approvals?status=invalid`,
        { token }
      );
      assert.equal(status, 400);
    });

    test("returns 401 without authentication", async () => {
      const { workspaceId } = await seedTestUser(db);
      const { status } = await request(
        app,
        "GET",
        `/api/workspaces/${workspaceId}/approvals`
      );
      assert.equal(status, 401);
    });

    test("does not return approvals belonging to other workspaces", async () => {
      const user1 = await seedTestUser(db, { email: "user1@example.com" });
      const user2 = await seedTestUser(db, { email: "user2@example.com" });
      await seedApproval(db, { workspaceId: user2.workspaceId });

      const { status, body } = await request(
        app,
        "GET",
        `/api/workspaces/${user1.workspaceId}/approvals`,
        { token: user1.token }
      );
      assert.equal(status, 200);
      assert.equal((body as any[]).length, 0, "should not leak cross-workspace approvals");
    });
  });

  // ------------------------------------------------------------------
  // POST /api/workspaces/:workspaceId/approvals/:approvalId/reject
  // ------------------------------------------------------------------
  describe("POST /api/workspaces/:workspaceId/approvals/:id/reject", () => {
    test("rejects a pending approval and returns success", async () => {
      const { workspaceId, token } = await seedTestUser(db);
      const approvalId = await seedApproval(db, { workspaceId });

      const { status, body } = await request(
        app,
        "POST",
        `/api/workspaces/${workspaceId}/approvals/${approvalId}/reject`,
        { token, body: { reason: "Not the right tone." } }
      );
      assert.equal(status, 200);
      assert.equal((body as any).success, true);
    });

    test("marks the approval as rejected in the DB", async () => {
      const { workspaceId, token } = await seedTestUser(db);
      const approvalId = await seedApproval(db, { workspaceId });

      await request(
        app,
        "POST",
        `/api/workspaces/${workspaceId}/approvals/${approvalId}/reject`,
        { token, body: { reason: "Wrong draft" } }
      );

      const row = await db
        .prepare("SELECT * FROM approval_requests WHERE id = ?")
        .get(approvalId);
      assert.equal((row as any).status, "rejected");
    });

    test("inserts a redraft feedback message into the messages table", async () => {
      const { workspaceId, token } = await seedTestUser(db);
      const approvalId = await seedApproval(db, { workspaceId, agentId: "stan" });

      await request(
        app,
        "POST",
        `/api/workspaces/${workspaceId}/approvals/${approvalId}/reject`,
        { token, body: { reason: "Please rephrase." } }
      );

      const messages = await db
        .prepare("SELECT * FROM messages WHERE workspace_id = ?")
        .all(workspaceId);
      assert.ok(messages.length > 0, "should have inserted a redraft message");
      assert.ok(
        (messages[0] as any).content?.includes("[REJECTED]"),
        "message should contain [REJECTED] marker"
      );
    });

    test("returns 409 when trying to reject an already-rejected approval", async () => {
      const { workspaceId, token } = await seedTestUser(db);
      const approvalId = await seedApproval(db, { workspaceId, status: "rejected" });

      const { status } = await request(
        app,
        "POST",
        `/api/workspaces/${workspaceId}/approvals/${approvalId}/reject`,
        { token }
      );
      assert.equal(status, 409);
    });

    test("returns 404 for a non-existent approval", async () => {
      const { workspaceId, token } = await seedTestUser(db);
      const { status } = await request(
        app,
        "POST",
        `/api/workspaces/${workspaceId}/approvals/99999/reject`,
        { token }
      );
      assert.equal(status, 404);
    });

    test("returns 404 when approval belongs to a different workspace", async () => {
      const user1 = await seedTestUser(db, { email: "u1@x.com" });
      const user2 = await seedTestUser(db, { email: "u2@x.com" });
      const approvalId = await seedApproval(db, { workspaceId: user2.workspaceId });

      const { status } = await request(
        app,
        "POST",
        `/api/workspaces/${user1.workspaceId}/approvals/${approvalId}/reject`,
        { token: user1.token }
      );
      assert.equal(status, 404);
    });

    test("returns 401 without authentication", async () => {
      const { workspaceId } = await seedTestUser(db);
      const approvalId = await seedApproval(db, { workspaceId });
      const { status } = await request(
        app,
        "POST",
        `/api/workspaces/${workspaceId}/approvals/${approvalId}/reject`
      );
      assert.equal(status, 401);
    });
  });

  // ------------------------------------------------------------------
  // POST /api/workspaces/:workspaceId/approvals/:approvalId/approve
  // ------------------------------------------------------------------
  describe("POST /api/workspaces/:workspaceId/approvals/:id/approve", () => {
    test("returns 500 when the social platform is not connected (dispatch fails)", async () => {
      // The mock DB has no linkedin_connections row, so dispatchApprovedAction throws
      const { workspaceId, token } = await seedTestUser(db);
      const approvalId = await seedApproval(db, {
        workspaceId,
        actionType: "linkedin_post",
      });

      const { status } = await request(
        app,
        "POST",
        `/api/workspaces/${workspaceId}/approvals/${approvalId}/approve`,
        { token }
      );
      assert.equal(status, 500, "should 500 when LinkedIn not connected");
    });

    test("returns 409 when approval is already approved", async () => {
      const { workspaceId, token } = await seedTestUser(db);
      const approvalId = await seedApproval(db, { workspaceId, status: "approved" });

      const { status } = await request(
        app,
        "POST",
        `/api/workspaces/${workspaceId}/approvals/${approvalId}/approve`,
        { token }
      );
      assert.equal(status, 409);
    });

    test("returns 404 for unknown approval", async () => {
      const { workspaceId, token } = await seedTestUser(db);
      const { status } = await request(
        app,
        "POST",
        `/api/workspaces/${workspaceId}/approvals/99999/approve`,
        { token }
      );
      assert.equal(status, 404);
    });

    test("returns 401 without authentication", async () => {
      const { workspaceId } = await seedTestUser(db);
      const approvalId = await seedApproval(db, { workspaceId });
      const { status } = await request(
        app,
        "POST",
        `/api/workspaces/${workspaceId}/approvals/${approvalId}/approve`
      );
      assert.equal(status, 401);
    });

    test("returns 500 for unsupported action type", async () => {
      const { workspaceId, token } = await seedTestUser(db);
      const approvalId = await seedApproval(db, {
        workspaceId,
        actionType: "unsupported_platform",
      });

      const { status, body } = await request(
        app,
        "POST",
        `/api/workspaces/${workspaceId}/approvals/${approvalId}/approve`,
        { token }
      );
      assert.equal(status, 500);
      assert.ok((body as any).error?.includes("Unsupported action type"));
    });

    test("successfully approves a LinkedIn post when connected", async () => {
      const { workspaceId, token } = await seedTestUser(db);
      
      // Mock LinkedIn connection
      await db.prepare("INSERT INTO linkedin_connections (workspace_id, access_token, author_urn) VALUES (?, ?, ?)")
        .run(workspaceId, "mock-token", "urn:li:person:123");

      const approvalId = await seedApproval(db, {
        workspaceId,
        actionType: "linkedin_post",
        payload: { text: "Success!" }
      });

      // Mock global fetch
      const originalFetch = global.fetch;
      global.fetch = async (url: string | URL | Request) => {
        if (url.toString().includes("linkedin.com")) {
          return {
            ok: true,
            status: 201,
            json: async () => ({}),
            headers: new Headers({ "x-restli-id": "urn:li:share:456" })
          } as Response;
        }
        return originalFetch(url);
      };

      try {
        const { status, body } = await request(
          app,
          "POST",
          `/api/workspaces/${workspaceId}/approvals/${approvalId}/approve`,
          { token }
        );

        assert.equal(status, 200);
        assert.equal((body as any).success, true);

        // Verify DB status update
        const row = await db.prepare("SELECT status FROM approval_requests WHERE id = ?").get(approvalId);
        assert.equal((row as any).status, "approved");
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
