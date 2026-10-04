-- Run once in the Supabase SQL Editor, or apply with supabase db push.
-- Demo identities are issued by PlanPilot's server, not Supabase Auth users.
begin;

create table if not exists public.planpilot_profiles (
  id uuid primary key,
  display_name text not null check (char_length(display_name) between 1 and 80),
  email text not null,
  phone text not null default '',
  company text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.planpilot_consultations (
  user_id uuid primary key references public.planpilot_profiles(id) on delete cascade,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  status text not null default 'in_progress' check (status in ('in_progress', 'ready')),
  updated_at timestamptz not null default now()
);

alter table public.planpilot_profiles enable row level security;
alter table public.planpilot_consultations enable row level security;
-- Access goes through server routes scoped to a validated signed demo cookie.
-- No direct browser/anonymous table access, and no public read policies.
revoke all on public.planpilot_profiles from anon, authenticated;
revoke all on public.planpilot_consultations from anon, authenticated;
grant select, insert, update on public.planpilot_profiles to service_role;
grant select, insert, update on public.planpilot_consultations to service_role;

commit;
