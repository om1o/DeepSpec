import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(process.cwd(), "supabase", "migrations", "20260518000100_deepspec_secure_foundation.sql");
const sql = readFileSync(migrationPath, "utf8");

console.log("DeepSpec Supabase migration SQL");
console.log("================================");
console.log("");
console.log("Paste the SQL below into Supabase Dashboard -> SQL Editor, run it, then rerun:");
console.log("");
console.log("  npm run verify:supabase");
console.log("");
console.log("Do not paste this into a browser console. Run it only in the Supabase SQL Editor for the DeepSpec project.");
console.log("");
console.log(sql);
