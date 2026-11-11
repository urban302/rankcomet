// De Conquer-pijplijn (stap 4): van zoekwoord tot conceptartikel.
//   reserveren (volumerem + temporem) -> brief -> artikel met links en meta -> kwaliteitspoort -> voorstel.
// Het resultaat is een voorstel (stap 3) dat de klant in de app goedkeurt. Niets gaat vanzelf naar de site.
// Mislukt een stap, dan wordt het artikel teruggeboekt (A22) en telt het niet mee.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Fout } from './accounts.js';
import { reserveerArtikel, boekTerug, werkArtikelBij } from './artikelen.js';
import { haalProfiel } from './sites.js';
import { clientVoorSite, stelVoor } from './wijzigingen.js';
import { beoordeel } from './kwaliteit.js';

const PROMPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prompts');
export const prompt = (naam, velden, map = PROMPTS) => readFileSync(path.join(map, `${naam}.md`), 'utf8').replace(/\{\{(\w+)\}\}/g, (_, k) => String(velden[k] ?? ''));

// Eén vraag aan het model, antwoord als JSON-object. Alles wat geen object is, is een fout.
export async function vraagJson(model, systeem, gebruiker, logger, stap) {
  let antwoord;
  try { antwoord = await model.chat([{ role: 'system', content: systeem }, { role: 'user', content: gebruiker }], { json: true }); }
  catch (e) { await logger?.log('fout', `schrijfhulp mislukt stap=${stap} ${e.name}${e.status ? ' status=' + e.status : ''}`); throw new Fout('De schrijfhulp is even niet bereikbaar. Probeer het later opnieuw.', 503); }
  await logger?.log('info', `schrijfhulp stap=${stap} tokens_in=${antwoord.tokens?.in ?? '?'} tokens_uit=${antwoord.tokens?.uit ?? '?'}`);
  if (antwoord.afgebroken) throw new Fout('Het artikel werd te lang en is afgebroken. Probeer het opnieuw.', 502);
  let data;
  try { data = JSON.parse(String(antwoord.tekst).replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { throw new Fout('De schrijfhulp gaf een onleesbaar antwoord. Probeer het opnieuw.', 502); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Fout('De schrijfhulp gaf een onleesbaar antwoord. Probeer het opnieuw.', 502);
  return data;
}

export const knip = (v, max) => (typeof v === 'string' ? v : '').slice(0, max);
const tekst = knip;
export const paginaLijst = (paginas) => paginas.length ? paginas.map((p) => `- ${p.titel} | ${p.url}`).join('\n') : '- (nog geen pagina\'s)';

// Stap 11: het schrijven is gesplitst. `bereidArtikelVoor` doet de controles en de reservering (direct in het
// verzoek, zodat de klant meteen hoort of het kan); `schrijfGereserveerdArtikel` doet het echte werk, in de wachtrij.
export async function bereidArtikelVoor(db, ctx, account, siteId, { zoekwoord }) {
  zoekwoord = String(zoekwoord || '').trim().replace(/\s+/g, ' ');
  if (zoekwoord.length < 2 || zoekwoord.length > 100) throw new Fout('Vul een zoekwoord in van 2 tot 100 tekens.', 400);
  const { site } = await clientVoorSite(db, ctx, account.id, siteId); // eerst het account (404), dan de rest
  const profiel = await haalProfiel(db, account.id, siteId);
  if (!profiel) throw new Fout('Vul eerst het siteprofiel in (bedrijf, diensten, plaats). Daarmee schrijft Rankcomet over jouw bedrijf en niet over zomaar een bedrijf.', 400, { profiel: siteId });
  // Reserveren: volumerem per maand en temporem per dag, in één transactie (artikelen.js).
  const artikel = await reserveerArtikel(db, account, siteId, new Date(), { zoekwoord });
  return { artikel, zoekwoord, site };
}

export async function schrijfArtikel(db, ctx, account, siteId, { zoekwoord }) {
  const voorbereid = await bereidArtikelVoor(db, ctx, account, siteId, { zoekwoord });
  return schrijfGereserveerdArtikel(db, ctx, account, { siteId, artikelId: voorbereid.artikel.id, zoekwoord: voorbereid.zoekwoord });
}

export async function schrijfGereserveerdArtikel(db, ctx, account, { siteId, artikelId, zoekwoord }) {
  const artikel = (await db.query("SELECT id, maand, dag FROM artikelen WHERE id = $1 AND account_id = $2 AND site_id = $3 AND status = 'gereserveerd'", [artikelId, account.id, siteId])).rows[0];
  if (!artikel) throw new Fout('Dit artikel is niet meer gereserveerd.', 409);
  try {
    const { site, wp } = await clientVoorSite(db, ctx, account.id, siteId);
    const profiel = await haalProfiel(db, account.id, siteId);
    if (!profiel) throw new Fout('Vul eerst het siteprofiel in (bedrijf, diensten, plaats).', 400, { profiel: siteId });
    const paginas = ((await wp.paginas()).paginas || []).filter((p) => p && typeof p.url === 'string' && typeof p.titel === 'string').slice(0, 200);
    const eerdere = (await db.query("SELECT v.nieuw FROM wijziging_velden v JOIN wijzigingen w ON w.id = v.wijziging_id WHERE w.site_id = $1 AND w.doel_type = 'post' AND v.veld = 'inhoud' AND w.status <> 'afgewezen' ORDER BY w.aangemaakt DESC LIMIT 50", [siteId])).rows.map((r) => r.nieuw);
    const systeem = prompt('systeem', profiel, ctx.promptsMap);
    const lijst = paginaLijst(paginas);

    const brief = await vraagJson(ctx.model, systeem, prompt('brief', { zoekwoord, paginas: lijst }, ctx.promptsMap), ctx.logger, 'brief');
    let feedback = '', beoordeling = null, concept = null;
    for (let poging = 1; poging <= 2; poging++) { // [A52] één herkansing met de bevindingen van de poort
      const uit = await vraagJson(ctx.model, systeem, prompt('artikel', { zoekwoord, brief: JSON.stringify(brief, null, 1), paginas: lijst, feedback }, ctx.promptsMap), ctx.logger, `artikel${poging}`);
      concept = { titel: tekst(uit.titel, 300), inhoud: tekst(uit.inhoud, 200000), meta_titel: tekst(uit.meta_titel, 300), meta_beschrijving: tekst(uit.meta_beschrijving, 600), focus_zoekwoord: tekst(uit.focus_zoekwoord, 200) || zoekwoord };
      beoordeling = beoordeel({ artikel: concept, zoekwoord, profiel, paginas, eerdereTeksten: eerdere });
      if (beoordeling.geslaagd) break;
      feedback = `\nDe vorige versie is afgekeurd. Los dit op:\n${beoordeling.bevindingen.map((b) => `- ${b.tekst}`).join('\n')}`;
      await ctx.logger?.log('info', `kwaliteitspoort afgekeurd artikel=${artikel.id} poging=${poging} codes=${beoordeling.bevindingen.map((b) => b.code).join(',')}`);
    }
    if (!beoordeling.geslaagd) {
      throw new Fout('Het artikel kwam niet door de kwaliteitscontrole. Rankcomet heeft het niet voorgesteld. ' + beoordeling.bevindingen.filter((b) => b.blokkeert).map((b) => b.tekst).join(' '), 422, { bevindingen: beoordeling.bevindingen });
    }
    const reden = `Nieuw artikel voor het zoekwoord "${zoekwoord}" (kwaliteitsscore ${beoordeling.score}, ${beoordeling.woorden} woorden)`;
    const wijziging = await stelVoor(db, ctx, account, siteId, { doelType: 'post', velden: beoordeling.artikel, reden });
    await werkArtikelBij(db, account.id, artikel.id, { status: 'concept', wijziging_id: wijziging.id, score: beoordeling.score, melding: beoordeling.bevindingen.map((b) => b.tekst).join(' ') || null });
    await ctx.logger?.log('info', `artikel klaar account=${account.id} site=${siteId} artikel=${artikel.id} score=${beoordeling.score}`);
    return { artikel: { ...artikel, status: 'concept', score: beoordeling.score }, wijziging, beoordeling, site };
  } catch (e) {
    await boekTerug(db, account.id, artikel.id, e instanceof Fout ? e.message : 'Onverwachte fout');
    await ctx.logger?.log('info', `artikel teruggeboekt account=${account.id} artikel=${artikel.id} status=${e.status || 500}`);
    throw e;
  }
}
