// Stap 12: alles wat een gebruiker ziet staat in de je-vorm. Deze test bewaakt dat de u-vorm niet terugkomt
// in de app, de mails, de meldingen, de prompts, de publieke pagina's en de plugin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAPPEN = ['src', 'public', 'prompts', 'config', '../wordpress-plugin/rankcomet'];
const BESTANDEN = /\.(js|html|md|json|php)$/;
// Woorden van de u-vorm als los woord; "u" als variabele (u.href, (u) =>) telt niet.
const U_VORM = /(^|[^\w.$])(U|Uw|uw|u)(?=\s(heeft|hebt|kunt|wilt|bent|krijgt|ziet|moet|mag|gaat|pakket|account|site|artikel|e-mailadres|wachtwoord)\b|\s*[.,!?](\s|$))/;

function alle(map, uit = []) {
  for (const naam of readdirSync(map)) {
    const p = path.join(map, naam);
    if (statSync(p).isDirectory()) { if (naam !== 'vendor' && naam !== 'node_modules') alle(p, uit); }
    else if (BESTANDEN.test(naam)) uit.push(p);
  }
  return uit;
}

test('geen u-vorm in teksten voor gebruikers', () => {
  const treffers = [];
  for (const map of MAPPEN) {
    for (const bestand of alle(path.join(WORTEL, map))) {
      readFileSync(bestand, 'utf8').split('\n').forEach((regel, i) => {
        if (/^\s*(\/\/|\*|#)/.test(regel)) return; // commentaar telt niet
        if (U_VORM.test(regel)) treffers.push(`${path.relative(WORTEL, bestand)}:${i + 1}: ${regel.trim().slice(0, 120)}`);
      });
    }
  }
  assert.deepEqual(treffers, [], 'u-vorm gevonden');
});
