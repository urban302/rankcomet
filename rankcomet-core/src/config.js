// Configuratie: pakketten en merk uit losse JSON-bestanden, geheimen alleen uit env.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const hier = path.dirname(fileURLToPath(import.meta.url));
const configMap = process.env.RC_CONFIG_DIR || path.join(hier, '..', 'config');

export function laadJson(naam) {
  return JSON.parse(readFileSync(path.join(configMap, naam), 'utf8'));
}

export function laadPakketten() {
  const p = laadJson('pakketten.json');
  for (const [id, pk] of Object.entries(p.pakketten)) {
    for (const veld of ['prijs_cent', 'max_sites', 'artikelen_per_maand', 'zoekwoorden_volgen']) {
      if (!Number.isInteger(pk[veld]) || pk[veld] < 0) throw new Error(`pakketten.json: ${id}.${veld} ongeldig`);
    }
  }
  return p;
}

export function laadMerk() { return laadJson('merk.json'); }

// Bewaartermijn logs in dagen, standaard 90.
export function bewaartermijnDagen(env = process.env) {
  const v = env.RC_LOG_BEWAAR_DAGEN;
  if (v === undefined || v === '') return 90;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 3650) throw new Error('RC_LOG_BEWAAR_DAGEN ongeldig (1-3650)');
  return n;
}
