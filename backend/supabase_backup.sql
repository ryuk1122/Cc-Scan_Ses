-- One-table, append/update mirror for lightweight recovery of events and scans.
-- Execute in the Supabase SQL editor. Only the FastAPI backend uses the secret key.
create table if not exists public.ccscan_backup (
  backup_id text primary key,
  entity_type text not null,
  entity_id text not null,
  payload jsonb not null,
  backed_up_at timestamptz not null default now()
);

alter table public.ccscan_backup enable row level security;
revoke all on table public.ccscan_backup from anon, authenticated;

create index if not exists ccscan_backup_type_time_idx
  on public.ccscan_backup (entity_type, backed_up_at desc);

comment on table public.ccscan_backup is
  'Secondary recovery mirror from CedulaScan API. MongoDB remains the operational source of truth.';
