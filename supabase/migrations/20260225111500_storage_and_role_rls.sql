-- =========================================================
-- STORAGE: damage_photos bucket + policies
-- =========================================================
insert into storage.buckets (id, name, public)
values ('damage_photos', 'damage_photos', true)
on conflict (id) do nothing;

drop policy if exists "damage_photos_authenticated_upload" on storage.objects;
create policy "damage_photos_authenticated_upload"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'damage_photos'
  and auth.role() = 'authenticated'
);

drop policy if exists "damage_photos_authenticated_view" on storage.objects;
create policy "damage_photos_authenticated_view"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'damage_photos'
  and auth.role() = 'authenticated'
);

-- =========================================================
-- RLS HELPERS
-- =========================================================
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'owner', false)
$$;

create or replace function public.is_worker()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'worker', false)
$$;

grant execute on function public.is_owner() to authenticated;
grant execute on function public.is_worker() to authenticated;

-- =========================================================
-- PROFILES TABLE RLS
-- owner: full access
-- worker: read own profile only
-- =========================================================
alter table public.profiles enable row level security;

drop policy if exists "profiles_owner_all" on public.profiles;
create policy "profiles_owner_all"
on public.profiles
for all
to authenticated
using (public.is_owner())
with check (public.is_owner());

drop policy if exists "profiles_select_self" on public.profiles;
create policy "profiles_select_self"
on public.profiles
for select
to authenticated
using (id = auth.uid());

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self"
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Remove earlier broader policies if they exist
drop policy if exists "profiles_select_self_or_management" on public.profiles;
drop policy if exists "profiles_update_self_or_owner" on public.profiles;

-- =========================================================
-- SITES TABLE RLS
-- owner: full access
-- worker: read active sites only
-- =========================================================
alter table public.sites enable row level security;

drop policy if exists "sites_owner_all" on public.sites;
create policy "sites_owner_all"
on public.sites
for all
to authenticated
using (public.is_owner())
with check (public.is_owner());

drop policy if exists "sites_worker_read_active" on public.sites;
create policy "sites_worker_read_active"
on public.sites
for select
to authenticated
using (
  public.is_worker()
  and status = 'active'
);

-- Remove earlier broader policies if they exist
drop policy if exists "sites_read_authenticated" on public.sites;
drop policy if exists "sites_write_management" on public.sites;

-- =========================================================
-- ASSETS TABLE RLS
-- owner: full access
-- worker: read all assets, update assets they are interacting with:
--   - assets already assigned to them (return/transfer)
--   - assets in_yard (checkout)
-- =========================================================
alter table public.assets enable row level security;

drop policy if exists "assets_owner_all" on public.assets;
create policy "assets_owner_all"
on public.assets
for all
to authenticated
using (public.is_owner())
with check (public.is_owner());

drop policy if exists "assets_worker_read" on public.assets;
create policy "assets_worker_read"
on public.assets
for select
to authenticated
using (public.is_worker());

drop policy if exists "assets_worker_update_interacting" on public.assets;
create policy "assets_worker_update_interacting"
on public.assets
for update
to authenticated
using (
  public.is_worker()
  and (
    assigned_user_id = auth.uid()
    or status = 'in_yard'
  )
)
with check (
  public.is_worker()
  and (
    assigned_user_id is not null
    or status in ('in_yard', 'quarantine')
  )
);

-- Remove earlier broader policies if they exist
drop policy if exists "assets_read_authenticated" on public.assets;
drop policy if exists "assets_write_management" on public.assets;

-- =========================================================
-- LOGS TABLE RLS
-- owner: full access
-- worker: read/insert own logs only (logs remain immutable for workers)
-- =========================================================
alter table public.logs enable row level security;

drop policy if exists "logs_owner_all" on public.logs;
create policy "logs_owner_all"
on public.logs
for all
to authenticated
using (public.is_owner())
with check (public.is_owner());

drop policy if exists "logs_worker_read_own" on public.logs;
create policy "logs_worker_read_own"
on public.logs
for select
to authenticated
using (
  public.is_worker()
  and user_id = auth.uid()
);

drop policy if exists "logs_worker_insert_own" on public.logs;
create policy "logs_worker_insert_own"
on public.logs
for insert
to authenticated
with check (
  public.is_worker()
  and user_id = auth.uid()
);

-- Keep logs immutable for workers
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

-- Remove earlier broader policies if they exist
drop policy if exists "logs_read_authenticated" on public.logs;
drop policy if exists "logs_insert_authenticated" on public.logs;

