-- =========================================================
-- BULK ASSETS, RESERVATIONS, MAINTENANCE LEDGER
-- =========================================================

alter table public.assets
  add column if not exists is_bulk boolean not null default false;

alter table public.assets
  add column if not exists total_quantity integer not null default 1;

alter table public.assets
  drop constraint if exists assets_total_quantity_positive_chk;
alter table public.assets
  add constraint assets_total_quantity_positive_chk check (total_quantity >= 1);

do $$
begin
  if not exists (select 1 from pg_type where typname = 'reservation_status') then
    create type public.reservation_status as enum ('pending', 'active', 'cancelled');
  end if;
end
$$;

do $$
begin
  begin
    alter type public.log_action add value if not exists 'bulk_checkout';
  exception when duplicate_object then null;
  end;
end
$$;

create table if not exists public.site_bulk_inventory (
  site_id uuid not null references public.sites(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete restrict,
  quantity_on_site integer not null default 0 check (quantity_on_site >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (site_id, asset_id)
);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete restrict,
  reserved_by_user_id uuid not null references public.profiles(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  start_date timestamptz not null,
  end_date timestamptz not null,
  status public.reservation_status not null default 'pending',
  created_at timestamptz not null default now(),
  check (end_date > start_date)
);

create table if not exists public.maintenance_logs (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  logged_by_user_id uuid not null references public.profiles(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  repair_cost numeric(12,2) not null default 0 check (repair_cost >= 0),
  description text not null,
  service_date timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_site_bulk_inventory_company_id on public.site_bulk_inventory(company_id);
create index if not exists idx_site_bulk_inventory_asset_id on public.site_bulk_inventory(asset_id);
create index if not exists idx_reservations_company_asset_dates
  on public.reservations(company_id, asset_id, start_date, end_date);
create index if not exists idx_reservations_status on public.reservations(status);
create index if not exists idx_maintenance_logs_company_asset_date
  on public.maintenance_logs(company_id, asset_id, service_date desc);

create or replace function public.set_updated_at_site_bulk_inventory()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_site_bulk_inventory on public.site_bulk_inventory;
create trigger trg_set_updated_at_site_bulk_inventory
before update on public.site_bulk_inventory
for each row
execute function public.set_updated_at_site_bulk_inventory();

-- Tenant-populating triggers
create or replace function public.set_company_id_from_asset_common()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
begin
  if tg_table_name = 'site_bulk_inventory' then
    select a.company_id into v_company_id from public.assets a where a.id = new.asset_id;
  elsif tg_table_name = 'reservations' then
    select a.company_id into v_company_id from public.assets a where a.id = new.asset_id;
  elsif tg_table_name = 'maintenance_logs' then
    select a.company_id into v_company_id from public.assets a where a.id = new.asset_id;
  end if;

  if v_company_id is null then
    raise exception 'Unable to determine company_id for % row', tg_table_name;
  end if;

  if new.company_id is null then
    new.company_id := v_company_id;
  elsif new.company_id <> v_company_id then
    raise exception 'company_id mismatch on %', tg_table_name;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_set_company_site_bulk_inventory on public.site_bulk_inventory;
create trigger trg_set_company_site_bulk_inventory
before insert or update on public.site_bulk_inventory
for each row
execute function public.set_company_id_from_asset_common();

drop trigger if exists trg_set_company_reservations on public.reservations;
create trigger trg_set_company_reservations
before insert or update on public.reservations
for each row
execute function public.set_company_id_from_asset_common();

drop trigger if exists trg_set_company_maintenance_logs on public.maintenance_logs;
create trigger trg_set_company_maintenance_logs
before insert or update on public.maintenance_logs
for each row
execute function public.set_company_id_from_asset_common();

-- Standard tenant RLS policies
alter table public.site_bulk_inventory enable row level security;
alter table public.reservations enable row level security;
alter table public.maintenance_logs enable row level security;

drop policy if exists "site_bulk_inventory_tenant_select" on public.site_bulk_inventory;
create policy "site_bulk_inventory_tenant_select"
on public.site_bulk_inventory for select to authenticated
using (company_id = public.get_user_company_id());

drop policy if exists "site_bulk_inventory_tenant_insert" on public.site_bulk_inventory;
create policy "site_bulk_inventory_tenant_insert"
on public.site_bulk_inventory for insert to authenticated
with check (company_id = public.get_user_company_id());

drop policy if exists "site_bulk_inventory_tenant_update" on public.site_bulk_inventory;
create policy "site_bulk_inventory_tenant_update"
on public.site_bulk_inventory for update to authenticated
using (company_id = public.get_user_company_id())
with check (company_id = public.get_user_company_id());

drop policy if exists "site_bulk_inventory_tenant_delete" on public.site_bulk_inventory;
create policy "site_bulk_inventory_tenant_delete"
on public.site_bulk_inventory for delete to authenticated
using (company_id = public.get_user_company_id());

drop policy if exists "reservations_tenant_select" on public.reservations;
create policy "reservations_tenant_select"
on public.reservations for select to authenticated
using (company_id = public.get_user_company_id());

drop policy if exists "reservations_tenant_insert" on public.reservations;
create policy "reservations_tenant_insert"
on public.reservations for insert to authenticated
with check (
  company_id = public.get_user_company_id()
  and reserved_by_user_id = auth.uid()
);

drop policy if exists "reservations_tenant_update" on public.reservations;
create policy "reservations_tenant_update"
on public.reservations for update to authenticated
using (company_id = public.get_user_company_id())
with check (company_id = public.get_user_company_id());

drop policy if exists "reservations_tenant_delete" on public.reservations;
create policy "reservations_tenant_delete"
on public.reservations for delete to authenticated
using (company_id = public.get_user_company_id());

drop policy if exists "maintenance_logs_tenant_select" on public.maintenance_logs;
create policy "maintenance_logs_tenant_select"
on public.maintenance_logs for select to authenticated
using (company_id = public.get_user_company_id());

drop policy if exists "maintenance_logs_tenant_insert" on public.maintenance_logs;
create policy "maintenance_logs_tenant_insert"
on public.maintenance_logs for insert to authenticated
with check (company_id = public.get_user_company_id());

drop policy if exists "maintenance_logs_tenant_update" on public.maintenance_logs;
create policy "maintenance_logs_tenant_update"
on public.maintenance_logs for update to authenticated
using (company_id = public.get_user_company_id())
with check (company_id = public.get_user_company_id());

drop policy if exists "maintenance_logs_tenant_delete" on public.maintenance_logs;
create policy "maintenance_logs_tenant_delete"
on public.maintenance_logs for delete to authenticated
using (company_id = public.get_user_company_id());

