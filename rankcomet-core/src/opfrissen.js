// Contentrefresh (stap 9): verouderde pagina's vinden en een opfrisvoorstel maken.
// Trigger (besluit OV11 d): een combinatie van positiedaling (rank tracking), klikdaling (Search Console) en de
// leeftijd van de inhoud, met drempels per site. Het voorstel gaat via stap 3 (goedkeuring in de app), dus niets
// verandert op de site zonder akkoord. Harde regels in code: daggrens per site, alleen de eigen site, profiel verplicht.
import { randomUUID } from 'node:crypto';
import { Fout } from './accounts.js';
import { pakketVoor } from './pakketten.js';
import { huidigeDag } from './artikelen.js';
import { haalProfiel } from './sites.js';
import { clientVoorSite, stelVoor } from './wijzigingen.js';
import { overzicht as positieOverzicht } from './posities.js';
import { klikkenPerPagina } from './gsc.js';
import { beoordeel } from './kwaliteit.js';
import { vraagJson, prompt, knip, paginaLijst } from './pijplijn.js';

const nu = () => new Date().toISOString();
// [A67] Standaarddrempels: ouder dan 180 dagen én (3 plaatsen gezakt of 30% minder klikken bij minstens 10 klikken eerder).
export const STANDAARD_DREMPELS = { min_leeftijd_dagen: 180, positie_daling: 3, klik_daling_pct: 30 };
const GRENZEN = { min_leeftijd_dagen: [30, 1095], positie_daling: [1, 50], klik_daling_pct: [10, 90] };
const MIN_KLIKKEN_EERDER = 10;
const DOELTYPE = { post: 'post', page: 'pagina' }; // producten niet (A68)

export const normUrl = (u) => String(u || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/$/, '');

async function eigenSite(db, accountId, siteId) {
  const site = (await db.query('SELECT id, domein FROM sites WHERE id = $1 AND account_id = $2', [siteId, accountId])).rows[0];
  if (!site) throw new Fout('Site niet gevonden.', 404);
  return site;
}

export async function instellingen(db, accountId, siteId) {
  await eigenSite(db, accountId, siteId);
  const r = (await db.query('SELECT min_leeftijd_dagen, positie_daling, klik_daling_pct FROM refresh_instellingen WHERE site_id = $1 AND account_id = $2', [siteId, accountId])).rows[0];
  return r ? { min_leeftijd_dagen: Number(r.min_leeftijd_dagen), positie_daling: Number(r.positie_daling), klik_daling_pct: Number(r.klik_daling_pct) } : { ...STANDAARD_DREMPELS };
}

export async function bewaarInstellingen(db, accountId, siteId, invoer) {
  await eigenSite(db, accountId, siteId);
  const p = {};
  for (const [veld, [min, max]] of Object.entries(GRENZEN)) {
    const n = Number(String(invoer?.[veld] ?? '').trim());
    if (!Number.isInteger(n) || n < min || n > max) throw new Fout(`Vul voor "${veld.replace(/_/g, ' ')}" een heel getal in van ${min} tot ${max}.`, 400);
    p[veld] = n;
  }
  await db.query(`INSERT INTO refresh_instellingen (site_id, account_id, min_leeftijd_dagen, positie_daling, klik_daling_pct, bijgewerkt) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (site_id) DO UPDATE SET min_leeftijd_dagen = $3, positie_daling = $4, klik_daling_pct = $5, bijgewerkt = $6 WHERE refresh_instellingen.account_id = $2`,
    [siteId, accountId, p.min_leeftijd_dagen, p.positie_daling, p.klik_daling_pct, nu()]);
  return instellingen(db, accountId, siteId);
}

// Kandidaten: pagina's van de plugin die oud genoeg zijn én gezakt zijn in positie of klikken.
export async function kandidaten(db, ctx, account, siteId, tijd = new Date()) {
  const { wp } = await clientVoorSite(db, ctx, account.id, siteId);
  const drempels = await instellingen(db, account.id, siteId);
  const paginas = ((await wp.paginas()).paginas || []).filter((p) => p && DOELTYPE[p.type] && typeof p.url === 'string' && p.id != null);
  const posities = await positieOverzicht(db, account.id, siteId, tijd);
  const klikken = await klikkenPerPagina(db, account.id, siteId);
  const eerder = (await db.query("SELECT doel_id, status, aangemaakt FROM opfrissingen WHERE site_id = $1 AND account_id = $2 AND status <> 'mislukt' ORDER BY aangemaakt DESC", [siteId, account.id])).rows;
  const dagMs = 86400000;
  const uit = [];
  for (const p of paginas) {
    const url = normUrl(p.url);
    const gewijzigd = p.gewijzigd ? new Date(p.gewijzigd) : null;
    const leeftijd = gewijzigd && !Number.isNaN(gewijzigd.getTime()) ? Math.floor((tijd - gewijzigd) / dagMs) : null;
    if (leeftijd == null || leeftijd < drempels.min_leeftijd_dagen) continue;
    const redenen = [];
    // Positie: het gevolgde zoekwoord op deze URL dat het meest zakte in 28 dagen (of uit de top 20 viel).
    let ergste = null;
    for (const z of posities.filter((z) => normUrl(z.url || z.laatsteUrl) === url)) {
      if (z.maandTerug == null) continue;
      const daling = z.positie == null ? Infinity : z.positie - z.maandTerug;
      if (daling >= drempels.positie_daling && (!ergste || daling > ergste.daling)) ergste = { ...z, daling };
    }
    if (ergste) redenen.push(ergste.positie == null ? `voor "${ergste.zoekwoord}" uit de top 20 gevallen (was ${ergste.maandTerug})` : `voor "${ergste.zoekwoord}" van positie ${ergste.maandTerug} naar ${ergste.positie}`);
    // Klikken: huidige periode tegenover de vorige, alleen bij genoeg klikken eerder.
    const h = klikken.huidig[url] ?? null, v = klikken.vorige[url] ?? null;
    let klikDaling = null;
    if (v != null && v >= MIN_KLIKKEN_EERDER && h != null) { klikDaling = Math.round((v - h) / v * 100); if (klikDaling >= drempels.klik_daling_pct) redenen.push(`${klikDaling}% minder klikken in Google (van ${v} naar ${h})`); else klikDaling = null; }
    if (!redenen.length) continue;
    const recent = eerder.find((e) => String(e.doel_id) === String(p.id) && (tijd - new Date(e.aangemaakt)) < 30 * dagMs);
    uit.push({ doelId: String(p.id), doelType: DOELTYPE[p.type], titel: p.titel, url: p.url, leeftijdDagen: leeftijd, redenen, zoekwoord: ergste?.zoekwoord ?? null, positieVoor: ergste?.positie ?? null, klikkenVoor: h, alVoorgesteld: Boolean(recent), ernst: (ergste ? Math.min(ergste.daling, 20) : 0) + (klikDaling ?? 0) / 10 });
  }
  return uit.sort((a, b) => b.ernst - a.ernst || a.titel.localeCompare(b.titel));
}

// Een opfrisvoorstel maken voor één pagina. Daggrens per site (pakketten.json); mislukt telt ook (A69).
export async function maakVoorstel(db, ctx, account, siteId, { doelId }, tijd = new Date()) {
  const site = await eigenSite(db, account.id, siteId);
  const profiel = await haalProfiel(db, account.id, siteId);
  if (!profiel) throw new Fout('Vul eerst het siteprofiel in (bedrijf, diensten, plaats).', 400, { profiel: siteId });
  const kandidaat = (await kandidaten(db, ctx, account, siteId, tijd)).find((k) => k.doelId === String(doelId));
  if (!kandidaat) throw new Fout('Deze pagina staat niet in de lijst om op te frissen.', 400);
  const pk = pakketVoor(account.pakket), dag = huidigeDag(tijd), id = randomUUID();
  await db.transactie(async (tx) => {
    await tx.query(`SELECT id FROM sites WHERE id = $1${tx.soort === 'pg' ? ' FOR UPDATE' : ''}`, [siteId]);
    const n = Number((await tx.query('SELECT COUNT(*) AS n FROM opfrissingen WHERE site_id = $1 AND dag = $2', [siteId, dag])).rows[0].n);
    if (n >= pk.opfrissingen_per_site_per_dag) throw new Fout(`Voor ${site.domein} zijn vandaag al ${pk.opfrissingen_per_site_per_dag} opfrisvoorstellen gemaakt. Morgen kan het weer.`, 429, { tempo: true });
    await tx.query('INSERT INTO opfrissingen (id, account_id, site_id, doel_type, doel_id, url, zoekwoord, reden, status, positie_voor, klikken_voor, dag, aangemaakt, bijgewerkt) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)',
      [id, account.id, siteId, kandidaat.doelType, kandidaat.doelId, kandidaat.url, kandidaat.zoekwoord, kandidaat.redenen.join('; '), 'bezig', kandidaat.positieVoor, kandidaat.klikkenVoor, dag, nu()]);
  });
  try {
    const { wp } = await clientVoorSite(db, ctx, account.id, siteId);
    const huidig = (await wp.haalDoel(kandidaat.doelType, kandidaat.doelId)).velden || {};
    const paginas = ((await wp.paginas()).paginas || []).filter((p) => p && typeof p.url === 'string' && typeof p.titel === 'string' && String(p.id) !== kandidaat.doelId).slice(0, 200);
    const eerdere = (await db.query("SELECT v.nieuw FROM wijziging_velden v JOIN wijzigingen w ON w.id = v.wijziging_id WHERE w.site_id = $1 AND w.doel_type IN ('post', 'pagina') AND v.veld = 'inhoud' AND w.status <> 'afgewezen' AND (w.doel_id IS NULL OR w.doel_id <> $2) ORDER BY w.aangemaakt DESC LIMIT 50", [siteId, kandidaat.doelId])).rows.map((r) => r.nieuw);
    const zoekwoord = kandidaat.zoekwoord || huidig.focus_zoekwoord || huidig.titel || kandidaat.titel;
    const systeem = prompt('systeem', profiel, ctx.promptsMap);
    let feedback = '', beoordeling = null, concept = null;
    for (let poging = 1; poging <= 2; poging++) {
      const uit = await vraagJson(ctx.model, systeem, prompt('opfrissen', { zoekwoord, reden: kandidaat.redenen.join(', '), oude_titel: huidig.titel || kandidaat.titel, oude_tekst: huidig.inhoud || '', paginas: paginaLijst(paginas), feedback }, ctx.promptsMap), ctx.logger, `opfrissen${poging}`);
      concept = { titel: knip(uit.titel, 300) || huidig.titel || kandidaat.titel, inhoud: knip(uit.inhoud, 200000), meta_titel: knip(uit.meta_titel, 300), meta_beschrijving: knip(uit.meta_beschrijving, 600), focus_zoekwoord: knip(uit.focus_zoekwoord, 200) || zoekwoord };
      beoordeling = beoordeel({ artikel: concept, zoekwoord, profiel, paginas, eerdereTeksten: eerdere });
      if (beoordeling.geslaagd) break;
      feedback = `\nDe vorige versie is afgekeurd. Los dit op:\n${beoordeling.bevindingen.map((b) => `- ${b.tekst}`).join('\n')}`;
    }
    if (!beoordeling.geslaagd) throw new Fout('De opgefriste tekst kwam niet door de kwaliteitscontrole. ' + beoordeling.bevindingen.filter((b) => b.blokkeert).map((b) => b.tekst).join(' '), 422, { bevindingen: beoordeling.bevindingen });
    const reden = `Opfrissen: ${kandidaat.redenen.join(', ')}; laatst gewijzigd ${kandidaat.leeftijdDagen} dagen geleden (kwaliteitsscore ${beoordeling.score})`;
    const wijziging = await stelVoor(db, ctx, account, siteId, { doelType: kandidaat.doelType, doelId: kandidaat.doelId, velden: beoordeling.artikel, reden });
    await db.query('UPDATE opfrissingen SET status = $1, wijziging_id = $2, score = $3, bijgewerkt = $4 WHERE id = $5', ['voorstel', wijziging.id, beoordeling.score, nu(), id]);
    await ctx.logger?.log('info', `opfrisvoorstel account=${account.id} site=${siteId} opfrissing=${id} score=${beoordeling.score}`);
    return { id, wijziging, beoordeling };
  } catch (e) {
    await db.query('UPDATE opfrissingen SET status = $1, melding = $2, bijgewerkt = $3 WHERE id = $4', ['mislukt', e instanceof Fout ? e.message.slice(0, 1000) : 'Onverwachte fout', nu(), id]);
    throw e;
  }
}

// Effect per URL: voor elke opfrissing de positie en klikken van toen tegenover nu, met de status van het voorstel.
export async function effect(db, accountId, siteId, tijd = new Date()) {
  await eigenSite(db, accountId, siteId);
  const rijen = (await db.query('SELECT o.id, o.url, o.zoekwoord, o.reden, o.status, o.melding, o.positie_voor, o.klikken_voor, o.aangemaakt, o.wijziging_id, w.status AS voorstel_status, w.gepubliceerd FROM opfrissingen o LEFT JOIN wijzigingen w ON w.id = o.wijziging_id WHERE o.site_id = $1 AND o.account_id = $2 ORDER BY o.aangemaakt DESC LIMIT 50', [siteId, accountId])).rows;
  if (!rijen.length) return [];
  const posities = await positieOverzicht(db, accountId, siteId, tijd);
  const klikken = await klikkenPerPagina(db, accountId, siteId);
  return rijen.map((r) => {
    const z = r.zoekwoord ? posities.find((p) => p.zoekwoord === r.zoekwoord) : null;
    return { ...r, positie_voor: r.positie_voor == null ? null : Number(r.positie_voor), klikken_voor: r.klikken_voor == null ? null : Number(r.klikken_voor), positieNu: z ? z.positie : null, klikkenNu: klikken.huidig[normUrl(r.url)] ?? null };
  });
}
