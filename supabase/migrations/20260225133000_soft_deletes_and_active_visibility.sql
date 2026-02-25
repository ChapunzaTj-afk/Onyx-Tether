-- =========================================================
-- SOFT DELETES
-- =========================================================
alter table public.profiles
  add column if not exists is_active boolean not null default true;

alter table public.assets
  add column if not exists is_active boolean not null default true;

create index if not exists idx_profiles_company_id_is_active
  on public.profiles (company_id, is_active);

create index if not exists idx_assets_company_id_is_active
  on public.assets (company_id, is_active);

-- =========================================================
-- ROLE-AWARE SELECT FILTERS (within tenant)
-- owner: can see active + inactive
-- worker/site_manager: only active rows
-- =========================================================

-- PROFILES SELECT
drop policy if exists "profiles_tenant_select" on public.profiles;
create policy "profiles_tenant_select"
on public.profiles
for select
to authenticated
using (
  company_id = public.get_user_company_id()
  and (
    public.current_user_role() = 'owner'
    or (
      public.current_user_role() in ('worker', 'site_manager')
      and is_active = true
    )
  )
);

-- ASSETS SELECT
drop policy if exists "assets_tenant_select" on public.assets;
create policy "assets_tenant_select"
on public.assets
for select
to authenticated
using (
  company_id = public.get_user_company_id()
  and (
    public.current_user_role() = 'owner'
    or (
      public.current_user_role() in ('worker', 'site_manager')
      and is_active = true
    )
  )
);

