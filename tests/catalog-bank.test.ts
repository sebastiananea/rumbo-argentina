import {test,before,after} from 'node:test';import assert from 'node:assert/strict';import {readFile,readdir} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
import {freshCatalog,validationQueue,type CatalogCandidate} from '../server/catalog-validation.ts';
let db:PGlite,legacy:any;const alice='00000000-0000-4000-8000-000000000001',bob='00000000-0000-4000-8000-000000000002';
async function rpc(name:string,args:unknown[]=[]){return (await db.query<{value:any}>('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as value',args)).rows[0].value;}
async function user(id=alice){await db.exec('reset role;set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);}
before(async()=>{db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;create function auth.jwt() returns jsonb language sql stable as $$select '{"app_metadata":{"provider":"google"},"amr":[{"method":"oauth"}]}'::jsonb$$;grant usage on schema public,auth to anon,authenticated,service_role;`);
 const root=new URL('../supabase/migrations/',import.meta.url);for(const name of (await readdir(root)).sort().filter(name=>name<'202610170010'))await db.exec(await readFile(new URL(name,root),'utf8'));
 await db.query('insert into auth.users(id) values($1),($2)',[alice,bob]);const claim=await rpc('daily_claim',[false]);await rpc('daily_publish',[claim.id,claim.token,JSON.stringify(claim.candidates.slice(0,5).map((p:any,i:number)=>({location_id:p.id,pano_id:'legacy-'+i})))]);
 await db.exec("update public.locations set validation_status='active'");await user();legacy=await rpc('create_room');await user(bob);await rpc('join_room',[legacy.code]);
 await db.exec('reset role');for(const name of ['202610170010_expanded_catalog.sql','202610170011_catalog_bank_rooms.sql'])await db.exec(await readFile(new URL(name,root),'utf8'));
});after(async()=>{await db?.close();});
test('Más de 500 puntos independientes, provincias completas y nombres solicitados; no inventa cobertura',async()=>{
 const seeds=JSON.parse(await readFile(new URL('../data/catalog-candidates.json',import.meta.url),'utf8'));assert.equal(seeds.length,1190);assert.equal(new Set(seeds.map((p:any)=>p.seed_slug)).size,seeds.length);assert.equal(new Set(seeds.map((p:any)=>p.region)).size,24);
 for(const name of ['Hurlingham','Morón','Constitución','Retiro','Salta','Córdoba','Mar del Plata'])assert.ok(seeds.some((p:any)=>p.name.includes(name)),name);
 assert.ok(seeds.every((p:any)=>Number.isFinite(p.lat)&&p.lat>=-56&&p.lat<=-21&&p.lng>=-74&&p.lng<=-53&&p.name.length<=100&&p.region.length<=50));
 const counts=(await db.query<{total:number;pending:number}>("select count(*)::int total,count(*) filter(where validation_status='pending')::int pending from public.locations")).rows[0];assert.equal(counts.total,1190);assert.equal(counts.pending,1139);
 assert.equal((await db.query('select * from public.catalog_panoramas')).rows.length,5);
});
test('Las salas existentes mantienen sus cinco puntos y no se alteran al ampliar',async()=>{
 await user();await rpc('advance_room',[legacy.id,0]);const state=await rpc('room_state',[legacy.id]);assert.ok(state.location.panoId.startsWith('legacy-'));const before=state.location;
 await db.exec('reset role');await db.query("update public.locations set name='Cambio posterior',lat=lat+0.01 where id=$1",[before.id]);await user();assert.deepEqual((await rpc('room_state',[legacy.id])).location,before);
});
test('Solo el preparador confiable puede validar; rechaza panos duplicados y publica estado real',async()=>{
 await assert.rejects(rpc('record_catalog_panorama',[legacy.id,'fake']),/permission denied/);await assert.rejects(db.query('select * from public.catalog_panoramas'),/permission denied/);await assert.rejects(db.query('select * from public.room_locations'),/permission denied/);
 await db.exec('reset role;set role service_role');const rows=(await db.query<{id:string}>("select id from public.locations where validation_status='pending' order by id limit 20")).rows;
 for(let i=0;i<rows.length;i++)assert.equal(await rpc('record_catalog_panorama',[rows[i].id,'bank-'+i]),true);
 const next=(await db.query<{id:string}>("select id from public.locations where validation_status='pending' limit 1")).rows[0];assert.equal(await rpc('record_catalog_panorama',[next.id,'bank-0']),false);
 assert.equal((await db.query('select * from public.catalog_panoramas')).rows.length,25);
 assert.equal(await rpc('record_catalog_panorama',[next.id,null]),false);
});
test('Cada sala sortea un conjunto nuevo, sin repetidos y compartido entre amigos',async()=>{
 await user();const a=await rpc('create_room'),b=await rpc('create_room');await db.exec('reset role');const slots=async(id:string)=>(await db.query<{location_id:string;pano_id:string}>('select location_id,pano_id from public.room_locations where room_id=$1 order by round_index',[id])).rows;
 const first=await slots(a.id),second=await slots(b.id);assert.equal(first.length,5);assert.equal(new Set(first.map(p=>p.pano_id)).size,5);assert.equal(second.some(p=>first.some(q=>q.location_id===p.location_id)),false);
 await user(bob);await rpc('join_room',[a.code]);await user();await rpc('advance_room',[a.id,0]);const host=await rpc('room_state',[a.id]);await user(bob);assert.deepEqual((await rpc('room_state',[a.id])).location,host.location);
 await rpc('submit_room_guess',[a.id,0,host.location.lat,host.location.lng]);await user();const result=await rpc('submit_room_guess',[a.id,0,host.location.lat,host.location.lng]);assert.equal(result.result.points,5000);
});
test('IDs vencidos no entran al sorteo; conserva fallback diario y permisos de invitados',async()=>{
 await db.exec("reset role;update public.catalog_panoramas set verified_at=clock_timestamp()-interval '29 days'");await user();const fallback=await rpc('create_room');await db.exec('reset role');const slots=(await db.query<{pano_id:string}>('select pano_id from public.room_locations where room_id=$1',[fallback.id])).rows;assert.equal(slots.length,5);assert.ok(slots.every(p=>p.pano_id.startsWith('legacy-')));
 await db.exec('set role anon');await assert.rejects(db.query('select * from public.catalog_panoramas'),/permission denied/);await assert.rejects(rpc('create_room'),/permission denied/);
});
test('La cola recorre provincias, omite válidos recientes y reintenta faltantes solo tras siete días',()=>{
 const now=Date.now();const row=(id:string,region:string,status='pending',checked:string|null=null)=>({id,region,validation_status:status,last_checked_at:checked,name:id,kind:'town',lat:-34,lng:-58}) as CatalogCandidate;
 const rows=[row('a','Buenos Aires'),row('b','Buenos Aires'),row('c','Salta'),row('d','Córdoba'),row('e','CABA','active'),row('f','Salta','unavailable',new Date(now).toISOString()),row('g','CABA','unavailable',new Date(now-8*86400000).toISOString())];
 const panos=[{location_id:'e',pano_id:'e',verified_at:new Date(now).toISOString()}];assert.deepEqual([...freshCatalog(rows,panos,now)],['e']);const queue=validationQueue(rows,panos,now);assert.ok(!queue.some(p=>p.id==='e'||p.id==='f'));assert.equal(new Set(queue.slice(0,4).map(p=>p.region)).size,4);
});
