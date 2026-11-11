// Praat met de Rankcomet-WordPress-plugin op de klantsite (stap 3), altijd via de veilige ophaler
// en altijd ondertekend met de sleutel van die site.
//
// Handtekening (de plugin controleert precies hetzelfde):
//   tekst   = METHODE + "\n" + pad + "\n" + tijd + "\n" + nonce + "\n" + sha256hex(body)
//   koptekst X-Rankcomet-Handtekening = hex(HMAC-SHA256(sleutel, tekst))
//   koptekst X-Rankcomet-Tijd = unixseconden, X-Rankcomet-Nonce = 16 willekeurige bytes (hex)
// De plugin weigert een tijd die meer dan 5 minuten afwijkt en een nonce die hij al zag.
import { createHmac, createHash, randomBytes } from 'node:crypto';
import { Fout } from './accounts.js';

export const PLUGIN_PAD = '/wp-json/rankcomet/v1';

export function handtekening(sleutel, methode, pad, tijd, nonce, body) {
  const tekst = [methode.toUpperCase(), pad, String(tijd), nonce, createHash('sha256').update(body || '').digest('hex')].join('\n');
  return createHmac('sha256', sleutel).update(tekst).digest('hex');
}

export function onderteken(sleutel, methode, pad, body = '', nu = Date.now()) {
  const tijd = Math.floor(nu / 1000), nonce = randomBytes(16).toString('hex');
  return {
    'x-rankcomet-tijd': String(tijd), 'x-rankcomet-nonce': nonce,
    'x-rankcomet-handtekening': handtekening(sleutel, methode, pad, tijd, nonce, body),
    ...(body ? { 'content-type': 'application/json' } : {}),
  };
}

// Client voor één site. `sleutel` is de ontsleutelde pluginsleutel (string), `ophalen` de veilige ophaler.
export function maakWpClient({ ophalen, domein, sleutel }) {
  async function vraag(methode, pad, data) {
    const body = data ? JSON.stringify(data) : '';
    const volledigPad = PLUGIN_PAD + pad;
    const r = await ophalen(`https://${domein}${volledigPad}`, domein, { methode, headers: onderteken(sleutel, methode, volledigPad, body), body: body || null });
    let antwoord = null;
    try { antwoord = JSON.parse(r.body); } catch {}
    if (r.status === 404 && !antwoord) throw new Fout(`De Rankcomet-plugin is niet gevonden op ${domein}. Is hij geïnstalleerd en ingeschakeld?`, 400, { plugin: 'ontbreekt' });
    if (r.status === 401 || r.status === 403) throw new Fout(`De sleutel in de Rankcomet-plugin op ${domein} klopt niet. Maak een nieuwe sleutel en zet die in de plugin.`, 400, { plugin: 'sleutel' });
    if (r.status !== 200 || !antwoord) throw new Fout(`De Rankcomet-plugin op ${domein} gaf een fout (${r.status}).`, 400, { plugin: 'fout', pluginFout: antwoord?.fout });
    return antwoord;
  }
  return {
    status: () => vraag('GET', '/status'),
    haalDoel: (doelType, doelId) => vraag('GET', `/doel/${encodeURIComponent(doelType)}/${encodeURIComponent(doelId)}`),
    pasToe: (wijziging) => vraag('POST', '/wijzigingen', wijziging),
  };
}
