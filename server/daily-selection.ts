export interface Candidate {id:string;name:string;region:string;kind:string;lat:number;lng:number;hint:string}
export interface Validated {place:Candidate;pano:string;target:{lat:number;lng:number}}

export async function selectDailyLocations(
 candidates:readonly Candidate[],
 verify:(place:Candidate)=>Promise<Validated|null>,
 limit=40,
):Promise<{location_id:string;pano_id:string}[]> {
 const pool=[...candidates];const selected:Validated[]=[];const panos=new Set<string>();let attempts=0;
 while(pool.length&&selected.length<5&&attempts<limit){
  // Preserve the database's shuffled order within ties; prefer new regions and environments.
  pool.sort((a,b)=>Number(selected.some(item=>item.place.region===a.region))-Number(selected.some(item=>item.place.region===b.region))||Number(selected.some(item=>item.place.kind===a.kind))-Number(selected.some(item=>item.place.kind===b.kind)));
  const candidate=pool.shift()!;if(selected.some(item=>item.place.id===candidate.id))continue;attempts++;
  const found=await verify(candidate);
  if(!found||found.place.id!==candidate.id||panos.has(found.pano))continue;
  // Nearby candidate centers can resolve to the same street; do not count it twice.
  if(selected.some(item=>Math.abs(item.target.lat-found.target.lat)<0.001&&Math.abs(item.target.lng-found.target.lng)<0.001))continue;
  panos.add(found.pano);selected.push(found);
 }
 if(selected.length!==5)throw new Error('No se encontraron cinco panoramas distintos y navegables');
 return selected.map(item=>({location_id:item.place.id,pano_id:item.pano}));
}
