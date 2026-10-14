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
<section class="home daily-landing" aria-labelledby="home-title"><div class="landing-copy"><p class="eyebrow">UN PAÍS. UN NUEVO DESAFÍO CADA DÍA.</p><h1 id="home-title">Argentina te espera.<br>Encontrá tu rumbo.</h1><p class="home-description">Cinco lugares, miles de pistas. Explorá calles y caminos de nuestro país y descubrí dónde estás.</p><div class="landing-steps"><p><span>01</span> Explorá el lugar en Street View.</p><p><span>02</span> Marcá tu ubicación en el mapa.</p><p><span>03</span> Descubrí qué tan cerca estuviste.</p></div></div><div class="daily-card"><div class="home-compass" aria-hidden="true">◈</div><p class="eyebrow">DESAFÍO DIARIO</p><h2>{{formatDay(daily()?.day??argentinaDay())}}</h2><p>Las mismas cinco ubicaciones para todos.<br>Un intento para encontrar tu rumbo.</p><div class="home-rules"><span>5 rondas</span><span>2 minutos por ronda</span><span>25.000 puntos</span></div>
@if(completedDaily()){<p class="completed-badge">✓ Desafío completado</p><p class="daily-score">{{completedDaily()!.total.toLocaleString('es-AR')}} <span>/ 25.000 puntos</span></p><button class="start" (click)="reviewDaily()">Ver mi puntaje →</button>}
@else if(dailyAttempt()?.status==='abandoned'){<p class="daily-message">Ya utilizaste tu intento de hoy.</p>}
@else{<button class="start" (click)="begin()" [disabled]="busy()||dailyLoading()||attemptLoading()||authBusy()||(!!backend.client&&!daily())|| (!!user()&&!!attemptError())">{{busy()||dailyLoading()||attemptLoading()?'Preparando desafío…':dailyAttempt()?.status==='playing'?'Continuar desafío →':'Jugar desafío →'}}</button>}
@if(attemptError()){<p role="status" class="daily-message">{{attemptError()}}</p><button class="quiet" (click)="refreshAttempt()">Volver a consultar mi intento</button>}
@if(dailyMessage()){<p role="status" class="daily-message">{{dailyMessage()}}</p><button class="quiet" (click)="refreshDaily()" [disabled]="dailyLoading()">Volver a consultar</button>}
@if(daily()&&daily()!.sourceDay!==daily()!.day){<p class="guest-note">Hoy mantenemos el último desafío disponible.</p>}
<p class="home-note">Si se agota el tiempo, la ronda suma 0 puntos.<br>Nuevo desafío a medianoche de Argentina.</p>@if(!user()){<p class="guest-note">Tu resultado de invitado queda en este navegador. Ingresá para guardarlo en tu cuenta.</p>}@if(!backend.client){<p class="guest-note">Modo de prueba local</p>}</div></section>
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
@if(finalResults()){
<section class="final-result" aria-labelledby="final-title"><p class="eyebrow">DESAFÍO COMPLETADO · {{gameDay()?formatDay(gameDay()!):''}}</p><h1 id="final-title" tabindex="-1">Tu recorrido por Argentina.</h1><p class="final-score">{{game.total.toLocaleString('es-AR')}}<span>/ 25.000 puntos</span></p><p>Completaste las cinco ubicaciones del desafío.</p><div class="score-track" aria-hidden="true"><span [style.width.%]="game.total/250"></span></div>@if(backendGameId){<p class="saved-game">✓ Partida guardada en tu historial.</p>}@else{<p class="guest-note">Partida de invitado: no se guarda en tu historial.</p>}<div class="recap">@for(r of game.results;track $index){<div class="recap-row"><span class="round-number">{{$index+1}}</span><div><strong>{{r.name}}</strong><small>{{r.timedOut?'Tiempo agotado':formatDistance(r.distance)+' del punto de inicio'}}</small></div><strong>{{r.points.toLocaleString('es-AR')}} <small>pts</small></strong></div>}</div><div class="result-actions"><button class="quiet" (click)="goHome()">Volver al inicio</button></div><p class="guest-note">Ya completaste tu intento. Volvé mañana para un nuevo desafío.</p></section>
}

@if(error()){<div class="error" role="alert">{{error()}}@if(roundSaveFailed()){<button (click)="submit()" [disabled]="submitting()">Reintentar guardar ronda</button>}</div>}
@if(game.revealed&&!finalResults()){<section class="round-result" aria-labelledby="round-result-title"><p class="eyebrow">RONDA {{game.index+1}} DE 5 · {{game.results[game.index].timedOut?'TIEMPO AGOTADO':'UBICACIÓN CONFIRMADA'}}</p><h1 id="round-result-title" tabindex="-1">{{game.results[game.index].name}}</h1><p class="round-score">+{{game.results[game.index].points.toLocaleString('es-AR')}}<span>puntos de esta ronda / 5.000</span></p><p>@if(game.results[game.index].timedOut){Se terminaron los 2 minutos. Esta ronda suma 0 puntos.}@else{Tu apuesta quedó a <strong>{{formatDistance(game.results[game.index].distance)}}</strong> del punto de inicio.}</p><p class="result-total">Acumulado: {{game.total.toLocaleString('es-AR')}} / 25.000 puntos</p><button (click)="game.finished?showFinalResults():next()">{{game.finished?'Ver resultado final →':'Siguiente ronda →'}}</button>@if(!game.finished){<button class="quiet" (click)="goHome()">Continuar más tarde</button>}</section>}
@if(!finalResults()){
<div class="workspace" [class.round-revealed]="game.revealed" [hidden]="finalResults()"><div class="gamehud"><span>{{gameDay()?formatDay(gameDay()!)+' · ':''}}Ronda {{game.index+1}} / 5 · {{game.total.toLocaleString('es-AR')}} puntos</span><span class="timer" [class.urgent]="remaining()<=20 && !game.revealed" role="timer" aria-label="Tiempo restante">{{busy() ? 'Cargando…' : timeLabel()}}</span><button (click)="goHome()">Volver al inicio ✕</button></div><section class="explore"><div class="panelbar"><span class="live">● {{connected()?'STREET VIEW':busy()?'CARGANDO STREET VIEW':'STREET VIEW NO DISPONIBLE'}}</span><span>Single player</span></div><div class="viewer" id="panorama" [class.inactive]="!connected()"></div>
@if(!connected()){<div class="practice"><span class="compass">◈</span><p class="eyebrow">EXPLORÁ ARGENTINA</p><h2>Street View no está disponible</h2><p>Se necesita una conexión válida con Google Maps para jugar.</p><button (click)="begin()" [disabled]="busy()">Reintentar</button><button class="quiet" (click)="goHome()">Volver al inicio</button></div>}
@if(busy()){<div class="loading" role="status">Buscando un panorama…</div>}
<div class="viewfooter"><span>{{game.revealed?game.rounds[game.index].name:'Encontrá tu rumbo'}}</span><button class="quiet" (click)="resetView()" [disabled]="!connected()||busy()">↺ Volver al inicio</button></div></section>
<section class="mapcard" [class.expanded]="mapExpanded() || game.revealed" (mouseenter)="mapExpanded.set(true)" (mouseleave)="mapExpanded.set(false)"><div class="panelbar"><strong>{{game.revealed?'Tu apuesta y la ubicación real':'Tu apuesta'}} <span [hidden]="game.revealed" class="map-timer" [class.urgent]="remaining()<=20 && !game.revealed">{{busy() ? 'Cargando…' : timeLabel()}}</span></strong><button [hidden]="game.revealed" class="maptoggle quiet" (click)="mapExpanded.set(!mapExpanded())" [attr.aria-expanded]="mapExpanded()" aria-label="Ampliar o reducir mapa">{{mapExpanded()?'Reducir ↙':'Ampliar ↗'}}</button></div><div id="map" aria-label="Mapa para elegir una ubicación"></div><div class="mapfooter" [hidden]="game.revealed"><p>{{game.guess?'Ubicación marcada. Podés moverla antes de apostar.':'Elegí dónde creés que estás.'}}</p><button class="primary" (click)="submit()" [disabled]="!game.guess||!game.target||game.revealed||busy()||submitting()">{{submitting()?'Guardando…':'Confirmar ubicación →'}}</button></div></section></div>
}
@if(game.revealed&&!finalResults()){<p class="map-legend"><span>● Tu apuesta</span><span>● Ubicación real</span></p>}
}
<footer><span>De la Puna a la Patagonia.</span><span>5 rondas · 2 minutos por ronda</span></footer></main>`})
class App implements OnDestroy {
 readonly backend=new Backend();
 user=signal<User|null>(null);displayName=signal('Jugador');historyItems=signal<GameHistory[]>([]);historyLoading=signal(false);
 accountOpen=signal(false);authMode=signal<'login'|'signup'|'reset'|'recover'>('login');authName=signal('');authEmail=signal('');authPassword=signal('');authMessage=signal('');authBusy=signal(false);accountError=signal('');
 catalogAdmin=signal(false);catalogChecking=signal(false);catalogMessage=signal('');submitting=signal(false);roundSaveFailed=signal(false);
 dailyAttempt=signal<GameHistory|null>(null);attemptLoading=signal(false);attemptError=signal('');private attemptEpoch=0;
 daily=signal<DailyChallenge|null>(null);dailyLoading=signal(false);dailyMessage=signal('');gameDay=signal<string|null>(null);private dailyRefreshTimer?:ReturnType<typeof setInterval>;
 backendGameId:string|null=null;private pendingGameRequest:string|null=null;private accountEpoch=0;
 private authSubscription?:{unsubscribe():void};private authInitialized:Promise<void>;

 finalResults=signal(false);started=signal(false);remaining=signal(120);private timer?:ReturnType<typeof setInterval>;
 playing=signal(false);mapExpanded=signal(false);private resizeObserver?:ResizeObserver;game=new Game();connected=signal(false);busy=signal(false);error=signal('');private map!:L.Map;private pins=L.layerGroup();private panorama?:google.maps.StreetViewPanorama;private service?:google.maps.StreetViewService;private startPano='';private request=0;private destroyed=false;private script?:HTMLScriptElement;private authFailed=false;
 constructor(private zone:NgZone,private cdr:ChangeDetectorRef){this.authInitialized=this.initializeAuth();
  if(!this.backend.client)void this.refreshAttempt();
  if(this.backend.client){void this.refreshDaily();this.dailyRefreshTimer=setInterval(()=>{if(!this.started()&&document.visibilityState==='visible'&&this.daily()?.day!==this.argentinaDay())void this.refreshDaily();},60000);}
 }
 private async initializeAuth(){
  const client=this.backend.client;if(!client)return;
  const {data}=client.auth.onAuthStateChange((event,session)=>{
   this.user.set(session?.user??null);this.historyItems.set([]);this.catalogAdmin.set(false);this.accountEpoch++;this.dailyAttempt.set(null);this.attemptEpoch++;this.attemptLoading.set(!!session?.user);
   void this.refreshAttempt();
   if(event==='PASSWORD_RECOVERY'){this.authMode.set('recover');this.accountOpen.set(true);}
   if(session?.user)setTimeout(()=>{void this.refreshAccount();},0);
  });
  this.authSubscription=data.subscription;
  const {data:session,error}=await client.auth.getSession();
  if(error)this.accountError.set('No se pudo recuperar tu sesión. Volvé a ingresar.');
  else this.user.set(session.session?.user??null);
  await this.refreshAttempt();
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
  try{const daily=await this.backend.daily();this.daily.set(daily);await this.refreshAttempt();if(!daily)this.dailyMessage.set('El desafío diario se está preparando. Volvé a consultar en unos minutos.');}
  catch{this.dailyMessage.set('No se pudo consultar el desafío diario. Volvé a intentar.');}
  finally{this.dailyLoading.set(false);}
 }
 completedDaily(){return this.dailyAttempt()?.status==='completed'?this.dailyAttempt():null;}
 private guestResult(day:string):GameHistory|null{
  try{const value=JSON.parse(localStorage.getItem('rumbo-daily-result:'+day)??'null');return value?.daily_day===day&&value.status==='completed'&&value.game_rounds?.length===5?value:null;}catch{return null;}
 }
 async refreshAttempt(){
  const epoch=++this.attemptEpoch,day=this.daily()?.day??this.argentinaDay();
  this.attemptLoading.set(true);this.attemptError.set('');
  try{const result=this.user()&&this.backend.client?await this.backend.dailyAttempt(day):this.guestResult(day);if(epoch===this.attemptEpoch)this.dailyAttempt.set(result);}
  catch{if(epoch===this.attemptEpoch){this.dailyAttempt.set(null);this.attemptError.set('No pudimos consultar tu intento de hoy. Volvé a intentar.');}}
  finally{if(epoch===this.attemptEpoch)this.attemptLoading.set(false);}
 }
 reviewDaily(){
  const result=this.completedDaily();if(!result)return;
  this.goHome();this.game=new Game();this.game.results=this.sortedHistoryRounds(result).map(round=>({name:round.name,distance:round.distance,points:round.points,timedOut:round.timed_out}));this.game.index=4;this.gameDay.set(result.daily_day);this.backendGameId=this.user()?result.id:null;this.started.set(true);this.finalResults.set(true);this.cdr.detectChanges();this.focusResult('final-title');
 }
 private async prepareGame(){
  await this.authInitialized;
  if(!this.backend.client){const day=this.argentinaDay();this.game=new Game(demoDailyRounds(day));this.gameDay.set(day);return;}
  if(this.user()){
   if(this.backendGameId)return;
   this.pendingGameRequest??=crypto.randomUUID();
   const created=await this.backend.createGame(this.pendingGameRequest);
   if(created.status!=='playing'||created.locations.length!==5)throw new Error('Partida no disponible');
   this.game=new Game(created.locations);this.game.results=created.results??[];this.game.index=this.game.results.length;this.gameDay.set(created.day);this.backendGameId=created.id;
  }else{
   const challenge=await this.backend.daily();
   if(!challenge||challenge.locations.length!==5)throw new Error('El desafío diario todavía se está preparando');
   this.daily.set(challenge);this.game=new Game(challenge.locations);this.gameDay.set(challenge.day);
  }
 }
 goHome(){
  this.stopTimer();this.request++;this.disposeGameViews();this.started.set(false);this.leave();
  this.finalResults.set(false);this.backendGameId=null;this.pendingGameRequest=null;this.gameDay.set(null);this.game=new Game();this.error.set('');this.roundSaveFailed.set(false);this.remaining.set(120);this.cdr.detectChanges();window.scrollTo(0,0);
  if(this.user())void this.refreshAccount();void this.refreshAttempt();
 }

 private disposeGameViews(){
  this.resizeObserver?.disconnect();this.map?.remove();this.map=undefined!;this.pins.clearLayers();
  if(this.panorama){google.maps.event.clearInstanceListeners(this.panorama);this.panorama.setVisible(false);}
  this.panorama=undefined;this.service=undefined;this.connected.set(false);
 }
 private initializeMap(){this.map=L.map('map').setView([-38.5,-64],4);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',maxZoom:19}).addTo(this.map);this.pins.addTo(this.map);this.map.on('click',(e:L.LeafletMouseEvent)=>this.zone.run(()=>{if(this.game.revealed||this.busy()||this.submitting()||this.roundSaveFailed()||this.checkTime())return;this.game.guess={lat:e.latlng.lat,lng:e.latlng.lng};this.draw();this.cdr.markForCheck();}));this.game.target=null;this.resizeObserver=new ResizeObserver(()=>{this.map.invalidateSize({pan:false});if(this.game.revealed)this.draw();if(this.panorama)google.maps.event.trigger(this.panorama,'resize');});this.resizeObserver.observe(document.getElementById('map')!);this.resizeObserver.observe(document.getElementById('panorama')!);}
 begin(){
  if(this.busy()||this.authBusy()||this.catalogChecking()||this.game.revealed||this.attemptLoading()||this.completedDaily()||this.dailyAttempt()?.status==='abandoned'||(this.user()&&this.attemptError()))return;
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
 private finishRound(){
  this.stopTimer();this.leave();this.panorama?.setVisible(false);
  if(this.game.finished){
   const result:GameHistory={id:this.backendGameId??'guest',daily_day:this.gameDay(),status:'completed',total:this.game.total,created_at:new Date().toISOString(),game_rounds:this.game.results.map((r,index)=>({round_index:index,name:r.name,status:'completed',distance:r.distance,points:r.points,timed_out:r.timedOut}))};
   this.dailyAttempt.set(result);
   if(this.backendGameId){if(this.user())void this.refreshAccount();}else{try{localStorage.setItem('rumbo-daily-result:'+this.gameDay(),JSON.stringify(result));}catch{}}
  }
  this.cdr.detectChanges();this.map.invalidateSize({pan:false});this.draw();this.focusResult('round-result-title');
 }
 private focusResult(id:string){window.scrollTo(0,0);document.getElementById(id)?.focus({preventScroll:true});}
 showFinalResults(){if(!this.game.finished)return;this.disposeGameViews();this.finalResults.set(true);this.cdr.detectChanges();this.focusResult('final-title');}

 leave(){this.playing.set(false);document.body.style.overflow='';}
 async connect(key:string){if(this.busy()||this.connected())return;this.authFailed=false;this.busy.set(true);this.error.set('');try{await this.loadGoogle(key);if(this.authFailed)throw new Error('auth');if(this.destroyed)return;this.service=new google.maps.StreetViewService();this.panorama=new google.maps.StreetViewPanorama(document.getElementById('panorama')!,{addressControl:false,showRoadLabels:false,linksControl:true,fullscreenControl:false,enableCloseButton:false,motionTracking:false});await this.prepareGame();this.connected.set(true);this.clear();await this.loadRound();if(this.connected()&&!this.game.revealed){this.playing.set(true);document.body.style.overflow='hidden';}}catch(problem){this.error.set(problem instanceof Error&&this.backend.client&&this.user()&&!this.connected()?problem.message:this.authFailed?'Google rechazó la clave. Revisá Maps JavaScript API, facturación y dominios autorizados.':'No se pudo iniciar Google Maps. Revisá GOOGLE_MAPS_API_KEY, las restricciones de la clave, la facturación y tu conexión.');this.stopTimer();this.connected.set(false);this.game.target=null;}finally{this.busy.set(false);}}
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
 next(){if(!this.game.revealed||this.game.finished)return;this.mapExpanded.set(false);this.game.next();this.playing.set(true);document.body.style.overflow='hidden';this.cdr.detectChanges();this.map.invalidateSize({pan:false});this.clear();if(this.connected())void this.loadRound();else this.game.target=null;}
 formatDistance(km:number|null){if(km===null)return 'Sin apuesta';return km<1?Math.round(km*1000)+' m':km.toLocaleString('es-AR',{maximumFractionDigits:1})+' km';}
 ngOnDestroy(){this.authSubscription?.unsubscribe();if(this.dailyRefreshTimer)clearInterval(this.dailyRefreshTimer);this.stopTimer();this.destroyed=true;this.resizeObserver?.disconnect();document.body.style.overflow='';this.request++;this.map?.remove();this.panorama?.setVisible(false);if(this.panorama)google.maps.event.clearInstanceListeners(this.panorama);delete (window as any).gm_authFailure;}
}
bootstrapApplication(App).catch(console.error);
