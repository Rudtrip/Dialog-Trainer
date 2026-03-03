-- Dialog Trainer MVP core schema
-- Supabase/Postgres migration 001

create extension if not exists "pgcrypto";
create extension if not exists "citext";

create type public.workspace_role as enum ('owner', 'editor', 'viewer');
create type public.simulator_status as enum ('draft', 'published', 'archived');
create type public.scenario_state as enum ('draft', 'published');
create type public.step_type as enum ('message', 'question', 'system');
create type public.scoring_mode as enum ('sum', 'weighted');
create type public.media_status as enum ('pending', 'ready', 'failed', 'deleted');
create type public.export_artifact_type as enum ('html', 'iframe', 'script');
create type public.attempt_status as enum ('in_progress', 'completed', 'abandoned');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email citext not null unique,
  full_name text not null,
  avatar_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint profiles_full_name_len check (char_length(trim(full_name)) >= 2)
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint workspaces_name_len check (char_length(trim(name)) between 1 and 120)
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null default 'viewer',
  invited_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (workspace_id, user_id)
);

create table public.simulators (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  status public.simulator_status not null default 'draft',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz,
  constraint simulators_name_len check (char_length(trim(name)) between 1 and 140)
);

create table public.scenario_versions (
  id uuid primary key default gen_random_uuid(),
  simulator_id uuid not null references public.simulators(id) on delete cascade,
  version_number integer not null,
  state public.scenario_state not null default 'draft',
  schema_version text not null default '1.0.0',
  title text not null default 'Untitled scenario',
  locale text not null default 'ru-RU',
  start_step_key text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  published_at timestamptz,
  constraint scenario_versions_version_positive check (version_number > 0),
  constraint scenario_versions_title_len check (char_length(trim(title)) between 1 and 120),
  unique (simulator_id, version_number)
);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id),
  s3_key text not null unique,
  mime_type text not null,
  size_bytes bigint not null,
  checksum text,
  status public.media_status not null default 'pending',
  original_filename text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint media_assets_size_positive check (size_bytes > 0)
);

create table public.scenario_steps (
  id uuid primary key default gen_random_uuid(),
  scenario_version_id uuid not null references public.scenario_versions(id) on delete cascade,
  step_key text not null,
  type public.step_type not null default 'message',
  speaker text,
  content jsonb not null default '{}'::jsonb,
  media_asset_id uuid references public.media_assets(id) on delete set null,
  order_index integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint scenario_steps_key_len check (char_length(trim(step_key)) between 1 and 120),
  constraint scenario_steps_order_nonnegative check (order_index >= 0),
  unique (scenario_version_id, step_key)
);

create table public.scenario_choices (
  id uuid primary key default gen_random_uuid(),
  scenario_version_id uuid not null references public.scenario_versions(id) on delete cascade,
  choice_key text not null,
  from_step_key text not null,
  next_step_key text,
  label text not null,
  condition_json jsonb not null default '{}'::jsonb,
  score_delta integer not null default 0,
  feedback text,
  order_index integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint scenario_choices_key_len check (char_length(trim(choice_key)) between 1 and 120),
  constraint scenario_choices_label_len check (char_length(trim(label)) between 1 and 160),
  constraint scenario_choices_order_nonnegative check (order_index >= 0),
  constraint scenario_choices_from_step_fk
    foreign key (scenario_version_id, from_step_key)
    references public.scenario_steps(scenario_version_id, step_key)
    on update cascade
    on delete cascade,
  constraint scenario_choices_next_step_fk
    foreign key (scenario_version_id, next_step_key)
    references public.scenario_steps(scenario_version_id, step_key)
    on update cascade
    on delete set null,
  unique (scenario_version_id, choice_key)
);

create table public.scenario_endings (
  id uuid primary key default gen_random_uuid(),
  scenario_version_id uuid not null references public.scenario_versions(id) on delete cascade,
  ending_key text not null,
  title text not null,
  description text,
  rule_json jsonb not null default '{}'::jsonb,
  score_min integer,
  score_max integer,
  priority integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint scenario_endings_key_len check (char_length(trim(ending_key)) between 1 and 120),
  constraint scenario_endings_title_len check (char_length(trim(title)) between 1 and 120),
  constraint scenario_endings_score_range check (
    (score_min is null and score_max is null) or
    (score_min is not null and score_max is not null and score_min <= score_max)
  ),
  unique (scenario_version_id, ending_key)
);

create table public.scoring_policies (
  id uuid primary key default gen_random_uuid(),
  scenario_version_id uuid not null unique references public.scenario_versions(id) on delete cascade,
  mode public.scoring_mode not null default 'sum',
  max_score integer not null default 100,
  pass_threshold integer not null default 70,
  rules_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint scoring_policies_score_nonnegative check (max_score >= 0 and pass_threshold >= 0),
  constraint scoring_policies_threshold_valid check (pass_threshold <= max_score)
);

create table public.ui_configs (
  id uuid primary key default gen_random_uuid(),
  scenario_version_id uuid not null unique references public.scenario_versions(id) on delete cascade,
  theme_json jsonb not null default '{}'::jsonb,
  branding_json jsonb not null default '{}'::jsonb,
  player_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.publications (
  id uuid primary key default gen_random_uuid(),
  simulator_id uuid not null references public.simulators(id) on delete cascade,
  scenario_version_id uuid not null unique references public.scenario_versions(id) on delete restrict,
  publication_key text not null unique,
  snapshot_json jsonb not null,
  is_active boolean not null default true,
  published_by uuid not null references auth.users(id),
  published_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint publications_key_len check (char_length(trim(publication_key)) between 6 and 80)
);

create table public.export_artifacts (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.publications(id) on delete cascade,
  type public.export_artifact_type not null,
  url_or_snippet text not null,
  content_hash text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (publication_id, type)
);

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.publications(id) on delete cascade,
  learner_ref text,
  status public.attempt_status not null default 'in_progress',
  started_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  final_score integer,
  ending_key text,
  runtime_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint attempts_completed_after_start check (
    completed_at is null or completed_at >= started_at
  )
);

create table public.attempt_events (
  id bigint generated always as identity primary key,
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  event_type text not null,
  event_time timestamptz not null default timezone('utc', now()),
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint attempt_events_type_len check (char_length(trim(event_type)) between 1 and 80)
);

create index idx_workspaces_owner_user_id on public.workspaces(owner_user_id);
create index idx_workspace_members_user_id on public.workspace_members(user_id);

create index idx_simulators_workspace_status on public.simulators(workspace_id, status);

create index idx_scenario_versions_simulator_state on public.scenario_versions(simulator_id, state);
create unique index idx_scenario_versions_one_draft_per_simulator
  on public.scenario_versions(simulator_id)
  where state = 'draft';

create index idx_media_assets_workspace_status on public.media_assets(workspace_id, status);

create index idx_scenario_steps_version_order on public.scenario_steps(scenario_version_id, order_index);
create index idx_scenario_choices_version_from_step on public.scenario_choices(scenario_version_id, from_step_key);
create index idx_scenario_choices_version_next_step on public.scenario_choices(scenario_version_id, next_step_key);
create index idx_scenario_endings_version_priority on public.scenario_endings(scenario_version_id, priority desc);

create index idx_publications_simulator_published_at on public.publications(simulator_id, published_at desc);
create index idx_attempts_publication_started_at on public.attempts(publication_id, started_at desc);
create index idx_attempt_events_attempt_event_time on public.attempt_events(attempt_id, event_time);

create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger trg_workspaces_updated_at
before update on public.workspaces
for each row execute function public.set_updated_at();

create trigger trg_workspace_members_updated_at
before update on public.workspace_members
for each row execute function public.set_updated_at();

create trigger trg_simulators_updated_at
before update on public.simulators
for each row execute function public.set_updated_at();

create trigger trg_scenario_versions_updated_at
before update on public.scenario_versions
for each row execute function public.set_updated_at();

create trigger trg_media_assets_updated_at
before update on public.media_assets
for each row execute function public.set_updated_at();

create trigger trg_scenario_steps_updated_at
before update on public.scenario_steps
for each row execute function public.set_updated_at();

create trigger trg_scenario_choices_updated_at
before update on public.scenario_choices
for each row execute function public.set_updated_at();

create trigger trg_scenario_endings_updated_at
before update on public.scenario_endings
for each row execute function public.set_updated_at();

create trigger trg_scoring_policies_updated_at
before update on public.scoring_policies
for each row execute function public.set_updated_at();

create trigger trg_ui_configs_updated_at
before update on public.ui_configs
for each row execute function public.set_updated_at();

create trigger trg_publications_updated_at
before update on public.publications
for each row execute function public.set_updated_at();

create trigger trg_export_artifacts_updated_at
before update on public.export_artifacts
for each row execute function public.set_updated_at();

create trigger trg_attempts_updated_at
before update on public.attempts
for each row execute function public.set_updated_at();
