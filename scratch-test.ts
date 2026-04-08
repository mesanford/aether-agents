import fs from 'fs';

const tables = [
  "sequence_events", "sequence_enrollments", "messages", "approval_requests",
  "tasks", "agents", "leads", "sales_sequences", "workspace_members",
  "workspace_invitations", "workspace_google_defaults", "wordpress_connections",
  "hubspot_connections", "linkedin_connections", "buffer_connections",
  "twilio_connections", "slack_connections", "teams_connections",
  "notion_connections", "stan_memory_ledger", "media_assets",
  "workspace_automation_settings", "knowledge_documents", "audit_logs",
  "workspace_webhook_secrets", "automation_jobs", "workspaces"
];

const dbBootstrapCode = fs.readFileSync('./src/server/dbBootstrap.ts', 'utf8');

for (const table of tables) {
  if (!dbBootstrapCode.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) {
    console.log("Missing table in dbBootstrap.ts:", table);
  }
}
