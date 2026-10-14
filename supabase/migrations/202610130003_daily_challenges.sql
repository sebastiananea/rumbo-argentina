begin;
create table public.daily_challenges (
 id uuid primary key default gen_random_uuid(),
 day date not null unique,
 status text not null default 'building' check(status in ('building','ready','failed')),
 build_token uuid not null default gen_random_uuid(),
 lease_until timestamptz,
 retry_after timestamptz,
 attempts integer not null default 0,
 candidate_ids uuid[] not null default '{}',
 published_at timestamptz
);
create table public.daily_locations (
 challenge_id uuid not null references public.daily_challenges(id) on delete cascade,
 round_index integer not null check(round_index between 0 and 4),
 location_id uuid not null references public.locations(id),
 name text not null,region text not null,kind text not null,lat double precision not null,lng double precision not null,
 pano_id text not null check(char_length(pano_id) between 1 and 200),
 primary key(challenge_id,round_index),
 unique(challenge_id,location_id),unique(challenge_id,pano_id)
);
-- Latch the first available challenge for each Argentina date. A late preparation
-- cannot change locations halfway through a day after fallback has been served.
create table public.daily_days (
 day date primary key,
 challenge_id uuid not null references public.daily_challenges(id)
);
alter table public.games add column daily_day date references public.daily_days(day);
alter table public.games add column daily_challenge_id uuid references public.daily_challenges(id);
create index games_daily_history on public.games(user_id,daily_day);
alter table public.daily_challenges enable row level security;
alter table public.daily_locations enable row level security;
alter table public.daily_days enable row level security;
revoke all on public.daily_challenges,public.daily_locations,public.daily_days from anon,authenticated;
grant all on public.daily_challenges,public.daily_locations,public.daily_days to service_role;

create function public.argentina_today() returns date language sql volatile set search_path='' as $$
 select (clock_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date
$$;

create function public.daily_claim(p_tomorrow boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_day date:=public.argentina_today()+case when p_tomorrow then 1 else 0 end;v_row public.daily_challenges;v_now timestamptz:=clock_timestamp();v_candidates uuid[];
begin
 insert into public.daily_challenges(day) values(v_day) on conflict(day) do nothing;
 select * into v_row from public.daily_challenges where day=v_day for update;
 if v_row.status='ready' then return jsonb_build_object('claimed',false,'reason','ready','day',v_day);end if;
 if v_row.lease_until>v_now then return jsonb_build_object('claimed',false,'reason','busy','day',v_day);end if;
 if v_row.retry_after>v_now then return jsonb_build_object('claimed',false,'reason','retry_later','day',v_day);end if;
 select array_agg(id) into v_candidates from (
  select l.id from public.locations l where l.validation_status in ('active','pending') or (l.validation_status='unavailable' and l.last_checked_at<clock_timestamp()-interval '7 days')
  order by exists(select 1 from public.daily_locations d join public.daily_challenges c on c.id=d.challenge_id where d.location_id=l.id and c.day>=v_day-7),l.validation_status<>'active',random() limit 40
 ) candidates;
 if coalesce(cardinality(v_candidates),0)<5 then raise exception 'No hay suficientes candidatos para preparar el desafío';end if;
 update public.daily_challenges set status='building',build_token=gen_random_uuid(),lease_until=v_now+interval '10 minutes',retry_after=null,attempts=attempts+1,candidate_ids=v_candidates where id=v_row.id returning * into v_row;
 return jsonb_build_object('claimed',true,'id',v_row.id,'token',v_row.build_token,'day',v_day,'candidates',(
  select jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'region',l.region,'kind',l.kind,'lat',l.lat,'lng',l.lng,'hint','') order by array_position(v_candidates,l.id)) from public.locations l where l.id=any(v_candidates)
 ));
end; $$;

create function public.daily_publish(p_id uuid,p_token uuid,p_locations jsonb) returns void language plpgsql security definer set search_path='' as $$
declare v_row public.daily_challenges;v_item jsonb;v_index integer:=0;v_location uuid;v_pano text;
begin
 select * into v_row from public.daily_challenges where id=p_id for update;
 if not found or p_token is null or v_row.lease_until is null or v_row.status<>'building' or v_row.build_token<>p_token or v_row.lease_until<=clock_timestamp() then raise exception 'Preparación vencida o no autorizada';end if;
 if p_locations is null or jsonb_typeof(p_locations)<>'array' or jsonb_array_length(p_locations)<>5 then raise exception 'El desafío debe tener exactamente cinco ubicaciones';end if;
 for v_item in select value from jsonb_array_elements(p_locations) loop
  v_location:=(v_item->>'location_id')::uuid;v_pano:=v_item->>'pano_id';
  if v_location is null or not(v_location=any(v_row.candidate_ids)) or v_pano is null or char_length(trim(v_pano)) not between 1 and 200 then raise exception 'Ubicación inválida para esta preparación';end if;
  insert into public.daily_locations(challenge_id,round_index,location_id,pano_id,name,region,kind,lat,lng) select p_id,v_index,id,v_pano,name,region,kind,lat,lng from public.locations where id=v_location;
  v_index:=v_index+1;
 end loop;
 update public.daily_challenges set status='ready',published_at=clock_timestamp(),lease_until=null,retry_after=null where id=p_id;
end; $$;

create function public.daily_fail(p_id uuid,p_token uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.daily_challenges set status='failed',lease_until=null,retry_after=clock_timestamp()+interval '10 minutes' where id=p_id and build_token=p_token and status='building';
end; $$;

create function public.get_daily_challenge() returns jsonb language plpgsql security definer set search_path='' as $$
declare v_day date:=public.argentina_today();v_id uuid;v_source date;
begin
 select challenge_id into v_id from public.daily_days where day=v_day;
 if not found then
  select id into v_id from public.daily_challenges where status='ready' and day<=v_day order by day desc limit 1;
  if not found then return null;end if;
  insert into public.daily_days(day,challenge_id) values(v_day,v_id) on conflict(day) do nothing;
  select challenge_id into v_id from public.daily_days where day=v_day;
 end if;
 select day into v_source from public.daily_challenges where id=v_id;
 return jsonb_build_object('id',v_id,'day',v_day,'sourceDay',v_source,'locations',(
  select jsonb_agg(jsonb_build_object('id',d.location_id,'name',d.name,'lat',d.lat,'lng',d.lng,'region',d.region,'kind',d.kind,'hint','','panoId',d.pano_id) order by d.round_index)
  from public.daily_locations d where d.challenge_id=v_id
 ));
end; $$;

create or replace function public.create_game(p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_game public.games;v_daily jsonb;
begin
 if v_user is null then raise exception 'Ingresá a tu cuenta' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_user::text,0));
 select * into v_game from public.games where user_id=v_user and request_id=p_request_id;
 if not found then
  v_daily:=public.get_daily_challenge();
  if v_daily is null then raise exception 'El desafío diario todavía se está preparando';end if;
  update public.game_rounds set target_lat=null,target_lng=null where game_id in(select id from public.games where user_id=v_user and status='playing');
  update public.games set status='abandoned',completed_at=clock_timestamp() where user_id=v_user and status='playing';
  insert into public.games(user_id,request_id,daily_day,daily_challenge_id) values(v_user,p_request_id,(v_daily->>'day')::date,(v_daily->>'id')::uuid) returning * into v_game;
  insert into public.game_rounds(game_id,round_index,location_id,name)
   select v_game.id,d.round_index,d.location_id,d.name from public.daily_locations d where d.challenge_id=v_game.daily_challenge_id;
 end if;
 return jsonb_build_object('id',v_game.id,'status',v_game.status,'day',v_game.daily_day,'locations',(
  select jsonb_agg(jsonb_build_object('id',l.id,'name',r.name,'lat',coalesce(d.lat,l.lat),'lng',coalesce(d.lng,l.lng),'region',coalesce(d.region,l.region),'kind',coalesce(d.kind,l.kind),'hint','','panoId',d.pano_id) order by r.round_index)
  from public.game_rounds r join public.locations l on l.id=r.location_id left join public.daily_locations d on d.challenge_id=v_game.daily_challenge_id and d.round_index=r.round_index where r.game_id=v_game.id
 ));
end; $$;

-- A shared daily round can never be replaced independently for one player.
create or replace function public.replace_round_location(p_game_id uuid,p_index integer,p_location_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare v_game public.games;v_round public.game_rounds;v_location public.locations;
begin
 select * into v_game from public.games where id=p_game_id and user_id=auth.uid() for update;
 if not found or v_game.status<>'playing' then raise exception 'Partida no disponible' using errcode='42501';end if;
 if v_game.daily_challenge_id is not null then raise exception 'Las ubicaciones del desafío diario son iguales para todos';end if;
 select * into v_round from public.game_rounds where game_id=p_game_id and round_index=p_index for update;
 if not found or v_round.status<>'loading' then raise exception 'La ronda ya comenzó';end if;
 select * into v_location from public.locations where id=p_location_id and validation_status='active';
 if not found then raise exception 'Ubicación no disponible';end if;
 if exists(select 1 from public.game_rounds where game_id=p_game_id and round_index<>p_index and location_id=p_location_id) then raise exception 'La ubicación ya está en esta partida';end if;
 update public.game_rounds set location_id=p_location_id,name=v_location.name where game_id=p_game_id and round_index=p_index;
end; $$;

drop function public.start_round(uuid,integer,double precision,double precision);
create function public.start_round(p_game_id uuid,p_index integer,p_target_lat double precision,p_target_lng double precision,p_pano_id text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_game public.games; v_round public.game_rounds; v_location public.locations; v_now timestamptz:=clock_timestamp();
begin
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


revoke execute on function public.argentina_today(),public.daily_claim(boolean),public.daily_publish(uuid,uuid,jsonb),public.daily_fail(uuid,uuid),public.get_daily_challenge(),public.start_round(uuid,integer,double precision,double precision,text) from public,anon,authenticated;
grant execute on function public.daily_claim(boolean),public.daily_publish(uuid,uuid,jsonb),public.daily_fail(uuid,uuid) to service_role;
grant execute on function public.get_daily_challenge() to anon,authenticated;
grant execute on function public.start_round(uuid,integer,double precision,double precision,text) to authenticated;
commit;
