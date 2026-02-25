-- =========================================================
-- COMPANIES: timezone + Stripe billing identifiers
-- =========================================================
alter table public.companies
  add column if not exists timezone text not null default 'Europe/London';

alter table public.companies
  add column if not exists stripe_customer_id text;

alter table public.companies
  add column if not exists stripe_subscription_id text;

create unique index if not exists idx_companies_stripe_customer_id_unique
  on public.companies (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists idx_companies_stripe_subscription_id_unique
  on public.companies (stripe_subscription_id)
  where stripe_subscription_id is not null;

