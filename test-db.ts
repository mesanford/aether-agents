import db from "./src/server/db.ts";
import { bootstrapDatabase } from "./src/server/dbBootstrap.ts";

async function main() {
  try {
    await bootstrapDatabase(db);
    console.log("SUCCESS");
  } catch (err) {
    console.error("ERROR", err);
  } finally {
    process.exit(0);
  }
}
main();
