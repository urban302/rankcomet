// Artikellimiet per maand (A6, besloten door Erwin 1-11). Solo en Pro: limiet per account.
// Bureau-proef: 10 per site per maand (5 sites = 50 totaal), niet vrij te verdelen.
// Een artikel 'reserveren' telt en registreert atomair (transactie + rijslot op het account).
import { randomUUID } from 'node:crypto';
import { Fout } from './accounts.js';
import { pakketVoor, upgradeOptie } from './pakketten.js';

export function huidigeMaand(nu = new Date()) { return nu.toISOString().slice(0, 7); } // [A] maand in UTC

export async function reserveerArtikel(db, account, siteId, nu = new Date()) {
  const maand = huidigeMaand(nu);
  return db.transactie(async (tx) => {
    const acc = (await tx.query(`SELECT pakket FROM accounts WHERE id = $1${tx.soort === 'pg' ? ' FOR UPDATE' : ''}`, [account.id])).rows[0];
    if (!acc) throw new Fout('Account niet gevonden.', 404);
    const site = (await tx.query('SELECT id, domein FROM sites WHERE id = $1 AND account_id = $2', [siteId, account.id])).rows[0];
    if (!site) throw new Fout('Site niet gevonden.', 404);
    const pk = pakketVoor(acc.pakket);
    const totaal = Number((await tx.query('SELECT COUNT(*) AS n FROM artikelen WHERE account_id = $1 AND maand = $2', [account.id, maand])).rows[0].n);
    if (totaal >= pk.artikelen_per_maand) {
      const up = upgradeOptie(pk.id);
      throw new Fout(`U heeft deze maand het maximum van ${pk.artikelen_per_maand} artikelen van uw pakket ${pk.naam} bereikt.` + (up ? ` Upgrade naar ${up.naam} voor meer artikelen.` : ''), 403, { upgrade: up ? up.id : null });
    }
    if (pk.artikelen_per_site_per_maand != null) {
      const perSite = Number((await tx.query('SELECT COUNT(*) AS n FROM artikelen WHERE site_id = $1 AND maand = $2', [siteId, maand])).rows[0].n);
      if (perSite >= pk.artikelen_per_site_per_maand) {
        throw new Fout(`Voor ${site.domein} is deze maand het maximum van ${pk.artikelen_per_site_per_maand} artikelen bereikt. In uw pakket ${pk.naam} geldt de limiet per site.`, 403, { upgrade: null });
      }
    }
    const id = randomUUID();
    await tx.query('INSERT INTO artikelen (id, account_id, site_id, maand, aangemaakt) VALUES ($1, $2, $3, $4, $5)', [id, account.id, siteId, maand, nu.toISOString()]);
    return { id, maand };
  });
}
