alter table public.sales
  add column if not exists sale_batch_id uuid;

create table if not exists public.inventory (
  item_id text primary key,
  item_name text not null,
  quantity bigint not null default 0,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.inventory
  drop constraint if exists inventory_quantity_check;

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  item_id text not null,
  item_name text not null,
  quantity_delta bigint not null,
  movement_type text not null check (movement_type in ('restock', 'sale', 'cancellation')),
  actor_discord_id text not null,
  reference_id text,
  created_at timestamptz not null default now()
);

create index if not exists inventory_movements_item_idx
  on public.inventory_movements (item_id, created_at desc);

create index if not exists inventory_movements_reference_idx
  on public.inventory_movements (reference_id);

alter table public.inventory enable row level security;
alter table public.inventory_movements enable row level security;

create or replace function public.restock_inventory(
  p_item_id text,
  p_item_name text,
  p_quantity bigint,
  p_actor_discord_id text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_quantity bigint;
begin
  if p_quantity <= 0 then
    raise exception 'INVALID_QUANTITY';
  end if;

  insert into public.inventory (item_id, item_name, quantity, updated_at, updated_by)
  values (p_item_id, p_item_name, p_quantity, now(), p_actor_discord_id)
  on conflict (item_id) do update
    set item_name = excluded.item_name,
        quantity = inventory.quantity + excluded.quantity,
        updated_at = now(),
        updated_by = excluded.updated_by
  returning quantity into new_quantity;

  insert into public.inventory_movements
    (item_id, item_name, quantity_delta, movement_type, actor_discord_id)
  values
    (p_item_id, p_item_name, p_quantity, 'restock', p_actor_discord_id);

  return new_quantity;
end;
$$;

create or replace function public.record_sale_with_inventory(
  p_guild_id text,
  p_seller_discord_id text,
  p_seller_name text,
  p_items jsonb,
  p_batch_id uuid
)
returns setof public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  sold public.sales%rowtype;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_SALE';
  end if;

  for item in select value from jsonb_array_elements(p_items)
  loop
    if (item->>'quantity')::bigint <= 0 then
      raise exception 'INVALID_QUANTITY';
    end if;
    insert into public.inventory (item_id, item_name, quantity)
    values (item->>'item_id', item->>'item_name', 0)
    on conflict (item_id) do update set item_name = excluded.item_name;
  end loop;

  for item in select value from jsonb_array_elements(p_items)
  loop
    update public.inventory
    set quantity = quantity - (item->>'quantity')::bigint,
        updated_at = now(),
        updated_by = p_seller_discord_id
    where item_id = item->>'item_id';

    insert into public.sales (
      guild_id, seller_discord_id, seller_name, item_id, item_name,
      unit_price, quantity, total, sale_batch_id
    ) values (
      p_guild_id,
      p_seller_discord_id,
      p_seller_name,
      item->>'item_id',
      item->>'item_name',
      (item->>'unit_price')::bigint,
      (item->>'quantity')::integer,
      (item->>'unit_price')::bigint * (item->>'quantity')::bigint,
      p_batch_id
    ) returning * into sold;

    insert into public.inventory_movements (
      item_id, item_name, quantity_delta, movement_type,
      actor_discord_id, reference_id
    ) values (
      item->>'item_id',
      item->>'item_name',
      -((item->>'quantity')::bigint),
      'sale',
      p_seller_discord_id,
      p_batch_id::text
    );

    return next sold;
  end loop;
end;
$$;

create or replace function public.cancel_sale_and_restore_inventory(
  p_sale_id uuid,
  p_actor_discord_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  anchor public.sales%rowtype;
  sale_row public.sales%rowtype;
  movement_reference text;
begin
  select * into anchor from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'SALE_NOT_FOUND';
  end if;
  if anchor.status = 'cancelled' then
    return;
  end if;

  movement_reference := coalesce(anchor.sale_batch_id::text, anchor.discord_message_id, anchor.id::text);

  for sale_row in
    select * from public.sales
    where status = 'active'
      and (
        (anchor.sale_batch_id is not null and sale_batch_id = anchor.sale_batch_id)
        or (anchor.sale_batch_id is null and anchor.discord_message_id is not null and discord_message_id = anchor.discord_message_id)
        or (anchor.sale_batch_id is null and anchor.discord_message_id is null and id = anchor.id)
      )
    for update
  loop
    insert into public.inventory (item_id, item_name, quantity, updated_at, updated_by)
    values (sale_row.item_id, sale_row.item_name, sale_row.quantity, now(), p_actor_discord_id)
    on conflict (item_id) do update
      set item_name = excluded.item_name,
          quantity = inventory.quantity + excluded.quantity,
          updated_at = now(),
          updated_by = excluded.updated_by;

    insert into public.inventory_movements (
      item_id, item_name, quantity_delta, movement_type,
      actor_discord_id, reference_id
    ) values (
      sale_row.item_id,
      sale_row.item_name,
      sale_row.quantity,
      'cancellation',
      p_actor_discord_id,
      movement_reference
    );

    update public.sales
    set status = 'cancelled', cancelled_at = now()
    where id = sale_row.id;
  end loop;
end;
$$;

revoke all on function public.restock_inventory(text, text, bigint, text) from public, anon, authenticated;
revoke all on function public.record_sale_with_inventory(text, text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.cancel_sale_and_restore_inventory(uuid, text) from public, anon, authenticated;

grant execute on function public.restock_inventory(text, text, bigint, text) to service_role;
grant execute on function public.record_sale_with_inventory(text, text, text, jsonb, uuid) to service_role;
grant execute on function public.cancel_sale_and_restore_inventory(uuid, text) to service_role;
