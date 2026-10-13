import type {Place, Point} from './game';

export interface PanoramaData {
 location?: {pano?: string; latLng?: {lat(): number; lng(): number} | null};
 links?: {pano?: string | null}[];
}
export interface PanoramaRequest {
 location: Point;
 radius: number;
 sources: ('google' | 'outdoor')[];
 preference: 'nearest';
}
export interface NavigablePanorama {place: Place; pano: string; target: Point}

function navigableLocation(data: PanoramaData): {pano: string; target: Point} | null {
 const location=data.location;
 const pano=location?.pano;
 if(!pano?.trim()||!location?.latLng)return null;
 if(!data.links?.some(link=>link.pano?.trim()&&link.pano!==pano))return null;
 const target={lat:location.latLng.lat(),lng:location.latLng.lng()};
 if(!Number.isFinite(target.lat)||!Number.isFinite(target.lng)||Math.abs(target.lat)>90||Math.abs(target.lng)>180)return null;
 return {pano,target};
}

function noCoverage(error: unknown): boolean {
 if(error==='ZERO_RESULTS')return true;
 if(typeof error!=='object'||error===null)return false;
 return ('code' in error&&error.code==='ZERO_RESULTS')||('status' in error&&error.status==='ZERO_RESULTS');
}

// Each destination gets at most five queries: its center and four nearby streets.
// Official outdoor imagery still needs a usable link; isolated panoramas are rejected.
export async function findNavigablePanorama(
 fetchPanorama: (request: PanoramaRequest)=>Promise<{data: PanoramaData}>,
 places: readonly Place[],
 isCurrent: ()=>boolean=()=>true,
): Promise<NavigablePanorama | null> {
 const seen=new Set<string>();
 for(const place of places){
  const longitudeOffset=0.0045/Math.cos(place.lat*Math.PI/180);
  const probes:Point[]=[place,
   {lat:place.lat+0.0045,lng:place.lng}, {lat:place.lat-0.0045,lng:place.lng},
   {lat:place.lat,lng:place.lng+longitudeOffset}, {lat:place.lat,lng:place.lng-longitudeOffset}];
  for(let index=0;index<probes.length;index++){
   if(!isCurrent())return null;
   let data:PanoramaData;
   try{
    ({data}=await fetchPanorama({location:probes[index],radius:index===0?1000:350,sources:['google','outdoor'],preference:'nearest'}));
   }catch(error){
    if(!isCurrent())return null;
    if(noCoverage(error))continue;
    // Authentication, quota and service failures should not trigger more requests.
    throw error;
   }
   if(!isCurrent())return null;
   const pano=data.location?.pano;
   if(pano&&seen.has(pano))continue;
   if(pano)seen.add(pano);
   const location=navigableLocation(data);
   if(location)return {place,...location};
  }
 }
 return null;
}
