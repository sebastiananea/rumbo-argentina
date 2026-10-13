import {readFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';

const file=process.argv[2]??'data/catalog-candidates.json';
const url=process.env.SUPABASE_URL;
const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key)throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY locally; never expose the service role in frontend settings.');
const rows=JSON.parse(await readFile(file,'utf8'));
if(!Array.isArray(rows)||rows.length===0)throw new Error('Expected a nonempty JSON array of candidate coordinates.');
const slugs=new Set();
const candidates=rows.map(row=>{
 const {seed_slug,name,region,kind,lat,lng}=row;
 if(typeof seed_slug!=='string'||!seed_slug.trim()||slugs.has(seed_slug)||typeof name!=='string'||!name.trim()||name.length>100||typeof region!=='string'||!region.trim()||region.length>50||!['city','town','road'].includes(kind)||!Number.isFinite(lat)||!Number.isFinite(lng)||lat< -56||lat> -21||lng< -74||lng> -53)throw new Error('Invalid or duplicate candidate.');
 slugs.add(seed_slug);
 return {seed_slug,name,region,kind,lat,lng};
});
const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
for(let offset=0;offset<candidates.length;offset+=250){
 const {error}=await client.from('locations').upsert(candidates.slice(offset,offset+250),{onConflict:'seed_slug',ignoreDuplicates:true});
 if(error)throw new Error('Catalog import failed. Check project access and apply the schema migrations.');
}
console.log(`Processed ${candidates.length} candidate coordinates. Existing records were preserved; new records require validation.`);
