import test from "node:test";
import assert from "node:assert/strict";
import { registerAiRoutes } from "../../src/server/routes/aiRoutes.ts";
import { isNonEmptyString } from "../../src/server/validators.ts";

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

test("registerAiRoutes rejects /chat request missing threadId or message", async () => {
  const { app, getRoute } = createMockApp();

  registerAiRoutes({
    app: app as any,
    aiClient: null as any,
    requireAuth: createPassThroughMiddleware() as any,
    requireWorkspaceAccess: createPassThroughMiddleware() as any,
    aiRateLimiter: createPassThroughMiddleware() as any,
    isNonEmptyString,
    buildDataAccessSection: () => "data",
    buildLiveDataSection: () => "live",
  });

  // Missing message
  const reqNoMessage = {
    params: { id: "9" },
    body: { threadId: "thread-1" },
  };
  const resNoMessage = createMockRes();
  await invokeHandlers(getRoute("POST", "/api/workspaces/:id/chat"), reqNoMessage, resNoMessage);
  assert.equal(resNoMessage.statusCode, 400);

  // Missing threadId
  const reqNoThread = {
    params: { id: "9" },
    body: { message: "Hello" },
  };
  const resNoThread = createMockRes();
  await invokeHandlers(getRoute("POST", "/api/workspaces/:id/chat"), reqNoThread, resNoThread);
  assert.equal(resNoThread.statusCode, 400);
});

test("registerAiRoutes rejects /chat/history request missing threadId query param", async () => {
  const { app, getRoute } = createMockApp();

  registerAiRoutes({
    app: app as any,
    aiClient: null as any,
    requireAuth: createPassThroughMiddleware() as any,
    requireWorkspaceAccess: createPassThroughMiddleware() as any,
    aiRateLimiter: createPassThroughMiddleware() as any,
    isNonEmptyString,
    buildDataAccessSection: () => "data",
    buildLiveDataSection: () => "live",
  });

  const req = {
    params: { id: "9" },
    query: {},
  };
  const res = createMockRes();
  await invokeHandlers(getRoute("GET", "/api/workspaces/:id/chat/history"), req, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "Missing threadId" });
});

test("registerAiRoutes rejects /scrape-onboarding-insights missing url", async () => {
  const { app, getRoute } = createMockApp();

  registerAiRoutes({
    app: app as any,
    aiClient: null as any,
    requireAuth: createPassThroughMiddleware() as any,
    requireWorkspaceAccess: createPassThroughMiddleware() as any,
    aiRateLimiter: createPassThroughMiddleware() as any,
    isNonEmptyString,
    buildDataAccessSection: () => "data",
    buildLiveDataSection: () => "live",
  });

  const req = {
    params: {},
    body: {},
  };
  const res = createMockRes();
  await invokeHandlers(getRoute("POST", "/api/scrape-onboarding-insights"), req, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "Missing URL param." });
});

test("registerAiRoutes invokes buildLiveDataSection and buildDataAccessSection with body values", async () => {
  const { app, getRoute } = createMockApp();
  const capturedArgs: { liveContext: unknown; connectedServices: unknown } = {
    liveContext: undefined,
    connectedServices: undefined,
  };

  // Patch workflow before importing to avoid real LangGraph invocation:
  // Instead we test that the section builders receive the correct arguments by
  // observing that the route handler reaches those calls before the workflow step.

  registerAiRoutes({
    app: app as any,
    aiClient: null as any,
    requireAuth: createPassThroughMiddleware() as any,
    requireWorkspaceAccess: createPassThroughMiddleware() as any,
    aiRateLimiter: createPassThroughMiddleware() as any,
    isNonEmptyString,
    buildDataAccessSection: (services) => {
      capturedArgs.connectedServices = services;
      return "data-section";
    },
    buildLiveDataSection: (ctx) => {
      capturedArgs.liveContext = ctx;
      return "live-section";
    },
  });

  const liveContext = { emails: [{ from: "a@b.com", subject: "Hi", date: "2026-01-01", snippet: "ok" }] };
  const connectedServices = { googleAnalytics: true };

  // The route will fail at workflow.invoke (no real LangGraph), but section
  // builders execute before that, so we catch the eventual 500 and just
  // assert on the captured arguments.
  const req = {
    params: { id: "9" },
    body: { threadId: "t-1", message: "Go", liveContext, connectedServices },
    userId: 1,
  };
  const res = createMockRes();
  await invokeHandlers(getRoute("POST", "/api/workspaces/:id/chat"), req, res);

  assert.deepEqual(capturedArgs.liveContext, liveContext);
  assert.deepEqual(capturedArgs.connectedServices, connectedServices);
});