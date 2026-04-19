/**
 * tests/unit/security.test.ts
 * Unit tests for createSecurityTools — requireAuth, requireWorkspaceAccess,
 * requireWorkspaceRole, and createRateLimiter.
 *
 * These tests call the middleware functions directly (no HTTP overhead).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import type { Request, Response } from "express";
import { createSecurityTools } from "../../src/server/security.ts";

const JWT_SECRET = "test-jwt-secret";

// ---------------------------------------------------------------------------
// Minimal stubs
// ---------------------------------------------------------------------------

type FakeRow = { role: string; owner_id?: number };
type FakeStmt = { get: (...args: unknown[]) => Promise<FakeRow | undefined>; run: (...args: unknown[]) => Promise<{ changes: number }> };

function makeMockDb(opts: {
  memberRole?: string | null;
  workspaceOwner?: number | null;
} = {}): any {
  return {
    prepare: (sql: string): FakeStmt => {
      if (sql.includes("workspace_members")) {
        return {
          get: async (..._args: unknown[]) => {
            if (opts.memberRole == null) return undefined;
            return { role: opts.memberRole };
          },
          run: async () => ({ changes: 1 }),
        };
      }
      if (sql.includes("workspaces")) {
        return {
          get: async (..._args: unknown[]) => {
            if (opts.workspaceOwner == null) return undefined;
            return { owner_id: opts.workspaceOwner };
          },
          run: async () => ({ changes: 1 }),
        };
      }
      return {
        get: async () => undefined,
        run: async () => ({ changes: 0 }),
      };
    },
  };
}

function makeReq(opts: {
  token?: string;
  params?: Record<string, string>;
  workspaceRole?: string;
  userId?: number;
} = {}): any {
  return {
    headers: { authorization: opts.token ? `Bearer ${opts.token}` : undefined },
    params: opts.params ?? {},
    workspaceRole: opts.workspaceRole,
    userId: opts.userId,
    ip: "127.0.0.1",
  };
}

function makeRes(): any {
  const res: any = {
    _status: 0,
    _json: null,
    _headers: {} as Record<string, string>,
  };
  res.status = (code: number) => { res._status = code; return res; };
  res.json = (data: unknown) => { res._json = data; return res; };
  res.setHeader = (k: string, v: string) => { res._headers[k] = v; };
  return res;
}

const noop = () => {};

// ---------------------------------------------------------------------------
// requireAuth
// ---------------------------------------------------------------------------

describe("requireAuth", () => {
  const { requireAuth } = createSecurityTools(makeMockDb(), JWT_SECRET);

  test("calls next() for a valid Bearer token", () => {
    const token = jwt.sign({ userId: 7 }, JWT_SECRET);
    const req = makeReq({ token });
    const res = makeRes();
    let called = false;
    requireAuth(req, res, () => { called = true; });
    assert.ok(called, "next() should be called");
    assert.equal(req.userId, 7);
  });

  test("returns 401 when Authorization header is absent", () => {
    const req = makeReq();
    const res = makeRes();
    requireAuth(req, res, noop);
    assert.equal(res._status, 401);
    assert.ok(res._json?.error);
  });

  test("returns 401 for a malformed token", () => {
    const req = makeReq({ token: "not.a.real.jwt" });
    const res = makeRes();
    requireAuth(req, res, noop);
    assert.equal(res._status, 401);
  });

  test("returns 401 for a token signed with wrong secret", () => {
    const token = jwt.sign({ userId: 1 }, "wrong-secret");
    const req = makeReq({ token });
    const res = makeRes();
    requireAuth(req, res, noop);
    assert.equal(res._status, 401);
  });

  test("returns 401 when token lacks userId claim", () => {
    const token = jwt.sign({ sub: "not-a-user-id" }, JWT_SECRET);
    const req = makeReq({ token });
    const res = makeRes();
    requireAuth(req, res, noop);
    assert.equal(res._status, 401);
  });

  test("returns 401 for an expired token", () => {
    // Sign with -1s so it's already expired
    const token = jwt.sign({ userId: 1 }, JWT_SECRET, { expiresIn: -1 });
    const req = makeReq({ token });
    const res = makeRes();
    requireAuth(req, res, noop);
    assert.equal(res._status, 401);
  });
});

// ---------------------------------------------------------------------------
// requireWorkspaceAccess
// ---------------------------------------------------------------------------

describe("requireWorkspaceAccess", () => {
  test("calls next() when user is a workspace member", async () => {
    const db = makeMockDb({ memberRole: "owner" });
    const { requireWorkspaceAccess } = createSecurityTools(db, JWT_SECRET);

    const req = makeReq({ userId: 1, params: { id: "5" } });
    const res = makeRes();
    let called = false;
    await requireWorkspaceAccess(req, res, () => { called = true; });
    assert.ok(called);
    assert.equal(req.workspaceId, 5);
    assert.equal(req.workspaceRole, "owner");
  });

  test("auto-recovers workspace ownership when member row is missing", async () => {
    // No member row, but workspace.owner_id matches req.userId
    const db = makeMockDb({ memberRole: null, workspaceOwner: 42 });
    const { requireWorkspaceAccess } = createSecurityTools(db, JWT_SECRET);

    const req = makeReq({ userId: 42, params: { id: "5" } });
    const res = makeRes();
    let called = false;
    await requireWorkspaceAccess(req, res, () => { called = true; });
    assert.ok(called, "should recover ownership and call next()");
  });

  test("returns 403 when user has no access", async () => {
    const db = makeMockDb({ memberRole: null, workspaceOwner: 99 });
    const { requireWorkspaceAccess } = createSecurityTools(db, JWT_SECRET);

    const req = makeReq({ userId: 1, params: { id: "5" } });
    const res = makeRes();
    await requireWorkspaceAccess(req, res, noop);
    assert.equal(res._status, 403);
  });

  test("returns 400 when workspaceId param is not a number", async () => {
    const db = makeMockDb({ memberRole: "owner" });
    const { requireWorkspaceAccess } = createSecurityTools(db, JWT_SECRET);

    const req = makeReq({ userId: 1, params: { id: "abc" } });
    const res = makeRes();
    await requireWorkspaceAccess(req, res, noop);
    assert.equal(res._status, 400);
  });
});

// ---------------------------------------------------------------------------
// requireWorkspaceRole
// ---------------------------------------------------------------------------

describe("requireWorkspaceRole", () => {
  const { requireWorkspaceRole } = createSecurityTools(makeMockDb(), JWT_SECRET);

  test("calls next() when role is in allowedRoles", () => {
    const middleware = requireWorkspaceRole("owner", "admin");
    const req = makeReq({ workspaceRole: "admin" });
    const res = makeRes();
    let called = false;
    middleware(req, res, () => { called = true; });
    assert.ok(called);
  });

  test("returns 403 when role is not in allowedRoles", () => {
    const middleware = requireWorkspaceRole("owner");
    const req = makeReq({ workspaceRole: "member" });
    const res = makeRes();
    middleware(req, res, noop);
    assert.equal(res._status, 403);
  });

  test("returns 403 when workspaceRole is undefined", () => {
    const middleware = requireWorkspaceRole("owner");
    const req = makeReq();
    const res = makeRes();
    middleware(req, res, noop);
    assert.equal(res._status, 403);
  });

  test("exact role match — owner matches ['owner']", () => {
    const middleware = requireWorkspaceRole("owner");
    const req = makeReq({ workspaceRole: "owner" });
    const res = makeRes();
    let called = false;
    middleware(req, res, () => { called = true; });
    assert.ok(called);
  });
});

// ---------------------------------------------------------------------------
// createRateLimiter
// ---------------------------------------------------------------------------

describe("createRateLimiter", () => {
  test("allows requests within the limit", () => {
    const { createRateLimiter } = createSecurityTools(makeMockDb(), JWT_SECRET);
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3, keyPrefix: "test" });
    const token = jwt.sign({ userId: 1 }, JWT_SECRET);
    const req = makeReq({ token });

    let nextCount = 0;
    for (let i = 0; i < 3; i++) {
      const res = makeRes();
      limiter(req, res, () => { nextCount++; });
    }
    assert.equal(nextCount, 3, "should allow exactly 3 requests");
  });

  test("blocks requests exceeding the limit and returns 429", () => {
    const { createRateLimiter } = createSecurityTools(makeMockDb(), JWT_SECRET);
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2, keyPrefix: "ratelimit-test" });
    const token = jwt.sign({ userId: 9 }, JWT_SECRET);
    const req = makeReq({ token });

    let blocked = 0;
    for (let i = 0; i < 5; i++) {
      const res = makeRes();
      limiter(req, res, () => {});
      if (res._status === 429) blocked++;
    }
    assert.equal(blocked, 3, "3 out of 5 requests should be blocked");
  });

  test("sets Retry-After header on 429", () => {
    const { createRateLimiter } = createSecurityTools(makeMockDb(), JWT_SECRET);
    const limiter = createRateLimiter({ windowMs: 5_000, max: 1, keyPrefix: "retry-after-test" });
    const token = jwt.sign({ userId: 10 }, JWT_SECRET);
    const req = makeReq({ token });

    limiter(req, makeRes(), () => {}); // allowed
    const blockedRes = makeRes();
    limiter(req, blockedRes, () => {});

    assert.equal(blockedRes._status, 429);
    assert.ok(blockedRes._headers["Retry-After"], "Retry-After header should be set");
  });

  test("isolates rate limit windows by user", () => {
    const { createRateLimiter } = createSecurityTools(makeMockDb(), JWT_SECRET);
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, keyPrefix: "user-isolation" });

    const t1 = jwt.sign({ userId: 100 }, JWT_SECRET);
    const t2 = jwt.sign({ userId: 200 }, JWT_SECRET);

    // Use up user 100's quota
    limiter(makeReq({ token: t1 }), makeRes(), () => {});
    const blocked = makeRes();
    limiter(makeReq({ token: t1 }), blocked, () => {});
    assert.equal(blocked._status, 429);

    // user 200 should still be allowed
    const ok = makeRes();
    let called = false;
    limiter(makeReq({ token: t2 }), ok, () => { called = true; });
    assert.ok(called, "user 200 should not be rate-limited");
  });
});
