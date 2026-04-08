import { PostgresShim } from "./src/server/db.ts";

async function testDelete() {
  const db = new PostgresShim();
  const queries = [
    "DELETE FROM sequence_events WHERE workspace_id = ?",
    "DELETE FROM sequence_enrollments WHERE workspace_id = ?",
    "DELETE FROM messages WHERE workspace_id = ?",
    "DELETE FROM approval_requests WHERE workspace_id = ?",
    "DELETE FROM tasks WHERE workspace_id = ?",
    "DELETE FROM agents WHERE workspace_id = ?",
    "DELETE FROM leads WHERE workspace_id = ?",
    "DELETE FROM sales_sequences WHERE workspace_id = ?",
    "DELETE FROM workspace_members WHERE workspace_id = ?",
    "DELETE FROM workspace_invitations WHERE workspace_id = ?",
    "DELETE FROM workspace_google_defaults WHERE workspace_id = ?",
    "DELETE FROM wordpress_connections WHERE workspace_id = ?",
    "DELETE FROM hubspot_connections WHERE workspace_id = ?",
    "DELETE FROM linkedin_connections WHERE workspace_id = ?",
    "DELETE FROM buffer_connections WHERE workspace_id = ?",
    "DELETE FROM twilio_connections WHERE workspace_id = ?",
    "DELETE FROM slack_connections WHERE workspace_id = ?",
    "DELETE FROM teams_connections WHERE workspace_id = ?",
    "DELETE FROM notion_connections WHERE workspace_id = ?",
    "DELETE FROM stan_memory_ledger WHERE workspace_id = ?",
    "DELETE FROM media_assets WHERE workspace_id = ?",
    "DELETE FROM workspace_automation_settings WHERE workspace_id = ?",
    "DELETE FROM knowledge_documents WHERE workspace_id = ?",
    "DELETE FROM audit_logs WHERE workspace_id = ?",
    "DELETE FROM workspace_webhook_secrets WHERE workspace_id = ?",
    "DELETE FROM automation_jobs WHERE workspace_id = ?",
    "DELETE FROM workspaces WHERE id = ?"
  ];
  
  const workspaceId = 1;
  const pool = db['pool'];

  for (const q of queries) {
    try {
      console.log(`Running: ${q}`);
      await pool.query(q.replace('?', '$1'), [workspaceId]);
    } catch (err: any) {
      console.error(`ERROR AT: ${q}`);
      console.error(err.message);
      break;
    }
  }
}
testDelete();
