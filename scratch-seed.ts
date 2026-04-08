import { db } from "./src/server/db.ts";
import { bootstrapDatabase } from "./src/server/dbBootstrap.ts";

async function test() {
  const { seedWorkspace } = await bootstrapDatabase(db);
  console.log("Bootstrapped. Testing seed...");
  try {
    await seedWorkspace(1);
    console.log("Success!");
  } catch (err) {
    console.error("Failed to seed:");
    console.error(err);
  }
}
test();
