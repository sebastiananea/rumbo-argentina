import {bootstrapApplication} from '@angular/platform-browser';
import {Component,OnDestroy,NgZone,ChangeDetectorRef,signal} from '@angular/core';
import * as L from 'leaflet';
import {Game,Point,demoDailyRounds} from './game';
import {findNavigablePanorama,navigableLocation} from './street-view';
import {Backend,type DailyChallenge,type DailyLocation,type GameHistory} from './backend';
import type {User} from '@supabase/supabase-js';
import {GOOGLE_MAPS_API_KEY} from './google-maps-config';
@Component({selector:'app-root',standalone:true,template:`
<header><a class="brand" href="/">◈ <span>rumbo<span class="dot">.</span></span></a><span class="country">ARGENTINA <span>🇦🇷</span></span>@if(backend.client && (!started() || game.finished)){<div class="account-actions">@if(user()){<span>{{displayName()}}</span><button class="quiet" (click)="signOut()" [disabled]="authBusy()||catalogChecking()">Salir de mi cuenta</button>}@else{<button class="quiet" (click)="openAccount('login')">Ingresar</button><button (click)="openAccount('signup')">Crear cuenta</button>}</div>}</header>
<main [class.playing]="playing()">
@if(accountOpen()){
<section class="account-panel" aria-labelledby="account-title"><button class="quiet account-close" (click)="accountOpen.set(false)" aria-label="Cerrar formulario">✕</button>
<h2 id="account-title">{{authMode()==='signup'?'Creá tu cuenta':authMode()==='reset'?'Recuperá tu contraseña':authMode()==='recover'?'Elegí una nueva contraseña':'Ingresá a tu cuenta'}}</h2>
@if(authMode()==='login'||authMode()==='signup'){
<button class="google-signin" type="button" (click)="signInWithGoogle()" [disabled]="authBusy()"><span aria-hidden="true" class="google-mark">G</span>{{authBusy()?'Conectando…':'Continuar con Google'}}</button><div class="auth-divider"><span>o con tu correo</span></div>
}
<form (submit)="authenticate($event)">
@if(authMode()==='signup'){<label>Nombre<input name="display_name" autocomplete="nickname" required maxlength="50" [value]="authName()" (input)="authName.set(inputValue($event))"></label>}
@if(authMode()!=='recover'){<label>Correo electrónico<input name="email" type="email" autocomplete="email" required [value]="authEmail()" (input)="authEmail.set(inputValue($event))"></label>}
@if(authMode()!=='reset'){<label>Contraseña<input name="password" type="password" [autocomplete]="authMode()==='login'?'current-password':'new-password'" required [minLength]="authMode()==='login'?1:8" [value]="authPassword()" (input)="authPassword.set(inputValue($event))"></label>}
<button type="submit" [disabled]="authBusy()">{{authBusy()?'Procesando…':authMode()==='signup'?'Crear cuenta':authMode()==='reset'?'Enviar enlace':authMode()==='recover'?'Guardar contraseña':'Ingresar'}}</button>
</form>
@if(authMessage()){<p role="status">{{authMessage()}}</p>}
@if(authMode()==='login'){<button class="quiet" (click)="openAccount('reset')">Olvidé mi contraseña</button>}
</section>
}
@if(accountError()){<p class="error" role="alert">{{accountError()}}</p>}
@if(!started()){
<section class="home" aria-labelledby="home-title"><div class="home-compass" aria-hidden="true">◈</div><p class="eyebrow">UN PAÍS. MILES DE CAMINOS.</p><h1 id="home-title">Encontrá tu rumbo.</h1><p class="home-description">Explorá Argentina en Street View y descubrí dónde estás.</p>@if(backend.client){<p class="daily-label">Desafío del {{daily()?formatDay(daily()!.day):argentinaDay()}}</p><p class="daily-description">Las mismas 5 ubicaciones para todos. Se renuevan a medianoche de Argentina.</p>}@else{<p class="guest-note">Modo de prueba local</p>}
<div class="home-rules"><span>5 rondas</span><span>2 minutos por ubicación</span><span>Hasta 25.000 puntos</span></div><button class="start" (click)="begin()" [disabled]="busy()||dailyLoading()||(!!backend.client&&!daily())">{{busy()||dailyLoading()?'Preparando desafío…':'Jugar →'}}</button>@if(dailyMessage()){<p role="status" class="daily-message">{{dailyMessage()}}</p><button class="quiet" (click)="refreshDaily()" [disabled]="dailyLoading()">Volver a consultar</button>}
@if(daily()&&daily()!.sourceDay!==daily()!.day){<p class="guest-note">Hoy mantenemos el último desafío disponible.</p>}
<p class="home-note">Marcá tu apuesta y confirmala antes de que termine el tiempo. Si se agota, la ronda vale 0 puntos.</p>@if(!user()){<p class="guest-note">Jugás como invitado. Tu partida no se guarda en el historial.</p>}</section>
@if(user()){
<section class="history-panel" aria-labelledby="history-title"><div class="section-heading"><h2 id="history-title">Tu historial</h2><button class="quiet" (click)="refreshAccount()" [disabled]="historyLoading()">Actualizar</button></div>
@if(historyLoading()){<p role="status">Cargando historial…</p>}@else if(!historyItems().length){<p>Todavía no jugaste ninguna partida con tu cuenta.</p>}
@for(item of historyItems();track item.id){<details><summary><span>{{item.daily_day?'Desafío '+formatDay(item.daily_day)+' · ':''}}{{historyDate(item.created_at)}} · {{historyLabel(item.status)}}</span><strong>{{item.total.toLocaleString('es-AR')}} / 25.000</strong></summary><table><thead><tr><th>Ronda</th><th>Destino</th><th>Resultado</th><th>Puntos</th></tr></thead><tbody>@for(round of sortedHistoryRounds(item);track round.round_index){<tr><td>{{round.round_index+1}}</td><td>{{round.name}}</td><td>{{round.status!=='completed'?'Sin terminar':round.timed_out?'Tiempo agotado':formatDistance(round.distance)}}</td><td>{{round.points}}</td></tr>}</tbody></table></details>}
</section>
}
@if(catalogAdmin()){
<section class="catalog-panel"><h2>Administrar catálogo</h2><p>Revisá lotes de 10 candidatos. Solo los puntos con Street View navegable entran al sorteo. Esta revisión consulta Google Maps.</p><button (click)="validateCatalog()" [disabled]="catalogChecking()">{{catalogChecking()?'Validando…':'Validar 10 ubicaciones'}}</button>@if(catalogMessage()){<p role="status">{{catalogMessage()}}</p>}</section>
}
}@else{
<section class="intro"><div><p class="eyebrow">UN PAÍS. MILES DE CAMINOS.</p><h1>¿Dónde estás?</h1><p>Explorá, buscá pistas y marcá tu destino.</p><button class="start" (click)="begin()">{{connected() ? 'Volver a la partida →' : 'Reintentar →'}}</button>@if(!connected()){<button class="quiet" (click)="goHome()">Volver al inicio</button>}</div><div class="stats"><div><small>RONDA</small><strong>{{game.index+1}} <span>/ 5</span></strong></div><div><small>PUNTAJE</small><strong>{{game.total.toLocaleString('es-AR')}} <span>/ 25.000</span></strong></div></div></section>
@if(error()){<div class="error" role="alert">{{error()}}@if(roundSaveFailed()){<button (click)="submit()" [disabled]="submitting()">Reintentar guardar ronda</button>}</div>}
<div class="workspace"><div class="gamehud"><span>{{gameDay()?formatDay(gameDay()!)+' · ':''}}Ronda {{game.index+1}} / 5 · {{game.total.toLocaleString('es-AR')}} puntos</span><span class="timer" [class.urgent]="remaining()<=20 && !game.revealed" role="timer" aria-label="Tiempo restante">{{busy() ? 'Cargando…' : timeLabel()}}</span><button (click)="leave()">Salir de la vista de juego ✕</button></div><section class="explore"><div class="panelbar"><span class="live">● {{connected()?'STREET VIEW':busy()?'CARGANDO STREET VIEW':'STREET VIEW NO DISPONIBLE'}}</span><span>Single player</span></div><div class="viewer" id="panorama" [class.inactive]="!connected()"></div>
@if(!connected()){<div class="practice"><span class="compass">◈</span><p class="eyebrow">EXPLORÁ ARGENTINA</p><h2>Street View no está disponible</h2><p>Se necesita una conexión válida con Google Maps para jugar.</p></div>}
@if(busy()){<div class="loading" role="status">Buscando un panorama…</div>}
<div class="viewfooter"><span>{{game.revealed?game.rounds[game.index].name:'Encontrá tu rumbo'}}</span><button class="quiet" (click)="resetView()" [disabled]="!connected()||busy()">↺ Volver al inicio</button></div></section>
<section class="mapcard" [class.expanded]="mapExpanded() || game.revealed" (mouseenter)="mapExpanded.set(true)" (mouseleave)="mapExpanded.set(false)"><div class="panelbar"><strong>Tu apuesta <span class="map-timer" [class.urgent]="remaining()<=20 && !game.revealed">{{busy() ? 'Cargando…' : timeLabel()}}</span></strong><button class="maptoggle quiet" (click)="mapExpanded.set(!mapExpanded())" [attr.aria-expanded]="mapExpanded()" aria-label="Ampliar o reducir mapa">{{mapExpanded()?'Reducir ↙':'Ampliar ↗'}}</button></div><div id="map" aria-label="Mapa para elegir una ubicación"></div><div class="mapfooter"><p>{{game.guess?'Ubicación marcada. Podés moverla antes de apostar.':'Elegí dónde creés que estás.'}}</p><button class="primary" (click)="submit()" [disabled]="!game.guess||!game.target||game.revealed||busy()||submitting()">{{submitting()?'Guardando…':'Confirmar ubicación →'}}</button></div></section></div>
@if(game.revealed){<section class="result" aria-live="polite"><div><p class="eyebrow">{{game.results[game.index].timedOut?'TIEMPO AGOTADO':game.finished?'PARTIDA COMPLETA':'RESULTADO DE LA RONDA'}}</p><h2>{{game.results[game.index].name}}</h2>@if(game.results[game.index].timedOut){<p>Se terminaron los 2 minutos. Esta ronda suma 0 puntos.</p>}@else{<p>A {{formatDistance(game.results[game.index].distance)}} del punto de inicio.</p>}</div><div><strong>+{{game.results[game.index].points.toLocaleString('es-AR')}}</strong><small>puntos de esta ronda</small></div><button (click)="game.finished?restart():next()">{{game.finished?'Jugar de nuevo ↺':'Siguiente ronda →'}}</button></section>}
@if(game.finished){<section class="summary">@if(backendGameId){<p class="saved-game">✓ Partida guardada en tu historial.</p>}@else{<p class="guest-note">Partida de invitado: no se guarda en tu historial.</p>}<button class="quiet" (click)="goHome()">Volver al inicio</button><h2>Tu recorrido · {{game.total.toLocaleString('es-AR')}} / 25.000 puntos</h2><table><thead><tr><th>Ronda</th><th>Destino</th><th>Distancia</th><th>Puntos</th></tr></thead><tbody>@for(r of game.results;track $index){<tr><td>{{$index+1}}</td><td>{{r.name}}</td><td>{{r.timedOut ? 'Tiempo agotado' : formatDistance(r.distance)}}</td><td>{{r.points.toLocaleString('es-AR')}}</td></tr>}</tbody></table></section>}
}
<footer><span>De la Puna a la Patagonia.</span><span>5 rondas · 2 minutos por ronda</span></footer></main>`})
class App implements OnDestroy {
 readonly backend=new Backend();
 user=signal<User|null>(null);displayName=signal('Jugador');historyItems=signal<GameHistory[]>([]);historyLoading=signal(false);
 accountOpen=signal(false);authMode=signal<'login'|'signup'|'reset'|'recover'>('login');authName=signal('');authEmail=signal('');authPassword=signal('');authMessage=signal('');authBusy=signal(false);accountError=signal('');
 catalogAdmin=signal(false);catalogChecking=signal(false);catalogMessage=signal('');submitting=signal(false);roundSaveFailed=signal(false);
 daily=signal<DailyChallenge|null>(null);dailyLoading=signal(false);dailyMessage=signal('');gameDay=signal<string|null>(null);private dailyRefreshTimer?:ReturnType<typeof setInterval>;
 backendGameId:string|null=null;private pendingGameRequest:string|null=null;private accountEpoch=0;
 private authSubscription?:{unsubscribe():void};private authInitialized:Promise<void>;

 started=signal(false);remaining=signal(120);private timer?:ReturnType<typeof setInterval>;
 playing=signal(false);mapExpanded=signal(false);private resizeObserver?:ResizeObserver;game=new Game();connected=signal(false);busy=signal(false);error=signal('');private map!:L.Map;private pins=L.layerGroup();private panorama?:google.maps.StreetViewPanorama;private service?:google.maps.StreetViewService;private startPano='';private request=0;private destroyed=false;private script?:HTMLScriptElement;private authFailed=false;
 constructor(private zone:NgZone,private cdr:ChangeDetectorRef){this.authInitialized=this.initializeAuth();
  if(this.backend.client){void this.refreshDaily();this.dailyRefreshTimer=setInterval(()=>{if(!this.started()&&document.visibilityState==='visible'&&this.daily()?.day!==this.argentinaDay())void this.refreshDaily();},60000);}
 }
 private async initializeAuth(){
  const client=this.backend.client;if(!client)return;
  const {data}=client.auth.onAuthStateChange((event,session)=>{
   this.user.set(session?.user??null);this.historyItems.set([]);this.catalogAdmin.set(false);this.accountEpoch++;
   if(event==='PASSWORD_RECOVERY'){this.authMode.set('recover');this.accountOpen.set(true);}
   if(session?.user)setTimeout(()=>{void this.refreshAccount();},0);
  });
  this.authSubscription=data.subscription;
  const {data:session,error}=await client.auth.getSession();
  if(error)this.accountError.set('No se pudo recuperar tu sesión. Volvé a ingresar.');
  else this.user.set(session.session?.user??null);
 }
 inputValue(event:Event){return (event.target as HTMLInputElement).value;}
 openAccount(mode:'login'|'signup'|'reset'){this.authMode.set(mode);this.authPassword.set('');this.authMessage.set('');this.accountOpen.set(true);}
 async signInWithGoogle(){
  const client=this.backend.client;if(!client||this.authBusy())return;
  this.authBusy.set(true);this.authMessage.set('');this.authPassword.set('');
  try{
   const {error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:window.location.origin+'/'}});
   if(error)throw error;
  }catch{this.authMessage.set('No se pudo iniciar sesión con Google. Volvé a intentar.');}
  finally{this.authBusy.set(false);}
 }
 async authenticate(event:Event){
  event.preventDefault();if(this.authBusy()||!this.backend.client)return;
  const client=this.backend.client;this.authBusy.set(true);this.authMessage.set('');
  try{
   const email=this.authEmail().trim(),password=this.authPassword();
   if(this.authMode()==='signup'){
    const {data,error}=await client.auth.signUp({email,password,options:{data:{display_name:this.authName().trim()},emailRedirectTo:window.location.origin+'/'}});
    if(error)throw error;
    if(data.session)this.accountOpen.set(false);else this.authMessage.set('Revisá tu correo para confirmar la cuenta.');
   }else if(this.authMode()==='reset'){
    const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin+'/'});if(error)throw error;
    this.authMessage.set('Si existe una cuenta con ese correo, recibirás un enlace para recuperar la contraseña.');
   }else if(this.authMode()==='recover'){
    const {error}=await client.auth.updateUser({password});if(error)throw error;
    this.authMessage.set('Contraseña actualizada. Ya podés jugar.');
   }else{
    const {error}=await client.auth.signInWithPassword({email,password});if(error)throw error;
    this.accountOpen.set(false);
   }
  }catch{this.authMessage.set('No se pudo completar la operación. Revisá los datos y volvé a intentar.');}
  finally{this.authPassword.set('');this.authBusy.set(false);}
 }
 async signOut(){
  if(!this.backend.client||this.authBusy()||this.catalogChecking())return;
  this.authBusy.set(true);
  const {error}=await this.backend.client.auth.signOut({scope:'local'});
  if(error)this.accountError.set('No se pudo cerrar la sesión. Volvé a intentar.');else this.goHome();
  this.authBusy.set(false);
 }
 async refreshAccount(){
  if(!this.user()||!this.backend.client)return;
  const epoch=++this.accountEpoch;
  this.historyLoading.set(true);this.accountError.set('');
  const [history,name,admin]=await Promise.allSettled([this.backend.history(),this.backend.displayName(),this.backend.isAdmin()]);
  if(epoch!==this.accountEpoch||!this.user())return;
  if(history.status==='fulfilled')this.historyItems.set(history.value);else this.accountError.set('No se pudo cargar tu historial. Podés volver a intentar.');
  if(name.status==='fulfilled')this.displayName.set(name.value);
  if(admin.status==='fulfilled')this.catalogAdmin.set(admin.value);
  this.historyLoading.set(false);
 }
 sortedHistoryRounds(item:GameHistory){return [...item.game_rounds].sort((a,b)=>a.round_index-b.round_index);}
 historyDate(value:string){return new Date(value).toLocaleString('es-AR',{dateStyle:'short',timeStyle:'short'});}
 historyLabel(value:string){return value==='completed'?'Completada':value==='abandoned'?'Sin terminar':'En curso';}
 async validateCatalog(){
  if(!this.catalogAdmin()||this.catalogChecking())return;
  this.catalogChecking.set(true);this.catalogMessage.set('Buscando candidatos…');
  try{
   const key=GOOGLE_MAPS_API_KEY.trim();if(!key)throw new Error('Sin clave');
   await this.loadGoogle(key);const service=new google.maps.StreetViewService();
   const batch=await this.backend.reviewBatch();let validated=0,unavailable=0;
   for(let index=0;index<batch.length;index++){
    if(this.destroyed)return;
    this.catalogMessage.set(`Validando ${index+1} de ${batch.length}…`);
    const found=await findNavigablePanorama(request=>service.getPanorama(request),[batch[index]],()=>!this.destroyed);
    if(this.destroyed)return;
    await this.backend.validateLocation(batch[index].id,!!found);
    if(found)validated++;else unavailable++;
   }
   this.catalogMessage.set(`${validated} ubicaciones navegables, ${unavailable} sin cobertura. Lote terminado.`);
  }catch{this.catalogMessage.set('No se pudo completar la revisión. Comprobá la conexión y el acceso a Google Maps; las ubicaciones pendientes no se habilitaron.');}
  finally{this.catalogChecking.set(false);}
 }
 argentinaDay(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
 formatDay(day:string){const [year,month,date]=day.split('-');return `${date}/${month}/${year}`;}
 async refreshDaily(){
  if(!this.backend.client||this.dailyLoading())return;
  this.dailyLoading.set(true);this.dailyMessage.set('');
  try{const daily=await this.backend.daily();this.daily.set(daily);if(!daily)this.dailyMessage.set('El desafío diario se está preparando. Volvé a consultar en unos minutos.');}
  catch{this.dailyMessage.set('No se pudo consultar el desafío diario. Volvé a intentar.');}
  finally{this.dailyLoading.set(false);}
 }
 private async prepareGame(){
  await this.authInitialized;
  if(!this.backend.client){const day=this.argentinaDay();this.game=new Game(demoDailyRounds(day));this.gameDay.set(day);return;}
  if(this.user()){
   if(this.backendGameId)return;
   this.pendingGameRequest??=crypto.randomUUID();
   const created=await this.backend.createGame(this.pendingGameRequest);
   if(created.status!=='playing'||created.locations.length!==5)throw new Error('Partida no disponible');
   this.game=new Game(created.locations);this.gameDay.set(created.day);this.backendGameId=created.id;
  }else{
   const challenge=await this.backend.daily();
   if(!challenge||challenge.locations.length!==5)throw new Error('El desafío diario todavía se está preparando');
   this.daily.set(challenge);this.game=new Game(challenge.locations);this.gameDay.set(challenge.day);
  }
 }
 goHome(){
  this.stopTimer();this.request++;this.resizeObserver?.disconnect();this.map?.remove();this.pins.clearLayers();
  if(this.panorama){google.maps.event.clearInstanceListeners(this.panorama);this.panorama.setVisible(false);}
  this.panorama=undefined;this.service=undefined;this.connected.set(false);this.started.set(false);this.leave();
  this.backendGameId=null;this.pendingGameRequest=null;this.gameDay.set(null);this.game=new Game();this.error.set('');this.roundSaveFailed.set(false);this.remaining.set(120);this.cdr.detectChanges();window.scrollTo(0,0);
  if(this.user())void this.refreshAccount();
 }

 private initializeMap(){this.map=L.map('map').setView([-38.5,-64],4);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',maxZoom:19}).addTo(this.map);this.pins.addTo(this.map);this.map.on('click',(e:L.LeafletMouseEvent)=>this.zone.run(()=>{if(this.game.revealed||this.busy()||this.submitting()||this.roundSaveFailed()||this.checkTime())return;this.game.guess={lat:e.latlng.lat,lng:e.latlng.lng};this.draw();this.cdr.markForCheck();}));this.game.target=null;this.resizeObserver=new ResizeObserver(()=>{this.map.invalidateSize({pan:false});if(this.game.revealed)this.draw();if(this.panorama)google.maps.event.trigger(this.panorama,'resize');});this.resizeObserver.observe(document.getElementById('map')!);this.resizeObserver.observe(document.getElementById('panorama')!);}
 begin(){
  if(this.busy()||this.authBusy()||this.catalogChecking()||this.game.finished)return;
  this.accountOpen.set(false);
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
  if(this.backendGameId){
   if(this.remaining()===0&&!this.game.revealed&&!this.submitting()&&!this.roundSaveFailed()){this.stopTimer();void this.submit();}
   return this.game.revealed||this.remaining()===0;
  }
  if(this.game.expire()){this.finishRound();return true;}
  return this.game.revealed;
 }
 private finishRound(){this.stopTimer();if(this.game.finished){this.leave();if(this.user())void this.refreshAccount();}this.draw();this.cdr.markForCheck();}

 leave(){this.playing.set(false);document.body.style.overflow='';}
 async connect(key:string){if(this.busy()||this.connected())return;this.authFailed=false;this.busy.set(true);this.error.set('');try{await this.loadGoogle(key);if(this.authFailed)throw new Error('auth');if(this.destroyed)return;this.service=new google.maps.StreetViewService();this.panorama=new google.maps.StreetViewPanorama(document.getElementById('panorama')!,{addressControl:false,showRoadLabels:false,linksControl:true,fullscreenControl:false,enableCloseButton:false,motionTracking:false});await this.prepareGame();this.connected.set(true);this.clear();await this.loadRound();if(this.connected())this.begin();}catch(problem){this.error.set(problem instanceof Error&&this.backend.client&&this.user()&&!this.connected()?problem.message:this.authFailed?'Google rechazó la clave. Revisá Maps JavaScript API, facturación y dominios autorizados.':'No se pudo iniciar Google Maps. Revisá GOOGLE_MAPS_API_KEY, las restricciones de la clave, la facturación y tu conexión.');this.stopTimer();this.connected.set(false);this.game.target=null;}finally{this.busy.set(false);}}
 private loadGoogle(key:string):Promise<void>{if(window.google?.maps)return Promise.resolve();return new Promise((resolve,reject)=>{let settled=false;const finish=(err?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);delete (window as any).__rumboMaps;if(err){this.script?.remove();reject(err);}else resolve();};const timer=setTimeout(()=>finish(new Error('timeout')),20000);(window as any).__rumboMaps=()=>finish();(window as any).gm_authFailure=()=>this.zone.run(()=>{this.authFailed=true;this.stopTimer();this.connected.set(false);this.game.target=null;this.busy.set(false);this.leave();finish(new Error('auth'));if(settled)this.error.set('Google rechazó la clave. Revisá Maps JavaScript API, facturación y dominios autorizados.');});this.script=document.createElement('script');this.script.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(key)+'&callback=__rumboMaps&loading=async&v=quarterly&language=es&region=AR';this.script.onerror=()=>finish(new Error('network'));document.head.appendChild(this.script);});}
 async loadRound(){
  this.stopTimer();this.remaining.set(120);
  const id=++this.request;
  const isCurrent=()=>id===this.request&&!this.destroyed&&!this.authFailed;
  this.busy.set(true);this.error.set('');this.game.target=null;
  const place=this.game.rounds[this.game.index];

  try{
   const pinned=(place as Partial<DailyLocation>).panoId;
   let found;
   if(pinned){
    const {data}=await this.service!.getPanorama({pano:pinned});
    const location=navigableLocation(data);
    if(!location||location.pano!==pinned)throw new Error('Panorama diario no disponible');
    found={place,...location};
   }else found=await findNavigablePanorama(request=>this.service!.getPanorama(request),[place],isCurrent);
   if(!isCurrent())return;
   if(!found)throw new Error('Sin panorama navegable');
   if(this.backendGameId){
    const timing=await this.backend.startRound(this.backendGameId,this.game.index,found.target,found.pano);
    if(!isCurrent())return;
    this.game.deadline=Date.now()+Math.max(0,Date.parse(timing.deadline)-Date.parse(timing.serverNow));
   }
   this.game.rounds[this.game.index]=found.place;
   this.game.target=found.target;this.startPano=found.pano;
   this.panorama!.setPano(this.startPano);
   this.panorama!.setPov({heading:Math.random()*360,pitch:0});
   this.panorama!.setVisible(true);this.startTimer();
  }catch{
   if(!isCurrent())return;
   this.error.set('No se pudo cargar esta ubicación del desafío diario. Volvé a intentar en unos momentos.');
   this.panorama?.setVisible(false);this.connected.set(false);this.game.target=null;this.leave();
  }finally{if(id===this.request)this.busy.set(false);}
 }
 resetView(){if(this.startPano)this.panorama?.setPano(this.startPano);}
 draw(){this.pins.clearLayers();if(this.game.guess)L.circleMarker(this.game.guess,{radius:8,color:'#fff',weight:3,fillColor:'#126e72',fillOpacity:1}).bindTooltip('Tu apuesta').addTo(this.pins);if(this.game.revealed&&this.game.target){L.circleMarker(this.game.target,{radius:8,color:'#fff',weight:3,fillColor:'#ea9049',fillOpacity:1}).bindTooltip('Ubicación real').addTo(this.pins);if(this.game.guess){L.polyline([this.game.guess,this.game.target],{color:'#ea9049',dashArray:'7,7'}).addTo(this.pins);this.map.fitBounds(L.latLngBounds([this.game.guess,this.game.target]),{padding:[35,35],maxZoom:14});}else this.map.setView(this.game.target,12);}}
 async submit(){
  if(!this.connected()||this.busy()||this.submitting()||this.game.revealed)return;
  if(!this.backendGameId){if(this.checkTime())return;this.game.submit();if(this.game.revealed)this.finishRound();return;}
  if(!this.game.guess&&this.game.remainingSeconds()>0)return;
  this.submitting.set(true);this.roundSaveFailed.set(false);this.error.set('');
  const id=this.request,index=this.game.index;
  try{
   const result=await this.backend.finishRound(this.backendGameId,index,this.game.guess);
   if(id!==this.request||this.destroyed)return;
   this.game.results.push({name:result.name,distance:result.distance,points:result.points,timedOut:result.timedOut});
   if(result.timedOut)this.remaining.set(0);
   this.finishRound();
  }catch{
   if(id!==this.request||this.destroyed)return;
   this.roundSaveFailed.set(true);this.error.set('No se pudo guardar la ronda. Tu apuesta se conserva; volvé a intentar. El reloj sigue corriendo.');
  }finally{this.submitting.set(false);}
 }
 clear(){this.pins.clearLayers();this.map.setView([-38.5,-64],4);}
 next(){if(!this.game.revealed||this.game.finished)return;this.mapExpanded.set(false);this.game.next();this.clear();if(this.connected())void this.loadRound();else this.game.target=null;}
 restart(){this.goHome();this.begin();}
 formatDistance(km:number|null){if(km===null)return 'Sin apuesta';return km<1?Math.round(km*1000)+' m':km.toLocaleString('es-AR',{maximumFractionDigits:1})+' km';}
 ngOnDestroy(){this.authSubscription?.unsubscribe();if(this.dailyRefreshTimer)clearInterval(this.dailyRefreshTimer);this.stopTimer();this.destroyed=true;this.resizeObserver?.disconnect();document.body.style.overflow='';this.request++;this.map?.remove();this.panorama?.setVisible(false);if(this.panorama)google.maps.event.clearInstanceListeners(this.panorama);delete (window as any).gm_authFailure;}
}
bootstrapApplication(App).catch(console.error);
