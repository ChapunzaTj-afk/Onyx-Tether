create extension if not exists pgcrypto;

-- =========================================================
-- ENUMS
-- =========================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('owner', 'site_manager', 'worker');
  end if;

  if not exists (select 1 from pg_type where typname = 'site_status') then
    create type public.site_status as enum ('active', 'completed');
  end if;

  if not exists (select 1 from pg_type where typname = 'asset_status') then
    create type public.asset_status as enum ('in_yard', 'on_site', 'quarantine', 'lost');
  end if;

  if not exists (select 1 from pg_type where typname = 'log_action') then
    create type public.log_action as enum ('checkout', 'return', 'transfer', 'flag_damaged');
  end if;

  if not exists (select 1 from pg_type where typname = 'asset_condition') then
    create type public.asset_condition as enum ('good', 'damaged');
  end if;
end
$$;

-- =========================================================
-- TABLES
-- =========================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone_number text,
  role public.user_role not null default 'worker',
  nuisance_score integer not null default 0 check (nuisance_score >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status public.site_status not null default 'active',
  manager_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  tag_id text not null unique,
  name text not null,
  value numeric(12,2) not null default 0 check (value >= 0),
  status public.asset_status not null default 'in_yard',
  current_site_id uuid references public.sites(id) on delete set null,
  assigned_user_id uuid references public.profiles(id) on delete set null,
  last_checkout_date timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.logs (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  site_id uuid references public.sites(id) on delete set null,
  action public.log_action not null,
  condition public.asset_condition not null default 'good',
  damage_photo_url text,
  notes text,
  created_at timestamptz not null default now()
);

-- =========================================================
-- INDEXES
-- =========================================================
create index if not exists idx_sites_manager_id on public.sites(manager_id);
create index if not exists idx_assets_current_site_id on public.assets(current_site_id);
create index if not exists idx_assets_assigned_user_id on public.assets(assigned_user_id);
create index if not exists idx_assets_status on public.assets(status);
create index if not exists idx_logs_asset_id_created_at on public.logs(asset_id, created_at desc);
create index if not exists idx_logs_user_id_created_at on public.logs(user_id, created_at desc);
create index if not exists idx_logs_site_id_created_at on public.logs(site_id, created_at desc);

-- =========================================================
-- HELPER FUNCTION FOR RLS
-- =========================================================
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
$$;

grant execute on function public.current_user_role() to authenticated;

-- =========================================================
-- ROW LEVEL SECURITY
-- =========================================================
alter table public.profiles enable row level security;
alter table public.sites enable row level security;
alter table public.assets enable row level security;
alter table public.logs enable row level security;

-- PROFILES
drop policy if exists "profiles_select_self_or_management" on public.profiles;
create policy "profiles_select_self_or_management"
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.current_user_role() in ('owner', 'site_manager')
);

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self"
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "profiles_update_self_or_owner" on public.profiles;
create policy "profiles_update_self_or_owner"
on public.profiles
for update
to authenticated
using (
  id = auth.uid()
  or public.current_user_role() = 'owner'
)
with check (
  id = auth.uid()
  or public.current_user_role() = 'owner'
);

-- SITES
drop policy if exists "sites_read_authenticated" on public.sites;
create policy "sites_read_authenticated"
on public.sites
for select
to authenticated
using (true);

drop policy if exists "sites_write_management" on public.sites;
create policy "sites_write_management"
on public.sites
for all
to authenticated
using (public.current_user_role() in ('owner', 'site_manager'))
with check (public.current_user_role() in ('owner', 'site_manager'));

-- ASSETS
drop policy if exists "assets_read_authenticated" on public.assets;
create policy "assets_read_authenticated"
on public.assets
for select
to authenticated
using (true);

drop policy if exists "assets_write_management" on public.assets;
create policy "assets_write_management"
on public.assets
for all
to authenticated
using (public.current_user_role() in ('owner', 'site_manager'))
with check (public.current_user_role() in ('owner', 'site_manager'));

-- LOGS (immutable)
drop policy if exists "logs_read_authenticated" on public.logs;
create policy "logs_read_authenticated"
on public.logs
for select
to authenticated
using (true);

drop policy if exists "logs_insert_authenticated" on public.logs;
create policy "logs_insert_authenticated"
on public.logs
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "logs_no_update" on public.logs;
create policy "logs_no_update"
on public.logs
for update
to authenticated
using (false)
with check (false);

drop policy if exists "logs_no_delete" on public.logs;
create policy "logs_no_delete"
on public.logs
for delete
to authenticated
using (false);

-- =========================================================
-- TRIGGER: APPLY LOG ENTRIES TO ASSET STATE
-- =========================================================
create or replace function public.apply_log_to_asset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.action in ('checkout', 'transfer') and new.site_id is null then
    raise exception 'site_id is required for action %', new.action;
  end if;

  update public.assets a
  set
    status = case
      when new.action = 'return' then 'in_yard'::public.asset_status
      when new.action = 'flag_damaged' or new.condition = 'damaged' then 'quarantine'::public.asset_status
      when new.action in ('checkout', 'transfer') then 'on_site'::public.asset_status
      else a.status
    end,
    current_site_id = case
      when new.action = 'return' then null
      when new.action in ('checkout', 'transfer') then new.site_id
      else a.current_site_id
    end,
    assigned_user_id = case
      when new.action = 'return' then null
      when new.action in ('checkout', 'transfer') then new.user_id
      else a.assigned_user_id
    end,
    last_checkout_date = case
      when new.action = 'checkout' then coalesce(new.created_at, now())
      else a.last_checkout_date
    end
  where a.id = new.asset_id;

  if not found then
    raise exception 'asset_id % not found for log insert', new.asset_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_apply_log_to_asset on public.logs;
create trigger trg_apply_log_to_asset
after insert on public.logs
for each row
execute function public.apply_log_to_asset();

-- =========================================================
-- OPTIONAL: AUTO-CREATE PROFILE ROWS FROM AUTH SIGNUPS
-- =========================================================
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone_number)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.raw_user_meta_data ->> 'phone_number'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_auth_user();
