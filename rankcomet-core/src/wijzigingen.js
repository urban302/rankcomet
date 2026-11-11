// Voorstellen voor wijzigingen op een klantsite (stap 3). De harde regels staan hier in code:
// - niets gaat naar de site zonder goedkeuring in de app (status voorstel -> goedgekeurd -> gepubliceerd);
// - een herhaalpoging publiceert nooit twee keer (het id is de idempotentiesleutel, de plugin kent het);
// - alleen velden uit velden.js, dus nooit prijs, voorraad, SKU of bestellingen;
// - per veld blijft de oude waarde bewaard, zodat terugzetten altijd kan;
// - volumerem per site per maand uit pakketten.json;
// - alles gefilterd op account én site.
import { randomUUID, randomBytes } from 'node:crypto';
import { Fout } from './accounts.js';
import { controleerVelden, WOOCOMMERCE_TYPES } from './velden.js';
import { pakketVoor } from './pakketten.js';
import { huidigeMaand } from './artikelen.js';
import { versleutel, ontsleutel } from './geheimen.js';
import { maakWpClient } from './wordpress.js';

const nu = () => new Date().toISOString();

// --- Pluginsleutel per site, versleuteld opgeslagen (AES-GCM, account-id als AAD) ---

export async function maakPluginSleutel(db, geheimenSleutel, accountId, siteId) {
  const site = (await db.query('SELECT id FROM sites WHERE id = $1 AND account_id = $2', [siteId, accountId])).rows[0];
  if (!site) throw new Fout('Site niet gevonden.', 404);
  const sleutel = randomBytes(32).toString('base64url');
  await db.transactie(async (tx) => {
    await tx.query("DELETE FROM geheimen WHERE account_id = $1 AND site_id = $2 AND soort = 'plugin_sleutel'", [accountId, siteId]);
    await tx.query("INSERT INTO geheimen (id, account_id, site_id, soort, versleuteld, aangemaakt) VALUES ($1, $2, $3, 'plugin_sleutel', $4, $5)",
      [randomUUID(), accountId, siteId, versleutel(geheimenSleutel, sleutel, accountId), nu()]);
  });
  return sleutel; // alleen nu zichtbaar; daarna alleen nog versleuteld in de database
}

async function pluginSleutel(db, geheimenSleutel, accountId, siteId) {
  const r = (await db.query("SELECT versleuteld FROM geheimen WHERE account_id = $1 AND site_id = $2 AND soort = 'plugin_sleutel'", [accountId, siteId])).rows[0];
  if (!r) throw new Fout('Er is nog geen pluginsleutel voor deze site. Maak er een aan en zet die in de Rankcomet-plugin.', 400, { plugin: 'geen_sleutel' });
  return ontsleutel(geheimenSleutel, r.versleuteld, accountId);
}

// Site van dit account, gekoppeld, met een WP-client. Site van een ander account: 404.
export async function clientVoorSite(db, ctx, accountId, siteId) {
  const site = (await db.query('SELECT id, domein, platform, eigendom_bevestigd FROM sites WHERE id = $1 AND account_id = $2', [siteId, accountId])).rows[0];
  if (!site) throw new Fout('Site niet gevonden.', 404);
  if (!site.eigendom_bevestigd) throw new Fout(`Bevestig eerst dat ${site.domein} van jou is.`, 403, { koppelen: site.id });
  const sleutel = await pluginSleutel(db, ctx.geheimenSleutel, accountId, siteId);
  return { site, wp: maakWpClient({ ophalen: ctx.ophalen, domein: site.domein, sleutel }) };
}

export async function pluginStatus(db, ctx, accountId, siteId) {
  const { wp } = await clientVoorSite(db, ctx, accountId, siteId);
  return wp.status();
}

// --- Voorstellen ---

const velden = async (db, id) => Object.fromEntries((await db.query('SELECT veld, nieuw, oud FROM wijziging_velden WHERE wijziging_id = $1 ORDER BY veld', [id])).rows.map((r) => [r.veld, { nieuw: r.nieuw, oud: r.oud }]));

export async function haal(db, accountId, id) {
  const w = (await db.query('SELECT * FROM wijzigingen WHERE id = $1 AND account_id = $2', [id, accountId])).rows[0];
  return w ? { ...w, velden: await velden(db, id) } : null;
}

export async function lijst(db, accountId, { siteId = null, status = null } = {}) {
  const voorwaarden = ['w.account_id = $1'], params = [accountId];
  if (siteId) { params.push(siteId); voorwaarden.push(`w.site_id = $${params.length}`); }
  if (status) { params.push(status); voorwaarden.push(`w.status = $${params.length}`); }
  // Met de voorgestelde titel erbij (voor het dashboard), zonder de hele velden op te halen.
  return (await db.query(`SELECT w.*, s.domein, (SELECT v.nieuw FROM wijziging_velden v WHERE v.wijziging_id = w.id AND v.veld = 'titel') AS titel, (SELECT COUNT(*) FROM wijziging_velden v WHERE v.wijziging_id = w.id AND v.oud IS NULL) AS zonder_oud FROM wijzigingen w JOIN sites s ON s.id = w.site_id WHERE ${voorwaarden.join(' AND ')} ORDER BY w.aangemaakt DESC`, params)).rows;
}

// Legt een voorstel vast. Haalt eerst de huidige waarden op bij de plugin (de 'oude' waarden), zodat
// de klant het verschil ziet en later kan terugzetten. doelId null = nieuw onderdeel (altijd concept).
export async function stelVoor(db, ctx, account, siteId, { doelType, doelId = null, velden: invoer, reden }) {
  const schoon = controleerVelden(doelType, invoer);
  if (typeof reden !== 'string' || !reden.trim()) throw new Fout('Geef een reden voor deze wijziging.', 400);
  const { site, wp } = await clientVoorSite(db, ctx, account.id, siteId);
  if (WOOCOMMERCE_TYPES.includes(doelType)) {
    if (site.platform !== 'woocommerce') throw new Fout(`${site.domein} is geen WooCommerce-webshop.`, 400);
    if (!pakketVoor(account.pakket).woocommerce_producten) throw new Fout(`Je pakket ${pakketVoor(account.pakket).naam} bevat geen WooCommerce-productteksten.`, 403);
  }
  let oud = {};
  if (doelId !== null) {
    const huidig = await wp.haalDoel(doelType, doelId);
    oud = huidig.velden || {};
  }
  const id = randomUUID(), t = nu();
  await db.transactie(async (tx) => {
    await tx.query('INSERT INTO wijzigingen (id, account_id, site_id, doel_type, doel_id, modus, reden, status, maand, aangemaakt, bijgewerkt) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)',
      [id, account.id, siteId, doelType, doelId === null ? null : String(doelId), 'concept', reden.trim(), 'voorstel', huidigeMaand(), t]);
    for (const [veld, nieuw] of Object.entries(schoon)) {
      await tx.query('INSERT INTO wijziging_velden (wijziging_id, veld, nieuw, oud) VALUES ($1, $2, $3, $4)', [id, veld, nieuw, oud[veld] ?? null]);
    }
  });
  return haal(db, account.id, id);
}

// Statusovergang in één voorwaardelijke UPDATE: twee gelijktijdige klikken wijzigen maar één keer.
async function zetStatus(db, id, van, naar, extra = {}) {
  const kolommen = ['status = $1', 'bijgewerkt = $2'], params = [naar, nu()];
  for (const [k, v] of Object.entries(extra)) { params.push(v); kolommen.push(`${k} = $${params.length}`); }
  params.push(id, ...van);
  const r = await db.query(`UPDATE wijzigingen SET ${kolommen.join(', ')} WHERE id = $${params.length - van.length} AND status IN (${van.map((_, i) => `$${params.length - van.length + 1 + i}`).join(', ')})`, params);
  return r.rowCount > 0;
}

// Goedkeuren: volumerem controleren (per site per maand, in een transactie met rijslot), dan publiceren.
// modus 'concept' zet het op de site klaar als concept; 'publiceren' zet het live.
export async function keurGoed(db, ctx, account, id, modus = 'concept') {
  if (!['concept', 'publiceren'].includes(modus)) throw new Fout('Kies: als concept klaarzetten of publiceren.', 400);
  const w = await haal(db, account.id, id);
  if (!w) throw new Fout('Voorstel niet gevonden.', 404);
  if (w.status !== 'voorstel') throw new Fout('Dit voorstel is al behandeld.', 409);
  const pk = pakketVoor(account.pakket), maand = huidigeMaand();
  await db.transactie(async (tx) => {
    await tx.query(`SELECT id FROM sites WHERE id = $1${tx.soort === 'pg' ? ' FOR UPDATE' : ''}`, [w.site_id]);
    const n = Number((await tx.query("SELECT COUNT(*) AS n FROM wijzigingen WHERE site_id = $1 AND maand = $2 AND status IN ('goedgekeurd', 'gepubliceerd', 'mislukt') AND terugzet_van IS NULL", [w.site_id, maand])).rows[0].n);
    if (n >= pk.wijzigingen_per_site_per_maand) {
      throw new Fout(`Voor deze site is deze maand het maximum van ${pk.wijzigingen_per_site_per_maand} wijzigingen van je pakket ${pk.naam} bereikt. Volgende maand kan het weer.`, 403, { volumerem: true });
    }
    const ok = await zetStatus(tx, id, ['voorstel'], 'goedgekeurd', { modus, maand, melding: null });
    if (!ok) throw new Fout('Dit voorstel is al behandeld.', 409);
  });
  return publiceer(db, ctx, account, id);
}

export async function wijsAf(db, account, id, reden = '') {
  const w = await haal(db, account.id, id); // eerst het account, dan pas iets wijzigen
  if (!w) throw new Fout('Voorstel niet gevonden.', 404);
  const ok = await zetStatus(db, id, ['voorstel'], 'afgewezen', { melding: String(reden || '').trim() || null });
  if (!ok && w.status !== 'afgewezen') throw new Fout('Dit voorstel is al behandeld.', 409);
  return haal(db, account.id, id);
}

// Stuurt een goedgekeurde (of eerder mislukte) wijziging naar de plugin. Vóór het sturen halen we de
// huidige waarden opnieuw op: is de site intussen met de hand gewijzigd, dan gaat het voorstel terug
// naar de rij met een melding. Een herhaling van een al gepubliceerde wijziging doet niets.
export async function publiceer(db, ctx, account, id) {
  const w = await haal(db, account.id, id);
  if (!w) throw new Fout('Voorstel niet gevonden.', 404);
  if (w.status === 'gepubliceerd') return { wijziging: w, alGedaan: true };
  if (!['goedgekeurd', 'mislukt'].includes(w.status)) throw new Fout('Dit voorstel is nog niet goedgekeurd.', 409);
  const { wp } = await clientVoorSite(db, ctx, account.id, w.site_id);
  if (w.doel_id !== null && !w.terugzet_van) {
    const huidig = (await wp.haalDoel(w.doel_type, w.doel_id)).velden || {};
    // Een veld telt als 'met de hand gewijzigd' als de huidige waarde noch de oude, noch de nieuwe is.
    // Staat de nieuwe waarde er al (een eerdere poging kwam wel aan, het antwoord niet), dan is dat geen drift.
    const anders = Object.entries(w.velden).filter(([veld, v]) => { const h = huidig[veld] ?? null; return h !== (v.oud ?? null) && h !== v.nieuw; }).map(([veld]) => veld);
    if (anders.length) {
      await db.transactie(async (tx) => {
        for (const veld of anders) await tx.query('UPDATE wijziging_velden SET oud = $1 WHERE wijziging_id = $2 AND veld = $3', [huidig[veld] ?? null, id, veld]);
        await zetStatus(tx, id, ['goedgekeurd', 'mislukt'], 'voorstel', { melding: `De site is intussen aangepast (${anders.join(', ')}). Kijk het voorstel opnieuw na.` });
      });
      return { wijziging: await haal(db, account.id, id), terugNaarRij: true };
    }
  }
  try {
    const r = await wp.pasToe({ id, doel_type: w.doel_type, doel_id: w.doel_id, modus: w.modus, velden: Object.fromEntries(Object.entries(w.velden).map(([k, v]) => [k, v.nieuw])) });
    await zetStatus(db, id, ['goedgekeurd', 'mislukt'], 'gepubliceerd', { gepubliceerd: nu(), doel_id: r.doel_id != null ? String(r.doel_id) : w.doel_id, melding: null });
    if (w.terugzet_van) await zetStatus(db, w.terugzet_van, ['gepubliceerd'], 'teruggezet');
    return { wijziging: await haal(db, account.id, id), alGedaan: Boolean(r.al_eerder) };
  } catch (e) {
    if (!(e instanceof Fout)) throw e;
    await zetStatus(db, id, ['goedgekeurd', 'mislukt'], 'mislukt', { melding: e.message });
    throw e;
  }
}

// Terugzetten: een nieuwe wijziging met de oude waarden, meteen goedgekeurd (de klant klikte er zelf op),
// via dezelfde idempotente weg. Telt niet mee voor de volumerem. Nieuwe velden zonder oude waarde
// (een nieuw onderdeel) kunnen we niet terugzetten.
export async function zetTerug(db, ctx, account, id) {
  const w = await haal(db, account.id, id);
  if (!w) throw new Fout('Voorstel niet gevonden.', 404);
  if (w.status !== 'gepubliceerd') throw new Fout('Alleen een gepubliceerde wijziging kun je terugzetten.', 409);
  if (w.doel_id === null || Object.values(w.velden).some((v) => v.oud === null)) throw new Fout('Dit was een nieuw onderdeel; verwijder het op je site zelf.', 400);
  const bestaand = (await db.query('SELECT id FROM wijzigingen WHERE terugzet_van = $1 AND account_id = $2', [id, account.id])).rows[0];
  const terugId = bestaand ? bestaand.id : randomUUID();
  if (!bestaand) {
    const t = nu();
    await db.transactie(async (tx) => {
      await tx.query('INSERT INTO wijzigingen (id, account_id, site_id, doel_type, doel_id, modus, reden, status, terugzet_van, maand, aangemaakt, bijgewerkt) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)',
        [terugId, account.id, w.site_id, w.doel_type, w.doel_id, w.modus, `Teruggezet door de klant`, 'goedgekeurd', id, huidigeMaand(), t]);
      for (const [veld, v] of Object.entries(w.velden)) await tx.query('INSERT INTO wijziging_velden (wijziging_id, veld, nieuw, oud) VALUES ($1, $2, $3, $4)', [terugId, veld, v.oud, v.nieuw]);
    });
  }
  return publiceer(db, ctx, account, terugId);
}
