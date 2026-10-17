begin;
create table public.catalog_panoramas(
 location_id uuid primary key references public.locations(id) on delete cascade,
 pano_id text not null unique check(char_length(trim(pano_id)) between 1 and 200),
 verified_at timestamptz not null default clock_timestamp()
);
alter table public.catalog_panoramas enable row level security;
revoke all on public.catalog_panoramas from anon,authenticated;
grant all on public.catalog_panoramas to service_role;
-- Existing published, trusted checks can seed the bank without inventing verification.
insert into public.catalog_panoramas(location_id,pano_id,verified_at)
 select location_id,pano_id,published_at from (
  select distinct on(d.location_id) d.location_id,d.pano_id,c.published_at from public.daily_locations d join public.daily_challenges c on c.id=d.challenge_id
  join public.locations l on l.id=d.location_id where c.status='ready' and l.validation_status='active' and c.published_at>clock_timestamp()-interval '28 days'
  order by d.location_id,c.published_at desc
 ) verified on conflict do nothing;

create function public.record_catalog_panorama(p_location uuid,p_pano text default null) returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('rumbo-catalog-bank',0));
 if not exists(select 1 from public.locations where id=p_location) then raise exception 'Ubicación inexistente';end if;
 if p_pano is not null and char_length(trim(p_pano)) not between 1 and 200 then raise exception 'Panorama inválido';end if;
 if p_pano is null or exists(select 1 from public.catalog_panoramas where pano_id=p_pano and location_id<>p_location) then
  delete from public.catalog_panoramas where location_id=p_location;
  update public.locations set validation_status='unavailable',last_checked_at=clock_timestamp() where id=p_location;
  return false;
 end if;
 insert into public.catalog_panoramas(location_id,pano_id,verified_at) values(p_location,p_pano,clock_timestamp()) on conflict(location_id) do update set pano_id=excluded.pano_id,verified_at=excluded.verified_at;
 update public.locations set validation_status='active',last_checked_at=clock_timestamp() where id=p_location;
 return true;
end; $$;
revoke execute on function public.record_catalog_panorama(uuid,text) from public,anon,authenticated;
grant execute on function public.record_catalog_panorama(uuid,text) to service_role;

create table public.room_locations(
 room_id uuid not null references public.friend_rooms(id) on delete cascade,
 round_index integer not null check(round_index between 0 and 4),
 location_id uuid not null references public.locations(id),name text not null,lat double precision not null,lng double precision not null,pano_id text not null,
 primary key(room_id,round_index),unique(room_id,location_id),unique(room_id,pano_id)
);
alter table public.room_locations enable row level security;
revoke all on public.room_locations from anon,authenticated;
grant all on public.room_locations to service_role;
-- Freeze old rooms as they were; neither history nor in-progress rounds change.
insert into public.room_locations(room_id,round_index,location_id,name,lat,lng,pano_id)
 select r.id,d.round_index,d.location_id,d.name,d.lat,d.lng,d.pano_id from public.friend_rooms r join public.daily_locations d on d.challenge_id=r.challenge_id;
alter table public.friend_rooms alter column challenge_id drop not null;

create or replace function public.create_room() returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb;r public.friend_rooms;v_count integer;
begin
 perform public.require_google_login();perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,1));
 if (select count(*) from public.friend_rooms where host_id=auth.uid() and created_at>clock_timestamp()-interval '1 day')>=10 then raise exception 'Llegaste al límite de diez salas creadas en 24 horas';end if;
 -- Prefer different provinces, then randomize within them; avoid the host's last 7 days where possible.
 -- Select against a fixed snapshot: later catalog edits cannot move a room's targets.
 insert into public.friend_rooms(host_id) values(auth.uid()) returning * into r;
 with ranked as (
  select l.*,p.pano_id,row_number() over(partition by l.region order by exists(select 1 from public.room_locations q join public.friend_rooms prior on prior.id=q.room_id where prior.host_id=auth.uid() and prior.created_at>clock_timestamp()-interval '7 days' and q.location_id=l.id),random()) as province_rank,
  exists(select 1 from public.room_locations q join public.friend_rooms prior on prior.id=q.room_id where prior.host_id=auth.uid() and prior.created_at>clock_timestamp()-interval '7 days' and q.location_id=l.id) as played
  from public.locations l join public.catalog_panoramas p on p.location_id=l.id where l.validation_status='active' and p.verified_at>clock_timestamp()-interval '28 days'
 ), chosen as (select * from ranked order by played,province_rank,random() limit 5)
 insert into public.room_locations(room_id,round_index,location_id,name,lat,lng,pano_id)
  select r.id,(row_number() over(order by random())-1)::integer,id,name,lat,lng,pano_id from chosen;
 get diagnostics v_count=row_count;
 if v_count<>5 then
  delete from public.room_locations where room_id=r.id;
  d:=public.get_daily_challenge();if d is null then raise exception 'Todavía no hay ubicaciones preparadas';end if;
  update public.friend_rooms set challenge_id=(d->>'id')::uuid where id=r.id;
  insert into public.room_locations(room_id,round_index,location_id,name,lat,lng,pano_id)
   select r.id,round_index,location_id,name,lat,lng,pano_id from public.daily_locations where challenge_id=(d->>'id')::uuid;
 end if;
 insert into public.friend_members(room_id,user_id) values(r.id,auth.uid());return public.room_state(r.id);
end; $$;
create or replace function public.room_state(p_room uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.friend_rooms;v_reveal boolean;
begin
 perform public.require_google_login();
 select * into r from public.friend_rooms where id=p_room for update;
 if not found or not exists(select 1 from public.friend_members where room_id=p_room and user_id=auth.uid() and left_at is null) then raise exception 'Sala no disponible' using errcode='42501';end if;
 update public.friend_members set seen_at=clock_timestamp() where room_id=p_room and user_id=auth.uid();
 if r.expires_at<clock_timestamp() and r.status not in ('completed','closed') then update public.friend_rooms set status='closed' where id=p_room returning * into r;end if;
 if r.status='playing' and (clock_timestamp()>=r.deadline or not exists(
  select 1 from public.friend_members m where m.room_id=p_room and m.left_at is null and not exists(select 1 from public.friend_answers a where a.room_id=p_room and a.user_id=m.user_id and a.round_index=r.round_index)
 )) then
  insert into public.friend_answers(room_id,user_id,round_index,points,timed_out)
   select p_room,user_id,r.round_index,0,true from public.friend_members where room_id=p_room and left_at is null on conflict do nothing;
  update public.friend_rooms set status=case when round_index=4 then 'completed' else 'round_result' end where id=p_room returning * into r;
 end if;
 v_reveal:=r.status in ('round_result','completed');
 return jsonb_build_object('id',r.id,'code',r.code,'status',r.status,'index',r.round_index,'deadline',r.deadline,'serverNow',clock_timestamp(),
 'host',coalesce(r.host_id=auth.uid(),false),'canAdvance',r.host_id=auth.uid() or not exists(select 1 from public.friend_members where room_id=p_room and user_id=r.host_id and left_at is null and seen_at>clock_timestamp()-interval '90 seconds'),
 'location',case when r.status in ('playing','round_result','completed') then (select jsonb_build_object('id',location_id,'name',case when v_reveal then name else 'Ubicación de la ronda' end,'hint','','lat',lat,'lng',lng,'panoId',pano_id) from public.room_locations where room_id=r.id and round_index=r.round_index) else null end,
 'submitted',exists(select 1 from public.friend_answers where room_id=p_room and user_id=auth.uid() and round_index=r.round_index),
 'result',case when v_reveal then (select jsonb_build_object('name',d.name,'distance',a.distance,'points',a.points,'timedOut',a.timed_out) from public.friend_answers a join public.room_locations d on d.room_id=r.id and d.round_index=a.round_index where a.room_id=p_room and a.user_id=auth.uid() and a.round_index=r.round_index) else null end,
 'members',(select coalesce(jsonb_agg(row_to_json(x) order by x.total desc,x.joined),'[]'::jsonb) from (
  select p.display_name as name,m.user_id=auth.uid() as mine,m.user_id=r.host_id as host,m.left_at is not null as "left",m.joined_at as joined,
  exists(select 1 from public.friend_answers a where a.room_id=p_room and a.user_id=m.user_id and a.round_index=r.round_index) as submitted,
  coalesce((select sum(a.points) from public.friend_answers a where a.room_id=p_room and a.user_id=m.user_id and (a.round_index<r.round_index or v_reveal)),0) as total
  from public.friend_members m join public.profiles p on p.id=m.user_id where m.room_id=p_room
 ) x));
end; $$;

create or replace function public.submit_room_guess(p_room uuid,p_index integer,p_lat double precision default null,p_lng double precision default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.friend_rooms;d public.room_locations;v_distance double precision;v_timeout boolean;v_points integer;
begin
 perform public.require_google_login();
 select * into r from public.friend_rooms where id=p_room for update;
 if not found or not exists(select 1 from public.friend_members where room_id=p_room and user_id=auth.uid() and left_at is null) then raise exception 'Sala no disponible' using errcode='42501';end if;
 if p_index<>r.round_index then raise exception 'La ronda cambió';end if;
 if exists(select 1 from public.friend_answers where room_id=p_room and user_id=auth.uid() and round_index=p_index) then return public.room_state(p_room);end if;
 if r.status<>'playing' or r.expires_at<clock_timestamp() then raise exception 'La ronda no está disponible';end if;
 v_timeout:=clock_timestamp()>=r.deadline;
 if not v_timeout and (p_lat is null or p_lng is null) then raise exception 'Marcá tu ubicación';end if;
 if (p_lat is null)<>(p_lng is null) or (p_lat is not null and (not(p_lat between -90 and 90) or not(p_lng between -180 and 180))) then raise exception 'Coordenadas inválidas';end if;
 select * into d from public.room_locations where room_id=r.id and round_index=p_index;
 if p_lat is not null then v_distance:=public.geo_distance(d.lat,d.lng,p_lat,p_lng);end if;
 v_points:=case when v_timeout then 0 else round(5000*exp(-v_distance/500)) end;
 -- First answer starts the shared final countdown, never extends an existing deadline.
 if not v_timeout and not exists(select 1 from public.friend_answers where room_id=p_room and round_index=p_index) then
  update public.friend_rooms set deadline=least(deadline,clock_timestamp()+interval '15 seconds') where id=p_room;
 end if;
 insert into public.friend_answers(room_id,user_id,round_index,guess_lat,guess_lng,points,distance,timed_out) values(p_room,auth.uid(),p_index,p_lat,p_lng,v_points,v_distance,v_timeout);
 return public.room_state(p_room);
end; $$;

commit;
