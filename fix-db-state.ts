import { bootstrapDatabase } from "./src/server/dbBootstrap";
import { PostgresShim } from "./src/server/db";

async function run() {
  const db = new PostgresShim();
  
  const workspaces = await db.prepare("SELECT * FROM workspaces").all();
  console.log("Workspaces:", workspaces);
  
  const memberships = await db.prepare("SELECT * FROM workspace_members").all();
  console.log("Memberships:", memberships);
  
  const users = await db.prepare("SELECT * FROM users").all();
  console.log("Users:", users);
}

run().catch(console.error);
