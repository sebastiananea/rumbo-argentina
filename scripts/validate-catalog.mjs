import {readFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {openCatalogVerifier} from './catalog-google.mjs';
import {freshCatalog,validationQueue} from '../server/catalog-validation.ts';

const required=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','GOOGLE_MAPS_API_KEY','RUMBO_SITE_URL'];
if(required.some(name=>!process.env[name]))throw new Error('Configure the catalog workflow variables and secrets in GitHub Actions.');
const target=Number(process.env.CATALOG_TARGET??500),limit=Number(process.env.CATALOG_MAX_ATTEMPTS??1200);
if(!Number.isInteger(target)||target<5||target>2000||!Number.isInteger(limit)||limit<1||limit>2000)throw new Error('Invalid catalog target or attempt limit.');
const client=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
async function all(table,columns){const result=[];for(let offset=0;;offset+=500){const {data,error}=await client.from(table).select(columns).order(table==='locations'?'id':'location_id').range(offset,offset+499);if(error)throw new Error('Catalog schema unavailable');result.push(...data);if(data.length<500)return result;}}
let verifier;
try{
 // Check the bank schema before doing any billable Google requests.
 let panos=await all('catalog_panoramas','location_id,pano_id,verified_at');
 const seeds=JSON.parse(await readFile(new URL('../data/catalog-candidates.json',import.meta.url),'utf8'));
 for(let offset=0;offset<seeds.length;offset+=250){const {error}=await client.from('locations').upsert(seeds.slice(offset,offset+250),{onConflict:'seed_slug',ignoreDuplicates:true});if(error)throw new Error('Catalog import unavailable');}
 const rows=await all('locations','id,name,region,kind,lat,lng,validation_status,last_checked_at');
 const fresh=freshCatalog(rows,panos);let attempts=0;
 console.log(`Catalog: ${rows.length} candidates, ${fresh.size} fresh navigable locations; target ${target}.`);
 if(fresh.size<target){
  verifier=await openCatalogVerifier(process.env.RUMBO_SITE_URL,process.env.GOOGLE_MAPS_API_KEY);
  for(const place of validationQueue(rows,panos)){
   if(fresh.size>=target||attempts>=limit)break;attempts++;
   // Authorization/service errors throw: never mark these as missing coverage.
   const found=await verifier.verify(place);
   const {data:accepted,error}=await client.rpc('record_catalog_panorama',{p_location:place.id,p_pano:found?.pano??null});
   if(error)throw new Error('Catalog publication unavailable');
   if(accepted)fresh.add(place.id);else fresh.delete(place.id);
   if(attempts%25===0)console.log(`Checked ${attempts}; ${fresh.size} fresh navigable locations.`);
  }
 }
 // Count persisted rows, not an optimistic local success counter.
 const persisted=freshCatalog(await all('locations','id,validation_status'),await all('catalog_panoramas','location_id,pano_id,verified_at'));
 console.log(`Persisted ${persisted.size} fresh navigable locations after ${attempts} checks.`);
 if(persisted.size<target)throw new Error('Target not reached');
 console.log(`CATALOG_READY: at least ${target} verified locations saved. Rooms draw independent sets of five.`);
}catch{console.error('Catalog target not confirmed. Saved progress is retained. Check migrations 010/011, Google authorization/billing and the candidate coverage; rerun to continue.');process.exitCode=1;}
finally{await verifier?.close();}
