export interface Point { lat: number; lng: number }
export interface Place extends Point { name: string; hint: string }
export const PLACES: Place[] = [
 {name:'Buenos Aires',lat:-34.6037,lng:-58.3816,hint:'Una avenida inmensa, edificios altos y mucho movimiento.'},
 {name:'Córdoba',lat:-31.4167,lng:-64.1833,hint:'Ciudad histórica, fachadas coloniales y un centro muy activo.'},
 {name:'Mendoza',lat:-32.8895,lng:-68.8458,hint:'Calles arboladas, acequias y la cordillera cerca.'},
 {name:'Salta',lat:-24.7892,lng:-65.4105,hint:'Arquitectura colonial y montañas del noroeste.'},
 {name:'Bariloche',lat:-41.1335,lng:-71.3103,hint:'Un lago enorme y montañas patagónicas.'},
 {name:'Mar del Plata',lat:-38.0033,lng:-57.5426,hint:'Ciudad costera, playas y edificios frente al mar.'},
 {name:'Rosario',lat:-32.947,lng:-60.6303,hint:'Una gran ciudad a orillas del Paraná.'},
 {name:'Ushuaia',lat:-54.806,lng:-68.303,hint:'Montañas, puerto y el extremo sur del país.'},
 {name:'San Juan',lat:-31.5375,lng:-68.5364,hint:'Ciudad de clima seco, calles amplias y montañas al oeste.'},
 {name:'Posadas',lat:-27.3668,lng:-55.8964,hint:'Costanera, vegetación subtropical y tierra colorada.'},
 {name:'Puerto Madryn',lat:-42.7692,lng:-65.0385,hint:'Mar, costa patagónica y paisaje árido.'},
 {name:'San Miguel de Tucumán',lat:-26.8309,lng:-65.2037,hint:'Una ciudad del norte con mucha historia y vegetación.'}
];
export function distanceKm(a:Point,b:Point):number {const rad=Math.PI/180;const dlat=(b.lat-a.lat)*rad;const dlng=(b.lng-a.lng)*rad;const h=Math.sin(dlat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dlng/2)**2;return 6371.0088*2*Math.asin(Math.sqrt(Math.min(1,Math.max(0,h))));}
export function score(km:number):number {if(!Number.isFinite(km)||km<0)throw new Error('Distancia inválida');return Math.round(5000*Math.exp(-km/500));}
export function pickRounds(random:()=>number=Math.random):Place[] {const pool=[...PLACES];for(let i=pool.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}return pool.slice(0,5);}
export class Game { rounds=pickRounds(); index=0; guess:Point|null=null; target:Point|null=null; results:{name:string;distance:number;points:number}[]=[];get finished(){return this.results.length===5;} get total(){return this.results.reduce((s,r)=>s+r.points,0);}get revealed(){return this.results.length>this.index;}submit(){if(!this.guess||!this.target||this.revealed||this.finished)return;const distance=distanceKm(this.target,this.guess);this.results.push({name:this.rounds[this.index].name,distance,points:score(distance)});}next(){if(!this.revealed||this.finished)return;this.index++;this.guess=null;this.target=null;}}
