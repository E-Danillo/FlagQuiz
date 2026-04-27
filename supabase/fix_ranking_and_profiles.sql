-- Correção rápida (SQL Editor → colar → Run):
-- 1) Ranking passa a mostrar partidas mesmo sem linha em profiles
-- 2) Cria perfis em falta para utilizadores que já existem em auth.users

create or replace function public.leaderboard_week(p_limit int default 20)
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
  order by m.score desc, m.played_at asc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

grant execute on function public.leaderboard_week(int) to anon, authenticated;

-- Perfis em falta (nome a partir do metadata ou da parte antes do @ do email)
insert into public.profiles (id, display_name)
select
  u.id,
  coalesce(
    nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''),
    split_part(u.email, '@', 1)
  )
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;
