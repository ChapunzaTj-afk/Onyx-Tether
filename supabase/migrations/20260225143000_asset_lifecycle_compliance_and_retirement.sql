-- =========================================================
-- ASSET LIFECYCLE: compliance date + retired status
-- =========================================================

do $$
begin
  begin
    alter type public.asset_status add value if not exists 'retired';
  exception
    when duplicate_object then null;
  end;
end
$$;

alter table public.assets
  add column if not exists next_service_date timestamptz;

create index if not exists idx_assets_company_next_service_date
  on public.assets (company_id, next_service_date);

-- Extend log actions so retirement/loss can be recorded in the audit trail.
do $$
begin
  begin
    alter type public.log_action add value if not exists 'retire';
  exception
    when duplicate_object then null;
  end;

  begin
    alter type public.log_action add value if not exists 'mark_lost';
  exception
    when duplicate_object then null;
  end;
end
$$;

