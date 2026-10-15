begin;
-- games is the private participation register: one account, date, status and score.
-- Expose only five finished results, never emails, account IDs or round coordinates.
create index games_daily_ranking on public.games(daily_day,status,completed_at);
create function public.get_daily_leaderboard() returns jsonb
language sql volatile security definer set search_path='' as $$
 with calendar as (select public.argentina_today() as day),
 participants as (
  select count(distinct g.user_id) as count from public.games g,calendar c where g.daily_day=c.day
 ),
 canonical as (
  -- Preserve old repeated attempts, but rank only the first completed one per account.
  select distinct on(g.user_id) g.user_id,g.total,g.completed_at,g.created_at,g.id
  from public.games g,calendar c where g.daily_day=c.day and g.status='completed'
  order by g.user_id,g.completed_at nulls last,g.created_at,g.id
 ),
 ranked as (
  select row_number() over(order by g.total desc,g.completed_at nulls last,g.created_at,g.id) as position,
   p.display_name,g.total,g.user_id=auth.uid() as mine
  from canonical g join public.profiles p on p.id=g.user_id
 ),
 top_five as (select * from ranked order by position limit 5)
 select jsonb_build_object('day',c.day,'participants',p.count,
  'completed',(select count(*) from canonical),
  'entries',coalesce((select jsonb_agg(jsonb_build_object('position',position,'name',display_name,'points',total,'mine',coalesce(mine,false)) order by position) from top_five),'[]'::jsonb))
 from calendar c,participants p
$$;
revoke execute on function public.get_daily_leaderboard() from public,anon,authenticated;
grant execute on function public.get_daily_leaderboard() to anon,authenticated;
commit;
