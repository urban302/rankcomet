// DataForSEO-client (stap 6), in gewoon JavaScript overgezet uit vendor-openseo/src/server/lib/dataforseo/.
// Alleen wat Rankcomet gebruikt: zoekwoordideeën (Labs) en zoekvolumes (Google Ads). Elke aanroep kost geld;
// de kosten komen terug per aanroep en worden gelogd (alleen bedragen, nooit de zoekwoorden van de klant).
// Het transport is injecteerbaar; in tests altijd een nep-transport.
import { Fout } from './accounts.js';

const API = 'https://api.dataforseo.com';
const TIMEOUT_MS = 60000;
const MAX_HERHALINGEN = 2;

// [A57] Alleen Nederland en België (A16), Nederlandstalig. Locatiecodes van DataForSEO.
export const LANDEN = { NL: { location_code: 2528, language_code: 'nl' }, BE: { location_code: 2056, language_code: 'nl' } };
// [A60] Rank tracking kijkt 20 resultaten diep (2 pagina's van 10, DataForSEO rekent per pagina), desktop.
export const RANKCHECK_DIEPTE = 20;

// Taakstatussen die een storing bij DataForSEO betekenen (uit envelope.ts), niet een fout van ons.
const STORING = new Set([40101, 40103, 50401, 50402]);
const BEZIG = new Set([20100, 40601, 40602]);

export function controleerDataforseoEnv(env = process.env) {
  if (!env.RC_DATAFORSEO_LOGIN || !env.RC_DATAFORSEO_WACHTWOORD) throw new Error('RC_DATAFORSEO_LOGIN of RC_DATAFORSEO_WACHTWOORD ontbreekt');
  return { login: env.RC_DATAFORSEO_LOGIN, wachtwoord: env.RC_DATAFORSEO_WACHTWOORD };
}

// Google Ads weigert de hele taak als één zoekwoord een van deze tekens heeft, langer is dan 80 tekens
// of meer dan 10 woorden heeft (uit google-ads.ts).
const ADS_ONGELDIG = /[!@%,*(){}<>|^~;=?`]|\p{Extended_Pictographic}/u;
export const isAdsZoekwoord = (z) => z.length <= 80 && z.split(/\s+/).length <= 10 && !ADS_ONGELDIG.test(z);

const INTENTIES = { informational: 'informatie', navigational: 'navigatie', commercial: 'commercieel', transactional: 'kopen' };
export const normaliseerIntentie = (raw) => INTENTIES[String(raw || '').toLowerCase()] || 'onbekend';

const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function maakDataforseo(env = process.env, fetchFn = globalThis.fetch, logger = null) {
  const { login, wachtwoord } = controleerDataforseoEnv(env);
  const auth = 'Basic ' + Buffer.from(`${login}:${wachtwoord}`).toString('base64');

  // Eén POST met één taak. Geeft { result, kostenUsd }. Alles wat niet 20000 is, wordt een Fout.
  async function post(pad, taak) {
    let antwoord;
    for (let poging = 0; ; poging++) {
      try {
        antwoord = await fetchFn(API + pad, { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify([taak]), signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (e) {
        await logger?.log('fout', `dataforseo onbereikbaar pad=${pad} ${e.name}`);
        throw new Fout('De zoekwoorddienst is even niet bereikbaar. Probeer het later opnieuw.', 503);
      }
      if (antwoord.status >= 500 && poging < MAX_HERHALINGEN) { await new Promise((ok) => setTimeout(ok, 250 * (poging + 1))); continue; }
      break;
    }
    if (antwoord.status === 401 || antwoord.status === 403) { await logger?.log('fout', `dataforseo weigert toegang status=${antwoord.status}`); throw new Fout('De zoekwoorddienst weigert onze toegang. We kijken ernaar.', 503); }
    if (antwoord.status === 429) throw new Fout('De zoekwoorddienst is druk. Probeer het over een minuut opnieuw.', 429);
    if (!antwoord.ok) { await logger?.log('fout', `dataforseo fout status=${antwoord.status} pad=${pad}`); throw new Fout('De zoekwoorddienst gaf een fout. Probeer het later opnieuw.', 503); }
    let data;
    try { data = await antwoord.json(); } catch { throw new Fout('De zoekwoorddienst gaf een onleesbaar antwoord.', 502); }
    if (data?.status_code !== 20000) { await logger?.log('fout', `dataforseo status_code=${data?.status_code} pad=${pad}`); throw new Fout('De zoekwoorddienst gaf een fout. Probeer het later opnieuw.', 503); }
    const t = data.tasks?.[0];
    const kostenUsd = getal(t?.cost) ?? 0;
    await logger?.log('info', `dataforseo pad=${pad} kosten_usd=${kostenUsd} status=${t?.status_code}`);
    if (!t) throw new Fout('De zoekwoorddienst gaf geen resultaat.', 502);
    if (t.status_code === 40501 || /no search results/i.test(t.status_message || '')) return { result: [], kostenUsd }; // leeg, geen fout
    if (BEZIG.has(t.status_code)) throw new Fout('De zoekwoorddienst is nog bezig. Probeer het zo opnieuw.', 503);
    if (t.status_code !== 20000) {
      if (!STORING.has(t.status_code)) await logger?.log('fout', `dataforseo taak status_code=${t.status_code} pad=${pad}`);
      throw new Fout('De zoekwoorddienst kon deze aanvraag niet verwerken. Probeer het later opnieuw.', 503);
    }
    return { result: t.result || [], kostenUsd };
  }

  return {
    // Ideeën bij een zoekwoord: volume, CPC, moeilijkheid en intentie (Labs keyword_ideas).
    async zoekwoordIdeeen({ zoekwoord, land = 'NL', limiet = 50 }) {
      const loc = LANDEN[land]; if (!loc) throw new Fout('Kies een land uit de lijst.', 400);
      const { result, kostenUsd } = await post('/v3/dataforseo_labs/google/keyword_ideas/live', { keywords: [zoekwoord], ...loc, limit: limiet, include_clickstream_data: false, include_serp_info: false, ignore_synonyms: false, closely_variants: false });
      const items = result?.[0]?.items || [];
      return {
        kostenUsd,
        ideeen: items.filter((i) => typeof i?.keyword === 'string' && i.keyword.trim()).map((i) => ({
          zoekwoord: i.keyword.trim().toLowerCase(),
          volume: getal(i.keyword_info?.search_volume),
          cpc: getal(i.keyword_info?.cpc),
          concurrentie: getal(i.keyword_info?.competition),
          moeilijkheid: getal(i.keyword_properties?.keyword_difficulty),
          intentie: normaliseerIntentie(i.search_intent_info?.main_intent),
        })),
      };
    },
    // Positie van een domein voor een zoekwoord (SERP organic live). Alleen organische resultaten tellen, met
    // rank_group (positie tussen de organische resultaten, wat een klant 'mijn positie' noemt); een subdomein telt mee.
    async positie({ zoekwoord, land = 'NL', domein, diepte = RANKCHECK_DIEPTE }) {
      const loc = LANDEN[land]; if (!loc) throw new Fout('Kies een land uit de lijst.', 400);
      const { result, kostenUsd } = await post('/v3/serp/google/organic/live/advanced', { keyword: zoekwoord, ...loc, device: 'desktop', os: 'windows', depth: Math.min(100, Math.max(10, diepte)) });
      const items = result?.[0]?.items || [];
      const doel = String(domein).toLowerCase();
      const treffer = items.find((i) => i?.type === 'organic' && typeof i.domain === 'string' && (i.domain.toLowerCase() === doel || i.domain.toLowerCase().endsWith('.' + doel)));
      return { kostenUsd, positie: treffer ? (getal(treffer.rank_group) ?? getal(treffer.rank_absolute)) : null, url: treffer?.url ?? null, aantal: items.filter((i) => i?.type === 'organic').length };
    },
    // Zoekvolumes voor eigen zoekwoorden (Google Ads search_volume). Zoekwoorden die Google Ads weigert, worden overgeslagen.
    async zoekvolumes({ zoekwoorden, land = 'NL' }) {
      const loc = LANDEN[land]; if (!loc) throw new Fout('Kies een land uit de lijst.', 400);
      const geldig = zoekwoorden.filter(isAdsZoekwoord);
      if (!geldig.length) return { kostenUsd: 0, volumes: {} };
      const { result, kostenUsd } = await post('/v3/keywords_data/google_ads/search_volume/live', { keywords: geldig, ...loc });
      const volumes = {};
      for (const i of result || []) if (typeof i?.keyword === 'string') volumes[i.keyword.toLowerCase()] = { volume: getal(i.search_volume), cpc: getal(i.cpc), concurrentie: getal(i.competition_index) != null ? i.competition_index / 100 : null };
      return { kostenUsd, volumes };
    },
  };
}
