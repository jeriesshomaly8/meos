-- Table privileges for the Supabase roles.
--
-- RLS decides which ROWS a caller may touch; GRANT decides whether the role may
-- touch the table at all. Enabling RLS without grants yields
-- "permission denied for table ..." before any policy is consulted.
--
-- `anon` is deliberately given nothing: MeOS requires a signed-in user for
-- every record, so unauthenticated callers should be rejected at the grant
-- layer rather than relying on policies to return zero rows.

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public
  to authenticated, service_role;
grant usage, select on all sequences in schema public
  to authenticated, service_role;
grant execute on all functions in schema public
  to authenticated, service_role;

-- Same privileges for anything added by later migrations.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to authenticated, service_role;
