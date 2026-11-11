// Maandrapport (stap 10): wat Rankcomet in een maand deed en wat het opleverde, per account.
// Als pagina in de app en als mail op de eerste van de maand, één keer per account per maand (claim in `rapporten`).
// Alle cijfers komen uit de eigen tabellen; er gaat niets naar buiten. Alles gefilterd op account.
import { randomUUID } from 'node:crypto';
import { Fout } from './accounts.js';
import { huidigeMaand } from './artikelen.js';
import { rapportMail } from './mail.js';

const nu = () => new Date().toISOString();
export const MAAND_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAANDNAMEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
export const maandNaam = (maand) => `${MAANDNAMEN[Number(maand.slice(5, 7)) - 1]} ${maand.slice(0, 4)}`;

function maandGrenzen(maand) {
  const [j, m] = maand.split('-').map(Number);
  const eind = new Date(Date.UTC(j, m, 0)); // laatste dag van de maand
  const vorigEind = new Date(Date.UTC(j, m - 1, 0));
  return { eersteDag: `${maand}-01`, laatsteDag: eind.toISOString().slice(0, 10), vorigeLaatsteDag: vorigEind.toISOString().slice(0, 10) };
}
export const vorigeMaand = (maand) => { const [j, m] = maand.split('-').map(Number); const d = new Date(Date.UTC(j, m - 2, 1)); return d.toISOString().slice(0, 7); };

// De maanden waarvoor een rapport kan bestaan: vanaf de maand van aanmelden tot en met de huidige maand, nieuwste eerst.
export async function maanden(db, accountId, tijd = new Date()) {
  const a = (await db.query('SELECT aangemaakt FROM accounts WHERE id = $1', [accountId])).rows[0];
  if (!a) return [];
  const start = a.aangemaakt.slice(0, 7), huidig = huidigeMaand(tijd), uit = [];
  for (let m = huidig; m >= start && uit.length < 36; m = vorigeMaand(m)) uit.push(m);
  return uit;
}

export async function maandrapport(db, accountId, maand) {
  if (!MAAND_RE.test(String(maand))) throw new Fout('Dit is geen geldige maand.', 400);
  const account = (await db.query('SELECT id, email, pakket, aangemaakt FROM accounts WHERE id = $1', [accountId])).rows[0];
  if (!account) throw new Fout('Account niet gevonden.', 404);
  const { laatsteDag, vorigeLaatsteDag } = maandGrenzen(maand);
  const n = async (sql, params) => Number((await db.query(sql, params)).rows[0].n);
  const artikelen = await n("SELECT COUNT(*) AS n FROM artikelen WHERE account_id = $1 AND maand = $2 AND status <> 'teruggeboekt'", [accountId, maand]);
  const voorstellen = await n("SELECT COUNT(*) AS n FROM wijzigingen WHERE account_id = $1 AND maand = $2 AND terugzet_van IS NULL", [accountId, maand]);
  const gepubliceerd = await n("SELECT COUNT(*) AS n FROM wijzigingen WHERE account_id = $1 AND maand = $2 AND terugzet_van IS NULL AND status IN ('gepubliceerd', 'teruggezet')", [accountId, maand]);
  const afgewezen = await n("SELECT COUNT(*) AS n FROM wijzigingen WHERE account_id = $1 AND maand = $2 AND status = 'afgewezen'", [accountId, maand]);
  const teruggezet = await n("SELECT COUNT(*) AS n FROM wijzigingen WHERE account_id = $1 AND maand = $2 AND status = 'teruggezet'", [accountId, maand]);
  const opfrissingen = await n("SELECT COUNT(*) AS n FROM opfrissingen WHERE account_id = $1 AND dag >= $2 AND dag <= $3 AND status <> 'mislukt'", [accountId, `${maand}-01`, laatsteDag]);
  const openNu = await n("SELECT COUNT(*) AS n FROM wijzigingen WHERE account_id = $1 AND status = 'voorstel'", [accountId]);

  const sitesLijst = (await db.query('SELECT id, domein FROM sites WHERE account_id = $1 AND eigendom_bevestigd IS NOT NULL ORDER BY aangemaakt, domein', [accountId])).rows;
  const sites = [];
  for (const s of sitesLijst) {
    // Posities: per gevolgd zoekwoord de laatste meting op of vóór het einde van de maand, en die van de maand ervoor.
    const rijen = (await db.query(`SELECT z.zoekwoord,
        (SELECT p.positie FROM posities p WHERE p.zoekwoord_id = z.id AND p.status = 'klaar' AND p.dag <= $2 ORDER BY p.dag DESC LIMIT 1) AS eind,
        (SELECT 1 FROM posities p WHERE p.zoekwoord_id = z.id AND p.status = 'klaar' AND p.dag <= $2 LIMIT 1) AS gemeten,
        (SELECT p.positie FROM posities p WHERE p.zoekwoord_id = z.id AND p.status = 'klaar' AND p.dag <= $3 ORDER BY p.dag DESC LIMIT 1) AS begin
      FROM zoekwoorden z WHERE z.site_id = $1 AND z.gevolgd = 1`, [s.id, laatsteDag, vorigeLaatsteDag])).rows;
    const num = (v) => (v == null ? null : Number(v));
    const posities = { gevolgd: rijen.length, gemeten: rijen.filter((r) => r.gemeten).length, top10Eind: rijen.filter((r) => num(r.eind) != null && num(r.eind) <= 10).length, top10Begin: rijen.filter((r) => num(r.begin) != null && num(r.begin) <= 10).length,
      beter: rijen.filter((r) => num(r.eind) != null && num(r.begin) != null && num(r.eind) < num(r.begin)).length, slechter: rijen.filter((r) => num(r.eind) != null && num(r.begin) != null && num(r.eind) > num(r.begin)).length };
    // Search Console: de laatste periode die in de maand eindigt, tegenover de periode van een maand eerder.
    const periode = (await db.query('SELECT periode_eind, SUM(klikken) AS klikken, SUM(vertoningen) AS vertoningen FROM gsc_cijfers WHERE site_id = $1 AND periode_eind <= $2 GROUP BY periode_eind ORDER BY periode_eind DESC LIMIT 1', [s.id, laatsteDag])).rows[0];
    const vorige = (await db.query('SELECT periode_eind, SUM(klikken) AS klikken, SUM(vertoningen) AS vertoningen FROM gsc_cijfers WHERE site_id = $1 AND periode_eind <= $2 GROUP BY periode_eind ORDER BY periode_eind DESC LIMIT 1', [s.id, vorigeLaatsteDag])).rows[0];
    const sc = periode ? { periodeEind: periode.periode_eind, klikken: Number(periode.klikken), vertoningen: Number(periode.vertoningen), klikkenVorige: vorige ? Number(vorige.klikken) : null } : null;
    const siteArtikelen = await n("SELECT COUNT(*) AS n FROM artikelen WHERE site_id = $1 AND maand = $2 AND status <> 'teruggeboekt'", [s.id, maand]);
    const siteGepubliceerd = await n("SELECT COUNT(*) AS n FROM wijzigingen WHERE site_id = $1 AND maand = $2 AND terugzet_van IS NULL AND status IN ('gepubliceerd', 'teruggezet')", [s.id, maand]);
    sites.push({ id: s.id, domein: s.domein, artikelen: siteArtikelen, gepubliceerd: siteGepubliceerd, posities, searchConsole: sc });
  }
  return { maand, naam: maandNaam(maand), account: { id: account.id, pakket: account.pakket }, artikelen, voorstellen, gepubliceerd, afgewezen, teruggezet, opfrissingen, openNu, sites };
}

// Op de eerste van de maand (of later, als de app toen uit stond) het rapport over de vorige maand mailen.
// Eén keer per account per maand: de claim in `rapporten` (UNIQUE) voorkomt dubbele mails, ook bij gelijktijdige runs.
export async function verstuurMaandrapporten(db, ctx, tijd = new Date()) {
  const maand = vorigeMaand(huidigeMaand(tijd));
  const accounts = (await db.query("SELECT DISTINCT a.id, a.email FROM accounts a JOIN sites s ON s.account_id = a.id WHERE a.email_geverifieerd IS NOT NULL AND s.eigendom_bevestigd IS NOT NULL AND a.aangemaakt < $1 ORDER BY a.id", [`${huidigeMaand(tijd)}-01`])).rows;
  const uit = { maand, verstuurd: 0, overgeslagen: 0, mislukt: 0 };
  for (const a of accounts) {
    const claim = await db.query('INSERT INTO rapporten (id, account_id, maand, status, aangemaakt) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (account_id, maand) DO NOTHING', [randomUUID(), a.id, maand, 'bezig', nu()]);
    if (!claim.rowCount) {
      // Een eerdere poging mislukte? Dan nog één keer proberen; anders overslaan.
      const opnieuw = await db.query("UPDATE rapporten SET status = 'bezig', bijgewerkt = $1 WHERE account_id = $2 AND maand = $3 AND status = 'mislukt'", [nu(), a.id, maand]);
      if (!opnieuw.rowCount) { uit.overgeslagen++; continue; }
    }
    try {
      const data = await maandrapport(db, a.id, maand);
      await ctx.mailer.stuur({ aan: a.email, ...rapportMail(data) });
      await db.query("UPDATE rapporten SET status = 'verstuurd', verstuurd = $1, bijgewerkt = $1 WHERE account_id = $2 AND maand = $3", [nu(), a.id, maand]);
      await ctx.logger?.log('info', `maandrapport verstuurd account=${a.id} maand=${maand}`);
      uit.verstuurd++;
    } catch (e) {
      await db.query("UPDATE rapporten SET status = 'mislukt', bijgewerkt = $1 WHERE account_id = $2 AND maand = $3", [nu(), a.id, maand]);
      await ctx.logger?.log('fout', `maandrapport mislukt account=${a.id} maand=${maand} ${e.name}`);
      uit.mislukt++;
    }
  }
  return uit;
}
