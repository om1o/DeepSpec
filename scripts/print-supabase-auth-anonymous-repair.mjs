import { AUTH_ANONYMOUS_REPAIR_SQL } from "./supabase-auth-anonymous-repair-sql.mjs";

console.log("DeepSpec Supabase anonymous Auth repair SQL");
console.log("");
console.log("Use this only after the Auth log or diagnostics show this exact failing path:");
console.log("auth.users -> public.handle_new_user() -> public.profiles");
console.log("");
console.log("It changes that trigger function so anonymous users can be created without a profile-row insert blocking signup.");
console.log("If diagnostics show a different trigger, hook, table, or required column, fix that specific object instead.");
console.log("");
console.log(AUTH_ANONYMOUS_REPAIR_SQL);
