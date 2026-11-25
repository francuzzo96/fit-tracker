-- Fit Tracker: da incollare una volta in Supabase > SQL Editor > New query > Run.
-- Ogni utente vede e modifica solo i propri dati (Row Level Security).

-- 1. I dati dell'app (allenamenti, dieta, agenda, progressi, referti): una riga per utente.
create table if not exists public.fit_data (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.fit_data enable row level security;
-- Accesso dall'app solo per chi ha fatto login (e poi solo alla propria riga, vedi la regola sotto).
revoke all on public.fit_data from anon;
grant select, insert, update, delete on public.fit_data to authenticated;

drop policy if exists "fit_data: solo i miei" on public.fit_data;
create policy "fit_data: solo i miei" on public.fit_data
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- L'ora di modifica la mette il server, così i dispositivi non si contraddicono.
create or replace function public.fit_touch() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := clock_timestamp(); return new; end $$;
drop trigger if exists fit_touch on public.fit_data;
create trigger fit_touch before insert or update on public.fit_data
  for each row execute function public.fit_touch();

-- 2. Le foto e i PDF dei referti: cartella privata, una sottocartella per utente.
insert into storage.buckets (id, name, public, file_size_limit)
values ('referti', 'referti', false, 26214400)
on conflict (id) do nothing;

drop policy if exists "referti: leggo i miei" on storage.objects;
drop policy if exists "referti: carico i miei" on storage.objects;
drop policy if exists "referti: aggiorno i miei" on storage.objects;
drop policy if exists "referti: cancello i miei" on storage.objects;
create policy "referti: leggo i miei" on storage.objects for select to authenticated
  using (bucket_id = 'referti' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "referti: carico i miei" on storage.objects for insert to authenticated
  with check (bucket_id = 'referti' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "referti: aggiorno i miei" on storage.objects for update to authenticated
  using (bucket_id = 'referti' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "referti: cancello i miei" on storage.objects for delete to authenticated
  using (bucket_id = 'referti' and (storage.foldername(name))[1] = (select auth.uid())::text);
