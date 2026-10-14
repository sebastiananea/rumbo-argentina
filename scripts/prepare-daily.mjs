import {createClient} from '@supabase/supabase-js';
import {chromium} from 'playwright';
import {findNavigablePanorama} from '../src/street-view.ts';
import {selectDailyLocations} from '../server/daily-selection.ts';

const required=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','GOOGLE_MAPS_API_KEY','RUMBO_SITE_URL'];
if(required.some(name=>!process.env[name])){
 console.error('Daily preparation needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_MAPS_API_KEY and RUMBO_SITE_URL.');process.exit(1);
}
const client=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
let claim,browser;
try{
 const {data,error}=await client.rpc('daily_claim',{p_tomorrow:process.env.DAILY_PREPARE_AHEAD==='true'});
 if(error)throw new Error('Could not claim daily preparation');
 claim=data;
 if(!claim.claimed){console.log(`Daily preparation skipped (${claim.reason}).`);process.exit(0);}
 const site=new URL(process.env.RUMBO_SITE_URL);
 if(site.protocol!=='https:'||site.username||site.password)throw new Error('RUMBO_SITE_URL must be the trusted HTTPS application origin');
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});
 const page=await browser.newPage();
 await page.goto(site.origin+'/',{waitUntil:'domcontentloaded',timeout:30000});
 // The trusted scheduled browser uses the existing restricted Maps JavaScript API key.
 // Do not forward browser console logs or enable traces: they can include URLs with keys.
 await page.evaluate(async key=>{
  if(!window.google?.maps)await new Promise((resolve,reject)=>{
   const script=document.createElement('script');const timer=setTimeout(()=>reject(new Error('Maps startup timeout')),20000);
   window.__dailyMapsLoaded=()=>{clearTimeout(timer);resolve();};window.gm_authFailure=()=>{clearTimeout(timer);reject(new Error('Maps authorization failed'));};
   script.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(key)+'&callback=__dailyMapsLoaded&loading=async&v=quarterly&language=es&region=AR';
   script.onerror=()=>{clearTimeout(timer);reject(new Error('Maps startup failed'));};document.head.appendChild(script);
  });
  window.__dailyStreetViewService=new google.maps.StreetViewService();
 },process.env.GOOGLE_MAPS_API_KEY);
 const verify=async place=>{
  const found=await findNavigablePanorama(async request=>{
  const result=await page.evaluate(async query=>{
   try{
    const {data}=await window.__dailyStreetViewService.getPanorama(query);
    return {ok:true,pano:data.location?.pano,lat:data.location?.latLng?.lat(),lng:data.location?.latLng?.lng(),links:(data.links??[]).map(link=>({pano:link.pano}))};
   }catch(error){return {ok:false,code:typeof error==='string'?error:error?.code??error?.status??'SERVICE_FAILURE'};}
  },request);
  if(!result.ok)throw {code:result.code};
  return {data:{location:{pano:result.pano,latLng:{lat:()=>result.lat,lng:()=>result.lng}},links:result.links}};
 },[place]);
  const {error}=await client.from('locations').update({validation_status:found?'active':'unavailable',last_checked_at:new Date().toISOString()}).eq('id',place.id);
  if(error)throw new Error('Could not save catalog verification');
  return found;
 };
 const locations=await selectDailyLocations(claim.candidates,verify);
 const {error:publishError}=await client.rpc('daily_publish',{p_id:claim.id,p_token:claim.token,p_locations:locations});
 if(publishError)throw new Error('Could not publish daily preparation');
 console.log(`Published five navigable locations for ${claim.day}.`);
}catch{
 if(claim?.claimed)await client.rpc('daily_fail',{p_id:claim.id,p_token:claim.token}).catch(()=>{});
 console.error('Daily preparation failed. Check database migrations, provider access, billing and authorized application referrers.');process.exitCode=1;
}finally{await browser?.close();}
