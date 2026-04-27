-- Ranking por modo: actualizar função leaderboard_week (SQL Editor → Run).

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
