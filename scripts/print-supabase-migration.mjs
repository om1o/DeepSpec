import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join(process.cwd(), "supabase", "migrations");
const migrationFiles = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const sql = migrationFiles
  .map((name) => [
    `-- ${name}`,
    readFileSync(join(migrationsDir, name), "utf8").trim(),
  ].join("\n"))
  .join("\n\n");

console.log("DeepSpec Supabase migration SQL");
console.log("================================");
console.log("");
console.log("Paste the SQL below into Supabase Dashboard -> SQL Editor, run it in order, then rerun:");
console.log("");
console.log("  npm run verify:supabase");
console.log("");
console.log("Do not paste this into a browser console. Run it only in the Supabase SQL Editor for the DeepSpec project.");
console.log("");
console.log(sql);
