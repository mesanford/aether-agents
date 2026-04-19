/**
 * tests/integration/integrations.integration.test.ts
 * Integrations API integration tests.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createMockDb, createTestApp, seedTestUser } from "../setup/testApp.ts";
import { injectRequest } from "../setup/injectRequest.ts";

async function request(
  app: any,
  method: string,
  path: string,
  opts: { body?: unknown; token?: string } = {}
): Promise<{ status: number; body: unknown }> {
  const result = await injectRequest(app, method, path, opts);
  return { status: result.status, body: result.body };
}

describe("Integrations API", () => {
  let db: any;
  let app: any;

  beforeEach(() => {
    db = createMockDb();
    app = createTestApp(db);
  });

  describe("LinkedIn Integration", () => {
    test("GET /api/workspaces/:id/integrations/linkedin/status - not connected", async () => {
      const { workspaceId, token } = await seedTestUser(db);
      const { status, body } = await request(
        app,
        "GET",
        `/api/workspaces/${workspaceId}/integrations/linkedin/status`,
        { token }
      );
      assert.strictEqual(status, 200);
      assert.strictEqual((body as any).connected, false);
    });

    test("POST /api/workspaces/:id/integrations/linkedin - success", async () => {
      const { workspaceId, token } = await seedTestUser(db);
      
      const originalFetch = global.fetch;
      global.fetch = (async (url: string) => {
        if (url.includes("linkedin.com")) {
          return {
            ok: true,
            json: async () => ({
              sub: "urn:li:person:123",
              name: "Test User"
            })
          } as Response;
        }
        return originalFetch(url);
      }) as any;

      try {
        const { status, body } = await request(
          app,
          "POST",
          `/api/workspaces/${workspaceId}/integrations/linkedin`,
          {
            token,
            body: { accessToken: "mock-token" }
          }
        );

        assert.strictEqual(status, 200);
        assert.strictEqual((body as any).connected, true);
        assert.strictEqual((body as any).authorUrn, "urn:li:person:123");

        // Verify status endpoint now returns connected
        const statusRes = await request(
          app,
          "GET",
          `/api/workspaces/${workspaceId}/integrations/linkedin/status`,
          { token }
        );
        assert.strictEqual((statusRes.body as any).connected, true);
      } finally {
        global.fetch = originalFetch;
      }
    });

    test("POST /api/workspaces/:id/integrations/linkedin - failure (invalid token)", async () => {
      const { workspaceId, token } = await seedTestUser(db);
      
      const originalFetch = global.fetch;
      global.fetch = (async () => ({
        ok: false,
        status: 401,
        message: "Unauthorized"
      })) as any;

      try {
        const { status } = await request(
          app,
          "POST",
          `/api/workspaces/${workspaceId}/integrations/linkedin`,
          {
            token,
            body: { accessToken: "bad-token" }
          }
        );

        assert.strictEqual(status, 400);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
