-- Tariff plans for admin /admin/rate and cabinet /cabinet

create table if not exists public.tariff_plans (
  plan_key text primary key,
  title text not null,
  monthly_price_usd numeric(10,2) not null default 0,
  yearly_price_usd numeric(10,2) not null default 0,
  simulator_limit integer,
  support_label text not null default '',
  features_json jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint tariff_plans_key_format check (plan_key ~ '^[a-z0-9_-]{2,40}$'),
  constraint tariff_plans_title_len check (char_length(trim(title)) between 1 and 120),
  constraint tariff_plans_monthly_nonnegative check (monthly_price_usd >= 0),
  constraint tariff_plans_yearly_nonnegative check (yearly_price_usd >= 0),
  constraint tariff_plans_limit_positive check (simulator_limit is null or simulator_limit > 0),
  constraint tariff_plans_support_label_len check (char_length(trim(support_label)) between 1 and 160),
  constraint tariff_plans_features_is_array check (jsonb_typeof(features_json) = 'array')
);

drop trigger if exists trg_tariff_plans_updated_at on public.tariff_plans;
create trigger trg_tariff_plans_updated_at
before update on public.tariff_plans
for each row execute function public.set_updated_at();

alter table public.tariff_plans enable row level security;

drop policy if exists tariff_plans_select_authenticated on public.tariff_plans;
create policy tariff_plans_select_authenticated
on public.tariff_plans for select
to authenticated
using (true);

insert into public.tariff_plans (
  plan_key,
  title,
  monthly_price_usd,
  yearly_price_usd,
  simulator_limit,
  support_label,
  features_json,
  is_active,
  sort_order
)
values
  (
    'free',
    'Starter',
    0,
    0,
    2,
    'Базовая поддержка',
    '["2 симулятора", "Ручная публикация"]'::jsonb,
    true,
    10
  ),
  (
    'pro',
    'Pro Educator',
    29,
    24,
    10,
    'Приоритетная поддержка',
    '["10 симуляторов", "Генерация диалогов через ИИ"]'::jsonb,
    true,
    20
  ),
  (
    'enterprise',
    'Institution',
    99,
    79,
    null,
    'Выделенный менеджер',
    '["Безлимитные симуляторы", "Персональный менеджер"]'::jsonb,
    true,
    30
  )
on conflict (plan_key)
do update set
  title = excluded.title,
  monthly_price_usd = excluded.monthly_price_usd,
  yearly_price_usd = excluded.yearly_price_usd,
  simulator_limit = excluded.simulator_limit,
  support_label = excluded.support_label,
  features_json = excluded.features_json,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  updated_at = timezone('utc', now());
