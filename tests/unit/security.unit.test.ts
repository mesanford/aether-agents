import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { createSecurityTools } from "../../src/server/security.ts";

type MockRes = {
  statusCode: number;
  body: any;
  headers: Record<string, string>;
  status: (code: number) => MockRes;
  json: (payload: any) => MockRes;
  setHeader: (name: string, value: string) => void;
};

function createMockRes(): MockRes {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
  };
}

function createDbWithRole(role?: string) {
  return {
    prepare: () => ({
      get: () => (role ? { role } : undefined),
    }),
  };
}

test("getUserIdFromRequest extracts valid bearer token user id", () => {
  const tools = createSecurityTools(createDbWithRole("owner") as any, "secret");
  const token = jwt.sign({ userId: 123 }, "secret");

  const req = { headers: { authorization: `Bearer ${token}` } } as any;
  assert.equal(tools.getUserIdFromRequest(req), 123);
});

test("requireAuth rejects missing token and accepts valid token", () => {
  const tools = createSecurityTools(createDbWithRole("owner") as any, "secret");

  const reqMissing = { headers: {} } as any;
  const resMissing = createMockRes();
  let nextCalled = false;

  tools.requireAuth(reqMissing, resMissing as any, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(resMissing.statusCode, 401);

  const token = jwt.sign({ userId: 77 }, "secret");
  const reqValid = { headers: { authorization: `Bearer ${token}` } } as any;
  const resValid = createMockRes();
  nextCalled = false;

  tools.requireAuth(reqValid, resValid as any, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(reqValid.userId, 77);
});

test("requireWorkspaceAccess enforces membership and stores role", () => {
  const allowTools = createSecurityTools(createDbWithRole("admin") as any, "secret");
  const reqAllowed = { params: { id: "9" }, userId: 1 } as any;
  const resAllowed = createMockRes();
  let nextCalled = false;

  allowTools.requireWorkspaceAccess(reqAllowed, resAllowed as any, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(reqAllowed.workspaceId, 9);
  assert.equal(reqAllowed.workspaceRole, "admin");

  const denyTools = createSecurityTools(createDbWithRole(undefined) as any, "secret");
  const reqDenied = { params: { id: "9" }, userId: 1 } as any;
  const resDenied = createMockRes();

  denyTools.requireWorkspaceAccess(reqDenied, resDenied as any, () => {
    throw new Error("next should not be called");
  });

  assert.equal(resDenied.statusCode, 403);
});

test("requireWorkspaceRole allows only configured roles", () => {
  const tools = createSecurityTools(createDbWithRole("owner") as any, "secret");
  const middleware = tools.requireWorkspaceRole("owner", "admin");

  const reqAllowed = { workspaceRole: "owner" } as any;
  const resAllowed = createMockRes();
  let allowedNext = false;

  middleware(reqAllowed, resAllowed as any, () => {
    allowedNext = true;
  });
  assert.equal(allowedNext, true);

  const reqDenied = { workspaceRole: "member" } as any;
  const resDenied = createMockRes();
  let deniedNext = false;

  middleware(reqDenied, resDenied as any, () => {
    deniedNext = true;
  });

  assert.equal(deniedNext, false);
  assert.equal(resDenied.statusCode, 403);
});

test("createRateLimiter returns 429 after exceeding threshold", () => {
  const tools = createSecurityTools(createDbWithRole("owner") as any, "secret");
  const limiter = tools.createRateLimiter({ windowMs: 60_000, max: 2, keyPrefix: "unit" });

  const req = { headers: {}, ip: "127.0.0.1" } as any;

  for (let i = 0; i < 2; i += 1) {
    const res = createMockRes();
    let nextCalled = false;
    limiter(req, res as any, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
  }

  const resBlocked = createMockRes();
  let blockedNext = false;
  limiter(req, resBlocked as any, () => {
    blockedNext = true;
  });

  assert.equal(blockedNext, false);
  assert.equal(resBlocked.statusCode, 429);
  assert.equal(typeof resBlocked.headers["Retry-After"], "string");
});
