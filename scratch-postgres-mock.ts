import { PostgresShim } from "./src/server/db.ts";
import { bootstrapDatabase } from "./src/server/dbBootstrap.ts";

const db = new PostgresShim();
db.pool.query = async (queryText: string, values?: any[]) => {
  console.log("QUERY:", queryText);
  if (values) console.log("VALUES:", values);
  if (queryText.includes("SELECT COUNT(*) as count FROM agents")) {
    return { rows: [{ count: "0" }] };
  }
  return { rowCount: 1, rows: [] };
};

async function test() {
  const { seedWorkspace } = await bootstrapDatabase(db);
  console.log("Testing seedWorkspace...");
  try {
    await seedWorkspace(2);
    console.log("Success!");
  } catch(e) {
    console.error("Error:", e);
  }
}
test();
