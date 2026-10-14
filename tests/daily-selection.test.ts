import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectDailyLocations,type Candidate} from '../server/daily-selection.ts';
const candidates:Candidate[]=Array.from({length:12},(_,index)=>({id:`location-${index}`,name:`Point ${index}`,region:`region-${index%6}`,kind:index%2?'town':'city',lat:-30-index*0.1,lng:-60,hint:''}));
const verify=async(place:Candidate)=>({place,pano:`pano-${place.id}`,target:{lat:place.lat,lng:place.lng}});

test('El preparador devuelve exactamente cinco sitios y prioriza regiones distintas',async()=>{
 const selected=await selectDailyLocations(candidates,verify);assert.equal(selected.length,5);
 assert.equal(new Set(selected.map(item=>item.location_id)).size,5);
 assert.equal(new Set(selected.map(item=>candidates.find(place=>place.id===item.location_id)!.region)).size,5);
});
test('Descarta falta de cobertura y panoramas compartidos por puntos próximos',async()=>{
 let count=0;
 const selected=await selectDailyLocations(candidates,async place=>{count++;if(count===1)return null;const found=await verify(place);return count<4?{...found,pano:'same-pano',target:{lat:-30,lng:-60}}:found;});
 assert.equal(selected.length,5);assert.equal(selected.filter(item=>item.pano_id==='same-pano').length,1);assert.ok(count>5);
});
test('No publica un lote parcial y limita consultas ante ausencia de cobertura',async()=>{
 let calls=0;await assert.rejects(selectDailyLocations(candidates,async()=>{calls++;return null;},7),/cinco panoramas/);assert.equal(calls,7);
});
test('Un fallo de autorización detiene la preparación sin continuar consultando',async()=>{
 let calls=0;await assert.rejects(selectDailyLocations(candidates,async()=>{calls++;throw new Error('Denied');}),/Denied/);assert.equal(calls,1);
});
