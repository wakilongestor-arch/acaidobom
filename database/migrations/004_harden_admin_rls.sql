-- Execute depois das migrações anteriores no SQL Editor do Supabase.
-- Cadastre o UUID do administrador em public.admin_users antes de usar o painel.

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
revoke all on public.admin_users from anon, authenticated;

grant select on public.admin_users to service_role;

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

alter table public.catalogs enable row level security;
alter table public.orders enable row level security;
alter table public.private_settings enable row level security;
alter table public.order_webhook_events enable row level security;

drop policy if exists "administrador gerencia catalogo" on public.catalogs;
create policy "administrador gerencia catalogo"
  on public.catalogs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "administrador le pedidos" on public.orders;
create policy "administrador le pedidos"
  on public.orders for select to authenticated using (public.is_admin());

drop policy if exists "administrador atualiza pedidos" on public.orders;
create policy "administrador atualiza pedidos"
  on public.orders for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "administrador exclui pedidos" on public.orders;
create policy "administrador exclui pedidos"
  on public.orders for delete to authenticated using (public.is_admin());

drop policy if exists "administrador gerencia configuracoes privadas" on public.private_settings;
create policy "administrador gerencia configuracoes privadas"
  on public.private_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "administrador le historico de webhooks" on public.order_webhook_events;
create policy "administrador le historico de webhooks"
  on public.order_webhook_events for select to authenticated using (public.is_admin());

drop policy if exists "administrador envia imagens" on storage.objects;
create policy "administrador envia imagens"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'menu-images' and public.is_admin());

drop policy if exists "administrador atualiza imagens" on storage.objects;
create policy "administrador atualiza imagens"
  on storage.objects for update to authenticated
  using (bucket_id = 'menu-images' and public.is_admin())
  with check (bucket_id = 'menu-images' and public.is_admin());

drop policy if exists "administrador remove imagens" on storage.objects;
create policy "administrador remove imagens"
  on storage.objects for delete to authenticated
  using (bucket_id = 'menu-images' and public.is_admin());
