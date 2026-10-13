import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import type {Place, Point, RoundResult} from './game';
import {SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY} from './google-maps-config';

export interface CatalogPlace extends Place {id:string; region:string; kind:'city'|'town'|'road'}
export interface GameHistory {
 id:string; status:'playing'|'completed'|'abandoned'; total:number; created_at:string;
 game_rounds:{round_index:number; name:string; status:string; distance:number|null; points:number; timed_out:boolean}[];
}
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
 async catalog():Promise<CatalogPlace[]>{
  const {data,error}=await this.requireClient().from('locations').select('id,name,region,kind,lat,lng').eq('validation_status','active').order('id').limit(1000);
  if(error)throw new Error('No se pudo obtener el catálogo.');
  return (data??[]).map(location=>({...location,hint:''})) as CatalogPlace[];
 }
 createGame(requestId:string){return this.rpc<{id:string;status:string;locations:CatalogPlace[]}>('create_game',{p_request_id:requestId});}
 replaceLocation(gameId:string,index:number,locationId:string){return this.rpc<void>('replace_round_location',{p_game_id:gameId,p_index:index,p_location_id:locationId});}
 startRound(gameId:string,index:number,target:Point){return this.rpc<{deadline:string;serverNow:string}>('start_round',{p_game_id:gameId,p_index:index,p_target_lat:target.lat,p_target_lng:target.lng});}
 finishRound(gameId:string,index:number,guess:Point|null){return this.rpc<SavedRound>('finish_round',{p_game_id:gameId,p_index:index,p_guess_lat:guess?.lat??null,p_guess_lng:guess?.lng??null});}
 async history():Promise<GameHistory[]>{
  const {data,error}=await this.requireClient().from('games').select('id,status,total,created_at,game_rounds(round_index,name,status,distance,points,timed_out)').order('created_at',{ascending:false}).limit(30);
  if(error)throw new Error('No se pudo cargar tu historial.');
  return data as GameHistory[];
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
