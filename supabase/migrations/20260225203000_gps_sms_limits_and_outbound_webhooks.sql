-- =========================================================
-- GPS LOGGING, SMS RATE LIMITS, OUTBOUND WEBHOOKS
-- =========================================================

alter table public.logs add column if not exists latitude numeric(10,7);
alter table public.logs add column if not exists longitude numeric(10,7);
alter table public.logs add column if not exists location_accuracy_meters numeric(10,2);

create table if not exists public.sms_rate_limits (
  id uuid primary key default gen_random_uuid(),
  phone_number text not null,
  message_type text not null,
  sent_at timestamptz not null default now()
);

create index if not exists idx_sms_rate_limits_phone_sent_at
  on public.sms_rate_limits (phone_number, sent_at desc);

create table if not exists public.outbound_webhooks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  endpoint_url text not null,
  secret_key text not null,
  event_types text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_outbound_webhooks_company_active
  on public.outbound_webhooks (company_id, is_active);
create index if not exists idx_outbound_webhooks_event_types_gin
  on public.outbound_webhooks using gin (event_types);

alter table public.sms_rate_limits enable row level security;
alter table public.outbound_webhooks enable row level security;

drop policy if exists "outbound_webhooks_tenant_select" on public.outbound_webhooks;
create policy "outbound_webhooks_tenant_select"
on public.outbound_webhooks for select to authenticated
using (company_id = public.get_user_company_id());

drop policy if exists "outbound_webhooks_tenant_insert" on public.outbound_webhooks;
create policy "outbound_webhooks_tenant_insert"
on public.outbound_webhooks for insert to authenticated
with check (company_id = public.get_user_company_id());

drop policy if exists "outbound_webhooks_tenant_update" on public.outbound_webhooks;
create policy "outbound_webhooks_tenant_update"
on public.outbound_webhooks for update to authenticated
using (company_id = public.get_user_company_id())
with check (company_id = public.get_user_company_id());

drop policy if exists "outbound_webhooks_tenant_delete" on public.outbound_webhooks;
create policy "outbound_webhooks_tenant_delete"
on public.outbound_webhooks for delete to authenticated
using (company_id = public.get_user_company_id());

-- Overload RPCs with GPS params for log metadata.
create or replace function public.checkout_asset_by_tag(
  p_tag_id text,
  p_site_id uuid,
  p_event_at timestamptz default null,
  p_offline_timestamp timestamptz default null,
  p_latitude numeric default null,
  p_longitude numeric default null,
  p_location_accuracy_meters numeric default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_asset public.assets%rowtype;
  v_event_at timestamptz := coalesce(p_event_at, now());
  v_overdue_child_count integer;
begin
  if v_user_id is null then
    raise exception 'Unauthorized';
  end if;

  select * into v_asset from public.assets where tag_id = p_tag_id;
  if not found then raise exception 'Asset not found'; end if;
  if v_asset.status <> 'in_yard'::public.asset_status then
    raise exception 'Asset is not currently in the yard';
  end if;
  if v_asset.next_service_date is not null and v_asset.next_service_date < v_event_at then
    raise exception 'Safety Lockout: This asset is overdue for servicing and cannot be checked out.';
  end if;

  select count(*) into v_overdue_child_count
  from public.assets c
  where c.parent_asset_id = v_asset.id
    and c.next_service_date is not null
    and c.next_service_date < v_event_at;
  if v_overdue_child_count > 0 then
    raise exception 'Safety Lockout: A bundled child asset is overdue for servicing and cannot be checked out.';
  end if;

  update public.assets
  set status = 'on_site',
      current_site_id = p_site_id,
      assigned_user_id = v_user_id,
      pending_transfer_user_id = null,
      last_checkout_date = v_event_at
  where id = v_asset.id or parent_asset_id = v_asset.id;

  insert into public.logs (
    asset_id, user_id, site_id, action, condition, created_at, offline_timestamp,
    latitude, longitude, location_accuracy_meters
  )
  select a.id, v_user_id, p_site_id, 'checkout', 'good', v_event_at, p_offline_timestamp,
         p_latitude, p_longitude, p_location_accuracy_meters
  from public.assets a
  where a.id = v_asset.id or a.parent_asset_id = v_asset.id;
end;
$$;

create or replace function public.return_asset_by_tag(
  p_tag_id text,
  p_is_damaged boolean,
  p_photo_url text default null,
  p_notes text default null,
  p_event_at timestamptz default null,
  p_offline_timestamp timestamptz default null,
  p_latitude numeric default null,
  p_longitude numeric default null,
  p_location_accuracy_meters numeric default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_asset public.assets%rowtype;
  v_event_at timestamptz := coalesce(p_event_at, now());
  v_next_status public.asset_status := case when p_is_damaged then 'quarantine' else 'in_yard' end;
begin
  if v_user_id is null then raise exception 'Unauthorized'; end if;
  select * into v_asset from public.assets where tag_id = p_tag_id;
  if not found then raise exception 'Asset not found'; end if;
  if v_asset.assigned_user_id is not null and v_asset.assigned_user_id <> v_user_id then
    raise exception 'You are not assigned to this asset';
  end if;

  update public.assets
  set status = v_next_status,
      current_site_id = null,
      assigned_user_id = null,
      pending_transfer_user_id = null
  where id = v_asset.id or parent_asset_id = v_asset.id;

  insert into public.logs (
    asset_id, user_id, site_id, action, condition, damage_photo_url, notes, created_at, offline_timestamp,
    latitude, longitude, location_accuracy_meters
  )
  select a.id, v_user_id, null, 'return',
         case when p_is_damaged then 'damaged' else 'good' end,
         case when p_is_damaged then p_photo_url else null end,
         nullif(trim(coalesce(p_notes, '')), ''),
         v_event_at, p_offline_timestamp,
         p_latitude, p_longitude, p_location_accuracy_meters
  from public.assets a
  where a.id = v_asset.id or a.parent_asset_id = v_asset.id;
end;
$$;

grant execute on function public.checkout_asset_by_tag(text, uuid, timestamptz, timestamptz, numeric, numeric, numeric) to authenticated;
grant execute on function public.return_asset_by_tag(text, boolean, text, text, timestamptz, timestamptz, numeric, numeric, numeric) to authenticated;

