import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { bootstrapDatabase } from "../../src/server/dbBootstrap.ts";
import { executePendingTasks, processAutomationJobs } from "../../src/server/taskEngine.ts";

function createTempDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "aether-task-engine-"));
  const dbPath = path.join(dir, "test.db");
  const db = new Database(dbPath);

  bootstrapDatabase(db);

  return {
    db,
    cleanup() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function createWorkspace(db: Database.Database) {
  const userInsert = db.prepare("INSERT INTO users (email, name) VALUES (?, ?)").run("task-engine@example.com", "Task Engine User");
  const workspaceInsert = db.prepare("INSERT INTO workspaces (name, owner_id) VALUES (?, ?)").run("Task Engine Workspace", userInsert.lastInsertRowid);
  db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)").run(
    workspaceInsert.lastInsertRowid,
    userInsert.lastInsertRowid,
    "owner",
  );

  return Number(workspaceInsert.lastInsertRowid);
}

function createAgent(
  db: Database.Database,
  workspaceId: number,
  agentId = "agent-1",
  name = "Agent One",
  role = "Operator",
) {
  db.prepare(`
    INSERT INTO agents (id, workspace_id, name, role, status, description, avatar, capabilities, guidelines, last_action)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    agentId,
    workspaceId,
    name,
    role,
    "idle",
    "Executes scheduled tasks",
    "AO",
    "[]",
    "[]",
    "Just now",
  );

  return agentId;
}

function createTask(
  db: Database.Database,
  workspaceId: number,
  assigneeId: string,
  overrides: Partial<{ id: string; title: string; dueDate: string; status: string }> = {},
  executionType?: string,
) {
  const taskId = overrides.id ?? "task-1";
  db.prepare(`
    INSERT INTO tasks (id, workspace_id, title, description, assignee_id, status, execution_type, due_date, repeat)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    taskId,
    workspaceId,
    overrides.title ?? "Scheduled Task",
    "Task description",
    assigneeId,
    overrides.status ?? "todo",
    executionType || null,
    overrides.dueDate ?? "2026-03-13T09:00:00.000Z",
    "",
  );

  return taskId;
}

test("executePendingTasks marks due ISO task done and posts completion message", async () => {
  const { db, cleanup } = createTempDb();
  try {
    const workspaceId = createWorkspace(db);
    const agentId = createAgent(db, workspaceId, "agent-blog", "Penny", "Blog Writer");
    const taskId = createTask(db, workspaceId, agentId, {
      id: "task-due",
      title: "Draft blog post outline",
      dueDate: "2026-03-13T09:00:00.000Z",
    });

    await executePendingTasks({
      db,
      now: "2026-03-13T10:00:00.000Z",
      createMessageId: () => "msg-success",
    });

    const task = db.prepare("SELECT status, execution_type, artifact_type, artifact_payload, output_summary, last_error, last_run_at, started_at, completed_at FROM tasks WHERE id = ?").get(taskId) as {
      status: string;
      execution_type: string | null;
      artifact_type: string | null;
      artifact_payload: string | null;
      output_summary: string | null;
      last_error: string | null;
      last_run_at: number | null;
      started_at: number | null;
      completed_at: number | null;
    };
    const message = db.prepare("SELECT sender_name, content, type FROM messages WHERE id = ?").get("msg-success") as {
      sender_name: string;
      content: string;
      type: string;
    };

    assert.equal(task.status, "done");
    assert.equal(task.execution_type, "draft");
  assert.equal(task.artifact_type, "brief");
    assert.match(task.output_summary || "", /content draft brief/i);
  assert.match(task.artifact_payload || "", /Draft brief/);
    assert.equal(task.last_error, null);
    assert.equal(typeof task.last_run_at, "number");
    assert.equal(typeof task.started_at, "number");
    assert.equal(typeof task.completed_at, "number");
    assert.equal(message.sender_name, "Penny");
    assert.equal(message.type, "agent");
    assert.match(message.content, /writing-ready brief/i);
  } finally {
    cleanup();
  }
});

test("executePendingTasks preserves explicit execution type for legal review tasks", async () => {
  const { db, cleanup } = createTempDb();
  try {
    const workspaceId = createWorkspace(db);
    const agentId = createAgent(db, workspaceId, "agent-legal", "Linda", "Legal Associate");
    const taskId = createTask(db, workspaceId, agentId, {
      id: "task-legal-review",
      title: "Contract risk review",
      dueDate: "2026-03-13T09:00:00.000Z",
    }, "review");

    await executePendingTasks({
      db,
      now: "2026-03-13T10:00:00.000Z",
      createMessageId: () => "msg-legal",
    });

    const task = db.prepare("SELECT execution_type, artifact_type, artifact_payload, output_summary FROM tasks WHERE id = ?").get(taskId) as {
      execution_type: string;
      artifact_type: string;
      artifact_payload: string;
      output_summary: string;
    };

    assert.equal(task.execution_type, "review");
    assert.equal(task.artifact_type, "review");
    assert.match(task.artifact_payload, /Review notes/);
    assert.match(task.output_summary, /compliance and risk review/i);
  } finally {
    cleanup();
  }
});

test("executePendingTasks skips tasks with non-ISO due dates", async () => {
  const { db, cleanup } = createTempDb();
  try {
    const workspaceId = createWorkspace(db);
    const agentId = createAgent(db, workspaceId);
    const taskId = createTask(db, workspaceId, agentId, {
      id: "task-natural-language",
      dueDate: "Today, 8:00 AM",
    });

    await executePendingTasks({
      db,
      now: "2026-03-13T10:00:00.000Z",
      createMessageId: () => "msg-skipped",
    });

    const task = db.prepare("SELECT status, last_run_at, started_at, completed_at FROM tasks WHERE id = ?").get(taskId) as {
      status: string;
      last_run_at: number | null;
      started_at: number | null;
      completed_at: number | null;
    };
    const messageCount = (db.prepare("SELECT COUNT(*) as count FROM messages WHERE id = ?").get("msg-skipped") as { count: number }).count;

    assert.equal(task.status, "todo");
    assert.equal(task.last_run_at, null);
    assert.equal(task.started_at, null);
    assert.equal(task.completed_at, null);
    assert.equal(messageCount, 0);
  } finally {
    cleanup();
  }
});

test("executePendingTasks rolls task back to todo when assignee agent is missing", async () => {
  const { db, cleanup } = createTempDb();
  try {
    const workspaceId = createWorkspace(db);
    const agentId = createAgent(db, workspaceId, "agent-missing");
    const taskId = createTask(db, workspaceId, agentId, {
      id: "task-missing-agent",
    });

    db.pragma("foreign_keys = OFF");
    db.prepare("DELETE FROM agents WHERE id = ?").run(agentId);
    db.pragma("foreign_keys = ON");

    await executePendingTasks({
      db,
      now: "2026-03-13T10:00:00.000Z",
      createMessageId: () => "msg-missing-agent",
    });

    const task = db.prepare("SELECT status, artifact_type, artifact_payload, output_summary, last_error, last_run_at, started_at, completed_at FROM tasks WHERE id = ?").get(taskId) as {
      status: string;
      artifact_type: string | null;
      artifact_payload: string | null;
      output_summary: string | null;
      last_error: string | null;
      last_run_at: number | null;
      started_at: number | null;
      completed_at: number | null;
    };
    const messageCount = (db.prepare("SELECT COUNT(*) as count FROM messages WHERE id = ?").get("msg-missing-agent") as { count: number }).count;

    assert.equal(task.status, "todo");
    assert.equal(task.artifact_type, null);
    assert.equal(task.artifact_payload, null);
    assert.equal(task.output_summary, null);
    assert.equal(task.last_error, "Agent not found");
    assert.equal(typeof task.last_run_at, "number");
    assert.equal(typeof task.started_at, "number");
    assert.equal(task.completed_at, null);
    assert.equal(messageCount, 0);
  } finally {
    cleanup();
  }
});

test("executePendingTasks rolls task back to todo when completion message insert fails", async () => {
  const { db, cleanup } = createTempDb();
  try {
    const workspaceId = createWorkspace(db);
    const agentId = createAgent(db, workspaceId);
    const taskId = createTask(db, workspaceId, agentId, {
      id: "task-duplicate-message",
    });

    db.prepare(`
      INSERT INTO messages (id, workspace_id, agent_id, sender_id, sender_name, sender_avatar, content, image_url, timestamp, type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "msg-duplicate",
      workspaceId,
      agentId,
      agentId,
      "Agent One",
      "AO",
      "Existing message",
      null,
      Date.now(),
      "agent",
    );

    await executePendingTasks({
      db,
      now: "2026-03-13T10:00:00.000Z",
      createMessageId: () => "msg-duplicate",
    });

    const task = db.prepare("SELECT status, artifact_type, artifact_payload, output_summary, last_error, last_run_at, started_at, completed_at FROM tasks WHERE id = ?").get(taskId) as {
      status: string;
      artifact_type: string | null;
      artifact_payload: string | null;
      output_summary: string | null;
      last_error: string | null;
      last_run_at: number | null;
      started_at: number | null;
      completed_at: number | null;
    };
    const messageCount = (db.prepare("SELECT COUNT(*) as count FROM messages WHERE id = ?").get("msg-duplicate") as { count: number }).count;

    assert.equal(task.status, "todo");
    assert.equal(task.artifact_type, null);
    assert.equal(task.artifact_payload, null);
    assert.equal(task.output_summary, null);
    assert.match(task.last_error || "", /UNIQUE constraint failed: messages.id/);
    assert.equal(typeof task.last_run_at, "number");
    assert.equal(typeof task.started_at, "number");
    assert.equal(task.completed_at, null);
    assert.equal(messageCount, 1);
  } finally {
    cleanup();
  }
});

test("executePendingTasks dispatches LinkedIn and Buffer automation for social tasks", async () => {
  const { db, cleanup } = createTempDb();
  const originalFetch = globalThis.fetch;
  const fetchCalls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    fetchCalls.push(url);

    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      headers: new Headers({ "content-type": "application/json" }),
      arrayBuffer: async () => new ArrayBuffer(0),
    } as any;
  }) as typeof globalThis.fetch;

  try {
    const workspaceId = createWorkspace(db);
    const agentId = createAgent(db, workspaceId, "agent-social", "Sonny", "Social Media Manager");
    createTask(db, workspaceId, agentId, {
      id: "task-social-automation",
      title: "Publish social campaign update",
      dueDate: "2026-03-13T09:00:00.000Z",
    });

    db.prepare("INSERT INTO linkedin_connections (workspace_id, access_token, author_urn) VALUES (?, ?, ?)")
      .run(workspaceId, "li-token", "urn:li:person:abc123");
    db.prepare("INSERT INTO buffer_connections (workspace_id, access_token) VALUES (?, ?)")
      .run(workspaceId, "buffer-token");
    db.prepare("INSERT INTO workspace_automation_settings (workspace_id, linkedin_mode, buffer_mode, buffer_profile_id, require_artifact_image) VALUES (?, ?, ?, ?, ?)")
      .run(workspaceId, "publish", "queue", "buffer-profile-1", 0);

    await executePendingTasks({
      db,
      now: "2026-03-13T10:00:00.000Z",
      createMessageId: () => "msg-social-automation",
    });

    assert.ok(fetchCalls.some((url) => url.includes("api.linkedin.com/v2/ugcPosts")));
    assert.ok(fetchCalls.some((url) => url.includes("api.bufferapp.com/1/updates/create.json")));

    const actions = db.prepare("SELECT action FROM audit_logs WHERE workspace_id = ?").all(workspaceId) as Array<{ action: string }>;
    assert.ok(actions.some((entry) => entry.action === "task.automation.attempted"));
    assert.ok(actions.some((entry) => entry.action === "task.automation.linkedin.succeeded"));
    assert.ok(actions.some((entry) => entry.action === "task.automation.buffer.succeeded"));
  } finally {
    globalThis.fetch = originalFetch;
    cleanup();
  }
});

test("executePendingTasks skips social automation when image is required but missing", async () => {
  const { db, cleanup } = createTempDb();
  const originalFetch = globalThis.fetch;
  const fetchCalls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    fetchCalls.push(url);

    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      headers: new Headers({ "content-type": "application/json" }),
      arrayBuffer: async () => new ArrayBuffer(0),
    } as any;
  }) as typeof globalThis.fetch;

  try {
    const workspaceId = createWorkspace(db);
    const agentId = createAgent(db, workspaceId, "agent-social-image", "Sonny", "Social Media Manager");
    createTask(db, workspaceId, agentId, {
      id: "task-social-image-required",
      title: "Publish LinkedIn recap",
      dueDate: "2026-03-13T09:00:00.000Z",
    });

    db.prepare("INSERT INTO linkedin_connections (workspace_id, access_token, author_urn) VALUES (?, ?, ?)")
      .run(workspaceId, "li-token", "urn:li:person:abc123");
    db.prepare("INSERT INTO buffer_connections (workspace_id, access_token) VALUES (?, ?)")
      .run(workspaceId, "buffer-token");
    db.prepare("INSERT INTO workspace_automation_settings (workspace_id, linkedin_mode, buffer_mode, buffer_profile_id, require_artifact_image) VALUES (?, ?, ?, ?, ?)")
      .run(workspaceId, "publish", "queue", "buffer-profile-1", 1);

    await executePendingTasks({
      db,
      now: "2026-03-13T10:00:00.000Z",
      createMessageId: () => "msg-social-image-required",
    });

    assert.equal(fetchCalls.some((url) => url.includes("api.linkedin.com/v2/ugcPosts")), false);
    assert.equal(fetchCalls.some((url) => url.includes("api.bufferapp.com/1/updates/create.json")), false);

    const skippedEntries = db
      .prepare("SELECT action, details FROM audit_logs WHERE workspace_id = ? AND action = ?")
      .all(workspaceId, "task.automation.skipped") as Array<{ action: string; details: string | null }>;
    assert.ok(skippedEntries.some((entry) => {
      if (!entry.details) return false;
      const details = JSON.parse(entry.details) as { reason?: string };
      return details.reason === "image_required_missing";
    }));
  } finally {
    globalThis.fetch = originalFetch;
    cleanup();
  }
});

test("executePendingTasks enqueues Teams and Notion automation jobs when connections exist", async () => {
  const { db, cleanup } = createTempDb();
  try {
    const workspaceId = createWorkspace(db);
    const agentId = createAgent(db, workspaceId, "agent-channel", "Penny", "Blog Writer");
    const taskId = createTask(db, workspaceId, agentId, {
      id: "task-channel-queue",
      title: "Publish weekly project summary",
      dueDate: "2026-03-13T09:00:00.000Z",
    });

    db.prepare("INSERT INTO teams_connections (workspace_id, webhook_url, default_channel_name) VALUES (?, ?, ?)")
      .run(workspaceId, "https://example.webhook.office.com/webhookb2/abc/IncomingWebhook/def", "Ops Updates");
    db.prepare("INSERT INTO notion_connections (workspace_id, integration_token, default_parent_page_id) VALUES (?, ?, ?)")
      .run(workspaceId, "secret_notion", "parent-page-id");
    db.prepare("INSERT INTO workspace_automation_settings (workspace_id, teams_mode, notion_mode, notion_parent_page_id) VALUES (?, ?, ?, ?)")
      .run(workspaceId, "send", "create", "parent-page-id");

    await executePendingTasks({
      db,
      now: "2026-03-13T10:00:00.000Z",
      createMessageId: () => "msg-channel-queue",
    });

    const jobs = db.prepare("SELECT action, channel, payload FROM automation_jobs WHERE workspace_id = ? ORDER BY id ASC")
      .all(workspaceId) as Array<{ action: string; channel: string; payload: string | null }>;

    assert.ok(jobs.some((job) => job.action === "teams.message.send" && job.channel === "teams"));
    assert.ok(jobs.some((job) => job.action === "notion.page.create" && job.channel === "notion"));

    const notionJob = jobs.find((job) => job.action === "notion.page.create");
    assert.ok(notionJob?.payload);
    const notionPayload = JSON.parse(String(notionJob?.payload)) as { taskId?: string; parentPageId?: string };
    assert.equal(notionPayload.taskId, taskId);
    assert.equal(notionPayload.parentPageId, "parent-page-id");
  } finally {
    cleanup();
  }
});

test("processAutomationJobs executes Teams and Notion queued actions", async () => {
  const { db, cleanup } = createTempDb();
  const originalFetch = globalThis.fetch;
  const fetchCalls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    fetchCalls.push(url);

    if (url.includes("api.notion.com/v1/pages")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "page-1", url: "https://notion.so/page-1" }),
        text: async () => "",
      } as any;
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => "",
    } as any;
  }) as typeof globalThis.fetch;

  try {
    const workspaceId = createWorkspace(db);

    db.prepare("INSERT INTO teams_connections (workspace_id, webhook_url, default_channel_name) VALUES (?, ?, ?)")
      .run(workspaceId, "https://example.webhook.office.com/webhookb2/abc/IncomingWebhook/def", "Ops Updates");
    db.prepare("INSERT INTO notion_connections (workspace_id, integration_token, default_parent_page_id) VALUES (?, ?, ?)")
      .run(workspaceId, "secret_notion", "parent-page-id");

    db.prepare(`
      INSERT INTO automation_jobs (workspace_id, source, channel, action, status, payload, attempts, max_attempts, next_run_at, updated_at)
      VALUES (?, ?, ?, ?, 'queued', ?, 0, 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(
      workspaceId,
      "task-engine",
      "teams",
      "teams.message.send",
      JSON.stringify({ title: "Task update", text: "Task finished" }),
    );

    db.prepare(`
      INSERT INTO automation_jobs (workspace_id, source, channel, action, status, payload, attempts, max_attempts, next_run_at, updated_at)
      VALUES (?, ?, ?, ?, 'queued', ?, 0, 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(
      workspaceId,
      "task-engine",
      "notion",
      "notion.page.create",
      JSON.stringify({ title: "Artifact", content: "Completed artifact content" }),
    );

    await processAutomationJobs(db, 10);

    assert.ok(fetchCalls.some((url) => url.includes("example.webhook.office.com")));
    assert.ok(fetchCalls.some((url) => url.includes("api.notion.com/v1/pages")));

    const jobStatuses = db
      .prepare("SELECT action, status FROM automation_jobs WHERE workspace_id = ? ORDER BY id ASC")
      .all(workspaceId) as Array<{ action: string; status: string }>;
    assert.ok(jobStatuses.some((job) => job.action === "teams.message.send" && job.status === "succeeded"));
    assert.ok(jobStatuses.some((job) => job.action === "notion.page.create" && job.status === "succeeded"));
  } finally {
    globalThis.fetch = originalFetch;
    cleanup();
  }
});

test("executePendingTasks does not enqueue duplicate Teams/Notion jobs for identical artifacts", async () => {
  const { db, cleanup } = createTempDb();
  try {
    const workspaceId = createWorkspace(db);
    const agentId = createAgent(db, workspaceId, "agent-dedupe", "Penny", "Blog Writer");
    const taskId = createTask(db, workspaceId, agentId, {
      id: "task-dedupe",
      title: "Publish identical summary twice",
      dueDate: "2026-03-13T09:00:00.000Z",
    });

    db.prepare("INSERT INTO teams_connections (workspace_id, webhook_url, default_channel_name) VALUES (?, ?, ?)")
      .run(workspaceId, "https://example.webhook.office.com/webhookb2/abc/IncomingWebhook/def", "Ops Updates");
    db.prepare("INSERT INTO notion_connections (workspace_id, integration_token, default_parent_page_id) VALUES (?, ?, ?)")
      .run(workspaceId, "secret_notion", "parent-page-id");
    db.prepare("INSERT INTO workspace_automation_settings (workspace_id, teams_mode, notion_mode, notion_parent_page_id) VALUES (?, ?, ?, ?)")
      .run(workspaceId, "send", "create", "parent-page-id");

    await executePendingTasks({
      db,
      now: "2026-03-13T10:00:00.000Z",
      createMessageId: () => "msg-dedupe-first",
    });

    db.prepare("UPDATE tasks SET status = 'todo', due_date = ? WHERE id = ?")
      .run("2026-03-13T10:01:00.000Z", taskId);

    await executePendingTasks({
      db,
      now: "2026-03-13T10:02:00.000Z",
      createMessageId: () => "msg-dedupe-second",
    });

    const jobs = db.prepare("SELECT action, dedupe_key FROM automation_jobs WHERE workspace_id = ? AND action IN ('teams.message.send', 'notion.page.create') ORDER BY id ASC")
      .all(workspaceId) as Array<{ action: string; dedupe_key: string | null }>;

    const teamsJobs = jobs.filter((job) => job.action === "teams.message.send");
    const notionJobs = jobs.filter((job) => job.action === "notion.page.create");

    assert.equal(teamsJobs.length, 1);
    assert.equal(notionJobs.length, 1);
    assert.equal(typeof teamsJobs[0].dedupe_key, "string");
    assert.equal(typeof notionJobs[0].dedupe_key, "string");

    const dedupeLogs = db.prepare("SELECT action, details FROM audit_logs WHERE workspace_id = ? AND action = 'task.automation.job.deduped'")
      .all(workspaceId) as Array<{ action: string; details: string | null }>;
    assert.equal(dedupeLogs.length, 2);
  } finally {
    cleanup();
  }
});
