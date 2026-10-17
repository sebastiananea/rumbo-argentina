import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';

const execute=promisify(execFile);
test('La importación usa lotes idempotentes y no declara cobertura de Google',async()=>{
 const calls:{rows:Record<string,unknown>[];prefer:string}[]=[];
 const server=createServer(async(request,response)=>{
  let body='';for await(const chunk of request)body+=chunk.toString();
  assert.equal(request.method,'POST');assert.match(request.url??'',/^\/rest\/v1\/locations\?/);
  calls.push({rows:JSON.parse(body),prefer:request.headers.prefer??''});
  response.writeHead(201,{'Content-Type':'application/json'});response.end();
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const env={SUPABASE_URL:`http://127.0.0.1:${address.port}`,SUPABASE_SERVICE_ROLE_KEY:'test-private-key-local-only'};
  const script=new URL('../scripts/import-catalog.mjs',import.meta.url).pathname;
  const data=new URL('../data/catalog-candidates.json',import.meta.url).pathname;
  await execute(process.execPath,[script,data],{env});await execute(process.execPath,[script,data],{env});
  const original=JSON.parse(await readFile(data,'utf8'));
  const batches=Math.ceil(original.length/250);
  assert.equal(calls.length,2*batches);
  assert.deepEqual(calls.slice(0,batches).flatMap(call=>call.rows),original);
  assert.deepEqual(calls.slice(batches).flatMap(call=>call.rows),original);
  for(const call of calls){
   assert.ok(call.rows.length<=250);assert.match(call.prefer,/resolution=ignore-duplicates/);
   assert.ok(call.rows.every(row=>!('validation_status' in row)&&!('last_checked_at' in row)));
  }
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
