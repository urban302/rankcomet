// Artikellimiet per maand (A6, besloten door Erwin 1-11). Solo en Pro: limiet per account.
// Bureau-proef: 10 per site per maand (5 sites = 50 totaal), niet vrij te verdelen.
// Een artikel 'reserveren' telt en registreert atomair (transactie + rijslot op het account).
// Stap 4: daarnaast een temporem per site per dag (A49) en terugboeken bij een mislukte generatie (A22):
// een teruggeboekt artikel telt niet meer mee.
import { randomUUID } from 'node:crypto';
import { Fout } from './accounts.js';
import { pakketVoor, upgradeOptie } from './pakketten.js';

// [A22] Een artikelmaand is de kalendermaand in Nederlandse tijd (Europe/Amsterdam), ook rond de zomertijd.
const NL_MAAND = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit' });
export function huidigeMaand(nu = new Date()) { return NL_MAAND.format(nu); } // 'YYYY-MM'
const NL_DAG = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' });
export function huidigeDag(nu = new Date()) { return NL_DAG.format(nu); } // 'YYYY-MM-DD'
const TELT = "status <> 'teruggeboekt'";

export async function reserveerArtikel(db, account, siteId, nu = new Date(), { zoekwoord = null } = {}) {
  const maand = huidigeMaand(nu), dag = huidigeDag(nu);
  return db.transactie(async (tx) => {
    const acc = (await tx.query(`SELECT pakket FROM accounts WHERE id = $1${tx.soort === 'pg' ? ' FOR UPDATE' : ''}`, [account.id])).rows[0];
    if (!acc) throw new Fout('Account niet gevonden.', 404);
    const site = (await tx.query('SELECT id, domein, eigendom_bevestigd FROM sites WHERE id = $1 AND account_id = $2', [siteId, account.id])).rows[0];
    if (!site) throw new Fout('Site niet gevonden.', 404);
    // Stap 2: pas artikelen als het eigendom van het domein is bevestigd.
    if (!site.eigendom_bevestigd) throw new Fout(`Bevestig eerst dat ${site.domein} van jou is. Daarna kan Rankcomet artikelen voor deze site maken.`, 403, { koppelen: site.id });
    const pk = pakketVoor(acc.pakket);
    const totaal = Number((await tx.query(`SELECT COUNT(*) AS n FROM artikelen WHERE account_id = $1 AND maand = $2 AND ${TELT}`, [account.id, maand])).rows[0].n);
    if (totaal >= pk.artikelen_per_maand) {
      const up = upgradeOptie(pk.id);
      throw new Fout(`U heeft deze maand het maximum van ${pk.artikelen_per_maand} artikelen van uw pakket ${pk.naam} bereikt.` + (up ? ` Upgrade naar ${up.naam} voor meer artikelen.` : ''), 403, { upgrade: up ? up.id : null });
    }
    if (pk.artikelen_per_site_per_maand != null) {
      const perSite = Number((await tx.query(`SELECT COUNT(*) AS n FROM artikelen WHERE site_id = $1 AND maand = $2 AND ${TELT}`, [siteId, maand])).rows[0].n);
      if (perSite >= pk.artikelen_per_site_per_maand) {
        throw new Fout(`Voor ${site.domein} is deze maand het maximum van ${pk.artikelen_per_site_per_maand} artikelen bereikt. In uw pakket ${pk.naam} geldt de limiet per site.`, 403, { upgrade: null });
      }
    }
    // Temporem: niet alles op één dag (A49).
    const vandaag = Number((await tx.query(`SELECT COUNT(*) AS n FROM artikelen WHERE site_id = $1 AND dag = $2 AND ${TELT}`, [siteId, dag])).rows[0].n);
    if (vandaag >= pk.artikelen_per_site_per_dag) {
      throw new Fout(`Voor ${site.domein} zijn vandaag al ${pk.artikelen_per_site_per_dag} artikelen gemaakt. Rankcomet verspreidt artikelen over de maand; morgen kan het weer.`, 429, { tempo: true });
    }
    const id = randomUUID();
    await tx.query('INSERT INTO artikelen (id, account_id, site_id, maand, aangemaakt, zoekwoord, status, dag, bijgewerkt) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $5)', [id, account.id, siteId, maand, nu.toISOString(), zoekwoord, 'gereserveerd', dag]);
    return { id, maand, dag };
  });
}

// Een mislukte generatie boekt het artikel terug (A22): het telt niet meer mee voor de limieten.
export async function boekTerug(db, accountId, artikelId, melding) {
  const r = await db.query("UPDATE artikelen SET status = 'teruggeboekt', melding = $1, bijgewerkt = $2 WHERE id = $3 AND account_id = $4 AND status <> 'teruggeboekt'", [String(melding || '').slice(0, 1000), new Date().toISOString(), artikelId, accountId]);
  return r.rowCount > 0;
}

export async function werkArtikelBij(db, accountId, artikelId, velden) {
  const kolommen = [], params = [];
  for (const [k, v] of Object.entries(velden)) { params.push(v); kolommen.push(`${k} = $${params.length}`); }
  params.push(new Date().toISOString(), artikelId, accountId);
  await db.query(`UPDATE artikelen SET ${kolommen.join(', ')}, bijgewerkt = $${params.length - 2} WHERE id = $${params.length - 1} AND account_id = $${params.length}`, params);
}

export async function lijstArtikelen(db, accountId, siteId) {
  return (await db.query('SELECT id, zoekwoord, status, score, melding, wijziging_id, aangemaakt FROM artikelen WHERE account_id = $1 AND site_id = $2 ORDER BY aangemaakt DESC', [accountId, siteId])).rows;
}
