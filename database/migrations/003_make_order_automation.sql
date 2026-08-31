-- Açaí do Bom: CRM de pedidos + automação de e-mail Make/Mailgun.
-- Execute todo este arquivo no SQL Editor do Supabase.

alter table public.orders add column if not exists store_email_status text not null default 'nao_enviado';
alter table public.orders add column if not exists customer_email_status text not null default 'nao_enviado';
alter table public.orders add column if not exists email_error text not null default '';
alter table public.orders add column if not exists last_email_at timestamptz;

create table if not exists public.private_settings (
  id text primary key check (id in ('integrations')),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.order_webhook_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  event_type text not null,
  source_updated_at timestamptz not null,
  status text not null default 'processando' check (status in ('processando','enviado','erro')),
  response_status integer,
  error_message text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, event_type, source_updated_at)
);

create index if not exists order_webhook_events_order_idx
  on public.order_webhook_events (order_id, created_at desc);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
revoke all on public.admin_users from anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    or exists (select 1 from public.admin_users where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated, service_role;

alter table public.private_settings enable row level security;
alter table public.order_webhook_events enable row level security;

drop policy if exists "administrador gerencia configuracoes privadas" on public.private_settings;
create policy "administrador gerencia configuracoes privadas"
  on public.private_settings for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "administrador le historico de webhooks" on public.order_webhook_events;
create policy "administrador le historico de webhooks"
  on public.order_webhook_events for select
  to authenticated
  using (public.is_admin());

drop policy if exists "administrador exclui pedidos" on public.orders;
create policy "administrador exclui pedidos"
  on public.orders for delete
  to authenticated
  using (public.is_admin());

grant select, insert, update, delete on public.private_settings to authenticated;
grant select on public.order_webhook_events to authenticated;
grant delete on public.orders to authenticated;
grant select, insert, update, delete on public.private_settings to service_role;
grant select, insert, update, delete on public.order_webhook_events to service_role;
grant select, update on public.orders to service_role;

insert into public.private_settings (id, data)
values ('integrations', '{"makeWebhookEnabled":false,"makeWebhookUrl":""}'::jsonb)
on conflict (id) do nothing;
