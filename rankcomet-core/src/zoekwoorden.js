// Zoekwoorden per site (stap 6): onderzoeken (DataForSEO), bewaren, volgen en zelf toevoegen.
// Harde regels in code: het aantal gevolgde zoekwoorden per site uit het pakket (A7: 100), een grens op het
// aantal onderzoeken per site per dag (elke aanroep kost geld), en alles gefilterd op account én site.
import { randomUUID } from 'node:crypto';
import { Fout } from './accounts.js';
import { pakketVoor } from './pakketten.js';
import { huidigeDag } from './artikelen.js';

const nu = () => new Date().toISOString();
const MAX_BEWAARD_PER_SITE = 500; // [A58] ideeën die niemand volgt, hooguit 500 per site; oudere worden vervangen

export function normaliseerZoekwoord(z) {
  const s = String(z || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (s.length < 2 || s.length > 100) throw new Fout('Vul een zoekwoord in van 2 tot 100 tekens.', 400);
  return s;
}

async function eigenSite(db, accountId, siteId) {
  const site = (await db.query('SELECT id, domein, land, eigendom_bevestigd FROM sites WHERE id = $1 AND account_id = $2', [siteId, accountId])).rows[0];
  if (!site) throw new Fout('Site niet gevonden.', 404);
  return site;
}

export async function lijst(db, accountId, siteId, { alleenGevolgd = false } = {}) {
  await eigenSite(db, accountId, siteId);
  return (await db.query(`SELECT id, zoekwoord, volume, cpc, moeilijkheid, intentie, bron, gevolgd, bijgewerkt FROM zoekwoorden WHERE account_id = $1 AND site_id = $2${alleenGevolgd ? ' AND gevolgd = 1' : ''} ORDER BY gevolgd DESC, volume DESC NULLS LAST, zoekwoord`, [accountId, siteId])).rows
    .map((r) => ({ ...r, gevolgd: Boolean(r.gevolgd) }));
}

// Bewaart ideeën: bestaande rijen bijwerken (volgstatus blijft), nieuwe toevoegen.
async function bewaar(tx, accountId, siteId, items, bron) {
  const t = nu();
  for (const i of items) {
    const r = await tx.query('UPDATE zoekwoorden SET volume = $1, cpc = $2, moeilijkheid = $3, intentie = COALESCE($4, intentie), bijgewerkt = $5 WHERE account_id = $6 AND site_id = $7 AND zoekwoord = $8',
      [i.volume ?? null, i.cpc ?? null, i.moeilijkheid ?? null, i.intentie ?? null, t, accountId, siteId, i.zoekwoord]);
    if (!r.rowCount) await tx.query('INSERT INTO zoekwoorden (id, account_id, site_id, zoekwoord, volume, cpc, moeilijkheid, intentie, bron, gevolgd, aangemaakt, bijgewerkt) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $10, $10)',
      [randomUUID(), accountId, siteId, i.zoekwoord, i.volume ?? null, i.cpc ?? null, i.moeilijkheid ?? null, i.intentie ?? 'onbekend', bron, t]);
  }
  // Opruimen: niet-gevolgde ideeën boven het maximum, oudste eerst (OFFSET zonder LIMIT verschilt per dialect, dus in JS).
  const nietGevolgd = (await tx.query('SELECT id FROM zoekwoorden WHERE site_id = $1 AND gevolgd = 0 ORDER BY bijgewerkt DESC, zoekwoord', [siteId])).rows;
  for (const r of nietGevolgd.slice(MAX_BEWAARD_PER_SITE)) { await tx.query('DELETE FROM posities WHERE zoekwoord_id = $1', [r.id]); await tx.query('DELETE FROM zoekwoorden WHERE id = $1', [r.id]); }
}

// Onderzoek: ideeën bij een startwoord ophalen en bewaren. Begrensd per site per dag (pakketten.json).
export async function onderzoek(db, ctx, account, siteId, { startwoord, land = null }) {
  const site = await eigenSite(db, account.id, siteId); // eerst het account (404), dan de invoer
  const woord = normaliseerZoekwoord(startwoord);
  const pk = pakketVoor(account.pakket), dag = huidigeDag();
  await db.transactie(async (tx) => {
    await tx.query(`SELECT id FROM sites WHERE id = $1${tx.soort === 'pg' ? ' FOR UPDATE' : ''}`, [siteId]);
    const n = Number((await tx.query('SELECT COUNT(*) AS n FROM onderzoeken WHERE site_id = $1 AND dag = $2', [siteId, dag])).rows[0].n);
    if (n >= pk.onderzoeken_per_site_per_dag) throw new Fout(`Voor ${site.domein} zijn vandaag al ${pk.onderzoeken_per_site_per_dag} onderzoeken gedaan. Morgen kan het weer.`, 429, { tempo: true });
    await tx.query('INSERT INTO onderzoeken (id, account_id, site_id, startwoord, dag, aantal, kosten_usd, aangemaakt) VALUES ($1, $2, $3, $4, $5, 0, 0, $6)', [randomUUID(), account.id, siteId, woord, dag, nu()]);
  });
  const { ideeen, kostenUsd } = await ctx.dataforseo.zoekwoordIdeeen({ zoekwoord: woord, land: land || site.land });
  await db.transactie(async (tx) => {
    await bewaar(tx, account.id, siteId, ideeen, 'idee');
    await tx.query('UPDATE onderzoeken SET aantal = $1, kosten_usd = $2 WHERE site_id = $3 AND startwoord = $4 AND dag = $5', [ideeen.length, kostenUsd, siteId, woord, dag]);
  });
  await ctx.logger?.log('info', `zoekwoordonderzoek account=${account.id} site=${siteId} aantal=${ideeen.length} kosten_usd=${kostenUsd}`);
  return { aantal: ideeen.length, zoekwoorden: await lijst(db, account.id, siteId) };
}

// Eigen zoekwoord toevoegen (met volume uit Google Ads) en meteen volgen.
export async function voegToe(db, ctx, account, siteId, { zoekwoord, land = null }) {
  const site = await eigenSite(db, account.id, siteId); // eerst het account (404), dan de invoer
  const woord = normaliseerZoekwoord(zoekwoord);
  const { volumes, kostenUsd } = await ctx.dataforseo.zoekvolumes({ zoekwoorden: [woord], land: land || site.land });
  const v = volumes[woord] || {};
  await db.transactie(async (tx) => bewaar(tx, account.id, siteId, [{ zoekwoord: woord, volume: v.volume ?? null, cpc: v.cpc ?? null, intentie: null }], 'eigen'));
  await ctx.logger?.log('info', `zoekwoord toegevoegd account=${account.id} site=${siteId} kosten_usd=${kostenUsd}`);
  const rij = (await db.query('SELECT id FROM zoekwoorden WHERE site_id = $1 AND zoekwoord = $2', [siteId, woord])).rows[0];
  return volg(db, account, siteId, rij.id);
}

// Volgen: hooguit zoekwoorden_volgen per site (A7), in een transactie met rijslot op de site.
export async function volg(db, account, siteId, zoekwoordId) {
  const site = await eigenSite(db, account.id, siteId);
  const pk = pakketVoor(account.pakket);
  return db.transactie(async (tx) => {
    await tx.query(`SELECT id FROM sites WHERE id = $1${tx.soort === 'pg' ? ' FOR UPDATE' : ''}`, [siteId]);
    const rij = (await tx.query('SELECT id, gevolgd FROM zoekwoorden WHERE id = $1 AND account_id = $2 AND site_id = $3', [zoekwoordId, account.id, siteId])).rows[0];
    if (!rij) throw new Fout('Zoekwoord niet gevonden.', 404);
    if (rij.gevolgd) return { gevolgd: true, al: true };
    const n = Number((await tx.query('SELECT COUNT(*) AS n FROM zoekwoorden WHERE site_id = $1 AND gevolgd = 1', [siteId])).rows[0].n);
    if (n >= pk.zoekwoorden_volgen) throw new Fout(`Je volgt voor ${site.domein} al ${pk.zoekwoorden_volgen} zoekwoorden, het maximum van je pakket. Stop met het volgen van een ander zoekwoord om dit te volgen.`, 403, { limiet: true });
    await tx.query('UPDATE zoekwoorden SET gevolgd = 1, bijgewerkt = $1 WHERE id = $2', [nu(), zoekwoordId]);
    return { gevolgd: true, al: false };
  });
}

export async function ontvolg(db, account, siteId, zoekwoordId) {
  await eigenSite(db, account.id, siteId);
  const r = await db.query('UPDATE zoekwoorden SET gevolgd = 0, bijgewerkt = $1 WHERE id = $2 AND account_id = $3 AND site_id = $4', [nu(), zoekwoordId, account.id, siteId]);
  if (!r.rowCount) throw new Fout('Zoekwoord niet gevonden.', 404);
  return { gevolgd: false };
}

export async function kostenOverzicht(db, accountId, siteId, dag = huidigeDag()) {
  await eigenSite(db, accountId, siteId);
  const r = (await db.query('SELECT COUNT(*) AS n, COALESCE(SUM(kosten_usd), 0) AS kosten FROM onderzoeken WHERE site_id = $1 AND dag = $2', [siteId, dag])).rows[0];
  return { vandaag: Number(r.n), kostenUsd: Math.round(Number(r.kosten) * 10000) / 10000 };
}
