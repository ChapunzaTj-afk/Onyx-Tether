-- =========================================================
-- HOT POTATO FIX: two-step transfers
-- =========================================================

do $$
begin
  begin
    alter type public.asset_status add value if not exists 'transfer_pending';
  exception
    when duplicate_object then null;
  end;
end
$$;

alter table public.assets
  add column if not exists pending_transfer_user_id uuid;

do $$
begin
  begin
    alter table public.assets
      add constraint assets_pending_transfer_user_id_fkey
      foreign key (pending_transfer_user_id) references public.profiles(id) on delete set null;
  exception when duplicate_object then null;
  end;
end
$$;

create index if not exists idx_assets_pending_transfer_user_id
  on public.assets (pending_transfer_user_id);

-- Multi-tenant tag uniqueness should be scoped to company, not global.
alter table public.assets
  drop constraint if exists assets_tag_id_key;

create unique index if not exists idx_assets_company_tag_id_unique
  on public.assets (company_id, tag_id);

-- New audit log actions required by the patched flow
do $$
begin
  begin
    alter type public.log_action add value if not exists 'transfer_accepted';
  exception
    when duplicate_object then null;
  end;

  begin
    alter type public.log_action add value if not exists 'tag_replaced';
  exception
    when duplicate_object then null;
  end;
end
$$;

-- Patch asset sync trigger to treat transfer_accepted (not transfer request) as the state change.
create or replace function public.apply_log_to_asset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.action in ('checkout', 'transfer_accepted') and new.site_id is null then
    raise exception 'site_id is required for action %', new.action;
  end if;

  update public.assets a
  set
    status = case
      when new.action = 'return' then 'in_yard'::public.asset_status
      when new.action = 'flag_damaged' or new.condition = 'damaged' then 'quarantine'::public.asset_status
      when new.action in ('checkout', 'transfer_accepted') then 'on_site'::public.asset_status
      else a.status
    end,
    current_site_id = case
      when new.action = 'return' then null
      when new.action in ('checkout', 'transfer_accepted') then new.site_id
      else a.current_site_id
    end,
    assigned_user_id = case
      when new.action = 'return' then null
      when new.action in ('checkout', 'transfer_accepted') then new.user_id
      else a.assigned_user_id
    end,
    pending_transfer_user_id = case
      when new.action = 'transfer_accepted' then null
      when new.action = 'return' then null
      else a.pending_transfer_user_id
    end,
    last_checkout_date = case
      when new.action in ('checkout', 'transfer_accepted') then coalesce(new.created_at, now())
      else a.last_checkout_date
    end
  where a.id = new.asset_id;

  if not found then
    raise exception 'asset_id % not found for log insert', new.asset_id;
  end if;

  return new;
end;
$$;
