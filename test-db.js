const Database = require('better-sqlite3');
const db = new Database('./crm.db');
try {
  let workspaceId = Number.parseInt("thread_abc", 10);
  console.log("Workspace ID parsed as:", workspaceId);
  db.prepare(`
    INSERT INTO media_assets (workspace_id, name, type, category, thumbnail, size, author)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(workspaceId, "test", "image", "uploads", "test", "test", "author");
  console.log("INSERT SUCCESS");
} catch(e) {
  console.log("DB ERROR:", e.message);
}
