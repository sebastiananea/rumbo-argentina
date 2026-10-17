import {test} from 'node:test';import assert from 'node:assert/strict';import type {Session} from '@supabase/supabase-js';import {isGoogleSession} from '../src/google-session.ts';
function session(provider:string,method:string,providers=[provider]){return {user:{app_metadata:{provider,providers}},access_token:'test.'+Buffer.from(JSON.stringify({amr:[{method}]})).toString('base64url')+'.signature'} as Session;}
test('Exige OAuth Google y admite perfiles antiguos vinculados sin aceptar contraseña',()=>{
 assert.equal(isGoogleSession(null),false);assert.equal(isGoogleSession(session('google','oauth')),true);assert.equal(isGoogleSession(session('email','oauth',['email','google'])),true);
 assert.equal(isGoogleSession(session('google','password')),false);assert.equal(isGoogleSession(session('email','password',['email','google'])),false);assert.equal(isGoogleSession(session('github','oauth')),false);
 const bad=session('google','oauth');bad.access_token='invalid';assert.equal(isGoogleSession(bad),false);
});
