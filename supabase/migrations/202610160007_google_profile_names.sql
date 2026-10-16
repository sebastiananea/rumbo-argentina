begin;
-- OAuth providers use full_name/name; email registration supplies display_name.
create or replace function public.create_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,display_name) values(new.id,left(coalesce(
  nullif(trim(new.raw_user_meta_data->>'display_name'),''),
  nullif(trim(new.raw_user_meta_data->>'full_name'),''),
  nullif(trim(new.raw_user_meta_data->>'name'),''),
  'Jugador'),50));
 return new;
end; $$;

-- Repair only fallback names; never replace an existing personalized name.
update public.profiles p set display_name=left(coalesce(
 nullif(trim(u.raw_user_meta_data->>'display_name'),''),
 nullif(trim(u.raw_user_meta_data->>'full_name'),''),
 nullif(trim(u.raw_user_meta_data->>'name'),'')),50)
from auth.users u
where p.id=u.id and p.display_name='Jugador'
 and coalesce(nullif(trim(u.raw_user_meta_data->>'display_name'),''),
 nullif(trim(u.raw_user_meta_data->>'full_name'),''),
 nullif(trim(u.raw_user_meta_data->>'name'),'')) is not null;
commit;
