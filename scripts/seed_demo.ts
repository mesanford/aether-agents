import { config } from 'dotenv';
config();
import Database from 'better-sqlite3';
const db = new Database('./crm.db');
import { MasterRegistry } from '../src/server/ai/tools';

async function generateSeedData() {
  const workspaceId = 1;

  console.log("1. Activating Gemini Tool 'generate_image'...");
  let imageUrl = "https://images.unsplash.com/photo-1611162617474-5b21e879e113";
  try {
    const imageResult = await MasterRegistry['generate_image'].executor({
      prompt: "A futuristic AI robot planning social media marketing strategy",
      style: "neon cyberpunk"
    }, { configurable: { thread_id: `thread_1_social-media-manager:${workspaceId}` } });
    
    if (imageResult.includes("data:image/jpeg;base64")) {
      imageUrl = imageResult.split("URL: ")[1];
      console.log("✅ Successfully generated image via Gemini!");
    } else {
      console.log("⚠️ Image generation returned non-base64 fallback:", imageResult);
    }
  } catch (err: any) {
    console.log("⚠️ Failed to generate image via API, using fallback. Error:", err.message);
  }

  console.log("2. Saving artifact directly into 'tasks' table for Sonny...");
  const draftArtifact = JSON.stringify({
    title: "10 AI Strategies for Marketing",
    body: "Robotics and AI represent the leading frontier of technical automation...",
    bullets: ["Strategy 1", "Strategy 2"],
    imageUrl: imageUrl
  });

  const taskId = `task-${Date.now()}-sonny`;
  db.prepare(`
    INSERT INTO tasks (id, workspace_id, title, description, assignee_id, status, execution_type, artifact_payload, due_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    taskId, workspaceId, "Futuristic AI Marketing Post",
    "Post draft about AI strategy", "social-media-manager:1", "todo", "social_post", draftArtifact, "Next Tuesday"
  );
  console.log(`✅ Saved Sonny Task: ${taskId}`);

  console.log("3. Saving sequence array into 'sales_sequences' table for Stan...");
  db.exec(`
    CREATE TABLE IF NOT EXISTS sales_sequences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      status TEXT DEFAULT 'Draft',
      schedule TEXT DEFAULT 'Runs every day',
      steps TEXT NOT NULL DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    )
  `);
  
  const steps = JSON.stringify([
    { id: 1, type: "Enroll", title: "Enroll leads", subtitle: "Status: New Lead" },
    { id: 2, type: "Email", title: "Send email", subtitle: "Re: Tech CTO Outreach Initiative" },
    { id: 3, type: "LinkedIn", title: "Send Invitation", subtitle: "Send connection request" }
  ]);
  
  db.prepare(`
    INSERT INTO sales_sequences (workspace_id, title, status, steps)
    VALUES (?, ?, ?, ?)
  `).run(workspaceId, "Enterprise SaaS CTO Outreach", "Running", steps);
  console.log("✅ Saved Stan Sequence!");

  console.log("🎉 Seed generation run complete!");
}

generateSeedData().catch(console.error);
