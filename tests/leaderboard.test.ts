import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
let db:PGlite;
const day='2026-10-15';
const ids=Array.from({length:8},(_,i)=>`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
type Board={day:string;participants:number;completed:number;me:{position:number;name:string;points:number}|null;entries:{position:number;name:string;points:number;mine:boolean}[]};
async function board(){return (await db.query<{board:Board}>('select public.get_daily_leaderboard() as board')).rows[0].board;}
async function role(name:string,id=''){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role '+name);}
async function game(user:number,score:number,status='completed',date=day,finished='2026-10-15T12:00:00Z'){
 await db.query('insert into public.games(user_id,request_id,total,status,daily_day,completed_at) values($1,$2,$3,$4,$5,$6)',[ids[user],crypto.randomUUID(),score,status,date,finished]);
}
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;`);
 for(const name of ['202610130001_backend.sql','202610130002_catalog_candidates.sql','202610130003_daily_challenges.sql','202610140004_daily_attempt.sql','202610150005_daily_leaderboard.sql','202610150006_personal_daily_rank.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 await db.exec(`create or replace function public.argentina_today() returns date language sql volatile set search_path='' as $$ select date '${day}' $$`);
 for(let i=0;i<ids.length;i++)await db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2)',[ids[i],JSON.stringify({display_name:'Jugador '+i,email:'private@example.test'})]);
 const challenge=(await db.query<{id:string}>("insert into public.daily_challenges(day,status) values($1,'ready') returning id",[day])).rows[0].id;
 await db.query('insert into public.daily_days(day,challenge_id) values($1,$2),($1::date-1,$2)',[day,challenge]);
});
after(async()=>{await db?.close();});
test('Ranking vacío accesible sin cuenta, con fecha del servidor',async()=>{
 await role('anon');assert.deepEqual(await board(),{day,participants:0,completed:0,me:null,entries:[]});
 await assert.rejects(db.query('select * from public.games'),/permission denied/);
 await assert.rejects(db.query('select * from public.profiles'),/permission denied/);
});
test('Registra participantes únicos, excluye incompletos y ordena el top cinco con desempate',async()=>{
 await db.exec('reset role');
 for(let i=0;i<6;i++)await game(i,25000-i*1000);
 await game(6,10000,'playing');await game(7,0,'abandoned');
 // Legacy replay scores cannot replace the first completed attempt.
 await game(5,25000,'completed',day,'2026-10-15T13:00:00Z');
 // Tie goes to the earliest completion, even though its account was inserted later.
 await db.query("update public.games set total=25000,completed_at='2026-10-15T11:00:00Z' where user_id=$1",[ids[1]]);
 await game(6,25000,'completed','2026-10-14');
 await role('anon');const result=await board();assert.equal(result.participants,8);assert.equal(result.completed,6);assert.equal(result.entries.length,5);
 assert.deepEqual(result.entries.map(e=>e.name),['Jugador 1','Jugador 0','Jugador 2','Jugador 3','Jugador 4']);assert.equal(result.entries.every(e=>!e.mine),true);
 assert.equal(JSON.stringify(result).includes('private@example.test'),false);
 assert.equal(JSON.stringify(result).includes(ids[0]),false);
 assert.deepEqual(Object.keys(result.entries[0]).sort(),['mine','name','points','position']);
});
test('Identifica solo el puntaje propio sin abrir historiales ajenos ni permitir escrituras',async()=>{
 await role('authenticated',ids[0]);const result=await board();assert.equal(result.entries[1].mine,true);assert.equal(result.entries.filter(e=>e.mine).length,1);assert.equal(result.me?.position,2);
 const own=await db.query<{user_id:string}>('select user_id from public.games');assert.ok(own.rows.every(g=>g.user_id===ids[0]));
 await assert.rejects(db.query('update public.games set total=25000'),/permission denied/);
 await assert.rejects(db.query('select public.get_daily_leaderboard($1)',['2026-10-14']),/does not exist/);
});
test('Un resultado aparece al completar; el cambio de fecha renueva el ranking',async()=>{
 await db.exec('reset role');await db.query("update public.games set status='completed',total=24000,completed_at='2026-10-16T03:01:00Z' where user_id=$1 and daily_day=$2",[ids[6],day]);
 await role('anon');let result=await board();assert.equal(result.completed,7);assert.equal(result.entries[2].name,'Jugador 6');assert.equal(result.participants,8);
 await db.exec(`reset role;create or replace function public.argentina_today() returns date language sql volatile set search_path='' as $$ select date '${day}'+1 $$`);
 await role('anon');result=await board();assert.deepEqual(result,{day:'2026-10-16',participants:0,completed:0,me:null,entries:[]});
});

test('La cuenta ve su posición fuera del top sin revelar otras identidades',async()=>{
 await db.exec(`reset role;create or replace function public.argentina_today() returns date language sql volatile set search_path='' as $$ select date '${day}' $$`);
 await role('authenticated',ids[5]);const result=await board();assert.equal(result.entries.length,5);assert.equal(result.me?.position,7);assert.equal(result.me?.name,'Jugador 5');assert.equal(result.entries.some(entry=>entry.mine),false);
 await role('anon');assert.equal((await board()).me,null);
});
