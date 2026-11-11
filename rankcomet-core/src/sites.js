// Sites per account. Elke query is gefilterd op account_id: strikte scheiding per account.
import { randomUUID, randomBytes } from 'node:crypto';
import { Fout } from './accounts.js';
import { laadMerk } from './config.js';
import { pakketVoor, upgradeOptie, eerstePakketMet } from './pakketten.js';

export function normaliseerDomein(d) {
  let s = String(d || '').trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(s)) throw new Fout('Vul een geldig domein in, bijvoorbeeld voorbeeld.nl.');
  return s;
}

const metBevestigd = (rij) => rij && { ...rij, bevestigd: Boolean(rij.eigendom_bevestigd) };

export async function lijstSites(db, accountId) {
  return (await db.query('SELECT id, domein, taal, land, platform, aangemaakt, eigendom_bevestigd FROM sites WHERE account_id = $1 ORDER BY aangemaakt, domein', [accountId])).rows.map(metBevestigd);
}

export async function haalSite(db, accountId, siteId) {
  const r = await db.query('SELECT id, domein, taal, land, platform, eigendom_bevestigd FROM sites WHERE id = $1 AND account_id = $2', [siteId, accountId]);
  return metBevestigd(r.rows[0]) || null; // site van een ander account: gewoon niet gevonden
}

// --- Eigendom van het domein (stap 2) ---
// Elke site krijgt een koppelcode. De klant zet die in een metatag op de homepage (of straks in de
// WordPress-plugin). Pas als we de code daar zien, telt de site als gekoppeld.
export const META_NAAM = 'rankcomet-koppelcode';
const nieuweKoppelcode = () => 'rc-' + randomBytes(16).toString('hex');

export async function koppelcodeVoor(db, accountId, siteId) {
  const site = (await db.query('SELECT id, domein, koppelcode, eigendom_bevestigd FROM sites WHERE id = $1 AND account_id = $2', [siteId, accountId])).rows[0];
  if (!site) throw new Fout('Site niet gevonden.', 404);
  if (!site.koppelcode) { // sites van vóór stap 2
    site.koppelcode = nieuweKoppelcode();
    await db.query('UPDATE sites SET koppelcode = $1 WHERE id = $2 AND account_id = $3 AND koppelcode IS NULL', [site.koppelcode, siteId, accountId]);
    site.koppelcode = (await db.query('SELECT koppelcode FROM sites WHERE id = $1', [siteId])).rows[0].koppelcode;
  }
  return { domein: site.domein, koppelcode: site.koppelcode, bevestigd: Boolean(site.eigendom_bevestigd), metatag: `<meta name="${META_NAAM}" content="${site.koppelcode}">` };
}

// Zoekt <meta name="rankcomet-koppelcode" content="..."> in de html, in beide attribuutvolgordes.
export function koppelcodesIn(html) {
  const codes = [];
  for (const tag of String(html).match(/<meta\b[^>]*>/gi) || []) {
    const attr = (naam) => { const m = tag.match(new RegExp(`\\b${naam}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i')); return m ? (m[1] ?? m[2] ?? m[3]).trim() : null; };
    if ((attr('name') || '').toLowerCase() === META_NAAM && attr('content')) codes.push(attr('content'));
  }
  return codes;
}

// Haalt de homepage op via de veilige ophaler en vergelijkt de koppelcode. Alleen voor een site van
// dit account; de code van een ander account (of een andere site) telt niet.
export async function controleerEigendom(db, accountId, siteId, ophalen) {
  const { domein, koppelcode, bevestigd } = await koppelcodeVoor(db, accountId, siteId);
  if (bevestigd) return { bevestigd: true, al: true };
  const pagina = await ophalen(`https://${domein}/`, domein);
  if (pagina.status !== 200) throw new Fout(`Je site gaf foutcode ${pagina.status} terug. Controleer of https://${domein}/ gewoon werkt in je browser.`, 400);
  if (!koppelcodesIn(pagina.body).includes(koppelcode)) {
    throw new Fout(`We hebben de koppelcode niet gevonden op https://${domein}/. Zet de metatag in de <head> van je homepage en probeer het dan opnieuw. Soms moet je eerst de cache van je site legen.`, 400);
  }
  const nu = new Date().toISOString();
  await db.query('UPDATE sites SET eigendom_bevestigd = COALESCE(eigendom_bevestigd, $1) WHERE id = $2 AND account_id = $3', [nu, siteId, accountId]);
  return { bevestigd: true, al: false };
}

export async function verwijderSite(db, accountId, siteId) {
  const r = await db.query('DELETE FROM sites WHERE id = $1 AND account_id = $2', [siteId, accountId]);
  return r.rowCount > 0;
}

// Voegt een site toe. Andere platforms dan WordPress/WooCommerce gaan naar de wachtlijst.
export async function voegSiteToe(db, account, { domein, taal = 'nl', land = 'NL', platform }) {
  const merk = laadMerk();
  domein = normaliseerDomein(domein);
  if (taal !== 'nl') throw new Fout('In de bèta is alleen Nederlands (nl) beschikbaar.');
  if (!merk.landen[land]) throw new Fout('Kies een land uit de lijst.');
  if (merk.platforms_wachtlijst[platform]) {
    await db.query('INSERT INTO wachtlijst (id, account_id, domein, platform, aangemaakt) VALUES ($1, $2, $3, $4, $5)',
      [randomUUID(), account.id, domein, platform, new Date().toISOString()]);
    return { wachtlijst: true, bericht: `${merk.platforms_wachtlijst[platform]} wordt nog niet ondersteund. We hebben ${domein} op de wachtlijst gezet en laten het weten zodra het kan.` };
  }
  if (!merk.platforms_actief[platform]) throw new Fout('Kies WordPress of WooCommerce, of een platform voor de wachtlijst.');
  // R3: zonder bevestigd e-mailadres geen site koppelen. De wachtlijst hierboven mag wel.
  const bevestigd = (await db.query('SELECT email_geverifieerd FROM accounts WHERE id = $1', [account.id])).rows[0]?.email_geverifieerd;
  if (!bevestigd) throw new Fout('Bevestig eerst je e-mailadres. Daarna kun je een site koppelen. Kijk in je mail of vraag op je dashboard een nieuwe mail aan.', 403, { onbevestigd: true });
  const pk = pakketVoor(account.pakket);
  if (platform === 'woocommerce' && !pk.woocommerce_koppelen) {
    // A8 (besloten door Erwin 1-11): WooCommerce alleen vanaf Pro.
    const up = eerstePakketMet((p) => p.woocommerce_koppelen);
    throw new Fout(`Uw pakket ${pk.naam} ondersteunt geen WooCommerce-webshop. Upgrade naar ${up.naam} om een WooCommerce-webshop te koppelen.`, 403, { upgrade: up.id });
  }
  const id = randomUUID();
  // Sitelimiet atomair: in een transactie met een rijslot op het account (PG: SELECT ... FOR UPDATE),
  // zodat gelijktijdige aanvragen van hetzelfde account na elkaar tellen. sqlite: transacties lopen
  // achter elkaar (BEGIN IMMEDIATE).
  await db.transactie(async (tx) => {
    const slot = await tx.query(`SELECT pakket FROM accounts WHERE id = $1${tx.soort === 'pg' ? ' FOR UPDATE' : ''}`, [account.id]);
    if (!slot.rows.length) throw new Fout('Account niet gevonden.', 404);
    const aantal = (await tx.query('SELECT COUNT(*) AS n FROM sites WHERE account_id = $1', [account.id])).rows[0].n;
    if (Number(aantal) >= pk.max_sites) {
      const up = upgradeOptie(account.pakket);
      throw new Fout(`Uw pakket ${pk.naam} staat maximaal ${pk.max_sites} ${pk.max_sites === 1 ? 'site' : 'sites'} toe. ` +
        (up ? `Upgrade naar ${up.naam} voor maximaal ${up.max_sites} sites.` : 'Neem contact met ons op voor meer sites.'), 403, { upgrade: up ? up.id : null });
    }
    const dubbel = await tx.query('SELECT 1 AS x FROM sites WHERE account_id = $1 AND domein = $2', [account.id, domein]);
    if (dubbel.rows.length) throw new Fout('Deze site staat al in uw account.', 409);
    await tx.query('INSERT INTO sites (id, account_id, domein, taal, land, platform, aangemaakt, koppelcode) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [id, account.id, domein, taal, land, platform, new Date().toISOString(), nieuweKoppelcode()]);
  });
  return { wachtlijst: false, site: { id, domein, taal, land, platform, bevestigd: false } };
}
