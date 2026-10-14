import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

type Location={id:string;name:string;lat:number;lng:number;region:string;kind:string;panoId:string};
type Challenge={id:string;day:string;sourceDay:string;locations:Location[]};
type Claim={claimed:boolean;id:string;token:string;day:string;candidates:Location[];reason?:string};
type Game={id:string;day:string;locations:Location[]};
const alice='00000000-0000-4000-8000-000000000101',bob='00000000-0000-4000-8000-000000000102';
let db:PGlite,claim:Claim,today:string;
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to anon,authenticated,service_role;`);
 for(const migration of ['202610130001_backend.sql','202610130002_catalog_candidates.sql','202610130003_daily_challenges.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'));
 await db.query('insert into auth.users(id) values($1),($2)',[alice,bob]);
 today=(await db.query<{day:string}>('select public.argentina_today()::text as day')).rows[0].day;
});
after(async()=>{await db?.close();});
async function owner(){await db.exec('reset role');}
async function user(id:string){await db.exec('reset role;set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);}
async function current(){return (await db.query<{daily:Challenge|null}>('select public.get_daily_challenge() as daily')).rows[0].daily;}
async function create(){return (await db.query<{game:Game}>('select public.create_game($1) as game',[crypto.randomUUID()])).rows[0].game;}
async function publish(c:Claim){const slots=c.candidates.slice(0,5).map((location,index)=>({location_id:location.id,pano_id:`test-${c.id}-${index}`}));await db.query('select public.daily_publish($1,$2,$3)',[c.id,c.token,JSON.stringify(slots)]);}

test('Sin publicación no inventa un desafío ni exige validaciones al jugador',async()=>{
 await user(alice);assert.equal(await current(),null);
 await assert.rejects(create(),/diario todavía se está preparando/);
 await assert.rejects(db.query('select public.daily_claim(false)'),/permission denied/);
 await assert.rejects(db.query('select * from public.daily_challenges'),/permission denied/);
});

test('La fecha usa Argentina y una preparación con lease no se duplica',async()=>{
 const expected=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());assert.equal(today,expected);
 await owner();await db.exec('set role service_role');
 claim=(await db.query<{claim:Claim}>('select public.daily_claim(false) as claim')).rows[0].claim;
 assert.equal(claim.claimed,true);assert.equal(claim.day,today);assert.equal(claim.candidates.length,40);
 const retry=(await db.query<{claim:Claim}>('select public.daily_claim(false) as claim')).rows[0].claim;
 assert.equal(retry.claimed,false);assert.equal(retry.reason,'busy');
 await user(bob);await assert.rejects(db.query('select public.daily_publish($1,$2,$3)',[claim.id,claim.token,'[]']),/permission denied/);
});

test('Publica atómicamente cinco ubicaciones únicas y requiere el token correcto',async()=>{
 await owner();await db.exec('set role service_role');
 await assert.rejects(db.query('select public.daily_publish($1,$2,$3)',[claim.id,crypto.randomUUID(),'[]']),/no autorizada/);
 await assert.rejects(db.query('select public.daily_publish($1,$2,$3)',[claim.id,claim.token,'[]']),/exactamente cinco/);
 await assert.rejects(db.query('select public.daily_publish($1,$2,$3)',[claim.id,claim.token,null]),/exactamente cinco/);
 const duplicate=Array.from({length:5},()=>({location_id:claim.candidates[0].id,pano_id:'duplicate'}));
 await assert.rejects(db.query('select public.daily_publish($1,$2,$3)',[claim.id,claim.token,JSON.stringify(duplicate)]),/duplicate key/);
 assert.equal((await db.query('select * from public.daily_locations where challenge_id=$1',[claim.id])).rows.length,0);
 await publish(claim);
 const skip=(await db.query<{claim:Claim}>('select public.daily_claim(false) as claim')).rows[0].claim;assert.equal(skip.reason,'ready');
});

test('Invitados y dos cuentas reciben exactamente los mismos cinco puntos, en el mismo orden',async()=>{
 await owner();await db.exec('set role anon');const guest=await current();assert.ok(guest);assert.equal(guest.day,today);assert.equal(guest.locations.length,5);
 assert.equal(new Set(guest.locations.map(location=>location.id)).size,5);
 assert.ok(!('token' in guest));
 await user(alice);const a=await create();await user(bob);const b=await create();
 assert.deepEqual(a.locations,guest.locations);assert.deepEqual(b.locations,guest.locations);assert.equal(a.day,today);
 assert.equal((await db.query('select * from public.games where id=$1',[a.id])).rows.length,0);
 await assert.rejects(db.query('select public.replace_round_location($1,0,$2)',[b.id,claim.candidates[6].id]),/iguales para todos/);
});

test('No se puede iniciar otro panorama; plazo y puntos siguen controlados por el servidor',async()=>{
 await user(alice);const game=await create(),location=game.locations[0];
 await assert.rejects(db.query('select public.start_round($1,0,$2,$3,$4)',[game.id,location.lat,location.lng,'other-pano']),/Panorama incorrecto/);
 const first=(await db.query<{state:{deadline:string}}>('select public.start_round($1,0,$2,$3,$4) as state',[game.id,location.lat,location.lng,location.panoId])).rows[0].state;
 const retry=(await db.query<{state:{deadline:string}}>('select public.start_round($1,0,$2,$3,$4) as state',[game.id,location.lat,location.lng,location.panoId])).rows[0].state;assert.equal(retry.deadline,first.deadline);
 await assert.rejects(db.query('select public.start_round($1,1,$2,$3,$4)',[game.id,game.locations[1].lat,game.locations[1].lng,game.locations[1].panoId]),/anteriores/);
 for(let index=0;index<5;index++){
  const point=game.locations[index];if(index>0)await db.query('select public.start_round($1,$2,$3,$4,$5)',[game.id,index,point.lat,point.lng,point.panoId]);
  await db.query('select public.finish_round($1,$2,$3,$4)',[game.id,index,point.lat,point.lng]);
 }
 assert.deepEqual((await db.query('select daily_day::text,total,status from public.games where id=$1',[game.id])).rows[0],{daily_day:today,total:25000,status:'completed'});
 const replay=await create();assert.deepEqual(replay.locations,game.locations);
});

test('El próximo desafío se prepara antes de medianoche y no se muestra antes de su fecha',async()=>{
 await owner();await db.exec('set role service_role');const next=(await db.query<{claim:Claim}>('select public.daily_claim(true) as claim')).rows[0].claim;
 assert.equal(next.claimed,true);assert.notEqual(next.day,today);await publish(next);
 await user(bob);assert.equal((await current())?.id,claim.id);
 // Advance only the trusted calendar helper; real SQL transactions and history remain intact.
 await owner();await db.exec(`create or replace function public.argentina_today() returns date language sql volatile set search_path='' as $$ select date '${today}'+1 $$`);
 await user(alice);assert.equal((await current())?.id,next.id);
});

test('Si falla la preparación mantiene el anterior y una publicación tardía no cambia el día ya iniciado',async()=>{
 await owner();const latest=(await db.query<{id:string}>('select id from public.daily_challenges where day=public.argentina_today()')).rows[0].id;
 await db.exec(`create or replace function public.argentina_today() returns date language sql volatile set search_path='' as $$ select date '${today}'+2 $$`);
 await db.exec('set role service_role');const failed=(await db.query<{claim:Claim}>('select public.daily_claim(false) as claim')).rows[0].claim;
 await db.query('select public.daily_fail($1,$2)',[failed.id,failed.token]);
 await user(bob);const fallback=await current();assert.equal(fallback?.id,latest);assert.notEqual(fallback?.sourceDay,fallback?.day);
 await owner();await db.query("update public.daily_challenges set retry_after=now()-interval '1 minute' where id=$1",[failed.id]);await db.exec('set role service_role');
 const repaired=(await db.query<{claim:Claim}>('select public.daily_claim(false) as claim')).rows[0].claim;await publish(repaired);
 await user(alice);assert.equal((await current())?.id,latest);
});

test('Conserva etiquetas y coordenadas del catálogo del día aunque el candidato se edite después',async()=>{
 await user(alice);const before=await current();assert.ok(before);const location=before.locations[0];
 await owner();await db.query("update public.locations set name='Changed candidate',lat=lat+0.01 where id=$1",[location.id]);
 await user(bob);const after=await current();assert.deepEqual(after,before);
});
