import { spawnSync } from "node:child_process";
import { AUTH_ANONYMOUS_REPAIR_SQL } from "./supabase-auth-anonymous-repair-sql.mjs";

const CONFIRM_FLAG = "--confirm-standard-profile-trigger";

if (!process.argv.includes(CONFIRM_FLAG)) {
  fail(
    [
      "Refusing to apply Supabase Auth repair without explicit confirmation.",
      "First run `npm run supabase:print-auth-diagnostics` in Supabase SQL Editor and confirm the failing path is:",
      "auth.users -> public.handle_new_user() -> public.profiles",
      `Then rerun with: npm run supabase:apply-auth-anonymous-repair -- ${CONFIRM_FLAG}`,
    ].join("\n"),
  );
}

const connection = getPostgresConnectionEnv(process.env);
if (!connection.ok) {
  fail(connection.message);
}

const psql = process.env.PSQL_BIN || "psql";
const result = spawnSync(psql, ["--no-psqlrc", "--set", "ON_ERROR_STOP=1"], {
  encoding: "utf8",
  env: {
    ...process.env,
    ...connection.env,
  },
  input: AUTH_ANONYMOUS_REPAIR_SQL,
  stdio: ["pipe", "pipe", "pipe"],
});

if (result.error) {
  const detail = result.error.code === "ENOENT" ? "`psql` was not found on PATH. Install PostgreSQL client tools or set PSQL_BIN." : result.error.message;
  fail(`Supabase Auth repair did not run: ${detail}`);
}

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.status !== 0) {
  fail(`Supabase Auth repair failed with exit code ${result.status ?? "unknown"}. Inspect the psql output above before retrying.`);
}

console.log("Supabase Auth repair SQL applied. Rerun `npm run verify:supabase` and require all 6 checks to pass.");

function getPostgresConnectionEnv(env) {
  const rawUrl = env.SUPABASE_DB_URL || env.DATABASE_URL;
  if (rawUrl) {
    return parsePostgresUrl(rawUrl, env);
  }

  if (env.PGHOST && env.PGUSER && env.PGDATABASE) {
    return {
      ok: true,
      env: pickPgEnv(env),
    };
  }

  return {
    ok: false,
    message: [
      "Missing a privileged Postgres connection.",
      "Set SUPABASE_DB_URL or DATABASE_URL to the Supabase database connection string,",
      "or set PGHOST, PGUSER, PGDATABASE, and PGPASSWORD/PGPASSFILE for psql.",
      "Do not use VITE_SUPABASE_PUBLISHABLE_KEY here; browser keys cannot repair Auth trigger functions.",
    ].join("\n"),
  };
}

function parsePostgresUrl(rawUrl, env) {
  let url;

  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, message: "SUPABASE_DB_URL / DATABASE_URL is not a valid URL." };
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    return { ok: false, message: "SUPABASE_DB_URL / DATABASE_URL must use postgres:// or postgresql://." };
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const pgEnv = {
    PGDATABASE: database || "postgres",
    PGHOST: url.hostname,
    PGPASSWORD: decodeURIComponent(url.password),
    PGPORT: url.port || "5432",
    PGSSLMODE: url.searchParams.get("sslmode") || env.PGSSLMODE || "require",
    PGUSER: decodeURIComponent(url.username),
  };

  if (!pgEnv.PGHOST || !pgEnv.PGUSER || !pgEnv.PGPASSWORD) {
    return { ok: false, message: "Postgres URL must include host, user, and password." };
  }

  return { ok: true, env: pgEnv };
}

function pickPgEnv(env) {
  const keys = ["PGDATABASE", "PGHOST", "PGPASSWORD", "PGPASSFILE", "PGPORT", "PGSSLMODE", "PGUSER"];
  return Object.fromEntries(keys.filter((key) => env[key]).map((key) => [key, env[key]]));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
