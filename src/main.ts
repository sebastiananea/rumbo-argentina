import {bootstrapApplication} from '@angular/platform-browser';
import {Component,OnDestroy,NgZone,ChangeDetectorRef,signal} from '@angular/core';
import * as L from 'leaflet';
import {Game,Point,PLACES} from './game';
import {findNavigablePanorama} from './street-view';
import {GOOGLE_MAPS_API_KEY} from './google-maps-config';
@Component({selector:'app-root',standalone:true,template:`
<header><a class="brand" href="/">◈ <span>rumbo<span class="dot">.</span></span></a><span class="country">ARGENTINA <span>🇦🇷</span></span></header>
<main [class.playing]="playing()">
@if(!started()){
<section class="home" aria-labelledby="home-title"><div class="home-compass" aria-hidden="true">◈</div><p class="eyebrow">UN PAÍS. MILES DE CAMINOS.</p><h1 id="home-title">Encontrá tu rumbo.</h1><p class="home-description">Explorá Argentina en Street View y descubrí dónde estás.</p><div class="home-rules"><span>5 rondas</span><span>2 minutos por ubicación</span><span>Hasta 25.000 puntos</span></div><button class="start" (click)="begin()">Jugar →</button><p class="home-note">Marcá tu apuesta y confirmala antes de que termine el tiempo. Si se agota, la ronda vale 0 puntos.</p></section>
}@else{
<section class="intro"><div><p class="eyebrow">UN PAÍS. MILES DE CAMINOS.</p><h1>¿Dónde estás?</h1><p>Explorá, buscá pistas y marcá tu destino.</p><button class="start" (click)="begin()">{{connected() ? 'Volver a la partida →' : 'Reintentar →'}}</button></div><div class="stats"><div><small>RONDA</small><strong>{{game.index+1}} <span>/ 5</span></strong></div><div><small>PUNTAJE</small><strong>{{game.total.toLocaleString('es-AR')}} <span>/ 25.000</span></strong></div></div></section>
@if(error()){<p class="error" role="alert">{{error()}}</p>}
<div class="workspace"><div class="gamehud"><span>Ronda {{game.index+1}} / 5 · {{game.total.toLocaleString('es-AR')}} puntos</span><span class="timer" [class.urgent]="remaining()<=20 && !game.revealed" role="timer" aria-label="Tiempo restante">{{busy() ? 'Cargando…' : timeLabel()}}</span><button (click)="leave()">Salir de la vista de juego ✕</button></div><section class="explore"><div class="panelbar"><span class="live">● {{connected()?'STREET VIEW':busy()?'CARGANDO STREET VIEW':'STREET VIEW NO DISPONIBLE'}}</span><span>Single player</span></div><div class="viewer" id="panorama" [class.inactive]="!connected()"></div>
@if(!connected()){<div class="practice"><span class="compass">◈</span><p class="eyebrow">EXPLORÁ ARGENTINA</p><h2>Street View no está disponible</h2><p>Se necesita una conexión válida con Google Maps para jugar.</p></div>}
@if(busy()){<div class="loading" role="status">Buscando un panorama…</div>}
<div class="viewfooter"><span>{{game.revealed?game.rounds[game.index].name:'Encontrá tu rumbo'}}</span><button class="quiet" (click)="resetView()" [disabled]="!connected()||busy()">↺ Volver al inicio</button></div></section>
<section class="mapcard" [class.expanded]="mapExpanded() || game.revealed" (mouseenter)="mapExpanded.set(true)" (mouseleave)="mapExpanded.set(false)"><div class="panelbar"><strong>Tu apuesta <span class="map-timer" [class.urgent]="remaining()<=20 && !game.revealed">{{busy() ? 'Cargando…' : timeLabel()}}</span></strong><button class="maptoggle quiet" (click)="mapExpanded.set(!mapExpanded())" [attr.aria-expanded]="mapExpanded()" aria-label="Ampliar o reducir mapa">{{mapExpanded()?'Reducir ↙':'Ampliar ↗'}}</button></div><div id="map" aria-label="Mapa para elegir una ubicación"></div><div class="mapfooter"><p>{{game.guess?'Ubicación marcada. Podés moverla antes de apostar.':'Elegí dónde creés que estás.'}}</p><button class="primary" (click)="submit()" [disabled]="!game.guess||!game.target||game.revealed||busy()">Confirmar ubicación →</button></div></section></div>
@if(game.revealed){<section class="result" aria-live="polite"><div><p class="eyebrow">{{game.results[game.index].timedOut?'TIEMPO AGOTADO':game.finished?'PARTIDA COMPLETA':'RESULTADO DE LA RONDA'}}</p><h2>{{game.results[game.index].name}}</h2>@if(game.results[game.index].timedOut){<p>Se terminaron los 2 minutos. Esta ronda suma 0 puntos.</p>}@else{<p>A {{formatDistance(game.results[game.index].distance)}} del punto de inicio.</p>}</div><div><strong>+{{game.results[game.index].points.toLocaleString('es-AR')}}</strong><small>puntos de esta ronda</small></div><button (click)="game.finished?restart():next()">{{game.finished?'Jugar de nuevo ↺':'Siguiente ronda →'}}</button></section>}
@if(game.finished){<section class="summary"><h2>Tu recorrido · {{game.total.toLocaleString('es-AR')}} / 25.000 puntos</h2><table><thead><tr><th>Ronda</th><th>Destino</th><th>Distancia</th><th>Puntos</th></tr></thead><tbody>@for(r of game.results;track $index){<tr><td>{{$index+1}}</td><td>{{r.name}}</td><td>{{r.timedOut ? 'Tiempo agotado' : formatDistance(r.distance)}}</td><td>{{r.points.toLocaleString('es-AR')}}</td></tr>}</tbody></table></section>}
}
<footer><span>De la Puna a la Patagonia.</span><span>5 rondas · 2 minutos por ronda</span></footer></main>`})
class App implements OnDestroy {
 started=signal(false);remaining=signal(120);private timer?:ReturnType<typeof setInterval>;
 playing=signal(false);mapExpanded=signal(false);private resizeObserver?:ResizeObserver;game=new Game();connected=signal(false);busy=signal(false);error=signal('');private map!:L.Map;private pins=L.layerGroup();private panorama?:google.maps.StreetViewPanorama;private service?:google.maps.StreetViewService;private startPano='';private request=0;private destroyed=false;private script?:HTMLScriptElement;private authFailed=false;
 constructor(private zone:NgZone,private cdr:ChangeDetectorRef){}
 private initializeMap(){this.map=L.map('map').setView([-38.5,-64],4);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',maxZoom:19}).addTo(this.map);this.pins.addTo(this.map);this.map.on('click',(e:L.LeafletMouseEvent)=>this.zone.run(()=>{if(this.game.revealed||this.busy()||this.checkTime())return;this.game.guess={lat:e.latlng.lat,lng:e.latlng.lng};this.draw();this.cdr.markForCheck();}));this.game.target=null;this.resizeObserver=new ResizeObserver(()=>{this.map.invalidateSize({pan:false});if(this.game.revealed)this.draw();if(this.panorama)google.maps.event.trigger(this.panorama,'resize');});this.resizeObserver.observe(document.getElementById('map')!);this.resizeObserver.observe(document.getElementById('panorama')!);}
 begin(){
  if(this.busy()||this.game.finished)return;
  if(!this.started()){this.started.set(true);this.cdr.detectChanges();this.initializeMap();}
  this.playing.set(true);this.mapExpanded.set(false);document.body.style.overflow='hidden';
  if(this.connected())return;
  const key=GOOGLE_MAPS_API_KEY.trim();
  if(!key){this.error.set('Street View no está disponible: falta configurar GOOGLE_MAPS_API_KEY en el entorno.');this.leave();return;}
  void this.connect(key);
 }
 timeLabel(){const seconds=this.remaining();return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');}
 private stopTimer(){if(this.timer!==undefined)clearInterval(this.timer);this.timer=undefined;}
 private startTimer(){this.stopTimer();this.game.startTimer();this.remaining.set(this.game.remainingSeconds());this.timer=setInterval(()=>this.zone.run(()=>this.checkTime()),250);}
 private checkTime(){
  this.remaining.set(this.game.remainingSeconds());
  if(this.game.expire()){this.finishRound();return true;}
  return this.game.revealed;
 }
 private finishRound(){this.stopTimer();if(this.game.finished)this.leave();this.draw();this.cdr.markForCheck();}

 leave(){this.playing.set(false);document.body.style.overflow='';}
 async connect(key:string){if(this.busy()||this.connected())return;this.authFailed=false;this.busy.set(true);this.error.set('');try{await this.loadGoogle(key);if(this.authFailed)throw new Error('auth');if(this.destroyed)return;this.service=new google.maps.StreetViewService();this.panorama=new google.maps.StreetViewPanorama(document.getElementById('panorama')!,{addressControl:false,showRoadLabels:false,linksControl:true,fullscreenControl:false,enableCloseButton:false,motionTracking:false});this.connected.set(true);this.game=new Game();this.clear();await this.loadRound();if(this.connected())this.begin();}catch{this.error.set(this.authFailed?'Google rechazó la clave. Revisá Maps JavaScript API, facturación y dominios autorizados.':'No se pudo iniciar Google Maps. Revisá GOOGLE_MAPS_API_KEY, las restricciones de la clave, la facturación y tu conexión.');this.stopTimer();this.connected.set(false);this.game.target=null;}finally{this.busy.set(false);}}
 private loadGoogle(key:string):Promise<void>{if(window.google?.maps)return Promise.resolve();return new Promise((resolve,reject)=>{let settled=false;const finish=(err?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);delete (window as any).__rumboMaps;if(err){this.script?.remove();reject(err);}else resolve();};const timer=setTimeout(()=>finish(new Error('timeout')),20000);(window as any).__rumboMaps=()=>finish();(window as any).gm_authFailure=()=>this.zone.run(()=>{this.authFailed=true;this.stopTimer();this.connected.set(false);this.game.target=null;this.busy.set(false);this.leave();finish(new Error('auth'));if(settled)this.error.set('Google rechazó la clave. Revisá Maps JavaScript API, facturación y dominios autorizados.');});this.script=document.createElement('script');this.script.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(key)+'&callback=__rumboMaps&loading=async&v=quarterly&language=es&region=AR';this.script.onerror=()=>finish(new Error('network'));document.head.appendChild(this.script);});}
 async loadRound(){
  this.stopTimer();this.remaining.set(120);
  const id=++this.request;
  const isCurrent=()=>id===this.request&&!this.destroyed&&!this.authFailed;
  this.busy.set(true);this.error.set('');this.game.target=null;
  const place=this.game.rounds[this.game.index];
  const reserved=new Set(this.game.rounds.map(round=>round.name));
  const alternatives=PLACES.filter(candidate=>!reserved.has(candidate.name));
  try{
   const found=await findNavigablePanorama(request=>this.service!.getPanorama(request),[place,...alternatives],isCurrent);
   if(!isCurrent())return;
   if(!found)throw new Error('Sin panorama navegable');
   this.game.rounds[this.game.index]=found.place;
   this.game.target=found.target;this.startPano=found.pano;
   this.panorama!.setPano(this.startPano);
   this.panorama!.setPov({heading:Math.random()*360,pitch:0});
   this.panorama!.setVisible(true);this.startTimer();
  }catch{
   if(!isCurrent())return;
   this.error.set('No se pudo cargar un Street View navegable. Revisá la cobertura, la clave de Google Maps y tu conexión, y volvé a intentar.');
   this.panorama?.setVisible(false);this.connected.set(false);this.game.target=null;this.leave();
  }finally{if(id===this.request)this.busy.set(false);}
 }
 resetView(){if(this.startPano)this.panorama?.setPano(this.startPano);}
 draw(){this.pins.clearLayers();if(this.game.guess)L.circleMarker(this.game.guess,{radius:8,color:'#fff',weight:3,fillColor:'#126e72',fillOpacity:1}).bindTooltip('Tu apuesta').addTo(this.pins);if(this.game.revealed&&this.game.target){L.circleMarker(this.game.target,{radius:8,color:'#fff',weight:3,fillColor:'#ea9049',fillOpacity:1}).bindTooltip('Ubicación real').addTo(this.pins);if(this.game.guess){L.polyline([this.game.guess,this.game.target],{color:'#ea9049',dashArray:'7,7'}).addTo(this.pins);this.map.fitBounds(L.latLngBounds([this.game.guess,this.game.target]),{padding:[35,35],maxZoom:14});}else this.map.setView(this.game.target,12);}}
 submit(){if(!this.connected()||this.busy())return;if(this.checkTime())return;this.game.submit();if(this.game.revealed)this.finishRound();}
 clear(){this.pins.clearLayers();this.map.setView([-38.5,-64],4);}
 next(){if(!this.game.revealed||this.game.finished)return;this.mapExpanded.set(false);this.game.next();this.clear();if(this.connected())void this.loadRound();else this.game.target=null;}
 restart(){this.stopTimer();this.game=new Game();this.begin();this.clear();if(this.connected())void this.loadRound();else this.game.target=null;}
 formatDistance(km:number|null){if(km===null)return 'Sin apuesta';return km<1?Math.round(km*1000)+' m':km.toLocaleString('es-AR',{maximumFractionDigits:1})+' km';}
 ngOnDestroy(){this.stopTimer();this.destroyed=true;this.resizeObserver?.disconnect();document.body.style.overflow='';this.request++;this.map?.remove();this.panorama?.setVisible(false);if(this.panorama)google.maps.event.clearInstanceListeners(this.panorama);delete (window as any).gm_authFailure;}
}
bootstrapApplication(App).catch(console.error);
