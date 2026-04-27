-- FlagQuiz — executar no SQL Editor do Supabase (Database → SQL → New query).
-- Depois: Authentication → Providers → Email (activar).

-- Perfil público (nome no ranking)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  updated_at timestamptz default now()
);

alter table public.profiles add column if not exists country text;
alter table public.profiles add column if not exists age smallint;
alter table public.profiles drop constraint if exists profiles_age_range;
alter table public.profiles add constraint profiles_age_range check (
  age is null or (age >= 6 and age <= 120)
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_public" on public.profiles;
create policy "profiles_select_public" on public.profiles for select using (true);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- Ao registar utilizador: criar linha em profiles (metadata.display_name do signUp)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do update
    set display_name = excluded.display_name,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Partidas
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  score int not null,
  xp int not null,
  correct int not null,
  wrong int not null,
  mode text not null check (mode in ('flag-to-name', 'name-to-flag')),
  played_at timestamptz not null default now()
);

create index if not exists matches_user_played on public.matches (user_id, played_at desc);
create index if not exists matches_played_at on public.matches (played_at);

alter table public.matches enable row level security;

drop policy if exists "matches_insert_own" on public.matches;
create policy "matches_insert_own" on public.matches
  for insert with check (auth.uid() = user_id);

drop policy if exists "matches_select_own" on public.matches;
create policy "matches_select_own" on public.matches
  for select using (auth.uid() = user_id);

-- Manter no máximo 10 partidas por utilizador (as mais recentes)
create or replace function public.trim_old_matches()
returns trigger
language plpgsql
as $$
begin
  delete from public.matches
  where user_id = new.user_id
    and id not in (
      select id from public.matches
      where user_id = new.user_id
      order by played_at desc
      limit 10
    );
  return new;
end;
$$;

drop trigger if exists trg_trim_matches on public.matches;
create trigger trg_trim_matches
  after insert on public.matches
  for each row execute function public.trim_old_matches();

-- Ranking semanal (UTC). p_mode: 'flag-to-name' | 'name-to-flag' | null (todos os modos)
drop function if exists public.leaderboard_week(int);
drop function if exists public.leaderboard_week(int, text);

create or replace function public.leaderboard_week(
  p_limit int default 20,
  p_mode text default null
)
returns table (
  rank bigint,
  display_name text,
  score int,
  played_at timestamptz,
  week_start timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select date_trunc('week', (now() at time zone 'utc'))::timestamptz as ws
  )
  select
    row_number() over (order by m.score desc, m.played_at asc)::bigint,
    coalesce(nullif(trim(p.display_name), ''), 'Jogador') as display_name,
    m.score,
    m.played_at,
    (select ws from bounds)
  from public.matches m
  left join public.profiles p on p.id = m.user_id
  cross join bounds b
  where m.played_at >= b.ws
    and (p_mode is null or m.mode = p_mode)
  order by m.score desc, m.played_at asc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

grant execute on function public.leaderboard_week(int, text) to anon, authenticated;
