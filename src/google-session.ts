import type {Session} from '@supabase/supabase-js';
/** UI gate only. PostgreSQL independently checks the JWT verified by Supabase. */
export function isGoogleSession(session:Session|null):boolean {
 if(!session)return false;
 const metadata=session.user.app_metadata;
 if(metadata.provider!=='google'&&!metadata.providers?.includes('google'))return false;
 try{const encoded=session.access_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');const claims=JSON.parse(atob(encoded));return Array.isArray(claims.amr)&&claims.amr.some((method:{method?:string})=>method.method==='oauth');}catch{return false;}
}
