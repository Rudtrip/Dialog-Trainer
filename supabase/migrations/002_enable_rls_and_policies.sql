-- Dialog Trainer MVP RLS policies
-- Supabase/Postgres migration 002

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
  );
$$;

create or replace function public.is_workspace_editor(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.role in ('owner', 'editor')
  );
$$;

create or replace function public.is_workspace_owner(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.role = 'owner'
  );
$$;

create or replace function public.add_workspace_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.owner_user_id, 'owner')
  on conflict (workspace_id, user_id)
  do update set
    role = 'owner',
    updated_at = timezone('utc', now());

  return new;
end;
$$;

create trigger trg_workspaces_add_owner_membership
after insert on public.workspaces
for each row execute function public.add_workspace_owner_membership();

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.simulators enable row level security;
alter table public.scenario_versions enable row level security;
alter table public.scenario_steps enable row level security;
alter table public.scenario_choices enable row level security;
alter table public.scenario_endings enable row level security;
alter table public.scoring_policies enable row level security;
alter table public.ui_configs enable row level security;
alter table public.media_assets enable row level security;
alter table public.publications enable row level security;
alter table public.export_artifacts enable row level security;
alter table public.attempts enable row level security;
alter table public.attempt_events enable row level security;

create policy profiles_self_select
on public.profiles for select
to authenticated
using (user_id = auth.uid());

create policy profiles_self_insert
on public.profiles for insert
to authenticated
with check (user_id = auth.uid());

create policy profiles_self_update
on public.profiles for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy workspaces_member_select
on public.workspaces for select
to authenticated
using (public.is_workspace_member(id));

create policy workspaces_owner_insert
on public.workspaces for insert
to authenticated
with check (owner_user_id = auth.uid());

create policy workspaces_owner_update
on public.workspaces for update
to authenticated
using (public.is_workspace_owner(id))
with check (public.is_workspace_owner(id));

create policy workspace_members_member_select
on public.workspace_members for select
to authenticated
using (public.is_workspace_member(workspace_id));

create policy workspace_members_owner_insert
on public.workspace_members for insert
to authenticated
with check (public.is_workspace_owner(workspace_id));

create policy workspace_members_owner_update
on public.workspace_members for update
to authenticated
using (public.is_workspace_owner(workspace_id))
with check (public.is_workspace_owner(workspace_id));

create policy workspace_members_owner_delete
on public.workspace_members for delete
to authenticated
using (public.is_workspace_owner(workspace_id));

create policy simulators_member_select
on public.simulators for select
to authenticated
using (public.is_workspace_member(workspace_id));

create policy simulators_editor_insert
on public.simulators for insert
to authenticated
with check (
  public.is_workspace_editor(workspace_id)
  and created_by = auth.uid()
);

create policy simulators_editor_update
on public.simulators for update
to authenticated
using (public.is_workspace_editor(workspace_id))
with check (public.is_workspace_editor(workspace_id));

create policy simulators_editor_delete
on public.simulators for delete
to authenticated
using (public.is_workspace_editor(workspace_id));

create policy scenario_versions_member_select
on public.scenario_versions for select
to authenticated
using (
  public.is_workspace_member(
    (select s.workspace_id from public.simulators s where s.id = simulator_id)
  )
);

create policy scenario_versions_editor_insert
on public.scenario_versions for insert
to authenticated
with check (
  created_by = auth.uid()
  and public.is_workspace_editor(
    (select s.workspace_id from public.simulators s where s.id = simulator_id)
  )
);

create policy scenario_versions_editor_update
on public.scenario_versions for update
to authenticated
using (
  public.is_workspace_editor(
    (select s.workspace_id from public.simulators s where s.id = simulator_id)
  )
)
with check (
  public.is_workspace_editor(
    (select s.workspace_id from public.simulators s where s.id = simulator_id)
  )
);

create policy scenario_versions_editor_delete
on public.scenario_versions for delete
to authenticated
using (
  public.is_workspace_editor(
    (select s.workspace_id from public.simulators s where s.id = simulator_id)
  )
);

create policy media_assets_member_select
on public.media_assets for select
to authenticated
using (public.is_workspace_member(workspace_id));

create policy media_assets_editor_insert
on public.media_assets for insert
to authenticated
with check (
  uploaded_by = auth.uid()
  and public.is_workspace_editor(workspace_id)
);

create policy media_assets_editor_update
on public.media_assets for update
to authenticated
using (public.is_workspace_editor(workspace_id))
with check (public.is_workspace_editor(workspace_id));

create policy media_assets_editor_delete
on public.media_assets for delete
to authenticated
using (public.is_workspace_editor(workspace_id));

create policy scenario_steps_member_select
on public.scenario_steps for select
to authenticated
using (
  public.is_workspace_member(
    (
      select s.workspace_id
      from public.scenario_versions sv
      join public.simulators s on s.id = sv.simulator_id
      where sv.id = scenario_version_id
    )
  )
);

create policy scenario_steps_editor_write
on public.scenario_steps for all
to authenticated
using (
  exists (
    select 1
    from public.scenario_versions sv
    join public.simulators s on s.id = sv.simulator_id
    where sv.id = scenario_version_id
      and sv.state = 'draft'
      and public.is_workspace_editor(s.workspace_id)
  )
)
with check (
  exists (
    select 1
    from public.scenario_versions sv
    join public.simulators s on s.id = sv.simulator_id
    where sv.id = scenario_version_id
      and sv.state = 'draft'
      and public.is_workspace_editor(s.workspace_id)
  )
);

create policy scenario_choices_member_select
on public.scenario_choices for select
to authenticated
using (
  public.is_workspace_member(
    (
      select s.workspace_id
      from public.scenario_versions sv
      join public.simulators s on s.id = sv.simulator_id
      where sv.id = scenario_version_id
    )
  )
);

create policy scenario_choices_editor_write
on public.scenario_choices for all
to authenticated
using (
  exists (
    select 1
    from public.scenario_versions sv
    join public.simulators s on s.id = sv.simulator_id
    where sv.id = scenario_version_id
      and sv.state = 'draft'
      and public.is_workspace_editor(s.workspace_id)
  )
)
with check (
  exists (
    select 1
    from public.scenario_versions sv
    join public.simulators s on s.id = sv.simulator_id
    where sv.id = scenario_version_id
      and sv.state = 'draft'
      and public.is_workspace_editor(s.workspace_id)
  )
);

create policy scenario_endings_member_select
on public.scenario_endings for select
to authenticated
using (
  public.is_workspace_member(
    (
      select s.workspace_id
      from public.scenario_versions sv
      join public.simulators s on s.id = sv.simulator_id
      where sv.id = scenario_version_id
    )
  )
);

create policy scenario_endings_editor_write
on public.scenario_endings for all
to authenticated
using (
  exists (
    select 1
    from public.scenario_versions sv
    join public.simulators s on s.id = sv.simulator_id
    where sv.id = scenario_version_id
      and sv.state = 'draft'
      and public.is_workspace_editor(s.workspace_id)
  )
)
with check (
  exists (
    select 1
    from public.scenario_versions sv
    join public.simulators s on s.id = sv.simulator_id
    where sv.id = scenario_version_id
      and sv.state = 'draft'
      and public.is_workspace_editor(s.workspace_id)
  )
);

create policy scoring_policies_member_select
on public.scoring_policies for select
to authenticated
using (
  public.is_workspace_member(
    (
      select s.workspace_id
      from public.scenario_versions sv
      join public.simulators s on s.id = sv.simulator_id
      where sv.id = scenario_version_id
    )
  )
);

create policy scoring_policies_editor_write
on public.scoring_policies for all
to authenticated
using (
  exists (
    select 1
    from public.scenario_versions sv
    join public.simulators s on s.id = sv.simulator_id
    where sv.id = scenario_version_id
      and sv.state = 'draft'
      and public.is_workspace_editor(s.workspace_id)
  )
)
with check (
  exists (
    select 1
    from public.scenario_versions sv
    join public.simulators s on s.id = sv.simulator_id
    where sv.id = scenario_version_id
      and sv.state = 'draft'
      and public.is_workspace_editor(s.workspace_id)
  )
);

create policy ui_configs_member_select
on public.ui_configs for select
to authenticated
using (
  public.is_workspace_member(
    (
      select s.workspace_id
      from public.scenario_versions sv
      join public.simulators s on s.id = sv.simulator_id
      where sv.id = scenario_version_id
    )
  )
);

create policy ui_configs_editor_write
on public.ui_configs for all
to authenticated
using (
  exists (
    select 1
    from public.scenario_versions sv
    join public.simulators s on s.id = sv.simulator_id
    where sv.id = scenario_version_id
      and sv.state = 'draft'
      and public.is_workspace_editor(s.workspace_id)
  )
)
with check (
  exists (
    select 1
    from public.scenario_versions sv
    join public.simulators s on s.id = sv.simulator_id
    where sv.id = scenario_version_id
      and sv.state = 'draft'
      and public.is_workspace_editor(s.workspace_id)
  )
);

create policy publications_public_select
on public.publications for select
to anon, authenticated
using (is_active = true);

create policy publications_member_select
on public.publications for select
to authenticated
using (
  public.is_workspace_member(
    (select s.workspace_id from public.simulators s where s.id = simulator_id)
  )
);

create policy publications_editor_insert
on public.publications for insert
to authenticated
with check (
  published_by = auth.uid()
  and public.is_workspace_editor(
    (select s.workspace_id from public.simulators s where s.id = simulator_id)
  )
);

create policy publications_editor_update
on public.publications for update
to authenticated
using (
  public.is_workspace_editor(
    (select s.workspace_id from public.simulators s where s.id = simulator_id)
  )
)
with check (
  public.is_workspace_editor(
    (select s.workspace_id from public.simulators s where s.id = simulator_id)
  )
);

create policy publications_editor_delete
on public.publications for delete
to authenticated
using (
  public.is_workspace_editor(
    (select s.workspace_id from public.simulators s where s.id = simulator_id)
  )
);

create policy export_artifacts_public_select
on public.export_artifacts for select
to anon, authenticated
using (
  exists (
    select 1
    from public.publications p
    where p.id = publication_id
      and p.is_active = true
  )
);

create policy export_artifacts_member_select
on public.export_artifacts for select
to authenticated
using (
  exists (
    select 1
    from public.publications p
    join public.simulators s on s.id = p.simulator_id
    where p.id = publication_id
      and public.is_workspace_member(s.workspace_id)
  )
);

create policy export_artifacts_editor_write
on public.export_artifacts for all
to authenticated
using (
  exists (
    select 1
    from public.publications p
    join public.simulators s on s.id = p.simulator_id
    where p.id = publication_id
      and public.is_workspace_editor(s.workspace_id)
  )
)
with check (
  exists (
    select 1
    from public.publications p
    join public.simulators s on s.id = p.simulator_id
    where p.id = publication_id
      and public.is_workspace_editor(s.workspace_id)
  )
);

create policy attempts_member_select
on public.attempts for select
to authenticated
using (
  exists (
    select 1
    from public.publications p
    join public.simulators s on s.id = p.simulator_id
    where p.id = publication_id
      and public.is_workspace_member(s.workspace_id)
  )
);

create policy attempts_runtime_insert
on public.attempts for insert
to anon, authenticated
with check (
  exists (
    select 1
    from public.publications p
    where p.id = publication_id
      and p.is_active = true
  )
);

create policy attempts_runtime_update
on public.attempts for update
to anon, authenticated
using (
  exists (
    select 1
    from public.publications p
    where p.id = publication_id
      and p.is_active = true
  )
)
with check (
  exists (
    select 1
    from public.publications p
    where p.id = publication_id
      and p.is_active = true
  )
);

create policy attempts_member_delete
on public.attempts for delete
to authenticated
using (
  exists (
    select 1
    from public.publications p
    join public.simulators s on s.id = p.simulator_id
    where p.id = publication_id
      and public.is_workspace_editor(s.workspace_id)
  )
);

create policy attempt_events_member_select
on public.attempt_events for select
to authenticated
using (
  exists (
    select 1
    from public.attempts a
    join public.publications p on p.id = a.publication_id
    join public.simulators s on s.id = p.simulator_id
    where a.id = attempt_id
      and public.is_workspace_member(s.workspace_id)
  )
);

create policy attempt_events_runtime_insert
on public.attempt_events for insert
to anon, authenticated
with check (
  exists (
    select 1
    from public.attempts a
    join public.publications p on p.id = a.publication_id
    where a.id = attempt_id
      and p.is_active = true
  )
);
