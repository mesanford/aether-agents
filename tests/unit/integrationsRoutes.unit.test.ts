import test from "node:test";
import assert from "node:assert/strict";
import { registerIntegrationsRoutes } from "../../src/server/routes/integrationsRoutes.ts";

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
      put(path: string, ...handlers: MockHandler[]) {
        routes.set(`PUT ${path}`, handlers);
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
  return (req, _res, next) => {
    req.workspaceId = req.workspaceId || Number(req.params?.id || 1);
    return next();
  };
}

test("registerIntegrationsRoutes stores verified WordPress credentials per workspace", async () => {
  const { app, getRoute } = createMockApp();
  const runs: Array<{ sql: string; args: unknown[] }> = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({ name: "Marcus" }),
  })) as any;

  try {
    registerIntegrationsRoutes({
      app: app as any,
      db: {
        prepare(sql: string) {
          return {
            get() {
              return undefined;
            },
            run(...args: unknown[]) {
              runs.push({ sql, args });
              return { changes: 1 };
            },
          };
        },
      } as any,
      googleClientId: "google-client-id",
      googleClientSecret: "google-client-secret",
      getUserIdFromRequest: () => 7,
      requireAuth: createPassThroughMiddleware() as any,
      requireWorkspaceAccess: createPassThroughMiddleware() as any,
      requireWorkspaceRole: () => createPassThroughMiddleware() as any,
    });

    const req = {
      params: { id: "9" },
      workspaceId: 9,
      body: {
        siteUrl: "example.com/",
        username: "editor",
        appPassword: "abcd efgh ijkl mnop",
      },
    };
    const res = createMockRes();

    await invokeHandlers(getRoute("POST", "/api/workspaces/:id/integrations/wordpress"), req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      connected: true,
      siteUrl: "https://example.com",
      userDisplayName: "Marcus",
    });
    assert.ok(runs.some((entry) => entry.sql.includes("INSERT INTO wordpress_connections")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("registerIntegrationsRoutes stores verified HubSpot credentials per workspace", async () => {
  const { app, getRoute } = createMockApp();
  const runs: Array<{ sql: string; args: unknown[] }> = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("account-info/v3/details")) {
      return {
        ok: true,
        json: async () => ({ portalId: 123456, companyName: "Sandbox Portal" }),
      } as any;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as any;

  try {
    registerIntegrationsRoutes({
      app: app as any,
      db: {
        prepare(sql: string) {
          return {
            get() {
              return undefined;
            },
            run(...args: unknown[]) {
              runs.push({ sql, args });
              return { changes: 1 };
            },
          };
        },
      } as any,
      googleClientId: "google-client-id",
      googleClientSecret: "google-client-secret",
      getUserIdFromRequest: () => 7,
      requireAuth: createPassThroughMiddleware() as any,
      requireWorkspaceAccess: createPassThroughMiddleware() as any,
      requireWorkspaceRole: () => createPassThroughMiddleware() as any,
    });

    const req = {
      params: { id: "9" },
      workspaceId: 9,
      body: {
        accessToken: "hubspot-private-app-token",
      },
    };
    const res = createMockRes();

    await invokeHandlers(getRoute("POST", "/api/workspaces/:id/integrations/hubspot"), req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      connected: true,
      portalId: 123456,
      accountName: "Sandbox Portal",
    });
    assert.ok(runs.some((entry) => entry.sql.includes("INSERT INTO hubspot_connections")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("registerIntegrationsRoutes stores verified LinkedIn credentials per workspace", async () => {
  const { app, getRoute } = createMockApp();
  const runs: Array<{ sql: string; args: unknown[] }> = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("linkedin.com/v2/userinfo")) {
      return {
        ok: true,
        json: async () => ({ sub: "member-123", name: "Marcus Sanford" }),
      } as any;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as any;

  try {
    registerIntegrationsRoutes({
      app: app as any,
      db: {
        prepare(sql: string) {
          return {
            get() {
              return undefined;
            },
            run(...args: unknown[]) {
              runs.push({ sql, args });
              return { changes: 1 };
            },
          };
        },
      } as any,
      googleClientId: "google-client-id",
      googleClientSecret: "google-client-secret",
      getUserIdFromRequest: () => 7,
      requireAuth: createPassThroughMiddleware() as any,
      requireWorkspaceAccess: createPassThroughMiddleware() as any,
      requireWorkspaceRole: () => createPassThroughMiddleware() as any,
    });

    const req = {
      params: { id: "9" },
      workspaceId: 9,
      body: {
        accessToken: "linkedin-token",
      },
    };
    const res = createMockRes();

    await invokeHandlers(getRoute("POST", "/api/workspaces/:id/integrations/linkedin"), req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      connected: true,
      authorUrn: "urn:li:person:member-123",
      accountName: "Marcus Sanford",
    });
    assert.ok(runs.some((entry) => entry.sql.includes("INSERT INTO linkedin_connections")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("registerIntegrationsRoutes stores verified Buffer credentials per workspace", async () => {
  const { app, getRoute } = createMockApp();
  const runs: Array<{ sql: string; args: unknown[] }> = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("api.bufferapp.com/1/profiles.json")) {
      return {
        ok: true,
        json: async () => ([
          {
            id: "profile-1",
            service: "linkedin",
            service_username: "marcus-sanford",
            formatted_username: "@marcus-sanford",
            default: true,
          },
        ]),
      } as any;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as any;

  try {
    registerIntegrationsRoutes({
      app: app as any,
      db: {
        prepare(sql: string) {
          return {
            get() {
              return undefined;
            },
            run(...args: unknown[]) {
              runs.push({ sql, args });
              return { changes: 1 };
            },
          };
        },
      } as any,
      googleClientId: "google-client-id",
      googleClientSecret: "google-client-secret",
      getUserIdFromRequest: () => 7,
      requireAuth: createPassThroughMiddleware() as any,
      requireWorkspaceAccess: createPassThroughMiddleware() as any,
      requireWorkspaceRole: () => createPassThroughMiddleware() as any,
    });

    const req = {
      params: { id: "9" },
      workspaceId: 9,
      body: {
        accessToken: "buffer-token",
      },
    };
    const res = createMockRes();

    await invokeHandlers(getRoute("POST", "/api/workspaces/:id/integrations/buffer"), req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      connected: true,
      profiles: [{
        id: "profile-1",
        service: "linkedin",
        serviceUsername: "marcus-sanford",
        formattedUsername: "@marcus-sanford",
        isDefault: true,
      }],
    });
    assert.ok(runs.some((entry) => entry.sql.includes("INSERT INTO buffer_connections")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("registerIntegrationsRoutes stores verified Slack credentials per workspace", async () => {
  const { app, getRoute } = createMockApp();
  const runs: Array<{ sql: string; args: unknown[] }> = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("slack.com/api/auth.test")) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          team_id: "T123456",
          team: "Sanford Team",
          user_id: "U123456",
        }),
      } as any;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as any;

  try {
    registerIntegrationsRoutes({
      app: app as any,
      db: {
        prepare(sql: string) {
          return {
            get() {
              return undefined;
            },
            run(...args: unknown[]) {
              runs.push({ sql, args });
              return { changes: 1 };
            },
          };
        },
      } as any,
      googleClientId: "google-client-id",
      googleClientSecret: "google-client-secret",
      getUserIdFromRequest: () => 7,
      requireAuth: createPassThroughMiddleware() as any,
      requireWorkspaceAccess: createPassThroughMiddleware() as any,
      requireWorkspaceRole: () => createPassThroughMiddleware() as any,
    });

    const req = {
      params: { id: "9" },
      workspaceId: 9,
      userId: 3,
      body: {
        botToken: "xoxb-test-token",
        defaultChannel: "#alerts",
      },
    };
    const res = createMockRes();

    await invokeHandlers(getRoute("POST", "/api/workspaces/:id/integrations/slack"), req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      connected: true,
      defaultChannel: "#alerts",
      teamId: "T123456",
      teamName: "Sanford Team",
      botUserId: "U123456",
    });
    assert.ok(runs.some((entry) => entry.sql.includes("INSERT INTO slack_connections")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("registerIntegrationsRoutes stores verified Teams webhook per workspace", async () => {
  const { app, getRoute } = createMockApp();
  const runs: Array<{ sql: string; args: unknown[] }> = [];

  registerIntegrationsRoutes({
    app: app as any,
    db: {
      prepare(sql: string) {
        return {
          get() {
            return undefined;
          },
          run(...args: unknown[]) {
            runs.push({ sql, args });
            return { changes: 1 };
          },
        };
      },
    } as any,
    googleClientId: "google-client-id",
    googleClientSecret: "google-client-secret",
    getUserIdFromRequest: () => 7,
    requireAuth: createPassThroughMiddleware() as any,
    requireWorkspaceAccess: createPassThroughMiddleware() as any,
    requireWorkspaceRole: () => createPassThroughMiddleware() as any,
  });

  const req = {
    params: { id: "9" },
    workspaceId: 9,
    userId: 3,
    body: {
      webhookUrl: "https://example.webhook.office.com/webhookb2/abc123/IncomingWebhook/xyz789",
      defaultChannelName: "Operations",
    },
  };
  const res = createMockRes();

  await invokeHandlers(getRoute("POST", "/api/workspaces/:id/integrations/teams"), req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    connected: true,
    defaultChannelName: "Operations",
  });
  assert.ok(runs.some((entry) => entry.sql.includes("INSERT INTO teams_connections")));
});

test("registerIntegrationsRoutes stores verified Notion credentials per workspace", async () => {
  const { app, getRoute } = createMockApp();
  const runs: Array<{ sql: string; args: unknown[] }> = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("api.notion.com/v1/users/me")) {
      return {
        ok: true,
        json: async () => ({
          object: "user",
          name: "Aether Workspace",
        }),
      } as any;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as any;

  try {
    registerIntegrationsRoutes({
      app: app as any,
      db: {
        prepare(sql: string) {
          return {
            get() {
              return undefined;
            },
            run(...args: unknown[]) {
              runs.push({ sql, args });
              return { changes: 1 };
            },
          };
        },
      } as any,
      googleClientId: "google-client-id",
      googleClientSecret: "google-client-secret",
      getUserIdFromRequest: () => 7,
      requireAuth: createPassThroughMiddleware() as any,
      requireWorkspaceAccess: createPassThroughMiddleware() as any,
      requireWorkspaceRole: () => createPassThroughMiddleware() as any,
    });

    const req = {
      params: { id: "9" },
      workspaceId: 9,
      userId: 3,
      body: {
        integrationToken: "secret_notion_token",
        defaultParentPageId: "page-abc-123",
      },
    };
    const res = createMockRes();

    await invokeHandlers(getRoute("POST", "/api/workspaces/:id/integrations/notion"), req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      connected: true,
      botName: "Aether Workspace",
      defaultParentPageId: "page-abc-123",
    });
    assert.ok(runs.some((entry) => entry.sql.includes("INSERT INTO notion_connections")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("registerIntegrationsRoutes publishes a LinkedIn image post when imageUrl is provided", async () => {
  const { app, getRoute } = createMockApp();
  const fetchCalls: Array<{ url: string; options?: RequestInit }> = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    fetchCalls.push({ url, options: init });

    if (url.includes("linkedin.com/v2/assets?action=registerUpload")) {
      return {
        ok: true,
        json: async () => ({
          value: {
            asset: "urn:li:digitalmediaAsset:C4D00AAA",
            uploadMechanism: {
              "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest": {
                uploadUrl: "https://uploads.linkedin.test/assets/123",
              },
            },
          },
        }),
      } as any;
    }

    if (url === "https://cdn.example.com/social/hero.png") {
      return {
        ok: true,
        headers: {
          get(name: string) {
            return name.toLowerCase() === "content-type" ? "image/png" : null;
          },
        },
        arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
      } as any;
    }

    if (url === "https://uploads.linkedin.test/assets/123") {
      return {
        ok: true,
        text: async () => "",
      } as any;
    }

    if (url.includes("linkedin.com/v2/ugcPosts")) {
      return {
        ok: true,
        headers: {
          get(name: string) {
            return /x-restli-id/i.test(name) ? "ugc-post-123" : null;
          },
        },
      } as any;
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as any;

  try {
    registerIntegrationsRoutes({
      app: app as any,
      db: {
        prepare(_sql: string) {
          return {
            get() {
              return {
                access_token: "linkedin-access-token",
                author_urn: "urn:li:person:member-123",
              };
            },
            run() {
              return { changes: 1 };
            },
          };
        },
      } as any,
      googleClientId: "google-client-id",
      googleClientSecret: "google-client-secret",
      getUserIdFromRequest: () => 7,
      requireAuth: createPassThroughMiddleware() as any,
      requireWorkspaceAccess: createPassThroughMiddleware() as any,
      requireWorkspaceRole: () => createPassThroughMiddleware() as any,
    });

    const req = {
      params: { id: "9" },
      workspaceId: 9,
      body: {
        text: "Spring launch is live.",
        imageUrl: "https://cdn.example.com/social/hero.png",
        title: "Spring launch",
        description: "New campaign creative",
      },
    };
    const res = createMockRes();

    await invokeHandlers(getRoute("POST", "/api/workspaces/:id/integrations/linkedin/post"), req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true, postId: "ugc-post-123" });

    const publishCall = fetchCalls.find((call) => call.url.includes("linkedin.com/v2/ugcPosts"));
    assert.ok(publishCall);
    const body = JSON.parse(String(publishCall?.options?.body || "{}"));
    assert.equal(body.specificContent["com.linkedin.ugc.ShareContent"].shareMediaCategory, "IMAGE");
    assert.equal(body.specificContent["com.linkedin.ugc.ShareContent"].media[0].media, "urn:li:digitalmediaAsset:C4D00AAA");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("registerIntegrationsRoutes sends a Buffer photo update when imageUrl is provided", async () => {
  const { app, getRoute } = createMockApp();
  const fetchCalls: Array<{ url: string; options?: RequestInit }> = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    fetchCalls.push({ url, options: init });

    if (url.includes("api.bufferapp.com/1/updates/create.json")) {
      return {
        ok: true,
        json: async () => ({ success: true, updates: [{ id: "update-1", profile_id: "profile-1", status: "pending" }] }),
      } as any;
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as any;

  try {
    registerIntegrationsRoutes({
      app: app as any,
      db: {
        prepare(_sql: string) {
          return {
            get() {
              return {
                access_token: "buffer-access-token",
              };
            },
            run() {
              return { changes: 1 };
            },
          };
        },
      } as any,
      googleClientId: "google-client-id",
      googleClientSecret: "google-client-secret",
      getUserIdFromRequest: () => 7,
      requireAuth: createPassThroughMiddleware() as any,
      requireWorkspaceAccess: createPassThroughMiddleware() as any,
      requireWorkspaceRole: () => createPassThroughMiddleware() as any,
    });

    const req = {
      params: { id: "9" },
      workspaceId: 9,
      body: {
        profileIds: ["profile-1"],
        text: "Queued with image",
        imageUrl: "https://cdn.example.com/social/hero.png",
      },
    };
    const res = createMockRes();

    await invokeHandlers(getRoute("POST", "/api/workspaces/:id/integrations/buffer/updates"), req, res);

    assert.equal(res.statusCode, 200);
    const bufferCall = fetchCalls.find((call) => call.url.includes("api.bufferapp.com/1/updates/create.json"));
    assert.ok(bufferCall);
    assert.match(String(bufferCall?.options?.body || ""), /media%5Bphoto%5D=https%3A%2F%2Fcdn\.example\.com%2Fsocial%2Fhero\.png/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("registerIntegrationsRoutes upserts workspace Google defaults", async () => {
  const { app, getRoute } = createMockApp();
  const runs: Array<{ sql: string; args: unknown[] }> = [];

  registerIntegrationsRoutes({
    app: app as any,
    db: {
      prepare(sql: string) {
        return {
          get() {
            return undefined;
          },
          run(...args: unknown[]) {
            runs.push({ sql, args });
            return { changes: 1 };
          },
        };
      },
    } as any,
    googleClientId: "google-client-id",
    googleClientSecret: "google-client-secret",
    getUserIdFromRequest: () => 7,
    requireAuth: createPassThroughMiddleware() as any,
    requireWorkspaceAccess: createPassThroughMiddleware() as any,
    requireWorkspaceRole: () => createPassThroughMiddleware() as any,
  });

  const req = {
    params: { id: "9" },
    workspaceId: 9,
    body: {
      analyticsPropertyId: "123456789",
      searchConsoleSiteUrl: "https://example.com/",
    },
  };
  const res = createMockRes();

  await invokeHandlers(getRoute("PUT", "/api/workspaces/:id/integrations/google/defaults"), req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    success: true,
    analyticsPropertyId: "123456789",
    searchConsoleSiteUrl: "https://example.com/",
  });
  assert.ok(runs.some((entry) => entry.sql.includes("INSERT INTO workspace_google_defaults")));
});

test("registerIntegrationsRoutes rotates provider webhook secrets", async () => {
  const { app, getRoute } = createMockApp();
  const runs: Array<{ sql: string; args: unknown[] }> = [];

  registerIntegrationsRoutes({
    app: app as any,
    db: {
      prepare(sql: string) {
        return {
          get() {
            return undefined;
          },
          all() {
            return [];
          },
          run(...args: unknown[]) {
            runs.push({ sql, args });
            return { changes: 1 };
          },
        };
      },
    } as any,
    googleClientId: "google-client-id",
    googleClientSecret: "google-client-secret",
    getUserIdFromRequest: () => 7,
    requireAuth: createPassThroughMiddleware() as any,
    requireWorkspaceAccess: createPassThroughMiddleware() as any,
    requireWorkspaceRole: () => createPassThroughMiddleware() as any,
  });

  const req = {
    params: { id: "9", provider: "hubspot" },
    workspaceId: 9,
    userId: 3,
  };
  const res = createMockRes();

  await invokeHandlers(getRoute("POST", "/api/workspaces/:id/integrations/webhooks/secrets/:provider/rotate"), req, res);

  assert.equal(res.statusCode, 200);
  const body = res.body as any;
  assert.equal(body.success, true);
  assert.equal(body.provider, "hubspot");
  assert.equal(typeof body.secret, "string");
  assert.ok(String(body.secret).length >= 32);
  assert.ok(runs.some((entry) => entry.sql.includes("UPDATE workspace_webhook_secrets SET is_active = false")));
  assert.ok(runs.some((entry) => entry.sql.includes("INSERT INTO workspace_webhook_secrets")));
});

test("registerIntegrationsRoutes accepts webhook payloads and queues automation jobs", async () => {
  const { app, getRoute } = createMockApp();
  const runs: Array<{ sql: string; args: unknown[] }> = [];

  registerIntegrationsRoutes({
    app: app as any,
    db: {
      prepare(sql: string) {
        return {
          get(...args: unknown[]) {
            if (sql.includes("SELECT secret FROM workspace_webhook_secrets")) {
              return { secret: "secret-abc-123" };
            }
            return undefined;
          },
          all() {
            return [];
          },
          run(...args: unknown[]) {
            runs.push({ sql, args });
            return { changes: 1 };
          },
        };
      },
    } as any,
    googleClientId: "google-client-id",
    googleClientSecret: "google-client-secret",
    getUserIdFromRequest: () => 7,
    requireAuth: createPassThroughMiddleware() as any,
    requireWorkspaceAccess: createPassThroughMiddleware() as any,
    requireWorkspaceRole: () => createPassThroughMiddleware() as any,
  });

  const req = {
    params: { provider: "hubspot", workspaceId: "9" },
    body: { eventType: "contact.creation", objectId: "1234" },
    get(name: string) {
      return name.toLowerCase() === "x-aether-webhook-secret" ? "secret-abc-123" : null;
    },
  };
  const res = createMockRes();

  await invokeHandlers(getRoute("POST", "/api/webhooks/:provider/:workspaceId"), req, res);

  assert.equal(res.statusCode, 202);
  assert.deepEqual(res.body, { accepted: true });
  assert.ok(runs.some((entry) => entry.sql.includes("INTO automation_jobs")));
  assert.ok(runs.some((entry) => entry.sql.includes("INSERT INTO audit_logs")));
});