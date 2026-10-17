import {AfterViewInit,Component,EventEmitter,Input,OnChanges,OnDestroy,Output,signal,type SimpleChanges} from '@angular/core';
import * as L from 'leaflet';
import {Backend,type DailyLocation} from './backend';
import type {Point,RoundResult} from './game';
import {navigableLocation} from './street-view';
import {GOOGLE_MAPS_API_KEY} from './google-maps-config';
import {GameMusic} from './music';
export interface RoomState {id:string;code:string;status:'lobby'|'playing'|'round_result'|'completed'|'closed';index:number;deadline:string|null;serverNow:string;host:boolean;canAdvance:boolean;location:(Pick<DailyLocation,'id'|'name'|'lat'|'lng'|'panoId'> & {hint:string})|null;submitted:boolean;result:RoundResult|null;members:{name:string;mine:boolean;host:boolean;left:boolean;submitted:boolean;total:number}[]}
let mapsLoading:Promise<void>|undefined;
async function maps(){
 if(window.google?.maps)return;
 if(!GOOGLE_MAPS_API_KEY)throw new Error('Street View no está configurado');
 mapsLoading??=new Promise<void>((resolve,reject)=>{
  const script=document.createElement('script');let done=false;
  const finish=(error?:Error)=>{if(done)return;done=true;clearTimeout(timeout);delete (window as any).__roomMaps;if(error){script.remove();mapsLoading=undefined;reject(error);}else resolve();};
  const timeout=setTimeout(()=>finish(new Error('Google Maps tardó demasiado')),20000);
  (window as any).__roomMaps=()=>finish();script.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(GOOGLE_MAPS_API_KEY)+'&callback=__roomMaps&loading=async&v=quarterly&language=es&region=AR';script.onerror=()=>finish(new Error('No se pudo cargar Google Maps'));document.head.appendChild(script);
 });
 return mapsLoading;
}
@Component({selector:'app-room-play',standalone:true,template:`
<section class="room-play"><div id="room-panorama" class="room-panorama"></div><div class="room-hud"><strong>Ronda {{state.index+1}} / 5</strong><span class="room-timer" role="timer" [class.urgent]="remaining()<=15&&remaining()>0&&!state.submitted">{{time()}}</span><button (click)="toggleMusic()" [attr.aria-label]="muted()?'Activar música':'Silenciar música'">{{muted()?'♪̸':'♫'}}</button><button (click)="exit.emit()" aria-label="Volver a la sala">✕</button></div>
@if(error()){<div class="room-overlay" role="alert"><p>{{error()}}</p><button (click)="load()">Reintentar Street View</button><button class="quiet" (click)="exit.emit()">Volver a la sala</button></div>}
@if(state.submitted||remaining()===0){<div class="room-overlay" role="status"><h2>{{state.submitted?'Ubicación enviada':'Tiempo agotado'}}</h2><p>Esperando al resto de jugadores…</p><p>{{state.members.length}} participantes · el reloj es compartido.</p></div>}
@if(!state.submitted&&remaining()>0){<button class="room-reset" (click)="reset()" [disabled]="!loaded()">↺ Punto inicial</button><button class="room-map-launcher" [hidden]="mapOpen()" (click)="openMap()" [disabled]="!loaded()">⌖ Elegir ubicación</button>}<section class="room-map-sheet" [hidden]="state.submitted||remaining()===0" [class.open]="mapOpen()"><div class="section-heading"><strong>Tu apuesta</strong><button class="quiet" (click)="mapOpen.set(false)" aria-label="Cerrar mapa">Cerrar ✕</button></div><div id="room-map"></div><p>Marcá dónde creés que estás. Al responder, quedan como máximo 15 segundos para tus amigos.</p><button (click)="guess.emit(point()!)" [disabled]="!point()||saving||!loaded()">{{saving?'Enviando…':'Confirmar ubicación →'}}</button></section>
</section>`})
export class RoomPlay implements AfterViewInit,OnChanges,OnDestroy {
 @Input({required:true}) state!:RoomState;@Input() saving=false;
 @Output() guess=new EventEmitter<Point>();@Output() exit=new EventEmitter<void>();
 remaining=signal(120);point=signal<Point|null>(null);loaded=signal(false);error=signal('');mapOpen=signal(false);
 private map?:L.Map;private panorama?:google.maps.StreetViewPanorama;private marker?:L.CircleMarker;private observer?:ResizeObserver;private timer?:ReturnType<typeof setInterval>;private deadline=0;private dead=false;private loading=false;private previousOverflow='';
 private music=new GameMusic();muted=signal(this.music.muted);
 ngOnChanges(changes:SimpleChanges){if(changes['state'])this.deadline=Date.now()+Math.max(0,Date.parse(this.state.deadline??'')-Date.parse(this.state.serverNow));if(this.state.submitted)this.music.stop();this.tick();}
 ngAfterViewInit(){this.previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';this.map=L.map('room-map').setView([-38.5,-64],4);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(this.map);this.map.on('click',(event:L.LeafletMouseEvent)=>{if(this.saving||this.state.submitted||!this.remaining())return;this.point.set(event.latlng);this.marker?.remove();this.marker=L.circleMarker(event.latlng,{radius:8,color:'#fff',fillColor:'#126e72',fillOpacity:1}).addTo(this.map!);});this.observer=new ResizeObserver(()=>this.map?.invalidateSize({pan:false}));this.observer.observe(document.getElementById('room-map')!);this.timer=setInterval(()=>this.tick(),250);void this.load();}
 private tick(){this.remaining.set(Math.max(0,Math.ceil((this.deadline-Date.now())/1000)));if(!this.remaining())this.music.stop();}
 time(){return Math.floor(this.remaining()/60)+':'+String(this.remaining()%60).padStart(2,'0');}
 openMap(){this.mapOpen.set(true);requestAnimationFrame(()=>this.map?.invalidateSize({pan:false}));}
 async load(){if(this.loading)return;this.loading=true;this.error.set('');try{await maps();if(this.dead)return;const data=await new google.maps.StreetViewService().getPanorama({pano:this.state.location!.panoId});if(this.dead)return;const valid=navigableLocation(data.data);if(!valid||valid.pano!==this.state.location!.panoId)throw new Error('Sin cobertura');if(!this.panorama)this.panorama=new google.maps.StreetViewPanorama(document.getElementById('room-panorama')!,{addressControl:false,showRoadLabels:false,fullscreenControl:false,enableCloseButton:false,motionTracking:false});this.panorama.setPano(valid.pano);this.panorama.setPov({heading:0,pitch:0});this.loaded.set(true);if(!this.state.submitted&&this.remaining()>0)this.music.start();}catch{if(!this.dead)this.error.set('No se pudo cargar Street View. El reloj de la sala sigue corriendo.');}finally{this.loading=false;}}
 reset(){if(this.state.location)this.panorama?.setPano(this.state.location.panoId);}
 toggleMusic(){this.music.toggle();this.muted.set(this.music.muted);}
 ngOnDestroy(){document.body.style.overflow=this.previousOverflow;this.dead=true;this.music.dispose();if(this.timer)clearInterval(this.timer);this.observer?.disconnect();this.map?.remove();if(this.panorama){google.maps.event.clearInstanceListeners(this.panorama);this.panorama.setVisible(false);}}
}
@Component({selector:'app-friend-rooms',standalone:true,imports:[RoomPlay],template:`
<section class="rooms-panel" aria-labelledby="rooms-title"><div class="section-heading"><div><p class="eyebrow">JUGÁ CON AMIGOS</p><h2 id="rooms-title">Salas privadas</h2></div>@if(state()){<button class="quiet" (click)="leave()" [disabled]="busy()">Salir de la sala</button>}</div>
@if(!state()){<p>Hasta 8 jugadores, las mismas cinco ubicaciones y dos minutos compartidos por ronda. La primera respuesta deja un máximo de 15 segundos para el resto. Las salas tienen su propio ranking y no consumen tu intento diario.</p><div class="room-actions"><button (click)="create()" [disabled]="busy()">Crear sala</button><form (submit)="join($event)"><label for="room-code">Código de invitación</label><div><input id="room-code" maxlength="10" autocomplete="off" autocapitalize="characters" [value]="code()" (input)="code.set(value($event))" placeholder="Código de 10 caracteres" required pattern="[A-Fa-f0-9]{10}"><button [disabled]="busy()" type="submit">Unirme</button></div></form></div>}
@else{<p>Código de invitación: <strong class="room-code">{{state()!.code}}</strong> <button class="quiet" (click)="copy()">Copiar código</button></p><p role="status">{{label()}}</p>
@if(state()!.status==='lobby'){<p>Compartí el código con tus amigos. Cuando estén listos, el anfitrión inicia la partida.</p>}
@if(state()!.status==='round_result'&&state()!.result;as result){<div class="room-round-result"><h3>{{result.name}}</h3><strong>+{{result.points.toLocaleString('es-AR')}} puntos</strong><p>{{result.timedOut?'Tiempo agotado':result.distance?.toFixed(1)+' km del destino'}}</p></div>}
<ol class="room-members">@for(member of state()!.members;track $index){<li><span>{{member.name}} {{member.mine?'(vos)':''}} {{member.host?'· anfitrión':''}} {{member.left?'· salió':''}}</span><strong>{{member.total.toLocaleString('es-AR')}} pts</strong>@if(state()!.status==='playing'){<small>{{member.submitted?'✓ Envió su ubicación':'Jugando…'}}</small>}</li>}</ol>
@if(state()!.status==='lobby'||state()!.status==='round_result'){@if(state()!.canAdvance){<button (click)="advance()" [disabled]="busy()">{{state()!.status==='lobby'?'Iniciar partida →':'Siguiente ronda →'}}</button>}@else{<p>Esperando al anfitrión… Si se desconecta, otro participante podrá continuar después de 90 segundos.</p>}}
@if(state()!.status==='playing'){<button (click)="showPlay.set(true)">Volver a la ronda →</button>}
<button class="quiet" (click)="refresh()" [disabled]="busy()">Actualizar sala</button>}
@if(message()){<p role="status" class="room-message">{{message()}}</p>}
</section>
@if(state()?.status==='playing'&&showPlay()){<app-room-play [state]="state()!" [saving]="busy()" (guess)="submit($event)" (exit)="showPlay.set(false)"/>}`})
export class FriendRooms implements OnDestroy {
 @Input({required:true}) backend!:Backend;@Output() activeChange=new EventEmitter<boolean>();
 state=signal<RoomState|null>(null);code=signal('');busy=signal(false);message=signal('');showPlay=signal(true);
 private poll?:ReturnType<typeof setInterval>;private refreshing=false;private lastRefresh=0;private dead=false;private epoch=0;
 value(event:Event){return (event.target as HTMLInputElement).value.toUpperCase();}
 private accept(state:RoomState){const previous=this.state();this.state.set(state);this.activeChange.emit(true);try{sessionStorage.setItem('rumbo-room-code',state.code);}catch{}if(previous?.index!==state.index)this.showPlay.set(true);}
 private startPolling(){if(this.poll)return;this.poll=setInterval(()=>{if(document.visibilityState==='visible'&&(this.state()?.status==='playing'||Date.now()-this.lastRefresh>=3000))void this.refresh();},1000);}
 ngOnInit(){try{const code=sessionStorage.getItem('rumbo-room-code');if(code){this.code.set(code);void this.join();}}catch{}}
 private async action(run:()=>Promise<RoomState>){if(this.busy())return;this.busy.set(true);this.message.set('');const epoch=++this.epoch;try{const state=await run();if(!this.dead&&epoch===this.epoch){this.accept(state);this.startPolling();}}catch(error){if(!this.dead)this.message.set(error instanceof Error&&/^(Ingresá|Sala no disponible|La partida|La sala|La ronda|Se necesitan|Solo el anfitrión|Marcá|Llegaste al límite|Todavía no hay)/.test(error.message)?error.message:'No se pudo completar la operación. Volvé a intentar en unos momentos.');}finally{if(!this.dead)this.busy.set(false);}}
 create(){return this.action(()=>this.backend.createRoom());}
 join(event?:Event){event?.preventDefault();return this.action(()=>this.backend.joinRoom(this.code().trim().toUpperCase()));}
 advance(){const state=this.state();if(state)return this.action(()=>this.backend.advanceRoom(state.id,state.index+1));}
 submit(point:Point){const state=this.state();if(state)return this.action(()=>this.backend.submitRoom(state.id,state.index,point));}
 async refresh(){const state=this.state();if(!state||this.refreshing||this.busy()||this.dead)return;this.refreshing=true;this.lastRefresh=Date.now();const epoch=this.epoch;try{const next=await this.backend.roomState(state.id);if(!this.dead&&epoch===this.epoch){this.accept(next);this.message.set('');}}catch{if(!this.dead)this.message.set('Se perdió la conexión con la sala. Volvemos a intentar automáticamente.');}finally{this.refreshing=false;}}
 async leave(){const state=this.state();if(!state||this.busy())return;this.busy.set(true);try{await this.backend.leaveRoom(state.id);this.epoch++;this.state.set(null);this.activeChange.emit(false);if(this.poll)clearInterval(this.poll);this.poll=undefined;try{sessionStorage.removeItem('rumbo-room-code');}catch{}this.message.set('');}catch{this.message.set('No se pudo salir de la sala. Reintentá.');}finally{this.busy.set(false);}}
 async copy(){try{await navigator.clipboard.writeText(this.state()!.code);this.message.set('Código copiado. Compartilo con tus amigos.');}catch{this.message.set('Copiá el código que aparece arriba y compartilo.');}}
 label(){const s=this.state();if(!s)return '';return s.status==='lobby'?'Esperando jugadores':s.status==='playing'?'Ronda '+(s.index+1)+' en curso':s.status==='round_result'?'Resultado de la ronda '+(s.index+1):s.status==='completed'?'Partida terminada · clasificación final':'La sala expiró o fue cerrada';}
 ngOnDestroy(){this.dead=true;this.epoch++;if(this.poll)clearInterval(this.poll);this.activeChange.emit(false);}
}
