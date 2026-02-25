-- =========================================================
-- OFFLINE / KITS / SUBCONTRACTORS SUPPORT
-- =========================================================

alter table public.assets
  add column if not exists parent_asset_id uuid;

do $$
begin
  begin
    alter table public.assets
      add constraint assets_parent_asset_id_fkey
      foreign key (parent_asset_id) references public.assets(id) on delete set null;
  exception when duplicate_object then null;
  end;
end
$$;

create index if not exists idx_assets_parent_asset_id
  on public.assets (parent_asset_id);

alter table public.profiles
  add column if not exists is_external boolean not null default false;

alter table public.logs
  add column if not exists offline_timestamp timestamptz;

create index if not exists idx_logs_offline_timestamp
  on public.logs (offline_timestamp);

-- =========================================================
-- ATOMIC ASSET LIFECYCLE RPCS (parent + child propagation)
-- =========================================================

create or replace function public.checkout_asset_by_tag(
  p_tag_id text,
  p_site_id uuid,
  p_event_at timestamptz default null,
  p_offline_timestamp timestamptz default null
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

  select * into v_asset
  from public.assets
  where tag_id = p_tag_id;

  if not found then
    raise exception 'Asset not found';
  end if;

  if v_asset.status <> 'in_yard'::public.asset_status then
    raise exception 'Asset is not currently in the yard';
  end if;

  if v_asset.next_service_date is not null and v_asset.next_service_date < v_event_at then
    raise exception 'Safety Lockout: This asset is overdue for servicing and cannot be checked out.';
  end if;

  select count(*)
  into v_overdue_child_count
  from public.assets c
  where c.parent_asset_id = v_asset.id
    and c.next_service_date is not null
    and c.next_service_date < v_event_at;

  if v_overdue_child_count > 0 then
    raise exception 'Safety Lockout: A bundled child asset is overdue for servicing and cannot be checked out.';
  end if;

  -- Atomic parent + child update
  update public.assets
  set
    status = 'on_site',
    current_site_id = p_site_id,
    assigned_user_id = v_user_id,
    pending_transfer_user_id = null,
    last_checkout_date = v_event_at
  where id = v_asset.id
     or parent_asset_id = v_asset.id;

  insert into public.logs (asset_id, user_id, site_id, action, condition, created_at, offline_timestamp)
  select a.id, v_user_id, p_site_id, 'checkout', 'good', v_event_at, p_offline_timestamp
  from public.assets a
  where a.id = v_asset.id
     or a.parent_asset_id = v_asset.id;
end;
$$;

create or replace function public.return_asset_by_tag(
  p_tag_id text,
  p_is_damaged boolean,
  p_photo_url text default null,
  p_notes text default null,
  p_event_at timestamptz default null,
  p_offline_timestamp timestamptz default null
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
  if v_user_id is null then
    raise exception 'Unauthorized';
  end if;

  select * into v_asset
  from public.assets
  where tag_id = p_tag_id;

  if not found then
    raise exception 'Asset not found';
  end if;

  if v_asset.assigned_user_id is not null and v_asset.assigned_user_id <> v_user_id then
    raise exception 'You are not assigned to this asset';
  end if;

  update public.assets
  set
    status = v_next_status,
    current_site_id = null,
    assigned_user_id = null,
    pending_transfer_user_id = null
  where id = v_asset.id
     or parent_asset_id = v_asset.id;

  insert into public.logs (
    asset_id, user_id, site_id, action, condition, damage_photo_url, notes, created_at, offline_timestamp
  )
  select
    a.id,
    v_user_id,
    null,
    'return',
    case when p_is_damaged then 'damaged' else 'good' end,
    case when p_is_damaged then p_photo_url else null end,
    nullif(trim(coalesce(p_notes, '')), ''),
    v_event_at,
    p_offline_timestamp
  from public.assets a
  where a.id = v_asset.id
     or a.parent_asset_id = v_asset.id;
end;
$$;

create or replace function public.request_asset_transfer_by_tag(
  p_tag_id text,
  p_target_user_id uuid,
  p_event_at timestamptz default null,
  p_offline_timestamp timestamptz default null
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
begin
  if v_user_id is null then
    raise exception 'Unauthorized';
  end if;

  select * into v_asset
  from public.assets
  where tag_id = p_tag_id;

  if not found then
    raise exception 'Asset not found';
  end if;

  if v_asset.assigned_user_id <> v_user_id then
    raise exception 'You are not currently assigned to this asset';
  end if;

  if v_asset.current_site_id is null then
    raise exception 'Asset is not currently assigned to a site';
  end if;

  if v_asset.status <> 'on_site'::public.asset_status then
    raise exception 'Asset must be on site to start a transfer';
  end if;

  update public.assets
  set
    status = 'transfer_pending',
    pending_transfer_user_id = p_target_user_id
  where id = v_asset.id
     or parent_asset_id = v_asset.id;

  -- Keep audit trail for transfer request (trigger ignores this action for state sync)
  insert into public.logs (asset_id, user_id, site_id, action, condition, created_at, offline_timestamp)
  select a.id, v_user_id, v_asset.current_site_id, 'transfer', 'good', v_event_at, p_offline_timestamp
  from public.assets a
  where a.id = v_asset.id
     or a.parent_asset_id = v_asset.id;
end;
$$;

create or replace function public.accept_asset_transfer_by_tag(
  p_tag_id text,
  p_event_at timestamptz default null,
  p_offline_timestamp timestamptz default null
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
begin
  if v_user_id is null then
    raise exception 'Unauthorized';
  end if;

  select * into v_asset
  from public.assets
  where tag_id = p_tag_id;

  if not found then
    raise exception 'Asset not found';
  end if;

  if v_asset.status <> 'transfer_pending'::public.asset_status then
    raise exception 'Asset is not awaiting transfer acceptance';
  end if;

  if v_asset.pending_transfer_user_id <> v_user_id then
    raise exception 'You are not the pending transfer recipient';
  end if;

  if v_asset.current_site_id is null then
    raise exception 'Asset is missing a site assignment';
  end if;

  update public.assets
  set
    assigned_user_id = v_user_id,
    pending_transfer_user_id = null,
    status = 'on_site',
    last_checkout_date = v_event_at
  where id = v_asset.id
     or parent_asset_id = v_asset.id;

  insert into public.logs (asset_id, user_id, site_id, action, condition, created_at, offline_timestamp)
  select a.id, v_user_id, v_asset.current_site_id, 'transfer_accepted', 'good', v_event_at, p_offline_timestamp
  from public.assets a
  where a.id = v_asset.id
     or a.parent_asset_id = v_asset.id;
end;
$$;

create or replace function public.reject_asset_transfer_by_tag(
  p_tag_id text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_asset public.assets%rowtype;
begin
  if v_user_id is null then
    raise exception 'Unauthorized';
  end if;

  select * into v_asset
  from public.assets
  where tag_id = p_tag_id;

  if not found then
    raise exception 'Asset not found';
  end if;

  if v_asset.status <> 'transfer_pending'::public.asset_status then
    raise exception 'Asset is not awaiting transfer acceptance';
  end if;

  if v_asset.pending_transfer_user_id <> v_user_id then
    raise exception 'You are not the pending transfer recipient';
  end if;

  update public.assets
  set
    status = 'on_site',
    pending_transfer_user_id = null
  where id = v_asset.id
     or parent_asset_id = v_asset.id;
end;
$$;

grant execute on function public.checkout_asset_by_tag(text, uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.return_asset_by_tag(text, boolean, text, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.request_asset_transfer_by_tag(text, uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.accept_asset_transfer_by_tag(text, timestamptz, timestamptz) to authenticated;
grant execute on function public.reject_asset_transfer_by_tag(text) to authenticated;
