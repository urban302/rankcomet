// Rank tracking (stap 7): per gevolgd zoekwoord één SERP-aanroep per dag bij DataForSEO.
// Harde regels in code:
// - per zoekwoord per dag hooguit één aanroep: de rij (zoekwoord_id, dag) wordt vóór de aanroep geclaimd met
//   INSERT ... ON CONFLICT DO NOTHING; een herhaling, een handmatige controle of twee gelijktijdige runs betalen
//   dus nooit dubbel, en het aantal aanroepen per site per dag is nooit hoger dan het aantal gevolgde zoekwoorden;
// - alles gefilterd op account én site.
import { randomUUID } from 'node:crypto';
import { Fout } from './accounts.js';
import { huidigeDag } from './artikelen.js';

const nu = () => new Date().toISOString();
const dagEerder = (dag, n) => { const d = new Date(`${dag}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

async function eigenSite(db, accountId, siteId) {
  const site = (await db.query('SELECT id, domein, land FROM sites WHERE id = $1 AND account_id = $2', [siteId, accountId])).rows[0];
  if (!site) throw new Fout('Site niet gevonden.', 404);
  return site;
}

// Controleert de posities van alle gevolgde zoekwoorden van één site voor vandaag. Geeft terug hoeveel
// zoekwoorden zijn gecontroleerd en hoeveel al gedaan waren (overgeslagen, niet betaald).
export async function controleer(db, ctx, account, siteId, tijd = new Date()) {
  const site = await eigenSite(db, account.id, siteId);
  const dag = huidigeDag(tijd);
  const gevolgd = (await db.query('SELECT id, zoekwoord FROM zoekwoorden WHERE site_id = $1 AND account_id = $2 AND gevolgd = 1 ORDER BY zoekwoord', [siteId, account.id])).rows;
  let gedaan = 0, overgeslagen = 0, mislukt = 0, kosten = 0;
  for (const z of gevolgd) {
    const id = randomUUID();
    const claim = await db.query('INSERT INTO posities (id, account_id, site_id, zoekwoord_id, dag, status, kosten_usd, aangemaakt) VALUES ($1, $2, $3, $4, $5, $6, 0, $7) ON CONFLICT (zoekwoord_id, dag) DO NOTHING',
      [id, account.id, siteId, z.id, dag, 'bezig', nu()]);
    if (!claim.rowCount) { overgeslagen++; continue; }
    try {
      const r = await ctx.dataforseo.positie({ zoekwoord: z.zoekwoord, land: site.land, domein: site.domein });
      await db.query('UPDATE posities SET status = $1, positie = $2, url = $3, kosten_usd = $4, bijgewerkt = $5 WHERE id = $6', ['klaar', r.positie, r.url, r.kostenUsd, nu(), id]);
      gedaan++; kosten += r.kostenUsd;
    } catch (e) {
      // Mislukt: de claim blijft staan voor vandaag (geen tweede poging die opnieuw kost); morgen opnieuw. [A62]
      await db.query('UPDATE posities SET status = $1, bijgewerkt = $2 WHERE id = $3', ['mislukt', nu(), id]);
      mislukt++;
      if (!(e instanceof Fout)) throw e;
    }
  }
  await ctx.logger?.log('info', `rankcheck account=${account.id} site=${siteId} dag=${dag} gedaan=${gedaan} overgeslagen=${overgeslagen} mislukt=${mislukt} kosten_usd=${Math.round(kosten * 10000) / 10000}`);
  return { dag, gedaan, overgeslagen, mislukt, kostenUsd: Math.round(kosten * 10000) / 10000 };
}

// De planning: alle sites met gevolgde zoekwoorden, één keer per dag. Idempotent door de claim per
// zoekwoord per dag, dus elk uur aanroepen kan geen kwaad. Een fout bij één site stopt de rest niet.
export async function controleerAlleSites(db, ctx, tijd = new Date()) {
  const rijen = (await db.query('SELECT DISTINCT s.id AS site_id, a.id AS account_id, a.pakket FROM zoekwoorden z JOIN sites s ON s.id = z.site_id JOIN accounts a ON a.id = s.account_id WHERE z.gevolgd = 1 AND s.eigendom_bevestigd IS NOT NULL ORDER BY s.id', [])).rows;
  const uitkomst = { sites: 0, gedaan: 0, overgeslagen: 0, mislukt: 0 };
  for (const r of rijen) {
    try {
      const u = await controleer(db, ctx, { id: r.account_id, pakket: r.pakket }, r.site_id, tijd);
      uitkomst.sites++; uitkomst.gedaan += u.gedaan; uitkomst.overgeslagen += u.overgeslagen; uitkomst.mislukt += u.mislukt;
    } catch (e) {
      await ctx.logger?.log('fout', `rankcheck site=${r.site_id} mislukt ${e.name}`);
    }
  }
  return uitkomst;
}

// Per gevolgd zoekwoord: de laatste positie, de URL, de positie van een week eerder en het verschil
// (positief = beter, dus een lager getal). Alleen de eigen site.
export async function overzicht(db, accountId, siteId, tijd = new Date()) {
  await eigenSite(db, accountId, siteId);
  const dag = huidigeDag(tijd), weekTerug = dagEerder(dag, 7);
  const rijen = (await db.query(`SELECT z.id, z.zoekwoord, z.volume,
      (SELECT p.positie FROM posities p WHERE p.zoekwoord_id = z.id AND p.status = 'klaar' ORDER BY p.dag DESC LIMIT 1) AS positie,
      (SELECT p.url FROM posities p WHERE p.zoekwoord_id = z.id AND p.status = 'klaar' ORDER BY p.dag DESC LIMIT 1) AS url,
      (SELECT p.dag FROM posities p WHERE p.zoekwoord_id = z.id AND p.status = 'klaar' ORDER BY p.dag DESC LIMIT 1) AS dag,
      (SELECT p.positie FROM posities p WHERE p.zoekwoord_id = z.id AND p.status = 'klaar' AND p.dag <= $3 ORDER BY p.dag DESC LIMIT 1) AS week_terug
    FROM zoekwoorden z WHERE z.site_id = $1 AND z.account_id = $2 AND z.gevolgd = 1 ORDER BY CASE WHEN (SELECT p.positie FROM posities p WHERE p.zoekwoord_id = z.id AND p.status = 'klaar' ORDER BY p.dag DESC LIMIT 1) IS NULL THEN 1 ELSE 0 END, 4, z.zoekwoord`, [siteId, accountId, weekTerug])).rows;
  return rijen.map((r) => {
    const positie = r.positie == null ? null : Number(r.positie), week = r.week_terug == null ? null : Number(r.week_terug);
    return { id: r.id, zoekwoord: r.zoekwoord, volume: r.volume, positie, url: r.url, dag: r.dag, weekTerug: week, verschil: positie != null && week != null ? week - positie : null };
  });
}

// Voor het dashboard: per site hoeveel gevolgd, hoeveel in de top 10, hoeveel beter en slechter dan een week geleden.
export async function samenvatting(db, accountId, tijd = new Date()) {
  const sitesLijst = (await db.query('SELECT id, domein FROM sites WHERE account_id = $1 AND eigendom_bevestigd IS NOT NULL ORDER BY aangemaakt, domein', [accountId])).rows;
  const uit = [];
  for (const s of sitesLijst) {
    const o = await overzicht(db, accountId, s.id, tijd);
    if (!o.length) continue;
    uit.push({ id: s.id, domein: s.domein, gevolgd: o.length, gemeten: o.filter((z) => z.positie != null).length, top10: o.filter((z) => z.positie != null && z.positie <= 10).length, beter: o.filter((z) => z.verschil > 0).length, slechter: o.filter((z) => z.verschil < 0).length });
  }
  return uit;
}
