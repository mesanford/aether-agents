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

test("registerAiRoutes rejects oversized live email context before model invocation", async () => {
  const { app, getRoute } = createMockApp();
  let modelCallCount = 0;

  registerAiRoutes({
    app: app as any,
    aiClient: {
      models: {
        async generateContent() {
          modelCallCount += 1;
          return { text: "ignored" };
        },
      },
    } as any,
    requireAuth: createPassThroughMiddleware() as any,
    requireWorkspaceAccess: createPassThroughMiddleware() as any,
    aiRateLimiter: createPassThroughMiddleware() as any,
    isNonEmptyString,
    buildDataAccessSection: () => "data access",
    buildLiveDataSection: () => "live data",
  });

  const req = {
    body: {
      role: "Executive Assistant",
      message: "Hello",
      liveContext: {
        emails: Array.from({ length: 51 }, (_, index) => ({
          from: `sender-${index}@example.com`,
          subject: `Subject ${index}`,
          date: "2026-03-13",
          snippet: "snippet",
        })),
      },
    },
  };
  const res = createMockRes();

  await invokeHandlers(getRoute("POST", "/api/workspaces/:id/ai/respond"), req, res);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "liveContext.emails exceeds 50 items" });
  assert.equal(modelCallCount, 0);
});

test("registerAiRoutes responds with generated image data when image prompt JSON is returned", async () => {
  const { app, getRoute } = createMockApp();
  let modelCallCount = 0;

  registerAiRoutes({
    app: app as any,
    aiClient: {
      models: {
        async generateContent({ model }: { model: string }) {
          modelCallCount += 1;

          if (model === "gemini-3-flash-preview") {
            return {
              text: "```json\n{\"imagePrompt\":\"Create a dashboard\"}\n```",
            };
          }

          return {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        data: "ZmFrZS1pbWFnZS1ieXRlcw==",
                      },
                    },
                  ],
                },
              },
            ],
          };
        },
      },
    } as any,
    requireAuth: createPassThroughMiddleware() as any,
    requireWorkspaceAccess: createPassThroughMiddleware() as any,
    aiRateLimiter: createPassThroughMiddleware() as any,
    isNonEmptyString,
    buildDataAccessSection: () => "data access",
    buildLiveDataSection: () => "live data",
  });

  const req = {
    body: {
      role: "Executive Assistant",
      message: "Generate an image",
      canGenerateImage: true,
    },
  };
  const res = createMockRes();

  await invokeHandlers(getRoute("POST", "/api/workspaces/:id/ai/respond"), req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    text: "```json\n{\"imagePrompt\":\"Create a dashboard\"}\n```",
    imageUrl: "data:image/png;base64,ZmFrZS1pbWFnZS1ieXRlcw==",
  });
  assert.equal(modelCallCount, 2);
});

test("registerAiRoutes rejects invalid orchestrator agent lists before model invocation", async () => {
  const { app, getRoute } = createMockApp();
  let modelCallCount = 0;

  registerAiRoutes({
    app: app as any,
    aiClient: {
      models: {
        async generateContent() {
          modelCallCount += 1;
          return { text: '{"plan":[]}' };
        },
      },
    } as any,
    requireAuth: createPassThroughMiddleware() as any,
    requireWorkspaceAccess: createPassThroughMiddleware() as any,
    aiRateLimiter: createPassThroughMiddleware() as any,
    isNonEmptyString,
    buildDataAccessSection: () => "data access",
    buildLiveDataSection: () => "live data",
  });

  const req = {
    body: {
      taskDescription: "Plan this task",
      agents: [],
    },
  };
  const res = createMockRes();

  await invokeHandlers(getRoute("POST", "/api/workspaces/:id/ai/orchestrate"), req, res);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "agents must be a non-empty array of strings" });
  assert.equal(modelCallCount, 0);
});

test("registerAiRoutes parses orchestrator JSON response", async () => {
  const { app, getRoute } = createMockApp();

  registerAiRoutes({
    app: app as any,
    aiClient: {
      models: {
        async generateContent() {
          return {
            text: JSON.stringify({
              plan: [
                { agentId: "executive-assistant", action: "Triage inbox", priority: "high" },
              ],
            }),
          };
        },
      },
    } as any,
    requireAuth: createPassThroughMiddleware() as any,
    requireWorkspaceAccess: createPassThroughMiddleware() as any,
    aiRateLimiter: createPassThroughMiddleware() as any,
    isNonEmptyString,
    buildDataAccessSection: () => "data access",
    buildLiveDataSection: () => "live data",
  });

  const req = {
    body: {
      taskDescription: "Run daily operations",
      agents: ["executive-assistant"],
    },
  };
  const res = createMockRes();

  await invokeHandlers(getRoute("POST", "/api/workspaces/:id/ai/orchestrate"), req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    plan: [
      { agentId: "executive-assistant", action: "Triage inbox", priority: "high" },
    ],
  });
});