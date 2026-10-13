begin;

create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null check (char_length(display_name) between 1 and 50),
 created_at timestamptz not null default now()
);
create table public.catalog_admins (user_id uuid primary key references auth.users(id) on delete cascade);
create table public.locations (
 id uuid primary key default gen_random_uuid(),
 seed_slug text not null unique,
 name text not null check (char_length(name) between 1 and 100),
 region text not null check (char_length(region) between 1 and 50),
 kind text not null check (kind in ('city','town','road')),
 lat double precision not null check (lat between -56 and -21),
 lng double precision not null check (lng between -74 and -53),
 validation_status text not null default 'pending' check (validation_status in ('pending','active','unavailable')),
 last_checked_at timestamptz,
 created_at timestamptz not null default now()
);
create table public.games (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,
 status text not null default 'playing' check (status in ('playing','completed','abandoned')),
 total integer not null default 0 check (total between 0 and 25000),
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 unique(user_id,request_id)
);
create unique index one_playing_game_per_user on public.games(user_id) where status='playing';
create index games_history on public.games(user_id,created_at desc);
create table public.game_rounds (
 game_id uuid not null references public.games(id) on delete cascade,
 round_index integer not null check (round_index between 0 and 4),
 location_id uuid not null references public.locations(id),
 name text not null,
 status text not null default 'loading' check (status in ('loading','playing','completed')),
 started_at timestamptz,
 deadline timestamptz,
 target_lat double precision,
 target_lng double precision,
 guess_lat double precision check (guess_lat between -90 and 90),
 guess_lng double precision check (guess_lng between -180 and 180),
 distance double precision check (distance>=0),
 points integer not null default 0 check (points between 0 and 5000),
 timed_out boolean not null default false,
 completed_at timestamptz,
 primary key(game_id,round_index),
 unique(game_id,location_id)
);

alter table public.profiles enable row level security;
alter table public.catalog_admins enable row level security;
alter table public.locations enable row level security;
alter table public.games enable row level security;
alter table public.game_rounds enable row level security;
create policy own_profile on public.profiles for select to authenticated using(id=auth.uid());
create policy edit_own_name on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy active_catalog on public.locations for select to anon,authenticated using(validation_status='active');
create policy own_games on public.games for select to authenticated using(user_id=auth.uid());
create policy own_rounds on public.game_rounds for select to authenticated using(exists(select 1 from public.games g where g.id=game_id and g.user_id=auth.uid()));
revoke all on public.profiles,public.catalog_admins,public.locations,public.games,public.game_rounds from anon,authenticated;
grant select on public.locations to anon,authenticated;
grant select on public.profiles,public.games,public.game_rounds to authenticated;
grant update(display_name) on public.profiles to authenticated;
grant all on public.profiles,public.catalog_admins,public.locations,public.games,public.game_rounds to service_role;

create function public.create_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,display_name) values(new.id,left(coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'),''),'Jugador'),50));
 return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.create_profile();
insert into public.profiles(id,display_name) select id,left(coalesce(nullif(trim(raw_user_meta_data->>'display_name'),''),'Jugador'),50) from auth.users on conflict(id) do nothing;

create function public.geo_distance(a_lat double precision,a_lng double precision,b_lat double precision,b_lng double precision)
returns double precision language sql immutable strict set search_path='' as $$
 select 6371.0088*2*asin(sqrt(least(1.0,greatest(0.0,power(sin(radians(b_lat-a_lat)/2),2)+cos(radians(a_lat))*cos(radians(b_lat))*power(sin(radians(b_lng-a_lng)/2),2)))))
$$;

create function public.is_catalog_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.catalog_admins where user_id=auth.uid())
$$;
create function public.catalog_review_batch(p_limit integer default 10) returns setof public.locations language plpgsql security definer set search_path='' as $$
begin
 if not public.is_catalog_admin() then raise exception 'Acceso no autorizado' using errcode='42501'; end if;
 return query select * from public.locations order by last_checked_at nulls first,id limit least(25,greatest(1,p_limit));
end; $$;
create function public.validate_location(p_location_id uuid,p_navigable boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_catalog_admin() then raise exception 'Acceso no autorizado' using errcode='42501'; end if;
 update public.locations set validation_status=case when p_navigable then 'active' else 'unavailable' end,last_checked_at=clock_timestamp() where id=p_location_id;
 if not found then raise exception 'Ubicación inexistente'; end if;
end; $$;

create function public.create_game(p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_user uuid:=auth.uid(); v_game public.games; v_location public.locations;
 v_ids uuid[]:='{}'; v_regions text[]:='{}'; v_kinds text[]:='{}'; v_index integer;
begin
 if v_user is null then raise exception 'Ingresá a tu cuenta' using errcode='42501'; end if;
 -- Serialize creation and retries for this user, including concurrent browser tabs.
 perform pg_advisory_xact_lock(hashtextextended(v_user::text,0));
 select * into v_game from public.games where user_id=v_user and request_id=p_request_id;
 if not found then
  if (select count(*) from public.locations where validation_status='active')<5 then raise exception 'Todavía no hay cinco ubicaciones validadas disponibles'; end if;
  update public.game_rounds set target_lat=null,target_lng=null where game_id in (select id from public.games where user_id=v_user and status='playing');
  update public.games set status='abandoned',completed_at=clock_timestamp() where user_id=v_user and status='playing';
  insert into public.games(user_id,request_id) values(v_user,p_request_id) returning * into v_game;
  for v_index in 0..4 loop
   select l.* into v_location from public.locations l
   where l.validation_status='active' and not(l.id=any(v_ids))
   order by
    exists(select 1 from public.game_rounds r join public.games g on g.id=r.game_id where g.user_id=v_user and r.location_id=l.id and r.status='completed'),
    exists(select 1 from public.locations picked where picked.id=any(v_ids) and public.geo_distance(l.lat,l.lng,picked.lat,picked.lng)<20),
    l.region=any(v_regions),l.kind=any(v_kinds),random()
   limit 1;
   v_ids:=array_append(v_ids,v_location.id);v_regions:=array_append(v_regions,v_location.region);v_kinds:=array_append(v_kinds,v_location.kind);
   insert into public.game_rounds(game_id,round_index,location_id,name) values(v_game.id,v_index,v_location.id,v_location.name);
  end loop;
 end if;
 return jsonb_build_object('id',v_game.id,'status',v_game.status,'locations',(
  select jsonb_agg(jsonb_build_object('id',l.id,'name',r.name,'lat',l.lat,'lng',l.lng,'region',l.region,'kind',l.kind,'hint','') order by r.round_index)
  from public.game_rounds r join public.locations l on l.id=r.location_id where r.game_id=v_game.id));
end; $$;

create function public.replace_round_location(p_game_id uuid,p_index integer,p_location_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare v_game public.games; v_round public.game_rounds; v_location public.locations;
begin
 select * into v_game from public.games where id=p_game_id and user_id=auth.uid() for update;
 if not found or v_game.status<>'playing' then raise exception 'Partida no disponible' using errcode='42501'; end if;
 select * into v_round from public.game_rounds where game_id=p_game_id and round_index=p_index for update;
 if not found or v_round.status<>'loading' then raise exception 'La ronda ya comenzó'; end if;
 select * into v_location from public.locations where id=p_location_id and validation_status='active';
 if not found then raise exception 'Ubicación no disponible'; end if;
 if exists(select 1 from public.game_rounds where game_id=p_game_id and round_index<>p_index and location_id=p_location_id) then raise exception 'La ubicación ya está en esta partida'; end if;
 update public.game_rounds set location_id=p_location_id,name=v_location.name where game_id=p_game_id and round_index=p_index;
end; $$;

create function public.start_round(p_game_id uuid,p_index integer,p_target_lat double precision,p_target_lng double precision) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_game public.games; v_round public.game_rounds; v_location public.locations; v_now timestamptz:=clock_timestamp();
begin
 select * into v_game from public.games where id=p_game_id and user_id=auth.uid() for update;
 if not found or v_game.status<>'playing' then raise exception 'Partida no disponible' using errcode='42501'; end if;
 select * into v_round from public.game_rounds where game_id=p_game_id and round_index=p_index for update;
 if not found then raise exception 'Ronda inexistente'; end if;
 if exists(select 1 from public.game_rounds where game_id=p_game_id and round_index<p_index and status<>'completed') then raise exception 'Terminá las rondas anteriores'; end if;
 if v_round.status='completed' then raise exception 'La ronda ya terminó'; end if;
 if v_round.status='loading' then
  v_now:=clock_timestamp();
  select * into v_location from public.locations where id=v_round.location_id;
  if p_target_lat is null or p_target_lng is null or not(p_target_lat between -90 and 90) or not(p_target_lng between -180 and 180)
   or public.geo_distance(v_location.lat,v_location.lng,p_target_lat,p_target_lng)>1.05 then raise exception 'Panorama fuera de la ubicación elegida'; end if;
  update public.game_rounds set status='playing',target_lat=p_target_lat,target_lng=p_target_lng,started_at=v_now,deadline=v_now+interval '2 minutes'
   where game_id=p_game_id and round_index=p_index returning * into v_round;
 end if;
 return jsonb_build_object('deadline',v_round.deadline,'serverNow',clock_timestamp());
end; $$;

create function public.finish_round(p_game_id uuid,p_index integer,p_guess_lat double precision default null,p_guess_lng double precision default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_game public.games; v_round public.game_rounds; v_now timestamptz:=clock_timestamp(); v_distance double precision; v_points integer:=0; v_timeout boolean; v_count integer;
begin
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

-- Run hourly in Supabase (see maintenance.sql) to clear abandoned session targets.
create function public.cleanup_stale_games() returns void language plpgsql security definer set search_path='' as $$
begin
 update public.game_rounds set target_lat=null,target_lng=null where game_id in (select id from public.games where status='playing' and created_at<clock_timestamp()-interval '1 day');
 update public.games set status='abandoned',completed_at=clock_timestamp() where status='playing' and created_at<clock_timestamp()-interval '1 day';
end; $$;
revoke execute on function public.cleanup_stale_games() from public,anon,authenticated;
grant execute on function public.cleanup_stale_games() to service_role;

-- Functions are the only write API for games; no user or score is accepted from the client.
revoke execute on function public.create_profile(),public.geo_distance(double precision,double precision,double precision,double precision),public.is_catalog_admin(),public.catalog_review_batch(integer),public.validate_location(uuid,boolean),public.create_game(uuid),public.replace_round_location(uuid,integer,uuid),public.start_round(uuid,integer,double precision,double precision),public.finish_round(uuid,integer,double precision,double precision) from public,anon,authenticated;
grant execute on function public.is_catalog_admin(),public.catalog_review_batch(integer),public.validate_location(uuid,boolean),public.create_game(uuid),public.replace_round_location(uuid,integer,uuid),public.start_round(uuid,integer,double precision,double precision),public.finish_round(uuid,integer,double precision,double precision) to authenticated;
commit;
