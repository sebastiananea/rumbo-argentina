import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import type {Place, Point, RoundResult} from './game';
import {SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY} from './google-maps-config';

export interface CatalogPlace extends Place {id:string; region:string; kind:'city'|'town'|'road'}
export interface DailyLocation extends CatalogPlace {panoId:string}
export interface DailyChallenge {id:string;day:string;sourceDay:string;locations:DailyLocation[]}
export interface GameHistory {
 id:string; daily_day:string|null; status:'playing'|'completed'|'abandoned'; total:number; created_at:string;
 game_rounds:{round_index:number; name:string; status:string; distance:number|null; points:number; timed_out:boolean}[];
}
export interface DailyLeaderboard {day:string;participants:number;completed:number;me?:{position:number;name:string;points:number}|null;entries:{position:number;name:string;points:number;mine:boolean}[]}
export interface SavedRound extends RoundResult {finished:boolean; total:number}

export class Backend {
 readonly client:SupabaseClient|null;
 constructor(){
  this.client=SUPABASE_URL&&SUPABASE_PUBLISHABLE_KEY?createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY):null;
 }
 private requireClient(){if(!this.client)throw new Error('Las cuentas todavía no están disponibles.');return this.client;}
 private async rpc<T>(name:string,args:Record<string,unknown>={}):Promise<T>{
  const {data,error}=await this.requireClient().rpc(name,args);
  if(error)throw new Error(error.message);
  return data as T;
 }
 leaderboard(){return this.rpc<DailyLeaderboard>('get_daily_leaderboard');}
 daily(){return this.rpc<DailyChallenge|null>('get_daily_challenge');}
 createGame(requestId:string){return this.rpc<{id:string;status:string;day:string;results:RoundResult[];locations:DailyLocation[]}>('create_game',{p_request_id:requestId});}
 startRound(gameId:string,index:number,target:Point,panoId:string){return this.rpc<{deadline:string;serverNow:string}>('start_round',{p_game_id:gameId,p_index:index,p_target_lat:target.lat,p_target_lng:target.lng,p_pano_id:panoId});}
 finishRound(gameId:string,index:number,guess:Point|null){return this.rpc<SavedRound>('finish_round',{p_game_id:gameId,p_index:index,p_guess_lat:guess?.lat??null,p_guess_lng:guess?.lng??null});}
 async history():Promise<GameHistory[]>{
  const {data,error}=await this.requireClient().from('games').select('id,status,total,created_at,daily_day,game_rounds(round_index,name,status,distance,points,timed_out)').order('created_at',{ascending:false}).limit(30);
  if(error)throw new Error('No se pudo cargar tu historial.');
  return data as GameHistory[];
 }
 async dailyAttempt(day:string):Promise<GameHistory|null>{
  const {data,error}=await this.requireClient().from('games').select('id,status,total,created_at,daily_day,game_rounds(round_index,name,status,distance,points,timed_out)').eq('daily_day',day).order('created_at').limit(100);
  if(error)throw new Error('No se pudo consultar tu desafío de hoy.');
  const games=(data??[]) as GameHistory[];
  return games.find(game=>game.status==='completed')??games.find(game=>game.status==='playing')??games[0]??null;
 }
 async displayName(){
  const {data,error}=await this.requireClient().from('profiles').select('display_name').single();
  if(error)throw new Error('No se pudo cargar tu perfil.');
  return data.display_name as string;
 }
 isAdmin(){return this.rpc<boolean>('is_catalog_admin');}
 async reviewBatch(){return (await this.rpc<CatalogPlace[]>('catalog_review_batch',{p_limit:10})).map(location=>({...location,hint:''}));}
 validateLocation(id:string,navigable:boolean){return this.rpc<void>('validate_location',{p_location_id:id,p_navigable:navigable});}
}
