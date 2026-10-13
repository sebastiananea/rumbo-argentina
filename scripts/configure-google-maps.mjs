import {writeFile} from 'node:fs/promises';

const apiKey = process.env.GOOGLE_MAPS_API_KEY ?? '';
const config = `export const GOOGLE_MAPS_API_KEY = ${JSON.stringify(apiKey)};\n`;

await writeFile(new URL('../src/google-maps-config.ts', import.meta.url), config, 'utf8');
