// Search Console-koppeling (stap 8). Harde regels in code:
// - de OAuth-state is eenmalig, verloopt na 10 minuten en hoort bij één account en één site;
// - tokens staan alleen versleuteld in `geheimen` (AES-GCM, account-id als AAD) en komen nooit in een log;
// - verbreken trekt de toegang bij Google in en verwijdert tokens, koppeling en cijfers;
// - cijfers worden hooguit één keer per dag per site opgehaald; alles gefilterd op account én site.
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { Fout } from './accounts.js';
import { versleutel, ontsleutel } from './geheimen.js';
import { laadMerk } from './config.js';
import { huidigeDag } from './artikelen.js';
import { maakVerifier } from './google.js';

const nu = () => new Date().toISOString();
const sha = (t) => createHash('sha256').update(t).digest('hex');
const STATE_DUUR_MS = 10 * 60000;          // [A64]
export const PERIODE_DAGEN = 28;           // [A65] laatste 28 dagen, zoals Search Console zelf standaard toont
export const redirectUri = () => `${laadMerk().basis_url}/google/terug`;

async function eigenSite(db, accountId, siteId) {
  const site = (await db.query('SELECT id, domein, eigendom_bevestigd FROM sites WHERE id = $1 AND account_id = $2', [siteId, accountId])).rows[0];
  if (!site) throw new Fout('Site niet gevonden.', 404);
  return site;
}

async function geheim(db, accountId, siteId, soort) {
  return (await db.query('SELECT id, versleuteld FROM geheimen WHERE account_id = $1 AND site_id = $2 AND soort = $3', [accountId, siteId, soort])).rows[0] || null;
}
async function zetGeheim(tx, sleutel, accountId, siteId, soort, waarde) {
  await tx.query('DELETE FROM geheimen WHERE account_id = $1 AND site_id = $2 AND soort = $3', [accountId, siteId, soort]);
  await tx.query('INSERT INTO geheimen (id, account_id, site_id, soort, versleuteld, aangemaakt) VALUES ($1, $2, $3, $4, $5, $6)', [randomUUID(), accountId, siteId, soort, versleutel(sleutel, waarde, accountId), nu()]);
}

// Stap 1: de klant klikt op "Koppel Search Console". Geeft de URL bij Google.
export async function start(db, ctx, account, siteId) {
  const site = await eigenSite(db, account.id, siteId);
  if (!site.eigendom_bevestigd) throw new Fout(`Bevestig eerst dat ${site.domein} van jou is.`, 403, { koppelen: site.id });
  if (!ctx.google.beschikbaar) throw new Fout('De koppeling met Google Search Console is nog niet beschikbaar.', 503, { geenConfig: true });
  const state = randomBytes(24).toString('base64url'), verifier = maakVerifier();
  await db.query('DELETE FROM oauth_staten WHERE verloopt < $1', [nu()]);
  await db.query('INSERT INTO oauth_staten (state_hash, account_id, site_id, verifier_versleuteld, verloopt, aangemaakt) VALUES ($1, $2, $3, $4, $5, $6)',
    [sha(state), account.id, siteId, versleutel(ctx.geheimenSleutel, verifier, account.id), new Date(Date.now() + STATE_DUUR_MS).toISOString(), nu()]);
  return ctx.google.authUrl({ redirectUri: redirectUri(), state, verifier });
}

// Stap 2: Google stuurt de klant terug met code en state. De state is eenmalig en hoort bij dit account.
export async function terug(db, ctx, account, { code, state, error }) {
  if (error) throw new Fout(error === 'access_denied' ? 'Je hebt de koppeling geweigerd. Niets gekoppeld.' : 'Google gaf een fout. Probeer het opnieuw.', 400);
  if (typeof state !== 'string' || !state || typeof code !== 'string' || !code) throw new Fout('Deze link klopt niet. Begin opnieuw bij je site.', 400);
  const rij = (await db.query('DELETE FROM oauth_staten WHERE state_hash = $1 AND account_id = $2 AND verloopt > $3 RETURNING site_id, verifier_versleuteld', [sha(state), account.id, nu()])).rows[0];
  if (!rij) throw new Fout('Deze link is verlopen of al gebruikt. Begin opnieuw bij je site.', 400);
  const verifier = ontsleutel(ctx.geheimenSleutel, rij.verifier_versleuteld, account.id);
  const tokens = await ctx.google.wisselCode({ code, redirectUri: redirectUri(), verifier });
  await db.transactie(async (tx) => {
    await zetGeheim(tx, ctx.geheimenSleutel, account.id, rij.site_id, 'google_refresh', tokens.refreshToken);
    await zetGeheim(tx, ctx.geheimenSleutel, account.id, rij.site_id, 'google_access', JSON.stringify({ token: tokens.accessToken, verloopt: tokens.verlooptOp }));
    await tx.query('DELETE FROM gsc_koppelingen WHERE site_id = $1', [rij.site_id]);
    await tx.query('INSERT INTO gsc_koppelingen (site_id, account_id, property, status, gekoppeld, bijgewerkt) VALUES ($1, $2, NULL, $3, $4, $4)', [rij.site_id, account.id, 'property_kiezen', nu()]);
  });
  await ctx.logger?.log('info', `search console gekoppeld account=${account.id} site=${rij.site_id}`);
  return { siteId: rij.site_id, properties: await propertiesVoor(db, ctx, account, rij.site_id) };
}

// Een geldig toegangsbewijs: het bewaarde, of een nieuw via de refresh token. Ingetrokken: koppeling op 'verbroken'.
async function toegang(db, ctx, account, siteId) {
  const acc = await geheim(db, account.id, siteId, 'google_access');
  if (acc) { const a = JSON.parse(ontsleutel(ctx.geheimenSleutel, acc.versleuteld, account.id)); if (a.verloopt > nu()) return a.token; }
  const ref = await geheim(db, account.id, siteId, 'google_refresh');
  if (!ref) throw new Fout('Search Console is niet gekoppeld.', 400, { nietGekoppeld: true });
  try {
    const n = await ctx.google.ververs(ontsleutel(ctx.geheimenSleutel, ref.versleuteld, account.id));
    await db.transactie(async (tx) => zetGeheim(tx, ctx.geheimenSleutel, account.id, siteId, 'google_access', JSON.stringify({ token: n.accessToken, verloopt: n.verlooptOp })));
    return n.accessToken;
  } catch (e) {
    if (e instanceof Fout && e.ingetrokken) await db.query('UPDATE gsc_koppelingen SET status = $1, melding = $2, bijgewerkt = $3 WHERE site_id = $4 AND account_id = $5', ['verbroken', e.message, nu(), siteId, account.id]);
    throw e;
  }
}

export async function propertiesVoor(db, ctx, account, siteId) {
  const site = await eigenSite(db, account.id, siteId);
  const lijst = await ctx.google.properties(await toegang(db, ctx, account, siteId));
  const past = (p) => p.property === `sc-domain:${site.domein}` || p.property.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') === site.domein;
  return lijst.sort((a, b) => Number(past(b)) - Number(past(a)) || a.property.localeCompare(b.property)).map((p) => ({ ...p, past: past(p) }));
}

// Stap 3: de klant kiest de property. Alleen een property die Google voor dit account teruggaf.
export async function kiesProperty(db, ctx, account, siteId, property) {
  await eigenSite(db, account.id, siteId);
  const lijst = await propertiesVoor(db, ctx, account, siteId);
  if (!lijst.some((p) => p.property === property)) throw new Fout('Kies een property uit de lijst.', 400);
  const r = await db.query('UPDATE gsc_koppelingen SET property = $1, status = $2, melding = NULL, bijgewerkt = $3 WHERE site_id = $4 AND account_id = $5', [property, 'gekoppeld', nu(), siteId, account.id]);
  if (!r.rowCount) throw new Fout('Search Console is niet gekoppeld.', 400, { nietGekoppeld: true });
  return ververs(db, ctx, account, siteId, { forceer: true });
}

export async function koppeling(db, accountId, siteId) {
  await eigenSite(db, accountId, siteId);
  const k = (await db.query('SELECT property, status, melding, gekoppeld, laatst_opgehaald, periode_start, periode_eind FROM gsc_koppelingen WHERE site_id = $1 AND account_id = $2', [siteId, accountId])).rows[0] || null;
  if (!k) return null;
  const paginas = (await db.query('SELECT pagina, klikken, vertoningen, ctr, positie FROM gsc_cijfers WHERE site_id = $1 AND account_id = $2 AND periode_eind = $3 ORDER BY klikken DESC, vertoningen DESC LIMIT 100', [siteId, accountId, k.periode_eind || ''])).rows
    .map((r) => ({ ...r, klikken: Number(r.klikken), vertoningen: Number(r.vertoningen), ctr: Number(r.ctr), positie: r.positie == null ? null : Number(r.positie) }));
  return { ...k, paginas, totaal: { klikken: paginas.reduce((t, p) => t + p.klikken, 0), vertoningen: paginas.reduce((t, p) => t + p.vertoningen, 0) } };
}

// Cijfers ophalen: hooguit één keer per dag per site (laatst_opgehaald), tenzij geforceerd (na het kiezen).
export async function ververs(db, ctx, account, siteId, { forceer = false, tijd = new Date() } = {}) {
  await eigenSite(db, account.id, siteId);
  const k = (await db.query("SELECT property, status, laatst_opgehaald FROM gsc_koppelingen WHERE site_id = $1 AND account_id = $2 AND status = 'gekoppeld'", [siteId, account.id])).rows[0];
  if (!k || !k.property) throw new Fout('Search Console is niet gekoppeld.', 400, { nietGekoppeld: true });
  const dag = huidigeDag(tijd);
  if (!forceer && k.laatst_opgehaald === dag) return { overgeslagen: true };
  // Search Console loopt 2 tot 3 dagen achter; periode eindigt 3 dagen geleden [A65].
  const eind = new Date(tijd); eind.setUTCDate(eind.getUTCDate() - 3);
  const begin = new Date(eind); begin.setUTCDate(begin.getUTCDate() - (PERIODE_DAGEN - 1));
  const periode = { start: begin.toISOString().slice(0, 10), eind: eind.toISOString().slice(0, 10) };
  const rijen = await ctx.google.zoekprestaties(await toegang(db, ctx, account, siteId), k.property, periode);
  await db.transactie(async (tx) => {
    // Geschiedenis blijft staan (voor contentrefresh): alleen dezelfde periode vervangen, en ouder dan 120 dagen opruimen [A70].
    await tx.query('DELETE FROM gsc_cijfers WHERE site_id = $1 AND periode_eind = $2', [siteId, periode.eind]);
    const grens = new Date(tijd); grens.setUTCDate(grens.getUTCDate() - 120);
    await tx.query('DELETE FROM gsc_cijfers WHERE site_id = $1 AND periode_eind < $2', [siteId, grens.toISOString().slice(0, 10)]);
    for (const r of rijen) await tx.query('INSERT INTO gsc_cijfers (id, account_id, site_id, pagina, klikken, vertoningen, ctr, positie, periode_start, periode_eind, aangemaakt) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
      [randomUUID(), account.id, siteId, r.pagina.slice(0, 2000), r.klikken, r.vertoningen, r.ctr, r.positie, periode.start, periode.eind, nu()]);
    await tx.query('UPDATE gsc_koppelingen SET laatst_opgehaald = $1, periode_start = $2, periode_eind = $3, bijgewerkt = $4 WHERE site_id = $5', [dag, periode.start, periode.eind, nu(), siteId]);
  });
  await ctx.logger?.log('info', `search console ververst account=${account.id} site=${siteId} paginas=${rijen.length}`);
  return { overgeslagen: false, paginas: rijen.length, periode };
}

// Planning: alle gekoppelde sites, één keer per dag. Een fout bij één site stopt de rest niet.
export async function verversAlleSites(db, ctx, tijd = new Date()) {
  const rijen = (await db.query("SELECT k.site_id, a.id AS account_id, a.pakket FROM gsc_koppelingen k JOIN accounts a ON a.id = k.account_id WHERE k.status = 'gekoppeld' AND k.property IS NOT NULL", [])).rows;
  const uit = { sites: 0, ververst: 0, mislukt: 0 };
  for (const r of rijen) {
    uit.sites++;
    try { const u = await ververs(db, ctx, { id: r.account_id, pakket: r.pakket }, r.site_id, { tijd }); if (!u.overgeslagen) uit.ververst++; }
    catch (e) { uit.mislukt++; await ctx.logger?.log('fout', `search console site=${r.site_id} mislukt status=${e.status || 500}`); }
  }
  return uit;
}

// Verbreken: toegang intrekken bij Google, daarna alles van deze koppeling verwijderen.
export async function verbreek(db, ctx, account, siteId) {
  await eigenSite(db, account.id, siteId);
  const ref = await geheim(db, account.id, siteId, 'google_refresh');
  if (ref) await ctx.google.trekIn(ontsleutel(ctx.geheimenSleutel, ref.versleuteld, account.id));
  await db.transactie(async (tx) => {
    await tx.query("DELETE FROM geheimen WHERE account_id = $1 AND site_id = $2 AND soort IN ('google_refresh', 'google_access')", [account.id, siteId]);
    await tx.query('DELETE FROM gsc_cijfers WHERE site_id = $1 AND account_id = $2', [siteId, account.id]);
    await tx.query('DELETE FROM gsc_koppelingen WHERE site_id = $1 AND account_id = $2', [siteId, account.id]);
    await tx.query('DELETE FROM oauth_staten WHERE site_id = $1 AND account_id = $2', [siteId, account.id]);
  });
  await ctx.logger?.log('info', `search console verbroken account=${account.id} site=${siteId}`);
}

// Voor het dashboard: per gekoppelde site de klikken en vertoningen van de laatste periode.
export async function samenvatting(db, accountId) {
  const rijen = (await db.query("SELECT k.site_id, s.domein, k.status, k.periode_start, k.periode_eind, (SELECT COALESCE(SUM(c.klikken), 0) FROM gsc_cijfers c WHERE c.site_id = k.site_id AND c.periode_eind = k.periode_eind) AS klikken, (SELECT COALESCE(SUM(c.vertoningen), 0) FROM gsc_cijfers c WHERE c.site_id = k.site_id AND c.periode_eind = k.periode_eind) AS vertoningen FROM gsc_koppelingen k JOIN sites s ON s.id = k.site_id WHERE k.account_id = $1 ORDER BY s.aangemaakt", [accountId])).rows;
  return rijen.map((r) => ({ ...r, klikken: Number(r.klikken), vertoningen: Number(r.vertoningen) }));
}

// Voor contentrefresh: klikken per pagina in de laatste periode en in de periode van ongeveer 28 dagen eerder.
export async function klikkenPerPagina(db, accountId, siteId) {
  const k = (await db.query('SELECT periode_eind FROM gsc_koppelingen WHERE site_id = $1 AND account_id = $2', [siteId, accountId])).rows[0];
  const leeg = { periode: null, vorigePeriode: null, huidig: {}, vorige: {} };
  if (!k?.periode_eind) return leeg;
  const vorigeEind = new Date(`${k.periode_eind}T12:00:00Z`); vorigeEind.setUTCDate(vorigeEind.getUTCDate() - PERIODE_DAGEN);
  const vorige = (await db.query('SELECT periode_eind FROM gsc_cijfers WHERE site_id = $1 AND periode_eind <= $2 ORDER BY periode_eind DESC LIMIT 1', [siteId, vorigeEind.toISOString().slice(0, 10)])).rows[0]?.periode_eind || null;
  const lees = async (eind) => eind ? Object.fromEntries((await db.query('SELECT pagina, klikken FROM gsc_cijfers WHERE site_id = $1 AND account_id = $2 AND periode_eind = $3', [siteId, accountId, eind])).rows.map((r) => [r.pagina.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/$/, ''), Number(r.klikken)])) : {};
  return { periode: k.periode_eind, vorigePeriode: vorige, huidig: await lees(k.periode_eind), vorige: await lees(vorige) };
}
