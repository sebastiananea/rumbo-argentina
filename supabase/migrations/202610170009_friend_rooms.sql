begin;
create table public.friend_rooms(
 id uuid primary key default gen_random_uuid(),code text unique not null default upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),
 host_id uuid references auth.users(id) on delete set null,challenge_id uuid not null references public.daily_challenges(id),
 status text not null default 'lobby' check(status in ('lobby','playing','round_result','completed','closed')),
 round_index integer not null default -1 check(round_index between -1 and 4),deadline timestamptz,
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null default clock_timestamp()+interval '6 hours'
);
create table public.friend_members(
 room_id uuid references public.friend_rooms(id) on delete cascade,user_id uuid references auth.users(id) on delete cascade,
 joined_at timestamptz not null default clock_timestamp(),seen_at timestamptz not null default clock_timestamp(),left_at timestamptz,
 primary key(room_id,user_id)
);
create table public.friend_answers(
 room_id uuid not null,user_id uuid not null,round_index integer not null check(round_index between 0 and 4),
 guess_lat double precision,guess_lng double precision,points integer not null check(points between 0 and 5000),distance double precision,
 timed_out boolean not null,submitted_at timestamptz not null default clock_timestamp(),
 primary key(room_id,user_id,round_index),foreign key(room_id,user_id) references public.friend_members(room_id,user_id) on delete cascade
);
alter table public.friend_rooms enable row level security;alter table public.friend_members enable row level security;alter table public.friend_answers enable row level security;
revoke all on public.friend_rooms,public.friend_members,public.friend_answers from anon,authenticated;
grant all on public.friend_rooms,public.friend_members,public.friend_answers to service_role;
create index friend_members_user on public.friend_members(user_id,room_id);

create function public.room_state(p_room uuid) returns jsonb language plpgsql security definer set search_path='' as $$
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
 'location',case when r.status in ('playing','round_result','completed') then (select jsonb_build_object('id',location_id,'name',case when v_reveal then name else 'Ubicación de la ronda' end,'hint','','lat',lat,'lng',lng,'panoId',pano_id) from public.daily_locations where challenge_id=r.challenge_id and round_index=r.round_index) else null end,
 'submitted',exists(select 1 from public.friend_answers where room_id=p_room and user_id=auth.uid() and round_index=r.round_index),
 'result',case when v_reveal then (select jsonb_build_object('name',d.name,'distance',a.distance,'points',a.points,'timedOut',a.timed_out) from public.friend_answers a join public.daily_locations d on d.challenge_id=r.challenge_id and d.round_index=a.round_index where a.room_id=p_room and a.user_id=auth.uid() and a.round_index=r.round_index) else null end,
 'members',(select coalesce(jsonb_agg(row_to_json(x) order by x.total desc,x.joined),'[]'::jsonb) from (
  select p.display_name as name,m.user_id=auth.uid() as mine,m.user_id=r.host_id as host,m.left_at is not null as "left",m.joined_at as joined,
  exists(select 1 from public.friend_answers a where a.room_id=p_room and a.user_id=m.user_id and a.round_index=r.round_index) as submitted,
  coalesce((select sum(a.points) from public.friend_answers a where a.room_id=p_room and a.user_id=m.user_id and (a.round_index<r.round_index or v_reveal)),0) as total
  from public.friend_members m join public.profiles p on p.id=m.user_id where m.room_id=p_room
 ) x));
end; $$;

create function public.create_room() returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb;r public.friend_rooms;
begin
 perform public.require_google_login();perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,1));
 if (select count(*) from public.friend_rooms where host_id=auth.uid() and created_at>clock_timestamp()-interval '1 day')>=10 then raise exception 'Llegaste al límite de diez salas creadas en 24 horas';end if;
 d:=public.get_daily_challenge();if d is null then raise exception 'Todavía no hay ubicaciones preparadas';end if;
 insert into public.friend_rooms(host_id,challenge_id) values(auth.uid(),(d->>'id')::uuid) returning * into r;
 insert into public.friend_members(room_id,user_id) values(r.id,auth.uid());return public.room_state(r.id);
end; $$;
create function public.join_room(p_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.friend_rooms;
begin
 perform public.require_google_login();
 select * into r from public.friend_rooms where code=upper(trim(p_code)) and expires_at>clock_timestamp() for update;
 if not found then raise exception 'Sala no disponible';end if;
 if exists(select 1 from public.friend_members where room_id=r.id and user_id=auth.uid() and left_at is null) then return public.room_state(r.id);end if;
 if r.status<>'lobby' then raise exception 'La partida ya comenzó';end if;
 if (select count(*) from public.friend_members where room_id=r.id and left_at is null)>=8 then raise exception 'La sala está completa (8 jugadores)';end if;
 insert into public.friend_members(room_id,user_id) values(r.id,auth.uid()) on conflict(room_id,user_id) do update set left_at=null,seen_at=clock_timestamp();return public.room_state(r.id);
end; $$;
create function public.advance_room(p_room uuid,p_index integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.friend_rooms;s jsonb;
begin
 s:=public.room_state(p_room);select * into r from public.friend_rooms where id=p_room for update;
 if not (s->>'canAdvance')::boolean then raise exception 'Solo el anfitrión puede iniciar la ronda' using errcode='42501';end if;
 -- A repeated click or retry cannot skip a round or reset its deadline.
 if r.round_index=p_index and r.status in ('playing','round_result','completed') then return s;end if;
 if r.status not in ('lobby','round_result') or p_index<>r.round_index+1 or p_index not between 0 and 4 then raise exception 'La ronda no está disponible';end if;
 if (select count(*) from public.friend_members where room_id=p_room and left_at is null)<2 then raise exception 'Se necesitan al menos dos jugadores';end if;
 update public.friend_rooms set host_id=auth.uid(),status='playing',round_index=p_index,deadline=clock_timestamp()+interval '2 minutes' where id=p_room;
 return public.room_state(p_room);
end; $$;
create function public.submit_room_guess(p_room uuid,p_index integer,p_lat double precision default null,p_lng double precision default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.friend_rooms;d public.daily_locations;v_distance double precision;v_timeout boolean;v_points integer;
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
 select * into d from public.daily_locations where challenge_id=r.challenge_id and round_index=p_index;
 if p_lat is not null then v_distance:=public.geo_distance(d.lat,d.lng,p_lat,p_lng);end if;
 v_points:=case when v_timeout then 0 else round(5000*exp(-v_distance/500)) end;
 -- First answer starts the shared final countdown, never extends an existing deadline.
 if not v_timeout and not exists(select 1 from public.friend_answers where room_id=p_room and round_index=p_index) then
  update public.friend_rooms set deadline=least(deadline,clock_timestamp()+interval '15 seconds') where id=p_room;
 end if;
 insert into public.friend_answers(room_id,user_id,round_index,guess_lat,guess_lng,points,distance,timed_out) values(p_room,auth.uid(),p_index,p_lat,p_lng,v_points,v_distance,v_timeout);
 return public.room_state(p_room);
end; $$;
create function public.leave_room(p_room uuid) returns void language plpgsql security definer set search_path='' as $$
declare v_host uuid;
begin
 perform public.require_google_login();perform 1 from public.friend_rooms where id=p_room for update;
 update public.friend_members set left_at=clock_timestamp() where room_id=p_room and user_id=auth.uid() and left_at is null;
 if not found then raise exception 'Sala no disponible' using errcode='42501';end if;
 select user_id into v_host from public.friend_members where room_id=p_room and left_at is null order by joined_at,user_id limit 1;
 if v_host is null then update public.friend_rooms set status='closed' where id=p_room;
 else update public.friend_rooms set host_id=v_host where id=p_room and host_id=auth.uid();end if;
end; $$;
revoke execute on function public.room_state(uuid),public.create_room(),public.join_room(text),public.advance_room(uuid,integer),public.submit_room_guess(uuid,integer,double precision,double precision),public.leave_room(uuid) from public,anon,authenticated;
grant execute on function public.room_state(uuid),public.create_room(),public.join_room(text),public.advance_room(uuid,integer),public.submit_room_guess(uuid,integer,double precision,double precision),public.leave_room(uuid) to authenticated;
commit;
