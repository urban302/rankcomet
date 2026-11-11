// Wachtrij voor het schrijven (stap 11). Een artikel of opfrisvoorstel duurt een minuut; dat hoort niet in het
// HTTP-verzoek. De controles en de reservering (volumerem, temporem, daggrens) gebeuren wél direct in het verzoek,
// zodat de klant meteen hoort of het kan. Daarna staat de taak in `taken`, "we zijn bezig" in de app, en een
// mail als het klaar is. Harde regels in code:
// - één taak tegelijk per proces (de werker claimt er één en wacht tot die klaar is);
// - nooit twee keer dezelfde taak: UNIQUE open_sleutel zolang de taak open is, en een claim is één atomaire UPDATE;
// - een taak die vastloopt (proces gestopt) wordt niet opnieuw gedraaid maar afgemeld (A75), zodat er nooit
//   twee voorstellen uit één verzoek komen; de reservering wordt teruggeboekt.
import { randomUUID } from 'node:crypto';
import { Fout } from './accounts.js';
import { boekTerug } from './artikelen.js';
import { schrijfGereserveerdArtikel } from './pijplijn.js';
import { schrijfOpfrissing } from './opfrissen.js';
import { taakKlaarMail, taakMisluktMail } from './mail.js';

const iso = (t = new Date()) => t.toISOString();
export const SOORTEN = ['artikel', 'opfrissen'];
export const VASTGELOPEN_MS = 30 * 60 * 1000; // [A75] langer dan 30 minuten bezig = vastgelopen
const TE_LANG = 'Dit duurde te lang en is gestopt. Probeer het opnieuw.';

// Een taak in de rij zetten. Staat dezelfde taak (site, soort, sleutel) al open, dan komt die terug met bestond: true.
export async function plaatsTaak(db, { accountId, siteId, soort, sleutel, invoer }, tijd = new Date()) {
  if (!SOORTEN.includes(soort)) throw new Fout('Onbekende taak.', 400);
  const id = randomUUID(), open = `${siteId}|${soort}|${String(sleutel).toLowerCase().slice(0, 200)}`;
  const r = await db.query('INSERT INTO taken (id, account_id, site_id, soort, sleutel, open_sleutel, invoer, status, aangemaakt, bijgewerkt) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) ON CONFLICT (open_sleutel) DO NOTHING',
    [id, accountId, siteId, soort, String(sleutel).slice(0, 200), open, JSON.stringify(invoer), 'wacht', iso(tijd)]);
  if (r.rowCount) return { id, bestond: false };
  const bestaand = (await db.query('SELECT id FROM taken WHERE open_sleutel = $1 AND account_id = $2', [open, accountId])).rows[0];
  if (!bestaand) throw new Fout('Deze taak staat al in de rij.', 409);
  return { id: bestaand.id, bestond: true };
}

// Taken van een account (en eventueel één site): open taken en de laatste afgeronde.
export async function lijst(db, accountId, { siteId = null, max = 20 } = {}) {
  const rijen = (await db.query(`SELECT t.id, t.site_id, s.domein, t.soort, t.sleutel, t.status, t.melding, t.wijziging_id, t.aangemaakt, t.klaar FROM taken t JOIN sites s ON s.id = t.site_id WHERE t.account_id = $1${siteId ? ' AND t.site_id = $2' : ''} ORDER BY t.aangemaakt DESC LIMIT ${Math.max(1, Math.min(100, max))}`, siteId ? [accountId, siteId] : [accountId])).rows;
  return rijen.map((t) => ({ id: t.id, siteId: t.site_id, domein: t.domein, soort: t.soort, onderwerp: t.sleutel, status: t.status, melding: t.melding, wijzigingId: t.wijziging_id, aangemaakt: t.aangemaakt, klaar: t.klaar, open: t.status === 'wacht' || t.status === 'bezig' }));
}

// Eén taak claimen: één atomaire UPDATE, dus twee processen krijgen nooit dezelfde taak.
async function claim(db, proces, tijd) {
  const r = await db.query("UPDATE taken SET status = 'bezig', gestart = $1, bijgewerkt = $1, proces = $2 WHERE id = (SELECT id FROM taken WHERE status = 'wacht' ORDER BY aangemaakt LIMIT 1) AND status = 'wacht' RETURNING id, account_id, site_id, soort, sleutel, invoer", [iso(tijd), proces]);
  return r.rows[0] || null;
}

async function sluitAf(db, taak, { status, melding = null, wijzigingId = null }, tijd) {
  await db.query('UPDATE taken SET status = $1, melding = $2, wijziging_id = $3, open_sleutel = NULL, klaar = $4, bijgewerkt = $4 WHERE id = $5', [status, melding ? String(melding).slice(0, 1000) : null, wijzigingId, iso(tijd), taak.id]);
}

// De reservering van een taak die niet doorgaat vrijgeven: artikel terugboeken of opfrissing op mislukt.
async function geefVrij(db, taak, melding) {
  const invoer = typeof taak.invoer === 'string' ? JSON.parse(taak.invoer) : taak.invoer;
  if (taak.soort === 'artikel' && invoer.artikelId) await boekTerug(db, taak.account_id, invoer.artikelId, melding);
  if (taak.soort === 'opfrissen' && invoer.opfrissingId) await db.query("UPDATE opfrissingen SET status = 'mislukt', melding = $1, bijgewerkt = $2 WHERE id = $3 AND account_id = $4 AND status = 'bezig'", [melding, iso(), invoer.opfrissingId, taak.account_id]);
}

// Vastgelopen taken (bezig, maar het proces is weg) afmelden. Niet opnieuw draaien (A75).
export async function ruimVastgelopenOp(db, ctx, tijd = new Date()) {
  const grens = iso(new Date(tijd.getTime() - VASTGELOPEN_MS));
  const oud = (await db.query("SELECT id, account_id, site_id, soort, sleutel, invoer FROM taken WHERE status = 'bezig' AND gestart < $1", [grens])).rows;
  for (const taak of oud) {
    const r = await db.query("UPDATE taken SET status = 'mislukt', melding = $1, open_sleutel = NULL, klaar = $2, bijgewerkt = $2 WHERE id = $3 AND status = 'bezig'", [TE_LANG, iso(tijd), taak.id]);
    if (!r.rowCount) continue;
    await geefVrij(db, taak, TE_LANG);
    await ctx.logger?.log('fout', `taak vastgelopen taak=${taak.id} soort=${taak.soort}`);
    await mailResultaat(db, ctx, taak, { geslaagd: false, melding: TE_LANG });
  }
  return oud.length;
}

async function mailResultaat(db, ctx, taak, { geslaagd, melding, wijzigingId }) {
  if (!ctx.mailer) return;
  try {
    const rij = (await db.query('SELECT a.email, s.domein FROM accounts a JOIN sites s ON s.id = $2 WHERE a.id = $1', [taak.account_id, taak.site_id])).rows[0];
    if (!rij) return;
    const t = { soort: taak.soort, onderwerp: taak.sleutel, domein: rij.domein, siteId: taak.site_id, wijzigingId, melding };
    await ctx.mailer.stuur({ aan: rij.email, ...(geslaagd ? taakKlaarMail(t) : taakMisluktMail(t)) });
  } catch (e) {
    await ctx.logger?.log('fout', `taakmail mislukt taak=${taak.id} ${e.name}`);
  }
}

// Eén taak uitvoeren. Geeft null als er niets te doen is, anders { id, status }.
export async function verwerkEen(db, ctx, { proces = 'werker', tijd = new Date() } = {}) {
  await ruimVastgelopenOp(db, ctx, tijd);
  const taak = await claim(db, proces, tijd);
  if (!taak) return null;
  const invoer = JSON.parse(taak.invoer);
  const account = (await db.query('SELECT id, email, pakket FROM accounts WHERE id = $1', [taak.account_id])).rows[0];
  try {
    if (!account) throw new Fout('Account niet gevonden.', 404);
    let wijzigingId;
    if (taak.soort === 'artikel') wijzigingId = (await schrijfGereserveerdArtikel(db, ctx, account, { siteId: taak.site_id, artikelId: invoer.artikelId, zoekwoord: invoer.zoekwoord })).wijziging.id;
    else wijzigingId = (await schrijfOpfrissing(db, ctx, account, { siteId: taak.site_id, opfrissingId: invoer.opfrissingId, kandidaat: invoer.kandidaat })).wijziging.id;
    await sluitAf(db, taak, { status: 'klaar', wijzigingId }, new Date());
    await ctx.logger?.log('info', `taak klaar taak=${taak.id} soort=${taak.soort} account=${taak.account_id}`);
    await mailResultaat(db, ctx, taak, { geslaagd: true, wijzigingId });
    return { id: taak.id, status: 'klaar', wijzigingId };
  } catch (e) {
    const melding = e instanceof Fout ? e.message : 'Er ging iets mis. Probeer het later opnieuw.';
    await sluitAf(db, taak, { status: 'mislukt', melding }, new Date());
    if (!(e instanceof Fout)) await geefVrij(db, taak, melding); // een Fout uit de pijplijn heeft zelf al teruggeboekt
    await ctx.logger?.log(e instanceof Fout ? 'info' : 'fout', `taak mislukt taak=${taak.id} soort=${taak.soort} status=${e.status || 500} ${e instanceof Fout ? '' : e.name}`);
    await mailResultaat(db, ctx, taak, { geslaagd: false, melding });
    return { id: taak.id, status: 'mislukt', melding };
  }
}

// De werker: elke paar seconden kijken, één taak tegelijk, nooit twee rondes door elkaar.
export function startWerker(db, ctx, { interval = 5000, proces = `werker-${process.pid}` } = {}) {
  let bezig = false, gestopt = false;
  const ronde = async () => {
    if (bezig || gestopt) return;
    bezig = true;
    try { while (!gestopt && await verwerkEen(db, ctx, { proces })) { /* door tot de rij leeg is */ } }
    catch (e) { await ctx.logger?.log('fout', `werker ${e.name}`).catch(() => {}); }
    finally { bezig = false; }
  };
  const timer = setInterval(ronde, interval);
  timer.unref();
  return { stop: () => { gestopt = true; clearInterval(timer); }, ronde };
}
