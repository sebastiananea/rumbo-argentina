import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

test('El build incorpora solo configuración pública y rechaza claves privadas sin sobrescribir archivos',async()=>{
 const root=await mkdtemp(join(tmpdir(),'rumbo-config-'));
 try{
  await mkdir(join(root,'scripts'));await mkdir(join(root,'src'));
  const script=join(root,'scripts/configure-google-maps.mjs'),output=join(root,'src/google-maps-config.ts');
  await copyFile(new URL('../scripts/configure-google-maps.mjs',import.meta.url),script);
  const run=(extra:Record<string,string>={})=>execFileSync(process.execPath,[script],{env:extra,stdio:'pipe'});
  run();assert.match(await readFile(output,'utf8'),/SUPABASE_URL = ""/);
  run({SUPABASE_URL:'https://example.supabase.co/',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'});
  assert.match(await readFile(output,'utf8'),/SUPABASE_URL = "https:\/\/example.supabase.co"/);
  assert.match(await readFile(output,'utf8'),/SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test"/);
  await writeFile(output,'existing local config');
  const payload=Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url');
  for(const key of ['sb_secret_do_not_ship',`header.${payload}.signature`]){
   assert.throws(()=>run({SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:key}));
   assert.equal(await readFile(output,'utf8'),'existing local config');
  }
  assert.throws(()=>run({SUPABASE_URL:'https://example.supabase.co'}));
  assert.throws(()=>run({SUPABASE_URL:'https://private@ex.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'}));
 }finally{await rm(root,{recursive:true,force:true});}
});
