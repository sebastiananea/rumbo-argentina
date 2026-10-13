import {test} from 'node:test';
import assert from 'node:assert/strict';
import {findNavigablePanorama} from '../src/street-view.ts';
import type {PanoramaData, PanoramaRequest} from '../src/street-view.ts';

const first={name:'Primera',lat:-34.6,lng:-58.4,hint:''};
const replacement={name:'Alternativa',lat:-31.4,lng:-64.2,hint:''};
function panorama(pano:string,links:PanoramaData['links']=[{pano:'neighbor'}]):PanoramaData {
 return {location:{pano,latLng:{lat:()=>-34.601,lng:()=>-58.402}},links};
}

test('Acepta imágenes conectadas y conserva las coordenadas reales del panorama',async()=>{
 const requests:PanoramaRequest[]=[];
 const found=await findNavigablePanorama(async request=>{requests.push(request);return {data:panorama('street')};},[first,replacement]);
 assert.deepEqual(found,{place:first,pano:'street',target:{lat:-34.601,lng:-58.402}});
 assert.equal(requests.length,1);
 assert.deepEqual(requests[0].sources,['google','outdoor']);
});

test('Descarta fotos aisladas y busca otra calle cercana',async()=>{
 const requests:PanoramaRequest[]=[];
 const found=await findNavigablePanorama(async request=>{
  requests.push(request);
  return {data:panorama(requests.length===1?'sphere':'street',requests.length===1?[]:[{pano:'neighbor'}])};
 },[first]);
 assert.equal(found?.pano,'street');assert.equal(found?.place.name,first.name);
 assert.equal(requests.length,2);assert.notDeepEqual(requests[0].location,requests[1].location);
});

test('Reemplaza el destino si las cinco consultas devuelven el mismo panorama aislado',async()=>{
 let calls=0;
 const found=await findNavigablePanorama(async()=>({data:++calls<=5?panorama('sphere',[]):panorama('street')}),[first,replacement]);
 assert.equal(calls,6);assert.equal(found?.place.name,replacement.name);
});

test('Rechaza conexiones vacías, al propio panorama y coordenadas inválidas',async()=>{
 const invalid:PanoramaData[]=[panorama('one'),panorama('two',[]),panorama('three',[{pano:null},{pano:''},{pano:' '}]),panorama('four',[{pano:'four'}]),panorama('five')];
 delete invalid[0].links;
 invalid[4].location!.latLng={lat:()=>NaN,lng:()=>0};
 let calls=0;
 const found=await findNavigablePanorama(async()=>({data:invalid[calls++]}),[first]);
 assert.equal(found,null);assert.equal(calls,5);
});

test('Continúa ante falta de cobertura y termina al agotar la búsqueda',async()=>{
 let calls=0;
 const found=await findNavigablePanorama(async()=>{calls++;throw {code:'ZERO_RESULTS'};},[first,replacement]);
 assert.equal(found,null);assert.equal(calls,10);
});

test('No multiplica consultas cuando falla la autorización o el servicio',async()=>{
 for(const code of ['REQUEST_DENIED','OVER_QUERY_LIMIT','UNKNOWN_ERROR']){
  let calls=0;const error={code};
  await assert.rejects(findNavigablePanorama(async()=>{calls++;throw error;},[first,replacement]),actual=>actual===error);
  assert.equal(calls,1);
 }
});

test('Una búsqueda cancelada no sigue consultando ni acepta resultados viejos',async()=>{
 let current=true;let calls=0;
 const found=await findNavigablePanorama(async()=>{calls++;current=false;return {data:panorama('street')};},[first,replacement],()=>current);
 assert.equal(found,null);assert.equal(calls,1);
 const cancelled=await findNavigablePanorama(async()=>{calls++;return {data:panorama('other')};},[first],()=>false);
 assert.equal(cancelled,null);assert.equal(calls,1);
});
