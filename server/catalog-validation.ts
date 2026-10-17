export interface CatalogCandidate {id:string;name:string;region:string;kind:string;lat:number;lng:number;validation_status:string;last_checked_at:string|null}
export interface CatalogPanorama {location_id:string;pano_id:string;verified_at:string}
export const CATALOG_FRESH_MS=28*24*60*60*1000;
export function freshCatalog(rows:readonly CatalogCandidate[],panos:readonly CatalogPanorama[],now=Date.now()){
 const active=new Set(rows.filter(row=>row.validation_status==='active').map(row=>row.id));
 return new Set(panos.filter(pano=>active.has(pano.location_id)&&Date.parse(pano.verified_at)>now-CATALOG_FRESH_MS).map(pano=>pano.location_id));
}
export function validationQueue(rows:readonly CatalogCandidate[],panos:readonly CatalogPanorama[],now=Date.now()){
 const fresh=freshCatalog(rows,panos,now),groups=new Map<string,CatalogCandidate[]>();
 for(const row of [...rows].sort((a,b)=>(a.last_checked_at?Date.parse(a.last_checked_at):0)-(b.last_checked_at?Date.parse(b.last_checked_at):0)||a.id.localeCompare(b.id))){
  if(fresh.has(row.id)||row.validation_status==='unavailable'&&row.last_checked_at&&Date.parse(row.last_checked_at)>now-7*24*60*60*1000)continue;
  const group=groups.get(row.region)??[];group.push(row);groups.set(row.region,group);
 }
 const queue:CatalogCandidate[]=[];
 while([...groups.values()].some(group=>group.length))for(const region of [...groups.keys()].sort()){const row=groups.get(region)!.shift();if(row)queue.push(row);}
 return queue;
}
