-- =========================================================
-- MULTI-TENANCY UPGRADE: companies + company_id propagation
-- =========================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'subscription_tier') then
    create type public.subscription_tier as enum ('starter', 'pro', 'fleet');
  end if;
end
$$;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subscription_tier public.subscription_tier not null default 'starter',
  created_at timestamptz not null default now()
);

-- Add tenant key to all tenant-scoped tables (initially nullable for backfill)
alter table public.profiles add column if not exists company_id uuid;
alter table public.sites add column if not exists company_id uuid;
alter table public.assets add column if not exists company_id uuid;
alter table public.logs add column if not exists company_id uuid;

-- Add foreign keys (idempotent-safe via exception handling)
do $$
begin
  begin
    alter table public.profiles
      add constraint profiles_company_id_fkey
      foreign key (company_id) references public.companies(id) on delete restrict;
  exception when duplicate_object then null;
  end;

  begin
    alter table public.sites
      add constraint sites_company_id_fkey
      foreign key (company_id) references public.companies(id) on delete restrict;
  exception when duplicate_object then null;
  end;

  begin
    alter table public.assets
      add constraint assets_company_id_fkey
      foreign key (company_id) references public.companies(id) on delete restrict;
  exception when duplicate_object then null;
  end;

  begin
    alter table public.logs
      add constraint logs_company_id_fkey
      foreign key (company_id) references public.companies(id) on delete restrict;
  exception when duplicate_object then null;
  end;
end
$$;

create index if not exists idx_profiles_company_id on public.profiles(company_id);
create index if not exists idx_sites_company_id on public.sites(company_id);
create index if not exists idx_assets_company_id on public.assets(company_id);
create index if not exists idx_logs_company_id on public.logs(company_id);

-- Bootstrap existing single-tenant data into one default company if needed.
-- This preserves backward compatibility while allowing NOT NULL company_id.
do $$
declare
  v_bootstrap_company_id uuid;
  v_has_unscoped_rows boolean;
begin
  select exists (
    select 1 from public.profiles where company_id is null
    union all
    select 1 from public.sites where company_id is null
    union all
    select 1 from public.assets where company_id is null
    union all
    select 1 from public.logs where company_id is null
  ) into v_has_unscoped_rows;

  if v_has_unscoped_rows then
    insert into public.companies (name, subscription_tier)
    values ('Default Company', 'starter')
    returning id into v_bootstrap_company_id;

    update public.profiles set company_id = v_bootstrap_company_id where company_id is null;
    update public.sites set company_id = v_bootstrap_company_id where company_id is null;
    update public.assets set company_id = v_bootstrap_company_id where company_id is null;
    update public.logs set company_id = v_bootstrap_company_id where company_id is null;
  end if;
end
$$;

-- Enforce NOT NULL after backfill
alter table public.profiles alter column company_id set not null;
alter table public.sites alter column company_id set not null;
alter table public.assets alter column company_id set not null;
alter table public.logs alter column company_id set not null;

-- =========================================================
-- PERFORMANCE HELPER FOR TENANT-AWARE RLS
-- =========================================================
create or replace function public.get_user_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.company_id
  from public.profiles p
  where p.id = auth.uid()
$$;

grant execute on function public.get_user_company_id() to authenticated;

-- =========================================================
-- STRICT MULTI-TENANT RLS (tenant isolation)
-- Rule: authenticated users can only operate on rows in their company.
-- =========================================================
alter table public.profiles enable row level security;
alter table public.sites enable row level security;
alter table public.assets enable row level security;
alter table public.logs enable row level security;

-- Drop earlier role-centric policies (and any prior tenant policies) to avoid OR-combining access.
drop policy if exists "profiles_owner_all" on public.profiles;
drop policy if exists "profiles_select_self" on public.profiles;
drop policy if exists "profiles_insert_self" on public.profiles;
drop policy if exists "profiles_update_self" on public.profiles;
drop policy if exists "profiles_tenant_select" on public.profiles;
drop policy if exists "profiles_tenant_insert" on public.profiles;
drop policy if exists "profiles_tenant_update" on public.profiles;
drop policy if exists "profiles_tenant_delete" on public.profiles;

drop policy if exists "sites_owner_all" on public.sites;
drop policy if exists "sites_worker_read_active" on public.sites;
drop policy if exists "sites_tenant_select" on public.sites;
drop policy if exists "sites_tenant_insert" on public.sites;
drop policy if exists "sites_tenant_update" on public.sites;
drop policy if exists "sites_tenant_delete" on public.sites;

drop policy if exists "assets_owner_all" on public.assets;
drop policy if exists "assets_worker_read" on public.assets;
drop policy if exists "assets_worker_update_interacting" on public.assets;
drop policy if exists "assets_tenant_select" on public.assets;
drop policy if exists "assets_tenant_insert" on public.assets;
drop policy if exists "assets_tenant_update" on public.assets;
drop policy if exists "assets_tenant_delete" on public.assets;

drop policy if exists "logs_owner_all" on public.logs;
drop policy if exists "logs_worker_read_own" on public.logs;
drop policy if exists "logs_worker_insert_own" on public.logs;
drop policy if exists "logs_no_update" on public.logs;
drop policy if exists "logs_no_delete" on public.logs;
drop policy if exists "logs_tenant_select" on public.logs;
drop policy if exists "logs_tenant_insert" on public.logs;
drop policy if exists "logs_tenant_update" on public.logs;
drop policy if exists "logs_tenant_delete" on public.logs;

-- PROFILES
create policy "profiles_tenant_select"
on public.profiles
for select
to authenticated
using (company_id = public.get_user_company_id());

create policy "profiles_tenant_insert"
on public.profiles
for insert
to authenticated
with check (
  id = auth.uid()
  and company_id = public.get_user_company_id()
);

create policy "profiles_tenant_update"
on public.profiles
for update
to authenticated
using (company_id = public.get_user_company_id())
with check (company_id = public.get_user_company_id());

create policy "profiles_tenant_delete"
on public.profiles
for delete
to authenticated
using (company_id = public.get_user_company_id());

-- SITES
create policy "sites_tenant_select"
on public.sites
for select
to authenticated
using (company_id = public.get_user_company_id());

create policy "sites_tenant_insert"
on public.sites
for insert
to authenticated
with check (company_id = public.get_user_company_id());

create policy "sites_tenant_update"
on public.sites
for update
to authenticated
using (company_id = public.get_user_company_id())
with check (company_id = public.get_user_company_id());

create policy "sites_tenant_delete"
on public.sites
for delete
to authenticated
using (company_id = public.get_user_company_id());

-- ASSETS
create policy "assets_tenant_select"
on public.assets
for select
to authenticated
using (company_id = public.get_user_company_id());

create policy "assets_tenant_insert"
on public.assets
for insert
to authenticated
with check (company_id = public.get_user_company_id());

create policy "assets_tenant_update"
on public.assets
for update
to authenticated
using (company_id = public.get_user_company_id())
with check (company_id = public.get_user_company_id());

create policy "assets_tenant_delete"
on public.assets
for delete
to authenticated
using (company_id = public.get_user_company_id());

-- LOGS
create policy "logs_tenant_select"
on public.logs
for select
to authenticated
using (company_id = public.get_user_company_id());

create policy "logs_tenant_insert"
on public.logs
for insert
to authenticated
with check (
  company_id = public.get_user_company_id()
  and user_id = auth.uid()
);

create policy "logs_tenant_update"
on public.logs
for update
to authenticated
using (company_id = public.get_user_company_id())
with check (company_id = public.get_user_company_id());

create policy "logs_tenant_delete"
on public.logs
for delete
to authenticated
using (company_id = public.get_user_company_id());

-- =========================================================
-- TRIGGER/FUNCTION ADJUSTMENTS FOR NEW company_id REQUIREMENT
-- =========================================================

-- Keep auth signup trigger from failing if company_id is not yet known.
-- App should create profile explicitly after company/invite context is established.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
begin
  begin
    v_company_id := nullif(new.raw_user_meta_data ->> 'company_id', '')::uuid;
  exception when others then
    v_company_id := null;
  end;

  if v_company_id is null then
    return new;
  end if;

  insert into public.profiles (id, full_name, phone_number, company_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.raw_user_meta_data ->> 'phone_number',
    v_company_id
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Ensure log rows carry tenant key and match the asset tenant
create or replace function public.set_log_company_id_from_asset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset_company_id uuid;
begin
  select company_id into v_asset_company_id
  from public.assets
  where id = new.asset_id;

  if v_asset_company_id is null then
    raise exception 'asset % missing company_id', new.asset_id;
  end if;

  if new.company_id is null then
    new.company_id := v_asset_company_id;
  elsif new.company_id <> v_asset_company_id then
    raise exception 'log company_id must match asset company_id';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_set_log_company_id on public.logs;
create trigger trg_set_log_company_id
before insert on public.logs
for each row
execute function public.set_log_company_id_from_asset();

-- Optional consistency checks on existing tables
alter table public.assets
  drop constraint if exists assets_company_site_company_match_chk;
alter table public.assets
  add constraint assets_company_site_company_match_chk
  check (
    current_site_id is null
    or company_id is not null
  );

