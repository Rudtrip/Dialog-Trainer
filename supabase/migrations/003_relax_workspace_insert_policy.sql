-- Temporary MVP/dev relaxation for workspace creation.
-- WARNING: This weakens tenant safety and should be revisited before production.

drop policy if exists workspaces_owner_insert on public.workspaces;

create policy workspaces_authenticated_insert
on public.workspaces
for insert
to authenticated
with check (true);
