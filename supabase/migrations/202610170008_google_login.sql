begin;
-- Use signed JWT provider metadata, never client-supplied profile fields.
create function public.require_google_login() returns void language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not(coalesce(auth.jwt()->'amr','[]'::jsonb) @> '[{"method":"oauth"}]'::jsonb) or not(
  coalesce(auth.jwt()->'app_metadata'->>'provider','')='google' or coalesce(auth.jwt()->'app_metadata'->'providers','[]'::jsonb) @> '["google"]'::jsonb
 ) then
  raise exception 'Ingresá con Google para jugar' using errcode='42501';
 end if;
end; $$;
revoke execute on function public.require_google_login() from public,anon,authenticated;
create or replace function public.create_game(p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_game public.games;v_daily jsonb;
begin
 perform public.require_google_login();
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

create or replace function public.start_round(p_game_id uuid,p_index integer,p_target_lat double precision,p_target_lng double precision,p_pano_id text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_game public.games; v_round public.game_rounds; v_location public.locations; v_now timestamptz:=clock_timestamp();
begin
 perform public.require_google_login();
 select * into v_game from public.games where id=p_game_id and user_id=auth.uid() for update;
 if not found or v_game.status<>'playing' then raise exception 'Partida no disponible' using errcode='42501'; end if;
 select * into v_round from public.game_rounds where game_id=p_game_id and round_index=p_index for update;
 if not found then raise exception 'Ronda inexistente'; end if;
 if exists(select 1 from public.game_rounds where game_id=p_game_id and round_index<p_index and status<>'completed') then raise exception 'Terminá las rondas anteriores'; end if;
 if v_game.daily_challenge_id is not null and not exists(select 1 from public.daily_locations where challenge_id=v_game.daily_challenge_id and round_index=p_index and pano_id=p_pano_id) then raise exception 'Panorama incorrecto para el desafío diario';end if;
 if v_round.status='completed' then raise exception 'La ronda ya terminó'; end if;
 if v_round.status='loading' then
  v_now:=clock_timestamp();
  select * into v_location from public.locations where id=v_round.location_id;
  if v_game.daily_challenge_id is not null then select lat,lng into v_location.lat,v_location.lng from public.daily_locations where challenge_id=v_game.daily_challenge_id and round_index=p_index;end if;
  if p_target_lat is null or p_target_lng is null or not(p_target_lat between -90 and 90) or not(p_target_lng between -180 and 180)
   or public.geo_distance(v_location.lat,v_location.lng,p_target_lat,p_target_lng)>1.05 then raise exception 'Panorama fuera de la ubicación elegida'; end if;
  update public.game_rounds set status='playing',target_lat=p_target_lat,target_lng=p_target_lng,started_at=v_now,deadline=v_now+interval '2 minutes'
   where game_id=p_game_id and round_index=p_index returning * into v_round;
 end if;
 return jsonb_build_object('deadline',v_round.deadline,'serverNow',clock_timestamp());
end; $$;
create or replace function public.finish_round(p_game_id uuid,p_index integer,p_guess_lat double precision default null,p_guess_lng double precision default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_game public.games; v_round public.game_rounds; v_now timestamptz:=clock_timestamp(); v_distance double precision; v_points integer:=0; v_timeout boolean; v_count integer;
begin
 perform public.require_google_login();
 select * into v_game from public.games where id=p_game_id and user_id=auth.uid() for update;
 if not found then raise exception 'Partida no disponible' using errcode='42501'; end if;
 select * into v_round from public.game_rounds where game_id=p_game_id and round_index=p_index for update;
 if not found then raise exception 'Ronda inexistente'; end if;
 if v_round.status<>'completed' then
  if v_game.status<>'playing' or v_round.status<>'playing' then raise exception 'La ronda no está en juego'; end if;
  v_now:=clock_timestamp();
  v_timeout:=v_now>=v_round.deadline;
  if not v_timeout and (p_guess_lat is null or p_guess_lng is null) then raise exception 'Marcá una ubicación antes de confirmar'; end if;
  if (p_guess_lat is null)<>(p_guess_lng is null) or (p_guess_lat is not null and not(p_guess_lat between -90 and 90)) or (p_guess_lng is not null and not(p_guess_lng between -180 and 180)) then raise exception 'Apuesta inválida'; end if;
  if p_guess_lat is not null then v_distance:=public.geo_distance(v_round.target_lat,v_round.target_lng,p_guess_lat,p_guess_lng); end if;
  if not v_timeout then v_points:=round(5000*exp(-v_distance/500)); end if;
  -- Retain original catalog coordinates and derived results, not Google panorama coordinates.
  update public.game_rounds set status='completed',guess_lat=p_guess_lat,guess_lng=p_guess_lng,distance=v_distance,points=v_points,timed_out=v_timeout,completed_at=v_now,target_lat=null,target_lng=null
   where game_id=p_game_id and round_index=p_index returning * into v_round;
  select count(*),coalesce(sum(points),0) into v_count,v_points from public.game_rounds where game_id=p_game_id and status='completed';
  update public.games set total=v_points,status=case when v_count=5 then 'completed' else 'playing' end,completed_at=case when v_count=5 then v_now else null end where id=p_game_id returning * into v_game;
 end if;
 return jsonb_build_object('name',v_round.name,'distance',v_round.distance,'points',v_round.points,'timedOut',v_round.timed_out,'finished',v_game.status='completed','total',v_game.total);
end; $$;

commit;
