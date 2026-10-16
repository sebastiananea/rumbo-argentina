import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('Repara nombres OAuth existentes y respeta nombres personalizados; funciona al crear nuevas cuentas',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  await db.exec(await readFile(new URL('../supabase/migrations/202610130001_backend.sql',import.meta.url),'utf8'));
  const add=async(meta:Record<string,string>)=>{const id=crypto.randomUUID();await db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2)',[id,JSON.stringify(meta)]);return id;};
  const name=async(id:string)=>(await db.query<{display_name:string}>('select display_name from public.profiles where id=$1',[id])).rows[0].display_name;
  const google=await add({full_name:'  Ana Gómez  ',name:'Ana',email:'private@example.test'});
  const providerName=await add({name:'Beto'});
  const custom=await add({display_name:'Mi alias',full_name:'Nombre de Google'});
  const edited=await add({full_name:'Nombre original'});await db.query("update public.profiles set display_name='Alias elegido' where id=$1",[edited]);
  const missing=await add({full_name:'  ',name:'',email:'private@example.test'});
  const long=await add({full_name:'Á'.repeat(70)});
  assert.equal(await name(google),'Jugador');
  const migration=await readFile(new URL('../supabase/migrations/202610160007_google_profile_names.sql',import.meta.url),'utf8');
  await db.exec(migration);
  assert.equal(await name(google),'Ana Gómez');assert.equal(await name(providerName),'Beto');assert.equal(await name(custom),'Mi alias');assert.equal(await name(edited),'Alias elegido');assert.equal(await name(missing),'Jugador');assert.equal(await name(long),'Á'.repeat(50));
  assert.equal(await name(await add({full_name:'Carla',name:'C',display_name:'  '})),'Carla');
  assert.equal(await name(await add({name:'Diego'})),'Diego');
  assert.equal(await name(await add({display_name:'Alias',full_name:'Eva'})),'Alias');
  assert.equal(await name(await add({email:'secret@example.test'})),'Jugador');
  await db.exec(migration);assert.equal(await name(edited),'Alias elegido');assert.equal(await name(google),'Ana Gómez');
 }finally{await db.close();}
});
