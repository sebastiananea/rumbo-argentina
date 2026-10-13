import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

type Location={id:string;name:string;lat:number;lng:number;region:string;kind:string};
type CreatedGame={id:string;status:string;locations:Location[]};
const alice='00000000-0000-4000-8000-000000000001';
const bob='00000000-0000-4000-8000-000000000002';
const admin='00000000-0000-4000-8000-000000000003';
let db:PGlite;
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;
 create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to anon,authenticated,service_role;
 insert into auth.users values('${alice}','{"display_name":"Ana"}');`);
 for(const migration of ['202610130001_backend.sql','202610130002_catalog_candidates.sql'])
  await db.exec(await readFile(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'));
 await db.query(`insert into auth.users(id,raw_user_meta_data) values($1,'{"display_name":"Beto","is_admin":true}'),($2,'{"display_name":"Administrador"}')`,[bob,admin]);
 await db.query('insert into public.catalog_admins(user_id) values($1)',[admin]);
 // Google coverage is a fixture only; shipped candidates remain pending.
 await db.exec("update public.locations set validation_status='active',last_checked_at=now()");
});
after(async()=>{await db?.close();});
async function user(id:string){await db.exec('reset role;set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);}
async function owner(){await db.exec('reset role');}
async function create():Promise<CreatedGame>{return (await db.query<{game:CreatedGame}>('select public.create_game($1) as game',[crypto.randomUUID()])).rows[0].game;}
async function start(game:CreatedGame,index=0){const location=game.locations[index];return (await db.query<{state:{deadline:string;serverNow:string}}>('select public.start_round($1,$2,$3,$4) as state',[game.id,index,location.lat,location.lng])).rows[0].state;}
async function finish(game:CreatedGame,index=0){const location=game.locations[index];return (await db.query<{result:{points:number;total:number;timedOut:boolean;finished:boolean}}>('select public.finish_round($1,$2,$3,$4) as result',[game.id,index,location.lat,location.lng])).rows[0].result;}

test('Crea perfiles y mantiene privados perfiles, partidas y rondas',async()=>{
 await user(alice);
 assert.deepEqual((await db.query('select display_name from public.profiles')).rows,[{display_name:'Ana'}]);
 const game=await create();await start(game);
 await user(bob);
 assert.equal((await db.query('select * from public.games where id=$1',[game.id])).rows.length,0);
 assert.equal((await db.query('select * from public.game_rounds where game_id=$1',[game.id])).rows.length,0);
 await assert.rejects(db.query('select public.start_round($1,0,0,0)',[game.id]),/no disponible/);
 await assert.rejects(db.query('select public.finish_round($1,0,0,0)',[game.id]),/no disponible/);
 await assert.rejects(db.query("update public.games set total=25000"),/permission denied/);
 await assert.rejects(db.query("insert into public.catalog_admins values($1)",[bob]),/permission denied/);
 assert.equal((await db.query<{admin:boolean}>('select public.is_catalog_admin() as admin')).rows[0].admin,false);
});

test('El catálogo solo publica puntos validados y requiere cinco para crear partidas',async()=>{
 await owner();await db.exec("update public.locations set validation_status='pending'");
 await user(bob);assert.equal((await db.query('select * from public.locations')).rows.length,0);
 await assert.rejects(create(),/cinco ubicaciones/);
 await assert.rejects(db.query("update public.locations set validation_status='active'"),/permission denied/);
 await owner();await db.exec("update public.locations set validation_status='active'");
});

test('Solo el administrador puede validar candidatos',async()=>{
 await user(bob);await assert.rejects(db.query('select * from public.catalog_review_batch(10)'),/no autorizado/);
 await user(admin);const candidates=(await db.query<Location>('select * from public.catalog_review_batch(10)')).rows;
 assert.equal(candidates.length,10);
 await db.query('select public.validate_location($1,false)',[candidates[0].id]);
 await user(bob);assert.equal((await db.query('select * from public.locations where id=$1',[candidates[0].id])).rows.length,0);
 await user(admin);await db.query('select public.validate_location($1,true)',[candidates[0].id]);
});

test('Selecciona cinco puntos distintos y prioriza ubicaciones no jugadas',async()=>{
 await user(bob);const game=await create();
 assert.equal(new Set(game.locations.map(location=>location.id)).size,5);
 assert.ok(new Set(game.locations.map(location=>location.region)).size>=4);
 for(let index=0;index<5;index++){await start(game,index);await finish(game,index);}
 const next=await create();
 assert.ok(next.locations.every(location=>!game.locations.some(previous=>previous.id===location.id)));
});

test('La creación y la confirmación son idempotentes; el servidor calcula el puntaje',async()=>{
 await user(alice);const request=crypto.randomUUID();
 const original=(await db.query<{game:CreatedGame}>('select public.create_game($1) as game',[request])).rows[0].game;
 const retry=(await db.query<{game:CreatedGame}>('select public.create_game($1) as game',[request])).rows[0].game;
 assert.equal(original.id,retry.id);
 await start(original);const result=await finish(original);
 assert.equal(result.points,5000);assert.equal(result.total,5000);
 const repeated=(await db.query<{result:unknown}>('select public.finish_round($1,0,-54,-68) as result',[original.id])).rows[0].result;
 assert.deepEqual(repeated,result);
 await start(original,1);
 const location=original.locations[1];
 const nearby=(await db.query<{result:{distance:number;points:number}}>('select public.finish_round($1,1,$2,$3) as result',[original.id,location.lat+1,location.lng])).rows[0].result;
 assert.ok(nearby.distance>111&&nearby.distance<112);assert.ok(nearby.points>=4000&&nearby.points<=4005);
 await assert.rejects(db.query('select public.finish_round($1,2,0,0)',[original.id]),/no está en juego/);
});

test('El plazo no se reinicia y una apuesta tardía vale cero aunque sea exacta',async()=>{
 await user(alice);const game=await create();const first=await start(game);const retried=await start(game);
 assert.equal(first.deadline,retried.deadline);
 assert.ok(Math.abs(Date.parse(first.deadline)-Date.parse(first.serverNow)-120000)<1000);
 await owner();await db.query("update public.game_rounds set deadline=now()-interval '1 second' where game_id=$1 and round_index=0",[game.id]);
 await user(alice);const result=await finish(game);
 assert.equal(result.points,0);assert.equal(result.timedOut,true);
 const target=(await db.query('select target_lat,target_lng from public.game_rounds where game_id=$1 and round_index=0',[game.id])).rows[0];
 assert.deepEqual(target,{target_lat:null,target_lng:null});
});

test('Rechaza rondas desordenadas, objetivos lejanos y reemplazos repetidos',async()=>{
 await user(alice);const game=await create();
 await assert.rejects(start(game,1),/anteriores/);
 await assert.rejects(db.query('select public.start_round($1,0,0,0)',[game.id]),/fuera/);
 await assert.rejects(db.query('select public.replace_round_location($1,0,$2)',[game.id,game.locations[1].id]),/ya está/);
 const available=(await db.query<Location>('select * from public.locations')).rows.find(location=>!game.locations.some(picked=>picked.id===location.id))!;
 await db.query('select public.replace_round_location($1,0,$2)',[game.id,available.id]);game.locations[0]=available;
 await start(game);
 await assert.rejects(db.query('select public.replace_round_location($1,0,$2)',[game.id,available.id]),/ya comenzó/);
});

test('Guarda cinco resultados y conserva el historial de partidas abandonadas',async()=>{
 await user(alice);const abandoned=await create();await start(abandoned);
 const game=await create();
 assert.equal((await db.query<{status:string}>('select status from public.games where id=$1',[abandoned.id])).rows[0].status,'abandoned');
 let result;
 for(let index=0;index<5;index++){await start(game,index);result=await finish(game,index);}
 assert.equal(result?.finished,true);assert.equal(result?.total,25000);
 const saved=(await db.query<{status:string;total:number}>('select status,total from public.games where id=$1',[game.id])).rows[0];
 assert.deepEqual(saved,{status:'completed',total:25000});
 assert.equal((await db.query('select * from public.game_rounds where game_id=$1 and status=\'completed\'',[game.id])).rows.length,5);
 await assert.rejects(start(game),/no disponible/);
});

test('Los invitados no pueden escribir partidas ni consultar historiales',async()=>{
 await owner();await db.exec('set role anon');await db.query("select set_config('request.jwt.claim.sub','',false)");
 await assert.rejects(create(),/permission denied/);
 await assert.rejects(db.query('select * from public.games'),/permission denied/);
});


test('La limpieza descarta partidas antiguas sin borrar resultados confirmados',async()=>{
 await user(alice);const game=await create();await start(game);
 await assert.rejects(db.query('select public.cleanup_stale_games()'),/permission denied/);
 await owner();await db.query("update public.games set created_at=now()-interval '2 days' where id=$1",[game.id]);
 await db.exec('select public.cleanup_stale_games()');
 await user(alice);
 assert.equal((await db.query<{status:string}>('select status from public.games where id=$1',[game.id])).rows[0].status,'abandoned');
 assert.deepEqual((await db.query('select target_lat,target_lng from public.game_rounds where game_id=$1 and round_index=0',[game.id])).rows[0],{target_lat:null,target_lng:null});
 assert.ok((await db.query("select * from public.games where status='completed' and total=25000")).rows.length>0);
});
