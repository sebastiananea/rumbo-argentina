import {chromium} from 'playwright';
import {findNavigablePanorama} from '../src/street-view.ts';

// Trusted scheduled browser only: no console forwarding, traces, screenshots or key logging.
export async function openCatalogVerifier(origin,key){
 const site=new URL(origin);
 if(site.protocol!=='https:'||site.username||site.password)throw new Error('Invalid public application origin');
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});
 try{
  const page=await browser.newPage();await page.goto(site.origin+'/',{waitUntil:'domcontentloaded',timeout:30000});
  await page.evaluate(async apiKey=>{
   if(!window.google?.maps)await new Promise((resolve,reject)=>{
    const script=document.createElement('script');let done=false;
    const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);delete window.__catalogMaps;if(error)reject(error);else resolve();};
    const timer=setTimeout(()=>finish(new Error('Maps timeout')),20000);
    window.__catalogMaps=()=>finish();window.gm_authFailure=()=>finish(new Error('Maps authorization failed'));
    script.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(apiKey)+'&callback=__catalogMaps&loading=async&v=quarterly&language=es&region=AR';script.onerror=()=>finish(new Error('Maps startup failed'));document.head.appendChild(script);
   });
   window.__catalogService=new google.maps.StreetViewService();
  },key);
  return {close:()=>browser.close(),verify:place=>findNavigablePanorama(async request=>{
   const response=await page.evaluate(async query=>{try{const {data}=await window.__catalogService.getPanorama(query);return {ok:true,pano:data.location?.pano,lat:data.location?.latLng?.lat(),lng:data.location?.latLng?.lng(),links:(data.links??[]).map(link=>({pano:link.pano}))};}catch(error){return {ok:false,code:typeof error==='string'?error:error?.code??error?.status??'SERVICE_FAILURE'};}},request);
   if(!response.ok)throw {code:response.code};
   return {data:{location:{pano:response.pano,latLng:{lat:()=>response.lat,lng:()=>response.lng}},links:response.links}};
  },[place])};
 }catch(error){await browser.close();throw error;}
}
