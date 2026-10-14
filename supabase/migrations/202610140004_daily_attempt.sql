begin;
-- One attempt per account and Argentina date. Resume the existing game without resetting deadlines.
create or replace function public.create_game(p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_game public.games;v_daily jsonb;
begin
 if v_user is null then raise exception 'Ingresá a tu cuenta' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_user::text,0));
 v_daily:=public.get_daily_challenge();
 if v_daily is null then raise exception 'El desafío diario todavía se está preparando';end if;
 if exists(select 1 from public.games where user_id=v_user and daily_day=(v_daily->>'day')::date and status='completed') then
  raise exception 'Ya completaste el desafío de hoy. Podés consultar tu puntaje.';
 end if;
 select * into v_game from public.games where user_id=v_user and daily_day=(v_daily->>'day')::date and status='playing' order by created_at limit 1 for update;
 if not found then
  if exists(select 1 from public.games where user_id=v_user and daily_day=(v_daily->>'day')::date) then raise exception 'Ya utilizaste tu intento del desafío de hoy';end if;
 end if;
 if v_game.id is null then
  update public.game_rounds set target_lat=null,target_lng=null where game_id in(select id from public.games where user_id=v_user and status='playing');
  update public.games set status='abandoned',completed_at=clock_timestamp() where user_id=v_user and status='playing';
  insert into public.games(user_id,request_id,daily_day,daily_challenge_id) values(v_user,p_request_id,(v_daily->>'day')::date,(v_daily->>'id')::uuid) returning * into v_game;
  insert into public.game_rounds(game_id,round_index,location_id,name)
   select v_game.id,d.round_index,d.location_id,d.name from public.daily_locations d where d.challenge_id=v_game.daily_challenge_id;
 end if;
 return jsonb_build_object('id',v_game.id,'status',v_game.status,'day',v_game.daily_day,'results',(select coalesce(jsonb_agg(jsonb_build_object('name',name,'distance',distance,'points',points,'timedOut',timed_out) order by round_index),'[]'::jsonb) from public.game_rounds where game_id=v_game.id and status='completed'),'locations',(
  select jsonb_agg(jsonb_build_object('id',l.id,'name',r.name,'lat',coalesce(d.lat,l.lat),'lng',coalesce(d.lng,l.lng),'region',coalesce(d.region,l.region),'kind',coalesce(d.kind,l.kind),'hint','','panoId',d.pano_id) order by r.round_index)
  from public.game_rounds r join public.locations l on l.id=r.location_id left join public.daily_locations d on d.challenge_id=v_game.daily_challenge_id and d.round_index=r.round_index where r.game_id=v_game.id
 ));
end; $$;

commit;
