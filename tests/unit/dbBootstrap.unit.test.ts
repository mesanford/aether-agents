import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { bootstrapDatabase } from "../../src/server/dbBootstrap.ts";

function createTempDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "aether-db-bootstrap-"));
  const dbPath = path.join(dir, "test.db");
  const db = new Database(dbPath);

  return {
    db,
    cleanup() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("bootstrapDatabase migrates legacy leads, creates default workspace, and seeds workspace content", (t) => {
  const { db, cleanup } = createTempDb();
  t.after(cleanup);

  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT,
      name TEXT,
      google_id TEXT UNIQUE
    );

    CREATE TABLE leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT,
      company TEXT,
      location TEXT,
      email TEXT,
      status TEXT DEFAULT 'New Lead',
      sequence TEXT DEFAULT 'None',
      linkedin_url TEXT,
      avatar TEXT
    );
  `);

  const userInsert = db.prepare("INSERT INTO users (email, name) VALUES (?, ?)").run("legacy@example.com", "Legacy User");
  db.prepare("INSERT INTO leads (name, company, email, status) VALUES (?, ?, ?, ?)").run(
    "Legacy Lead",
    "Legacy Co",
    "lead@example.com",
    "New Lead",
  );

  bootstrapDatabase(db);

  const leadsColumns = db.prepare("PRAGMA table_info(leads)").all() as Array<{ name: string }>;
  const agentColumns = db.prepare("PRAGMA table_info(agents)").all() as Array<{ name: string }>;
  const taskColumns = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
  const wordpressColumns = db.prepare("PRAGMA table_info(wordpress_connections)").all() as Array<{ name: string }>;
  const hubspotColumns = db.prepare("PRAGMA table_info(hubspot_connections)").all() as Array<{ name: string }>;
  const linkedinColumns = db.prepare("PRAGMA table_info(linkedin_connections)").all() as Array<{ name: string }>;
  const bufferColumns = db.prepare("PRAGMA table_info(buffer_connections)").all() as Array<{ name: string }>;
  const twilioColumns = db.prepare("PRAGMA table_info(twilio_connections)").all() as Array<{ name: string }>;
  const slackColumns = db.prepare("PRAGMA table_info(slack_connections)").all() as Array<{ name: string }>;
  const teamsColumns = db.prepare("PRAGMA table_info(teams_connections)").all() as Array<{ name: string }>;
  const notionColumns = db.prepare("PRAGMA table_info(notion_connections)").all() as Array<{ name: string }>;
  const webhookSecretColumns = db.prepare("PRAGMA table_info(workspace_webhook_secrets)").all() as Array<{ name: string }>;
  const automationJobColumns = db.prepare("PRAGMA table_info(automation_jobs)").all() as Array<{ name: string }>;
  const googleDefaultsColumns = db.prepare("PRAGMA table_info(workspace_google_defaults)").all() as Array<{ name: string }>;
  assert.ok(leadsColumns.some((column) => column.name === "workspace_id"));
  assert.ok(leadsColumns.some((column) => column.name === "notes"));
  assert.ok(agentColumns.some((column) => column.name === "personality"));
  assert.ok(wordpressColumns.some((column) => column.name === "workspace_id"));
  assert.ok(wordpressColumns.some((column) => column.name === "site_url"));
  assert.ok(wordpressColumns.some((column) => column.name === "username"));
  assert.ok(wordpressColumns.some((column) => column.name === "app_password"));
  assert.ok(hubspotColumns.some((column) => column.name === "workspace_id"));
  assert.ok(hubspotColumns.some((column) => column.name === "access_token"));
  assert.ok(hubspotColumns.some((column) => column.name === "portal_id"));
  assert.ok(hubspotColumns.some((column) => column.name === "account_name"));
  assert.ok(linkedinColumns.some((column) => column.name === "workspace_id"));
  assert.ok(linkedinColumns.some((column) => column.name === "access_token"));
  assert.ok(linkedinColumns.some((column) => column.name === "author_urn"));
  assert.ok(linkedinColumns.some((column) => column.name === "account_name"));
  assert.ok(bufferColumns.some((column) => column.name === "workspace_id"));
  assert.ok(bufferColumns.some((column) => column.name === "access_token"));
  assert.ok(twilioColumns.some((column) => column.name === "workspace_id"));
  assert.ok(twilioColumns.some((column) => column.name === "account_sid"));
  assert.ok(twilioColumns.some((column) => column.name === "auth_token"));
  assert.ok(twilioColumns.some((column) => column.name === "from_number"));
  assert.ok(slackColumns.some((column) => column.name === "workspace_id"));
  assert.ok(slackColumns.some((column) => column.name === "bot_token"));
  assert.ok(slackColumns.some((column) => column.name === "default_channel"));
  assert.ok(slackColumns.some((column) => column.name === "team_id"));
  assert.ok(slackColumns.some((column) => column.name === "team_name"));
  assert.ok(slackColumns.some((column) => column.name === "bot_user_id"));
  assert.ok(teamsColumns.some((column) => column.name === "workspace_id"));
  assert.ok(teamsColumns.some((column) => column.name === "webhook_url"));
  assert.ok(teamsColumns.some((column) => column.name === "default_channel_name"));
  assert.ok(notionColumns.some((column) => column.name === "workspace_id"));
  assert.ok(notionColumns.some((column) => column.name === "integration_token"));
  assert.ok(notionColumns.some((column) => column.name === "bot_name"));
  assert.ok(notionColumns.some((column) => column.name === "default_parent_page_id"));
  assert.ok(webhookSecretColumns.some((column) => column.name === "workspace_id"));
  assert.ok(webhookSecretColumns.some((column) => column.name === "provider"));
  assert.ok(webhookSecretColumns.some((column) => column.name === "secret"));
  assert.ok(automationJobColumns.some((column) => column.name === "workspace_id"));
  assert.ok(automationJobColumns.some((column) => column.name === "source"));
  assert.ok(automationJobColumns.some((column) => column.name === "status"));
  assert.ok(automationJobColumns.some((column) => column.name === "attempts"));
  assert.ok(automationJobColumns.some((column) => column.name === "max_attempts"));
  assert.ok(automationJobColumns.some((column) => column.name === "next_run_at"));
  assert.ok(automationJobColumns.some((column) => column.name === "dedupe_key"));
  assert.ok(automationJobColumns.some((column) => column.name === "dead_lettered_at"));
  assert.ok(googleDefaultsColumns.some((column) => column.name === "workspace_id"));
  assert.ok(googleDefaultsColumns.some((column) => column.name === "analytics_property_id"));
  assert.ok(googleDefaultsColumns.some((column) => column.name === "search_console_site_url"));
  assert.ok(taskColumns.some((column) => column.name === "execution_type"));
  assert.ok(taskColumns.some((column) => column.name === "artifact_type"));
  assert.ok(taskColumns.some((column) => column.name === "artifact_payload"));
  assert.ok(taskColumns.some((column) => column.name === "output_summary"));
  assert.ok(taskColumns.some((column) => column.name === "last_error"));
  assert.ok(taskColumns.some((column) => column.name === "last_run_at"));
  assert.ok(taskColumns.some((column) => column.name === "started_at"));
  assert.ok(taskColumns.some((column) => column.name === "completed_at"));

  const workspace = db.prepare("SELECT id, owner_id, name FROM workspaces WHERE owner_id = ?").get(userInsert.lastInsertRowid) as {
    id: number;
    owner_id: number;
    name: string;
  };
  assert.equal(workspace.owner_id, userInsert.lastInsertRowid);
  assert.match(workspace.name, /Legacy User/);

  const membership = db.prepare("SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?").get(workspace.id, userInsert.lastInsertRowid) as {
    role: string;
  };
  assert.equal(membership.role, "owner");

  const migratedLead = db.prepare("SELECT workspace_id FROM leads WHERE name = ?").get("Legacy Lead") as { workspace_id: number };
  assert.equal(migratedLead.workspace_id, workspace.id);

  const seededAgents = db.prepare("SELECT COUNT(*) as count FROM agents WHERE workspace_id = ?").get(workspace.id) as { count: number };
  const seededTasks = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE workspace_id = ?").get(workspace.id) as { count: number };
  const seededMessages = db.prepare("SELECT COUNT(*) as count FROM messages WHERE workspace_id = ?").get(workspace.id) as { count: number };

  assert.ok(seededAgents.count > 0);
  assert.ok(seededTasks.count > 0);
  assert.ok(seededMessages.count > 0);
});

test("seedWorkspace is idempotent for a newly created workspace", (t) => {
  const { db, cleanup } = createTempDb();
  t.after(cleanup);

  const { seedWorkspace } = bootstrapDatabase(db);

  const userInsert = db.prepare("INSERT INTO users (email, name) VALUES (?, ?)").run("new@example.com", "New User");
  const workspaceInsert = db.prepare("INSERT INTO workspaces (name, owner_id) VALUES (?, ?)").run("Fresh Workspace", userInsert.lastInsertRowid);
  db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)").run(
    workspaceInsert.lastInsertRowid,
    userInsert.lastInsertRowid,
    "owner",
  );

  seedWorkspace(workspaceInsert.lastInsertRowid);
  const firstAgentCount = (db.prepare("SELECT COUNT(*) as count FROM agents WHERE workspace_id = ?").get(workspaceInsert.lastInsertRowid) as { count: number }).count;
  const firstTaskCount = (db.prepare("SELECT COUNT(*) as count FROM tasks WHERE workspace_id = ?").get(workspaceInsert.lastInsertRowid) as { count: number }).count;
  const firstMessageCount = (db.prepare("SELECT COUNT(*) as count FROM messages WHERE workspace_id = ?").get(workspaceInsert.lastInsertRowid) as { count: number }).count;

  seedWorkspace(workspaceInsert.lastInsertRowid);
  const secondAgentCount = (db.prepare("SELECT COUNT(*) as count FROM agents WHERE workspace_id = ?").get(workspaceInsert.lastInsertRowid) as { count: number }).count;
  const secondTaskCount = (db.prepare("SELECT COUNT(*) as count FROM tasks WHERE workspace_id = ?").get(workspaceInsert.lastInsertRowid) as { count: number }).count;
  const secondMessageCount = (db.prepare("SELECT COUNT(*) as count FROM messages WHERE workspace_id = ?").get(workspaceInsert.lastInsertRowid) as { count: number }).count;

  assert.ok(firstAgentCount > 0);
  assert.ok(firstTaskCount > 0);
  assert.ok(firstMessageCount > 0);
  assert.equal(secondAgentCount, firstAgentCount);
  assert.equal(secondTaskCount, firstTaskCount);
  assert.equal(secondMessageCount, firstMessageCount);
});
