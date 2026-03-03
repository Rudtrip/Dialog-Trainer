-- Asset library for /assets page (characters + backgrounds)
-- Includes preinstalled and user uploads metadata for MVP

do $$
begin
  if not exists (select 1 from pg_type where typname = 'library_asset_type') then
    create type public.library_asset_type as enum ('character', 'background');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'library_asset_source') then
    create type public.library_asset_source as enum ('preinstalled', 'user_upload');
  end if;
end $$;

create table if not exists public.library_assets (
  id uuid primary key default gen_random_uuid(),
  type public.library_asset_type not null,
  title text not null,
  source public.library_asset_source not null default 'user_upload',
  file_url text not null,
  thumbnail_url text,
  mime_type text not null,
  file_size_bytes bigint not null default 0,
  width integer,
  height integer,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  owner_id uuid references auth.users(id),
  s3_key text unique,
  metadata_json jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint library_assets_title_len check (char_length(trim(title)) between 1 and 160),
  constraint library_assets_file_size_nonnegative check (file_size_bytes >= 0),
  constraint library_assets_dimensions_positive check (
    (width is null or width > 0) and (height is null or height > 0)
  ),
  constraint library_assets_scope_valid check (
    (source = 'preinstalled' and workspace_id is null and owner_id is null and s3_key is null) or
    (source = 'user_upload' and workspace_id is not null and owner_id is not null and s3_key is not null)
  )
);

create index if not exists idx_library_assets_type_source on public.library_assets(type, source);
create index if not exists idx_library_assets_workspace_type on public.library_assets(workspace_id, type);
create index if not exists idx_library_assets_active_updated on public.library_assets(is_active, updated_at desc);

drop trigger if exists trg_library_assets_updated_at on public.library_assets;
create trigger trg_library_assets_updated_at
before update on public.library_assets
for each row execute function public.set_updated_at();

alter table public.library_assets enable row level security;

drop policy if exists library_assets_select_policy on public.library_assets;
create policy library_assets_select_policy
on public.library_assets for select
to authenticated
using (
  source = 'preinstalled'
  or (
    workspace_id is not null
    and public.is_workspace_member(workspace_id)
  )
);

drop policy if exists library_assets_insert_policy on public.library_assets;
create policy library_assets_insert_policy
on public.library_assets for insert
to authenticated
with check (
  source = 'user_upload'
  and owner_id = auth.uid()
  and workspace_id is not null
  and public.is_workspace_editor(workspace_id)
);

drop policy if exists library_assets_update_policy on public.library_assets;
create policy library_assets_update_policy
on public.library_assets for update
to authenticated
using (
  source = 'user_upload'
  and workspace_id is not null
  and public.is_workspace_editor(workspace_id)
)
with check (
  source = 'user_upload'
  and workspace_id is not null
  and public.is_workspace_editor(workspace_id)
);

drop policy if exists library_assets_delete_policy on public.library_assets;
create policy library_assets_delete_policy
on public.library_assets for delete
to authenticated
using (
  source = 'user_upload'
  and workspace_id is not null
  and public.is_workspace_editor(workspace_id)
);

insert into public.library_assets (
  id,
  type,
  title,
  source,
  file_url,
  thumbnail_url,
  mime_type,
  file_size_bytes,
  width,
  height,
  metadata_json,
  is_active
)
values
  (
    '4fc1896a-8e77-4f89-87b7-9fb8dd420001',
    'character',
    'Professor Elena',
    'preinstalled',
    'https://api.dicebear.com/9.x/adventurer/svg?seed=Professor-Elena',
    'https://api.dicebear.com/9.x/adventurer/svg?seed=Professor-Elena',
    'image/svg+xml',
    0,
    null,
    null,
    '{"emotions_count": 3}'::jsonb,
    true
  ),
  (
    '4fc1896a-8e77-4f89-87b7-9fb8dd420002',
    'character',
    'Student Marcus',
    'preinstalled',
    'https://api.dicebear.com/9.x/adventurer/svg?seed=Student-Marcus',
    'https://api.dicebear.com/9.x/adventurer/svg?seed=Student-Marcus',
    'image/svg+xml',
    0,
    null,
    null,
    '{"emotions_count": 3}'::jsonb,
    true
  ),
  (
    '4fc1896a-8e77-4f89-87b7-9fb8dd420003',
    'character',
    'Coach Miller',
    'preinstalled',
    'https://api.dicebear.com/9.x/adventurer/svg?seed=Coach-Miller',
    'https://api.dicebear.com/9.x/adventurer/svg?seed=Coach-Miller',
    'image/svg+xml',
    0,
    null,
    null,
    '{"emotions_count": 3}'::jsonb,
    true
  ),
  (
    '4fc1896a-8e77-4f89-87b7-9fb8dd420004',
    'background',
    'Office Interior',
    'preinstalled',
    'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1920&q=80',
    'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=640&q=80',
    'image/jpeg',
    0,
    1920,
    1080,
    '{}'::jsonb,
    true
  ),
  (
    '4fc1896a-8e77-4f89-87b7-9fb8dd420005',
    'background',
    'Classroom',
    'preinstalled',
    'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?auto=format&fit=crop&w=1920&q=80',
    'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?auto=format&fit=crop&w=640&q=80',
    'image/jpeg',
    0,
    1920,
    1080,
    '{}'::jsonb,
    true
  ),
  (
    '4fc1896a-8e77-4f89-87b7-9fb8dd420006',
    'background',
    'Meeting Room',
    'preinstalled',
    'https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=1920&q=80',
    'https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=640&q=80',
    'image/jpeg',
    0,
    1920,
    1080,
    '{}'::jsonb,
    true
  )
on conflict (id) do nothing;
