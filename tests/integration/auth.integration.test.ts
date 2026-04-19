/**
 * tests/integration/auth.integration.test.ts
 * Auth API integration tests using the in-memory mock DB.
 *
 * Run: node --import tsx --test tests/integration/auth.integration.test.ts
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createMockDb, createTestApp, makeToken, seedTestUser } from "../setup/testApp.ts";
import { injectRequest } from "../setup/injectRequest.ts";

// ---------------------------------------------------------------------------
// Thin wrapper that matches the existing call-site signature
// ---------------------------------------------------------------------------

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
// Tests
// ---------------------------------------------------------------------------

let db: ReturnType<typeof createMockDb>;
let app: ReturnType<typeof createTestApp>;

describe("Auth API", () => {
  beforeEach(() => {
    db = createMockDb();
    app = createTestApp(db);
  });

  // ------------------------------------------------------------------
  // POST /api/auth/register
  // ------------------------------------------------------------------
  describe("POST /api/auth/register", () => {
    test("registers a new user and returns a JWT", async () => {
      const { status, body } = await request(app, "POST", "/api/auth/register", {
        body: { email: "alice@example.com", password: "Secret123!" },
      });
      assert.equal(status, 200, "should return 200");
      assert.ok((body as any).token, "should include JWT token");
      assert.ok((body as any).user?.id, "should include user id");
      assert.equal((body as any).user?.email, "alice@example.com");
    });

    test("rejects registration when email is missing", async () => {
      const { status, body } = await request(app, "POST", "/api/auth/register", {
        body: { password: "Secret123!" },
      });
      assert.equal(status, 400);
      assert.ok((body as any).error);
    });

    test("rejects registration when password is missing", async () => {
      const { status, body } = await request(app, "POST", "/api/auth/register", {
        body: { email: "no-pass@example.com" },
      });
      assert.equal(status, 400);
      assert.ok((body as any).error);
    });

    test("rejects duplicate email registration", async () => {
      await request(app, "POST", "/api/auth/register", {
        body: { email: "dup@example.com", password: "Pass123!" },
      });
      const { status } = await request(app, "POST", "/api/auth/register", {
        body: { email: "dup@example.com", password: "Pass123!" },
      });
      assert.equal(status, 400, "second registration should fail with 400");
    });

    test("derives username from email when name is not provided", async () => {
      const { body } = await request(app, "POST", "/api/auth/register", {
        body: { email: "derived@example.com", password: "Secret!" },
      });
      assert.equal((body as any).user?.name, "derived");
    });
  });

  // ------------------------------------------------------------------
  // POST /api/auth/login
  // ------------------------------------------------------------------
  describe("POST /api/auth/login", () => {
    test("returns a JWT for valid credentials", async () => {
      // seed via register
      await request(app, "POST", "/api/auth/register", {
        body: { email: "logintest@example.com", password: "Pass123!" },
      });

      const { status, body } = await request(app, "POST", "/api/auth/login", {
        body: { email: "logintest@example.com", password: "Pass123!" },
      });
      assert.equal(status, 200);
      assert.ok((body as any).token);
    });

    test("returns 401 for wrong password", async () => {
      await request(app, "POST", "/api/auth/register", {
        body: { email: "logintest2@example.com", password: "RealPass1!" },
      });

      const { status } = await request(app, "POST", "/api/auth/login", {
        body: { email: "logintest2@example.com", password: "WrongPass!" },
      });
      assert.equal(status, 401);
    });

    test("returns 401 for non-existent user", async () => {
      const { status } = await request(app, "POST", "/api/auth/login", {
        body: { email: "nobody@example.com", password: "Pass123!" },
      });
      assert.equal(status, 401);
    });

    test("returns 400 when email or password missing", async () => {
      const { status } = await request(app, "POST", "/api/auth/login", {
        body: { email: "nope@example.com" },
      });
      assert.equal(status, 400);
    });
  });

  // ------------------------------------------------------------------
  // GET /api/auth/me
  // ------------------------------------------------------------------
  describe("GET /api/auth/me", () => {
    test("returns user data for a valid token", async () => {
      const { userId, token } = await seedTestUser(db);
      const { status, body } = await request(app, "GET", "/api/auth/me", { token });
      assert.equal(status, 200);
      assert.equal((body as any).user?.id, userId);
    });

    test("returns 401 without a token", async () => {
      const { status } = await request(app, "GET", "/api/auth/me");
      assert.equal(status, 401);
    });

    test("returns 401 for a tampered token", async () => {
      const { status } = await request(app, "GET", "/api/auth/me", {
        token: "totally.fake.jwt",
      });
      assert.equal(status, 401);
    });

    test("returns 401 for a token signed with the wrong secret", async () => {
      const jwtMod = await import("jsonwebtoken");
      const sign = (jwtMod.default ?? jwtMod).sign as typeof import("jsonwebtoken").sign;
      const badToken = sign({ userId: 1 }, "wrong-secret");
      const { status } = await request(app, "GET", "/api/auth/me", { token: badToken });
      assert.equal(status, 401);
    });
  });

  // ------------------------------------------------------------------
  // PATCH /api/auth/me
  // ------------------------------------------------------------------
  describe("PATCH /api/auth/me", () => {
    test("updates user name", async () => {
      const { token } = await seedTestUser(db, { email: "patch@example.com" });
      const { status, body } = await request(app, "PATCH", "/api/auth/me", {
        token,
        body: { name: "Updated Name" },
      });
      assert.equal(status, 200);
      assert.equal((body as any).user?.name, "Updated Name");
    });

    test("returns 401 without auth", async () => {
      const { status } = await request(app, "PATCH", "/api/auth/me", {
        body: { name: "Hacker" },
      });
      assert.equal(status, 401);
    });
  });

  // ------------------------------------------------------------------
  // PATCH /api/users/:id/password
  // ------------------------------------------------------------------
  describe("PATCH /api/users/:id/password", () => {
    test("changes password with correct current password", async () => {
      const { userId, token } = await seedTestUser(db, {
        email: "pw@example.com",
        password: "OldPass1!",
      });

      const { status } = await request(app, "PATCH", `/api/users/${userId}/password`, {
        token,
        body: { currentPassword: "OldPass1!", newPassword: "NewPass2!" },
      });
      assert.equal(status, 200);
    });

    test("rejects password change with incorrect current password", async () => {
      const { userId, token } = await seedTestUser(db, {
        email: "pw2@example.com",
        password: "OldPass1!",
      });

      const { status } = await request(app, "PATCH", `/api/users/${userId}/password`, {
        token,
        body: { currentPassword: "WrongOld!", newPassword: "NewPass2!" },
      });
      assert.equal(status, 400);
    });

    test("returns 403 when user tries to change another user's password", async () => {
      const { token } = await seedTestUser(db, { email: "a@example.com" });
      const other = await seedTestUser(db, { email: "b@example.com" });

      const { status } = await request(app, "PATCH", `/api/users/${other.userId}/password`, {
        token,
        body: { currentPassword: "Pass1!", newPassword: "NewPass2!" },
      });
      assert.equal(status, 403);
    });
  });
});
