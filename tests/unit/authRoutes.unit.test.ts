import test from "node:test";
import assert from "node:assert/strict";
import { registerAuthRoutes } from "../../src/server/routes/authRoutes.ts";

type MockHandler = (req: any, res: any, next: () => void | Promise<void>) => unknown;

function createMockRes() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    send(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

function createMockApp() {
  const routes = new Map<string, MockHandler[]>();

  return {
    app: {
      get(path: string, ...handlers: MockHandler[]) {
        routes.set(`GET ${path}`, handlers);
      },
      post(path: string, ...handlers: MockHandler[]) {
        routes.set(`POST ${path}`, handlers);
      },
      patch(path: string, ...handlers: MockHandler[]) {
        routes.set(`PATCH ${path}`, handlers);
      },
      delete(path: string, ...handlers: MockHandler[]) {
        routes.set(`DELETE ${path}`, handlers);
      },
    },
    getRoute(method: string, path: string) {
      const handlers = routes.get(`${method} ${path}`);
      assert.ok(handlers, `Route ${method} ${path} was not registered`);
      return handlers;
    },
  };
}

async function invokeHandlers(handlers: MockHandler[], req: any, res: any) {
  const dispatch = async (index: number): Promise<void> => {
    const handler = handlers[index];
    if (!handler) return;
    await Promise.resolve(handler(req, res, () => dispatch(index + 1)));
  };

  await dispatch(0);
}

function createPassThroughMiddleware(): MockHandler {
  return (_req, _res, next) => {
    next();
  };
}

test("registerAuthRoutes login returns 401 for Google-only account without password hash", async () => {
  const { app, getRoute } = createMockApp();

  const db = {
    prepare: (_sql: string) => ({
      get: (email: string) => ({
        id: 1,
        email,
        name: "Google User",
        password: null,
        google_id: "google-123",
      }),
      run: () => ({ lastInsertRowid: 1 }),
    }),
  };

  registerAuthRoutes({
    app: app as any,
    db: db as any,
    jwtSecret: "test-secret",
    authRateLimiter: createPassThroughMiddleware() as any,
    seedWorkspace: () => {},
  });

  const req = {
    body: {
      email: "google.user@example.com",
      password: "does-not-matter",
    },
  };
  const res = createMockRes();

  await invokeHandlers(getRoute("POST", "/api/auth/login"), req, res);

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, {
    error: "This account uses Google sign-in. Please continue with Google.",
  });
});
