import { AUTH_ANONYMOUS_REPAIR_SQL } from "./supabase-auth-anonymous-repair-sql.mjs";

console.log("DeepSpec Supabase anonymous Auth repair SQL");
console.log("");
console.log("Use this only after the Auth log or diagnostics show the standard auth.users trigger calls public.handle_new_user.");
console.log("It changes the trigger function so anonymous users can be created without a profile-row insert blocking signup.");
console.log("");
console.log(AUTH_ANONYMOUS_REPAIR_SQL);
