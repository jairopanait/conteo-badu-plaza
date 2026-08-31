create extension if not exists pgcrypto;

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  seller_discord_id text not null,
  seller_name text not null,
  item_id text not null,
  item_name text not null,
  unit_price bigint not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0),
  total bigint not null check (total >= 0),
  status text not null default 'active' check (status in ('active', 'cancelled')),
  discord_message_id text,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);

create index if not exists sales_guild_created_idx
  on public.sales (guild_id, created_at desc);

create index if not exists sales_seller_created_idx
  on public.sales (seller_discord_id, created_at desc);

alter table public.sales enable row level security;

comment on table public.sales is
  'Ventas del bot. Solo el backend accede usando SUPABASE_SERVICE_ROLE_KEY.';

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
