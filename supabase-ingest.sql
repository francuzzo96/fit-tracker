-- Fit Tracker: collegamento con le email (movimenti e ordini). Da eseguire una volta nello SQL Editor.
-- Un codice segreto per utente: nel database c'è solo l'hash SHA-256, il codice vero lo conosce solo lo script nell'account Google dell'utente.
create table if not exists public.ingest_tokens (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_at timestamptz
);
alter table public.ingest_tokens enable row level security;
revoke all on public.ingest_tokens from anon;
grant select, insert, update, delete on public.ingest_tokens to authenticated;
grant select, insert, update, delete on public.ingest_tokens to service_role;
grant select, update on public.fit_data to service_role;
drop policy if exists "ingest_tokens: solo il mio" on public.ingest_tokens;
create policy "ingest_tokens: solo il mio" on public.ingest_tokens for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
