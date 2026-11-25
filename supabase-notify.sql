-- Fit Tracker: notifiche push. Da eseguire una volta nello SQL Editor.

-- Iscrizioni dei dispositivi: ognuno gestisce solo le proprie.
create table if not exists public.push_subs (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  sub jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.push_subs enable row level security;
revoke all on public.push_subs from anon;
grant select, insert, update, delete on public.push_subs to authenticated;
drop policy if exists "push_subs: solo le mie" on public.push_subs;
create policy "push_subs: solo le mie" on public.push_subs for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Promemoria già mandati (per non ripeterli) e chiavi del server: solo il servizio notifiche li legge.
create table if not exists public.push_log (
  user_id uuid not null references auth.users on delete cascade,
  key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, key)
);
create table if not exists public.push_keys (id int primary key, keys jsonb not null);
alter table public.push_log enable row level security;
alter table public.push_keys enable row level security;
revoke all on public.push_log, public.push_keys from anon, authenticated;
-- Il progetto non concede accessi automatici alle tabelle nuove: il servizio notifiche (service_role) li riceve qui.
grant select, insert, update, delete on public.push_subs, public.push_log, public.push_keys to service_role;
grant select on public.fit_data to service_role;

-- Ogni 15 minuti chiede al servizio di mandare i promemoria dovuti.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('fit-notify') where exists (select 1 from cron.job where jobname = 'fit-notify');
select cron.schedule('fit-notify', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://hzjedbtpdxhpfwrawwhn.supabase.co/functions/v1/notify',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"run": true}'::jsonb
  );
$$);
