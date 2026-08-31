create extension if not exists pgcrypto;

create table if not exists public.employee_requests (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  discord_id text not null,
  discord_username text not null,
  ic_name text not null,
  status text not null default 'pending' check (status in ('pending', 'approved')),
  roles_at_request text[] not null default '{}',
  granted_roles text[] not null default '{}',
  roles_after_approval text[] not null default '{}',
  request_message_id text,
  requested_at timestamptz not null default now(),
  reviewed_by text,
  reviewed_at timestamptz
);

create index if not exists employee_requests_discord_idx
  on public.employee_requests (discord_id, requested_at desc);

create index if not exists employee_requests_status_idx
  on public.employee_requests (status, requested_at desc);

alter table public.employee_requests enable row level security;

comment on table public.employee_requests is
  'Registro histórico permanente de todas las solicitudes de rango de empleados.';
