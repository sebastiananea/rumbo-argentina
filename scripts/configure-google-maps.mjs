import {writeFile} from 'node:fs/promises';

const apiKey = process.env.GOOGLE_MAPS_API_KEY ?? '';
const supabaseUrl = (process.env.SUPABASE_URL ?? '').trim().replace(/\/$/, '');
const supabaseKey = (process.env.SUPABASE_PUBLISHABLE_KEY ?? '').trim();
// Only a publishable/anon key belongs in frontend JavaScript.
let role;
try { role = JSON.parse(Buffer.from(supabaseKey.split('.')[1] ?? '', 'base64url').toString()).role; } catch {}
if (supabaseKey.startsWith('sb_secret_') || role === 'service_role') {
 throw new Error('SUPABASE_PUBLISHABLE_KEY must be a public publishable/anon key, never a service-role key.');
}
if (Boolean(supabaseUrl) !== Boolean(supabaseKey)) throw new Error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY together.');
if (supabaseUrl && !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl) && !/^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(supabaseUrl)) {
 throw new Error('SUPABASE_URL must be a Supabase project URL or a local development URL.');
}
const config = `export const GOOGLE_MAPS_API_KEY = ${JSON.stringify(apiKey)};\nexport const SUPABASE_URL = ${JSON.stringify(supabaseUrl)};\nexport const SUPABASE_PUBLISHABLE_KEY = ${JSON.stringify(supabaseKey)};\n`;

await writeFile(new URL('../src/google-maps-config.ts', import.meta.url), config, 'utf8');
