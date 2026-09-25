import {access,readFile} from 'node:fs/promises';
const required=['netlify.toml','site/index.html','site/offerta.html','site/configurazione.html','site/config/companyConfig.js','site/offer-app.js','site/seed-data.json','netlify/functions/api.mjs'];
for(const file of required)await access(new URL('../'+file,import.meta.url));
const seed=JSON.parse(await readFile(new URL('../site/seed-data.json',import.meta.url),'utf8'));
if(!Array.isArray(seed.articles)||!Array.isArray(seed.clients))throw new Error('Archivio offline non valido');
console.log(`Pacchetto valido: ${seed.articles.length} articoli, ${seed.clients.length} clienti, configurazione e API verificate`);

