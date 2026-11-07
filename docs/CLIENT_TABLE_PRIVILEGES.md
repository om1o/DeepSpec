# Client table administration

`20261103234956_remove_client_table_administration.sql` removes `TRUNCATE`,
`REFERENCES`, and `TRIGGER` from `PUBLIC`, `anon`, and `authenticated` on the 23
named application tables. On PostgreSQL 17 and later it also removes `MAINTAIN`.
Ordinary table DML, column write allowlists, RLS policies, existing foreign keys
and triggers, and `service_role` grants are unchanged. In particular, the billing
purchase ledger remains SELECT/INSERT only for `service_role`.

The migration changes only the `postgres` creator's table defaults in `public`.
The observed database has schema-specific grants and no global default grants.
Per-schema revocation cannot remove a global default grant. A different database
must be checked for that difference before claiming equivalent protection.

The platform-owned `supabase_admin` role has separate defaults. The application's
non-superuser `postgres` role cannot change them; this migration neither attempts
that change nor grants itself more authority. Tables subsequently created by
`supabase_admin` or another creator need a separate grant review. Existing tables
outside the explicit list and schemas such as `auth` and `storage` are outside
this migration. New application tables still need explicit grants and RLS.

## Disposable validation

The SQL tests in `supabase/tests` use transactions and raised assertions, not
pgTAP. Run `client_table_administration.sql` only on a disposable local database,
after the application migrations, as `postgres` with permission to create a test
schema. It creates synthetic tables, a function, and a schema, then rolls them
back. It must never target a linked production database.

```sh
psql "$DISPOSABLE_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/client_table_administration.sql
```

In addition to this post-migration test, validation must establish a failing
baseline and prove the exact administrative commands succeeded on synthetic
fixtures before the actual migration. Compare ordinary table/column DML and all
service-role privileges before and after; prove existing trigger execution,
foreign-key enforcement, and RLS isolation still work. A synthetic PostgreSQL
fixture does not prove Supabase Auth, PostgREST, hosted RPCs, or concurrent billing
behavior. The PostgreSQL version guard does not substitute for an older-engine
test when deploying to PostgreSQL 15 or 16.

References: [PostgreSQL privileges](https://www.postgresql.org/docs/17/ddl-priv.html),
[REVOKE semantics](https://www.postgresql.org/docs/17/sql-revoke.html), and
[creator-specific default privileges](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html).
