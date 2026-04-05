import test from "node:test";
import assert from "node:assert/strict";
import { registerWorkspaceRoutes } from "../../src/server/routes/workspaceRoutes.ts";
import {
  getAllowedAgentUpdate,
  getAllowedMessageCreate,
  getAllowedTaskCreate,
  getAllowedTaskStatusUpdate,
  isNonEmptyString,
} from "../../src/server/validators.ts";

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
  return (_req, _res, next) => {
    next();
  };
}

function createWorkspaceDbMock() {
  const runs: Array<{ sql: string; args: unknown[] }> = [];

  return {
    runs,
    prepare(sql: string) {
      return {
        all() {
          return [];
        },
        get() {
          return undefined;
        },
        run(...args: unknown[]) {
          runs.push({ sql, args });
          if (sql.includes("INSERT INTO workspaces")) {
            return { lastInsertRowid: 42 };
          }
          return { changes: 1 };
        },
      };
    },
  };
}

test("registerWorkspaceRoutes creates workspaces and seeds them", async () => {
  const { app, getRoute } = createMockApp();
  const db = createWorkspaceDbMock();
  const seeded: Array<number | bigint> = [];

  registerWorkspaceRoutes({
    app: app as any,
    db: db as any,
    requireAuth: createPassThroughMiddleware() as any,
    requireWorkspaceAccess: createPassThroughMiddleware() as any,
    requireWorkspaceRole: () => createPassThroughMiddleware() as any,
    getAllowedAgentUpdate,
    getAllowedTaskCreate,
    getAllowedTaskStatusUpdate,
    getAllowedMessageCreate,
    isNonEmptyString,
    writeAuditLog: () => {},
    seedWorkspace(workspaceId) {
      seeded.push(workspaceId);
    },
  });

  const req = {
    userId: 7,
    body: { name: "Operations" },
  };
  const res = createMockRes();

  await invokeHandlers(getRoute("POST", "/api/workspaces"), req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { id: 42, name: "Operations", role: "owner" });
  assert.deepEqual(seeded, [42]);
  assert.ok(db.runs.some((entry) => entry.sql.includes("INSERT INTO workspace_members") && entry.args[0] === 42 && entry.args[1] === 7));
});

test("registerWorkspaceRoutes upserts existing members and writes an audit log", async () => {
  const { app, getRoute } = createMockApp();
  const auditEntries: any[] = [];
  const updatedRoles: unknown[][] = [];

  const db = {
    prepare(sql: string) {
      return {
        all() {
          return [];
        },
        get(...args: unknown[]) {
          if (sql.includes("SELECT id, email, name FROM users WHERE email = ?")) {
            return { id: 33, email: args[0], name: "Teammate" };
          }
          if (sql.includes("SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?")) {
            return { role: "member" };
          }
          return undefined;
        },
        run(...args: unknown[]) {
          if (sql.includes("UPDATE workspace_members SET role = ?")) {
            updatedRoles.push(args);
          }
          return { changes: 1 };
        },
      };
    },
  };

  registerWorkspaceRoutes({
    app: app as any,
    db: db as any,
    requireAuth: createPassThroughMiddleware() as any,
    requireWorkspaceAccess: createPassThroughMiddleware() as any,
    requireWorkspaceRole: () => createPassThroughMiddleware() as any,
    getAllowedAgentUpdate,
    getAllowedTaskCreate,
    getAllowedTaskStatusUpdate,
    getAllowedMessageCreate,
    isNonEmptyString,
    writeAuditLog(entry) {
      auditEntries.push(entry);
    },
    seedWorkspace: () => {},
  });

  const req = {
    workspaceId: 9,
    userId: 1,
    body: { email: " teammate@example.com ", role: "Admin" },
  };
  const res = createMockRes();

  await invokeHandlers(getRoute("POST", "/api/workspaces/:id/members"), req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    id: 33,
    email: "teammate@example.com",
    name: "Teammate",
    role: "admin",
  });
  assert.deepEqual(updatedRoles, [["admin", 9, 33]]);
  assert.deepEqual(auditEntries, [
    {
      workspaceId: 9,
      userId: 1,
      action: "workspace.member.role_updated",
      resource: "workspace_members",
      details: { memberUserId: 33, role: "admin", mode: "upsert" },
    },
  ]);
});

test("registerWorkspaceRoutes blocks admins from promoting members to owner", async () => {
  const { app, getRoute } = createMockApp();

  registerWorkspaceRoutes({
    app: app as any,
    db: { prepare: () => ({ all: () => [], get: () => undefined, run: () => ({ changes: 1 }) }) } as any,
    requireAuth: createPassThroughMiddleware() as any,
    requireWorkspaceAccess: createPassThroughMiddleware() as any,
    requireWorkspaceRole: () => createPassThroughMiddleware() as any,
    getAllowedAgentUpdate,
    getAllowedTaskCreate,
    getAllowedTaskStatusUpdate,
    getAllowedMessageCreate,
    isNonEmptyString,
    writeAuditLog: () => {},
    seedWorkspace: () => {},
  });

  const req = {
    workspaceId: 9,
    workspaceRole: "admin",
    params: { memberUserId: "55" },
    body: { role: "owner" },
  };
  const res = createMockRes();

  await invokeHandlers(getRoute("PATCH", "/api/workspaces/:workspaceId/members/:memberUserId"), req, res);

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: "Only owners can promote to owner" });
});

test("registerWorkspaceRoutes infers execution type when creating a task", async () => {
  const { app, getRoute } = createMockApp();
  const taskInsertArgs: unknown[][] = [];

  const db = {
    prepare(sql: string) {
      return {
        all() {
          return [];
        },
        get() {
          if (sql.includes("SELECT role FROM agents WHERE id = ? AND workspace_id = ?")) {
            return { role: "Blog Writer" };
          }
          return undefined;
        },
        run(...args: unknown[]) {
          if (sql.includes("INSERT INTO tasks")) {
            taskInsertArgs.push(args);
          }
          return { changes: 1 };
        },
      };
    },
  };

  registerWorkspaceRoutes({
    app: app as any,
    db: db as any,
    requireAuth: createPassThroughMiddleware() as any,
    requireWorkspaceAccess: createPassThroughMiddleware() as any,
    requireWorkspaceRole: () => createPassThroughMiddleware() as any,
    getAllowedAgentUpdate,
    getAllowedTaskCreate,
    getAllowedTaskStatusUpdate,
    getAllowedMessageCreate,
    isNonEmptyString,
    writeAuditLog: () => {},
    seedWorkspace: () => {},
  });

  const req = {
    workspaceId: 9,
    userId: 1,
    body: {
      title: "Draft article outline",
      description: "Write the next technical blog draft",
      assigneeId: "blog-writer:9",
      dueDate: "2026-03-14T09:00:00.000Z",
      repeat: "",
    },
  };
  const res = createMockRes();

  await invokeHandlers(getRoute("POST", "/api/workspaces/:id/tasks"), req, res);

  assert.equal(res.statusCode, 200);
  assert.equal((res.body as any).executionType, "draft");
  assert.equal(taskInsertArgs.length, 1);
  assert.equal(taskInsertArgs[0][6], "draft");
});

test("registerWorkspaceRoutes promotes a task artifact into lead notes", async () => {
  const { app, getRoute } = createMockApp();
  const auditEntries: any[] = [];
  const leadUpdates: unknown[][] = [];

  const db = {
    prepare(sql: string) {
      return {
        all() {
          return [];
        },
        get(...args: unknown[]) {
          if (sql.includes("FROM tasks t")) {
            return {
              id: args[0],
              title: "Build outreach brief",
              artifact_payload: JSON.stringify({
                title: "Outreach brief: Build outreach brief",
                body: "Ready to convert into lead-facing notes.",
                bullets: ["Prioritize public-sector accounts", "Lead with GA4 migration pain points"],
              }),
              assignee_name: "Stan",
            };
          }

          if (sql.includes("SELECT id, notes FROM leads")) {
            return {
              id: 12,
              notes: "Existing note",
            };
          }

          return undefined;
        },
        run(...args: unknown[]) {
          if (sql.includes("UPDATE leads SET notes = ?")) {
            leadUpdates.push(args);
          }

          return { changes: 1 };
        },
      };
    },
  };

  registerWorkspaceRoutes({
    app: app as any,
    db: db as any,
    requireAuth: createPassThroughMiddleware() as any,
    requireWorkspaceAccess: createPassThroughMiddleware() as any,
    requireWorkspaceRole: () => createPassThroughMiddleware() as any,
    getAllowedAgentUpdate,
    getAllowedTaskCreate,
    getAllowedTaskStatusUpdate,
    getAllowedMessageCreate,
    isNonEmptyString,
    writeAuditLog(entry) {
      auditEntries.push(entry);
    },
    seedWorkspace: () => {},
  });

  const req = {
    workspaceId: 9,
    userId: 2,
    params: { taskId: "task-123" },
    body: { leadId: 12 },
  };
  const res = createMockRes();

  await invokeHandlers(getRoute("POST", "/api/workspaces/:workspaceId/tasks/:taskId/promote-artifact"), req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(leadUpdates.length, 1);
  assert.equal(leadUpdates[0][1], 12);
  assert.equal(leadUpdates[0][2], 9);
  assert.match(String(leadUpdates[0][0]), /Existing note/);
  assert.match(String(leadUpdates[0][0]), /Task artifact: Build outreach brief/);
  assert.match(String(leadUpdates[0][0]), /Prepared by Stan/);
  assert.deepEqual(auditEntries, [
    {
      workspaceId: 9,
      userId: 2,
      action: "task.artifact.promoted_to_lead",
      resource: "leads",
      details: { taskId: "task-123", leadId: 12 },
    },
  ]);
  assert.equal((res.body as any).leadId, 12);
  assert.match(String((res.body as any).notes), /Lead with GA4 migration pain points/);
 });

test("registerWorkspaceRoutes persists task selected media id", async () => {
  const { app, getRoute } = createMockApp();
  const auditEntries: any[] = [];
  const taskUpdates: unknown[][] = [];

  const db = {
    prepare(sql: string) {
      return {
        all() {
          return [];
        },
        get(...args: unknown[]) {
          if (sql.includes("SELECT id FROM media_assets")) {
            return { id: Number(args[0]) };
          }
          return undefined;
        },
        run(...args: unknown[]) {
          if (sql.includes("UPDATE tasks SET selected_media_asset_id = ?")) {
            taskUpdates.push(args);
            return { changes: 1 };
          }
          return { changes: 1 };
        },
      };
    },
  };

  registerWorkspaceRoutes({
    app: app as any,
    db: db as any,
    requireAuth: createPassThroughMiddleware() as any,
    requireWorkspaceAccess: createPassThroughMiddleware() as any,
    requireWorkspaceRole: () => createPassThroughMiddleware() as any,
    getAllowedAgentUpdate,
    getAllowedTaskCreate,
    getAllowedTaskStatusUpdate,
    getAllowedMessageCreate,
    isNonEmptyString,
    writeAuditLog(entry) {
      auditEntries.push(entry);
    },
    seedWorkspace: () => {},
  });

  const req = {
    workspaceId: 9,
    userId: 4,
    params: { taskId: "task-44" },
    body: { selectedMediaAssetId: "21" },
  };
  const res = createMockRes();

  await invokeHandlers(getRoute("PATCH", "/api/workspaces/:workspaceId/tasks/:taskId/selected-media"), req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true, selectedMediaAssetId: 21 });
  assert.deepEqual(taskUpdates, [[21, "task-44", 9]]);
  assert.deepEqual(auditEntries, [
    {
      workspaceId: 9,
      userId: 4,
      action: "task.selected_media.updated",
      resource: "tasks",
      details: { taskId: "task-44", selectedMediaAssetId: 21 },
    },
  ]);
});

test("registerWorkspaceRoutes validates media thumbnail input", async () => {
  const { app, getRoute } = createMockApp();

  registerWorkspaceRoutes({
    app: app as any,
    db: { prepare: () => ({ all: () => [], get: () => undefined, run: () => ({ changes: 1 }) }) } as any,
    requireAuth: createPassThroughMiddleware() as any,
    requireWorkspaceAccess: createPassThroughMiddleware() as any,
    requireWorkspaceRole: () => createPassThroughMiddleware() as any,
    getAllowedAgentUpdate,
    getAllowedTaskCreate,
    getAllowedTaskStatusUpdate,
    getAllowedMessageCreate,
    isNonEmptyString,
    writeAuditLog: () => {},
    seedWorkspace: () => {},
  });

  const req = {
    workspaceId: 9,
    body: {
      name: "hero",
      type: "image",
      category: "uploads",
      thumbnail: "javascript:alert(1)",
    },
  };
  const res = createMockRes();

  await invokeHandlers(getRoute("POST", "/api/workspaces/:id/media"), req, res);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "thumbnail must be a data:image or public http(s) URL" });
});

test("registerWorkspaceRoutes validates and saves automation settings", async () => {
  const { app, getRoute } = createMockApp();
  const upserts: unknown[][] = [];

  const db = {
    prepare(sql: string) {
      return {
        all() {
          return [];
        },
        get() {
          return undefined;
        },
        run(...args: unknown[]) {
          if (sql.includes("INSERT INTO workspace_automation_settings")) {
            upserts.push(args);
          }
          return { changes: 1 };
        },
      };
    },
  };

  registerWorkspaceRoutes({
    app: app as any,
    db: db as any,
    requireAuth: createPassThroughMiddleware() as any,
    requireWorkspaceAccess: createPassThroughMiddleware() as any,
    requireWorkspaceRole: () => createPassThroughMiddleware() as any,
    getAllowedAgentUpdate,
    getAllowedTaskCreate,
    getAllowedTaskStatusUpdate,
    getAllowedMessageCreate,
    isNonEmptyString,
    writeAuditLog: () => {},
    seedWorkspace: () => {},
  });

  const invalidReq = {
    workspaceId: 9,
    body: { linkedinMode: "queue", bufferMode: "queue" },
  };
  const invalidRes = createMockRes();
  await invokeHandlers(getRoute("PUT", "/api/workspaces/:id/automation-settings"), invalidReq, invalidRes);

  assert.equal(invalidRes.statusCode, 400);
  assert.deepEqual(invalidRes.body, { error: "linkedinMode must be off or publish" });

  const validReq = {
    workspaceId: 9,
    body: {
      linkedinMode: "publish",
      bufferMode: "queue",
      teamsMode: "send",
      notionMode: "create",
      bufferProfileId: "profile-1",
      notionParentPageId: "parent-page-1",
      requireArtifactImage: true,
    },
  };
  const validRes = createMockRes();
  await invokeHandlers(getRoute("PUT", "/api/workspaces/:id/automation-settings"), validReq, validRes);

  assert.equal(validRes.statusCode, 200);
  assert.deepEqual(validRes.body, {
    linkedinMode: "publish",
    bufferMode: "queue",
    teamsMode: "send",
    notionMode: "create",
    bufferProfileId: "profile-1",
    notionParentPageId: "parent-page-1",
    requireArtifactImage: true,
  });
  assert.deepEqual(upserts, [[9, "publish", "queue", "send", "create", "profile-1", "parent-page-1", 1]]);
});

test("registerWorkspaceRoutes returns task automation logs", async () => {
  const { app, getRoute } = createMockApp();

  const db = {
    prepare(sql: string) {
      return {
        all() {
          if (sql.includes("FROM audit_logs")) {
            return [
              {
                id: 101,
                action: "task.automation.attempted",
                details: JSON.stringify({ taskId: "task-1", reason: "start" }),
                created_at: "2026-03-13 10:00:00",
              },
              {
                id: 102,
                action: "task.automation.linkedin.succeeded",
                details: JSON.stringify({ taskId: "task-1", channel: "linkedin" }),
                created_at: "2026-03-13 10:00:01",
              },
              {
                id: 103,
                action: "task.automation.skipped",
                details: JSON.stringify({ taskId: "other-task", reason: "not_social_task" }),
                created_at: "2026-03-13 10:00:02",
              },
            ];
          }
          return [];
        },
        get() {
          return undefined;
        },
        run() {
          return { changes: 1 };
        },
      };
    },
  };

  registerWorkspaceRoutes({
    app: app as any,
    db: db as any,
    requireAuth: createPassThroughMiddleware() as any,
    requireWorkspaceAccess: createPassThroughMiddleware() as any,
    requireWorkspaceRole: () => createPassThroughMiddleware() as any,
    getAllowedAgentUpdate,
    getAllowedTaskCreate,
    getAllowedTaskStatusUpdate,
    getAllowedMessageCreate,
    isNonEmptyString,
    writeAuditLog: () => {},
    seedWorkspace: () => {},
  });

  const req = {
    workspaceId: 9,
    params: { taskId: "task-1" },
    query: { limit: "5" },
  };
  const res = createMockRes();

  await invokeHandlers(getRoute("GET", "/api/workspaces/:workspaceId/tasks/:taskId/automation-logs"), req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, [
    {
      id: 101,
      action: "task.automation.attempted",
      details: { taskId: "task-1", reason: "start" },
      createdAt: "2026-03-13 10:00:00",
    },
    {
      id: 102,
      action: "task.automation.linkedin.succeeded",
      details: { taskId: "task-1", channel: "linkedin" },
      createdAt: "2026-03-13 10:00:01",
    },
  ]);
});

test("registerWorkspaceRoutes retries task automation for valid artifact payload", async () => {
  const { app, getRoute } = createMockApp();
  const auditEntries: any[] = [];

  const db = {
    prepare(sql: string) {
      return {
        all() {
          return [];
        },
        get(...args: unknown[]) {
          if (sql.includes("SELECT id, artifact_payload FROM tasks")) {
            return {
              id: args[0],
              artifact_payload: JSON.stringify({
                title: "Campaign update",
                body: "Here is this week's campaign recap.",
                bullets: ["Pipeline increased 12%", "Top channel: LinkedIn"],
              }),
            };
          }

          if (sql.includes("SELECT linkedin_mode, buffer_mode, buffer_profile_id, require_artifact_image FROM workspace_automation_settings")) {
            return {
              linkedin_mode: "off",
              buffer_mode: "off",
              buffer_profile_id: null,
              require_artifact_image: 0,
            };
          }

          return undefined;
        },
        run() {
          return { changes: 1 };
        },
      };
    },
  };

  registerWorkspaceRoutes({
    app: app as any,
    db: db as any,
    requireAuth: createPassThroughMiddleware() as any,
    requireWorkspaceAccess: createPassThroughMiddleware() as any,
    requireWorkspaceRole: () => createPassThroughMiddleware() as any,
    getAllowedAgentUpdate,
    getAllowedTaskCreate,
    getAllowedTaskStatusUpdate,
    getAllowedMessageCreate,
    isNonEmptyString,
    writeAuditLog(entry) {
      auditEntries.push(entry);
    },
    seedWorkspace: () => {},
  });

  const req = {
    workspaceId: 9,
    userId: 3,
    params: { taskId: "task-99" },
  };
  const res = createMockRes();

  await invokeHandlers(getRoute("POST", "/api/workspaces/:workspaceId/tasks/:taskId/automation-retry"), req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true, queued: true });
  assert.deepEqual(auditEntries, [
    {
      workspaceId: 9,
      userId: 3,
      action: "task.automation.retry_requested",
      resource: "tasks",
      details: { taskId: "task-99", mode: "queued" },
    },
  ]);
});

test("registerWorkspaceRoutes persists agent capabilities updates", async () => {
  const { app, getRoute } = createMockApp();
  const capabilityUpdates: unknown[][] = [];
  const auditEntries: any[] = [];

  const db = {
    prepare(sql: string) {
      return {
        all() {
          return [];
        },
        get() {
          return undefined;
        },
        run(...args: unknown[]) {
          if (sql.includes("UPDATE agents SET capabilities = ?")) {
            capabilityUpdates.push(args);
          }
          return { changes: 1 };
        },
      };
    },
  };

  registerWorkspaceRoutes({
    app: app as any,
    db: db as any,
    requireAuth: createPassThroughMiddleware() as any,
    requireWorkspaceAccess: createPassThroughMiddleware() as any,
    requireWorkspaceRole: () => createPassThroughMiddleware() as any,
    getAllowedAgentUpdate,
    getAllowedTaskCreate,
    getAllowedTaskStatusUpdate,
    getAllowedMessageCreate,
    isNonEmptyString,
    writeAuditLog(entry) {
      auditEntries.push(entry);
    },
    seedWorkspace: () => {},
  });

  const req = {
    workspaceId: 9,
    userId: 1,
    params: { agentId: "social-media-manager:9" },
    body: { capabilities: ["Scheduling", "Analytics"] },
  };
  const res = createMockRes();

  await invokeHandlers(getRoute("PATCH", "/api/workspaces/:workspaceId/agents/:agentId"), req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true });
  assert.deepEqual(capabilityUpdates, [[JSON.stringify(["Scheduling", "Analytics"]), "social-media-manager:9", 9]]);
  assert.deepEqual(auditEntries, [
    {
      workspaceId: 9,
      userId: 1,
      action: "agent.updated",
      resource: "agents",
      details: { agentId: "social-media-manager:9", fields: ["capabilities"] },
    },
  ]);
});

test("registerWorkspaceRoutes rejects duplicate agent personality profiles in a workspace", async () => {
  const { app, getRoute } = createMockApp();
  const writes: unknown[][] = [];
  const auditEntries: any[] = [];

  const db = {
    prepare(sql: string) {
      return {
        all() {
          if (sql.includes("SELECT id, personality, role FROM agents")) {
            return [
              {
                id: "social-media-manager:9",
                role: "Social Media Manager",
                personality: JSON.stringify({
                  tone: "analytical",
                  communicationStyle: "detailed",
                  assertiveness: "medium",
                  humor: "none",
                  verbosity: "long",
                  signaturePhrase: "Here is the narrative arc and data spine.",
                  doNots: ["Do not overuse buzzwords."],
                }),
              },
            ];
          }
          return [];
        },
        get() {
          if (sql.includes("SELECT description, guidelines, capabilities, personality, role FROM agents")) {
            return {
              description: "Original description",
              guidelines: JSON.stringify([]),
              capabilities: JSON.stringify(["Research"]),
              personality: JSON.stringify({
                tone: "direct",
                communicationStyle: "balanced",
                assertiveness: "medium",
                humor: "none",
                verbosity: "medium",
                signaturePhrase: "",
                doNots: [],
              }),
              role: "Blog Writer",
            };
          }
          return undefined;
        },
        run(...args: unknown[]) {
          writes.push(args);
          return { changes: 1 };
        },
      };
    },
  };

  registerWorkspaceRoutes({
    app: app as any,
    db: db as any,
    requireAuth: createPassThroughMiddleware() as any,
    requireWorkspaceAccess: createPassThroughMiddleware() as any,
    requireWorkspaceRole: () => createPassThroughMiddleware() as any,
    getAllowedAgentUpdate,
    getAllowedTaskCreate,
    getAllowedTaskStatusUpdate,
    getAllowedMessageCreate,
    isNonEmptyString,
    writeAuditLog(entry) {
      auditEntries.push(entry);
    },
    seedWorkspace: () => {},
  });

  const req = {
    workspaceId: 9,
    userId: 5,
    params: { agentId: "blog-writer:9" },
    body: {
      personality: {
        tone: "analytical",
        communicationStyle: "detailed",
        assertiveness: "medium",
        humor: "none",
        verbosity: "long",
        signaturePhrase: "Here is the narrative arc and data spine.",
        doNots: ["Do not overuse buzzwords."],
      },
    },
  };
  const res = createMockRes();

  await invokeHandlers(getRoute("PATCH", "/api/workspaces/:workspaceId/agents/:agentId"), req, res);

  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { error: "Personality profile must be meaningfully distinct across agents in this workspace" });
  assert.equal(writes.length, 0);
  assert.equal(auditEntries.length, 0);
});

test("registerWorkspaceRoutes rejects near-duplicate agent personality profiles in a workspace", async () => {
  const { app, getRoute } = createMockApp();
  const writes: unknown[][] = [];

  const db = {
    prepare(sql: string) {
      return {
        all() {
          if (sql.includes("SELECT id, personality, role FROM agents")) {
            return [
              {
                id: "sales-associate:9",
                role: "Sales Associate",
                personality: JSON.stringify({
                  tone: "direct",
                  communicationStyle: "concise",
                  assertiveness: "high",
                  humor: "light",
                  verbosity: "short",
                  signaturePhrase: "Ready to move this forward?",
                  doNots: ["Do not use passive asks", "Do not bury call-to-action"],
                }),
              },
            ];
          }
          return [];
        },
        get() {
          if (sql.includes("SELECT description, guidelines, capabilities, personality, role FROM agents")) {
            return {
              description: "Original description",
              guidelines: JSON.stringify([]),
              capabilities: JSON.stringify(["Outreach"]),
              personality: JSON.stringify({
                tone: "warm",
                communicationStyle: "balanced",
                assertiveness: "medium",
                humor: "none",
                verbosity: "medium",
                signaturePhrase: "",
                doNots: [],
              }),
              role: "Blog Writer",
            };
          }
          return undefined;
        },
        run(...args: unknown[]) {
          writes.push(args);
          return { changes: 1 };
        },
      };
    },
  };

  registerWorkspaceRoutes({
    app: app as any,
    db: db as any,
    requireAuth: createPassThroughMiddleware() as any,
    requireWorkspaceAccess: createPassThroughMiddleware() as any,
    requireWorkspaceRole: () => createPassThroughMiddleware() as any,
    getAllowedAgentUpdate,
    getAllowedTaskCreate,
    getAllowedTaskStatusUpdate,
    getAllowedMessageCreate,
    isNonEmptyString,
    writeAuditLog: () => {},
    seedWorkspace: () => {},
  });

  const req = {
    workspaceId: 9,
    userId: 5,
    params: { agentId: "blog-writer:9" },
    body: {
      personality: {
        tone: "direct",
        communicationStyle: "concise",
        assertiveness: "high",
        humor: "light",
        verbosity: "short",
        signaturePhrase: "Ready to move this forward with the next best step?",
        doNots: ["Do not bury call-to-action", "Do not use passive asks"],
      },
    },
  };
  const res = createMockRes();

  await invokeHandlers(getRoute("PATCH", "/api/workspaces/:workspaceId/agents/:agentId"), req, res);

  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { error: "Personality profile must be meaningfully distinct across agents in this workspace" });
  assert.equal(writes.length, 0);
});

test("registerWorkspaceRoutes versions prompt context when agent prompt fields change", async () => {
  const { app, getRoute } = createMockApp();
  const auditEntries: any[] = [];

  const db = {
    prepare(sql: string) {
      return {
        all() {
          return [];
        },
        get() {
          if (sql.includes("SELECT description, guidelines, capabilities, personality, role FROM agents")) {
            return {
              description: "Original description",
              guidelines: JSON.stringify([{ id: "g1", title: "Tone", items: [{ id: "i1", content: "Be concise" }] }]),
              capabilities: JSON.stringify(["Research", "SEO"]),
              personality: JSON.stringify({ tone: "direct", communicationStyle: "balanced", assertiveness: "medium", humor: "none", verbosity: "medium", signaturePhrase: "", doNots: [] }),
              role: "Blog Writer",
            };
          }
          return undefined;
        },
        run() {
          return { changes: 1 };
        },
      };
    },
  };

  registerWorkspaceRoutes({
    app: app as any,
    db: db as any,
    requireAuth: createPassThroughMiddleware() as any,
    requireWorkspaceAccess: createPassThroughMiddleware() as any,
    requireWorkspaceRole: () => createPassThroughMiddleware() as any,
    getAllowedAgentUpdate,
    getAllowedTaskCreate,
    getAllowedTaskStatusUpdate,
    getAllowedMessageCreate,
    isNonEmptyString,
    writeAuditLog(entry) {
      auditEntries.push(entry);
    },
    seedWorkspace: () => {},
  });

  const nextGuidelines = [{ id: "g2", title: "Voice", items: [{ id: "i2", content: "Use active voice" }] }];
  const req = {
    workspaceId: 9,
    userId: 5,
    params: { agentId: "blog-writer:9" },
    body: {
      description: "Updated description",
      guidelines: nextGuidelines,
      capabilities: ["Research", "Long-form Drafting"],
      personality: {
        tone: "analytical",
        communicationStyle: "detailed",
        assertiveness: "medium",
        humor: "none",
        verbosity: "long",
        signaturePhrase: "Here is the narrative arc and data spine.",
        doNots: ["Do not overuse buzzwords."],
      },
    },
  };
  const res = createMockRes();

  await invokeHandlers(getRoute("PATCH", "/api/workspaces/:workspaceId/agents/:agentId"), req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(auditEntries.length, 2);
  assert.equal(auditEntries[0].action, "agent.updated");
  assert.equal(auditEntries[1].action, "agent.prompt_context.versioned");
  assert.equal(auditEntries[1].details.agentId, "blog-writer:9");
  assert.equal(auditEntries[1].details.before.description, "Original description");
  assert.deepEqual(auditEntries[1].details.before.capabilities, ["Research", "SEO"]);
  assert.equal(auditEntries[1].details.before.personality.tone, "direct");
  assert.equal(auditEntries[1].details.after.description, "Updated description");
  assert.deepEqual(auditEntries[1].details.after.guidelines, nextGuidelines);
  assert.deepEqual(auditEntries[1].details.after.capabilities, ["Research", "Long-form Drafting"]);
  assert.equal(auditEntries[1].details.after.personality.tone, "analytical");
  assert.equal(typeof auditEntries[1].details.versionAt, "number");
});

test("registerWorkspaceRoutes returns prompt version history for an agent", async () => {
  const { app, getRoute } = createMockApp();

  const db = {
    prepare(sql: string) {
      return {
        all() {
          if (sql.includes("FROM audit_logs") && sql.includes("agent.prompt_context.versioned")) {
            return [
              {
                id: 301,
                user_id: 7,
                details: JSON.stringify({
                  agentId: "blog-writer:9",
                  before: { description: "Old", capabilities: ["Research"], guidelines: [], personality: { tone: "direct" } },
                  after: { description: "New", capabilities: ["Research", "SEO"], guidelines: [{ id: "g1", title: "Tone", items: [] }], personality: { tone: "analytical" } },
                  versionAt: 123456,
                }),
                created_at: "2026-03-13 12:00:00",
              },
              {
                id: 302,
                user_id: 7,
                details: JSON.stringify({
                  agentId: "other-agent:9",
                  before: {},
                  after: {},
                  versionAt: 123457,
                }),
                created_at: "2026-03-13 12:01:00",
              },
            ];
          }
          return [];
        },
        get() {
          return undefined;
        },
        run() {
          return { changes: 1 };
        },
      };
    },
  };

  registerWorkspaceRoutes({
    app: app as any,
    db: db as any,
    requireAuth: createPassThroughMiddleware() as any,
    requireWorkspaceAccess: createPassThroughMiddleware() as any,
    requireWorkspaceRole: () => createPassThroughMiddleware() as any,
    getAllowedAgentUpdate,
    getAllowedTaskCreate,
    getAllowedTaskStatusUpdate,
    getAllowedMessageCreate,
    isNonEmptyString,
    writeAuditLog: () => {},
    seedWorkspace: () => {},
  });

  const req = {
    workspaceId: 9,
    params: { agentId: "blog-writer:9" },
    query: { limit: "5" },
  };
  const res = createMockRes();

  await invokeHandlers(getRoute("GET", "/api/workspaces/:workspaceId/agents/:agentId/prompt-versions"), req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, [
    {
      id: 301,
      userId: 7,
      before: { description: "Old", capabilities: ["Research"], guidelines: [], personality: { tone: "direct" } },
      after: { description: "New", capabilities: ["Research", "SEO"], guidelines: [{ id: "g1", title: "Tone", items: [] }], personality: { tone: "analytical" } },
      versionAt: 123456,
      createdAt: "2026-03-13 12:00:00",
    },
  ]);
});

test("registerWorkspaceRoutes returns integrations health snapshot", async () => {
  const { app, getRoute } = createMockApp();

  const db = {
    prepare(sql: string) {
      return {
        all() {
          if (sql.includes("action LIKE 'task.automation.%.failed'")) {
            return [
              {
                id: 401,
                action: "task.automation.buffer.failed",
                details: JSON.stringify({ taskId: "task-10", channel: "buffer", error: "rate_limited" }),
                created_at: "2026-03-13 13:00:00",
              },
            ];
          }
          if (sql.includes("action LIKE 'task.automation.%'")) {
            return [
              {
                action: "task.automation.linkedin.succeeded",
                details: JSON.stringify({ channel: "linkedin" }),
                created_at: "2026-03-13 12:00:00",
              },
              {
                action: "task.automation.linkedin.failed",
                details: JSON.stringify({ taskId: "task-11", channel: "linkedin", error: "auth_error" }),
                created_at: "2026-03-13 12:30:00",
              },
              {
                action: "task.automation.buffer.failed",
                details: JSON.stringify({ taskId: "task-10", channel: "buffer", error: "rate_limited" }),
                created_at: "2026-03-13 13:00:00",
              },
            ];
          }
          if (sql.includes("FROM automation_jobs") && sql.includes("GROUP BY status")) {
            return [
              { status: "queued", count: 2 },
              { status: "retrying", count: 1 },
              { status: "dead_lettered", count: 1 },
            ];
          }
          return [];
        },
        get() {
          if (sql.includes("action = 'task.automation.job.deduped'")) {
            return { count: 3 };
          }
          if (sql.includes("FROM linkedin_connections")) return { workspace_id: 9 };
          if (sql.includes("FROM buffer_connections")) return undefined;
          if (sql.includes("FROM wordpress_connections")) return { workspace_id: 9 };
          if (sql.includes("FROM hubspot_connections")) return undefined;
          if (sql.includes("FROM teams_connections")) return { workspace_id: 9 };
          if (sql.includes("FROM notion_connections")) return { workspace_id: 9 };
          if (sql.includes("FROM workspace_automation_settings")) {
            return { linkedin_mode: "publish", buffer_mode: "queue", teams_mode: "send", notion_mode: "create", require_artifact_image: 1 };
          }
          return undefined;
        },
        run() {
          return { changes: 1 };
        },
      };
    },
  };

  registerWorkspaceRoutes({
    app: app as any,
    db: db as any,
    requireAuth: createPassThroughMiddleware() as any,
    requireWorkspaceAccess: createPassThroughMiddleware() as any,
    requireWorkspaceRole: () => createPassThroughMiddleware() as any,
    getAllowedAgentUpdate,
    getAllowedTaskCreate,
    getAllowedTaskStatusUpdate,
    getAllowedMessageCreate,
    isNonEmptyString,
    writeAuditLog: () => {},
    seedWorkspace: () => {},
  });

  const req = { workspaceId: 9 };
  const res = createMockRes();

  await invokeHandlers(getRoute("GET", "/api/workspaces/:id/integrations/health"), req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    services: {
      linkedin: {
        connected: true,
        lastSuccessAt: "2026-03-13 12:00:00",
        lastFailureAt: "2026-03-13 12:30:00",
        failedCount24h: 1,
      },
      buffer: {
        connected: false,
        lastSuccessAt: null,
        lastFailureAt: "2026-03-13 13:00:00",
        failedCount24h: 1,
      },
      wordpress: {
        connected: true,
        lastSuccessAt: null,
        lastFailureAt: null,
        failedCount24h: 0,
      },
      hubspot: {
        connected: false,
        lastSuccessAt: null,
        lastFailureAt: null,
        failedCount24h: 0,
      },
      teams: {
        connected: true,
        lastSuccessAt: null,
        lastFailureAt: null,
        failedCount24h: 0,
      },
      notion: {
        connected: true,
        lastSuccessAt: null,
        lastFailureAt: null,
        failedCount24h: 0,
      },
    },
    providerTelemetry: {
      linkedin: {
        rateLimited24h: 0,
        authErrors24h: 0,
        lastError: null,
      },
      buffer: {
        rateLimited24h: 1,
        authErrors24h: 0,
        lastError: "rate_limited",
      },
      wordpress: {
        rateLimited24h: 0,
        authErrors24h: 0,
        lastError: null,
      },
      hubspot: {
        rateLimited24h: 0,
        authErrors24h: 0,
        lastError: null,
      },
      teams: {
        rateLimited24h: 0,
        authErrors24h: 0,
        lastError: null,
      },
      notion: {
        rateLimited24h: 0,
        authErrors24h: 0,
        lastError: null,
      },
    },
    queue: {
      queued: 2,
      running: 0,
      retrying: 1,
      deadLettered: 1,
      deduped24h: 3,
    },
    automation: {
      linkedinMode: "publish",
      bufferMode: "queue",
      teamsMode: "send",
      notionMode: "create",
      requireArtifactImage: true,
      recentFailures: [
        {
          id: 401,
          action: "task.automation.buffer.failed",
          taskId: "task-10",
          channel: "buffer",
          error: "rate_limited",
          createdAt: "2026-03-13 13:00:00",
        },
      ],
    },
  });
});