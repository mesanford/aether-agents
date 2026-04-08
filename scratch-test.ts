import { Pool } from "pg";
console.log("Starting test...");
async function test() {
  const pool = new Pool();
  try {
    const res = await pool.query("SELECT $1::int", [undefined]);
    console.log("Executed perfectly:", res.rows);
  } catch (e) {
    console.log("Failed:", e.message);
  }
}
test();
