// Accounts en sessies. Een account kan later onder een bureau vallen (bureau_id, nu altijd NULL) [A].
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { hashWachtwoord, controleerWachtwoord, controleerSterkte } from './wachtwoord.js';

const SESSIE_DUUR_MS = 7 * 86400000; // [A] 7 dagen
// [A29] Geldigheid van eenmalige links: e-mail bevestigen 24 uur, wachtwoord herstellen 1 uur.
const TOKEN_DUUR_MS = { verificatie: 24 * 3600000, wachtwoord: 3600000 };
const sha = (t) => createHash('sha256').update(t).digest('hex');

export class Fout extends Error { constructor(bericht, status = 400, extra = {}) { super(bericht); this.status = status; Object.assign(this, extra); } }

export function normaliseerEmail(e) { return String(e || '').trim().toLowerCase(); }

export async function registreer(db, email, wachtwoord, pakket = 'solo') {
  email = normaliseerEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Fout('Vul een geldig e-mailadres in.');
  const zwak = controleerSterkte(wachtwoord); if (zwak) throw new Fout(zwak);
  const bestaand = await db.query('SELECT id FROM accounts WHERE email = $1', [email]);
  if (bestaand.rows.length) throw new Fout('Er bestaat al een account met dit e-mailadres.', 409);
  const id = randomUUID();
  await db.query('INSERT INTO accounts (id, email, wachtwoord_hash, pakket, aangemaakt) VALUES ($1, $2, $3, $4, $5)',
    [id, email, await hashWachtwoord(wachtwoord), pakket, new Date().toISOString()]);
  return { id, email, pakket };
}

export async function login(db, email, wachtwoord) {
  const r = await db.query('SELECT id, wachtwoord_hash FROM accounts WHERE email = $1', [normaliseerEmail(email)]);
  const rij = r.rows[0];
  // Altijd een hash berekenen, zodat de responstijd niet verraadt of het account bestaat.
  const ok = await controleerWachtwoord(String(wachtwoord || ''), rij ? rij.wachtwoord_hash : 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
  if (!rij || !ok) throw new Fout('E-mailadres of wachtwoord klopt niet.', 401);
  const token = randomBytes(32).toString('base64url');
  const nu = Date.now();
  await db.query('INSERT INTO sessies (token_hash, account_id, verloopt, aangemaakt) VALUES ($1, $2, $3, $4)',
    [sha(token), rij.id, new Date(nu + SESSIE_DUUR_MS).toISOString(), new Date(nu).toISOString()]);
  return { token, accountId: rij.id };
}

export async function accountVoorSessie(db, token) {
  if (!token) return null;
  const r = await db.query(
    'SELECT a.id, a.email, a.pakket, a.abonnement_status, a.email_geverifieerd, s.verloopt FROM sessies s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = $1',
    [sha(token)]);
  const rij = r.rows[0];
  if (!rij || new Date(rij.verloopt) < new Date()) return null;
  return { id: rij.id, email: rij.email, pakket: rij.pakket, abonnement_status: rij.abonnement_status, geverifieerd: Boolean(rij.email_geverifieerd) };
}

export async function logout(db, token) { if (token) await db.query('DELETE FROM sessies WHERE token_hash = $1', [sha(token)]); }

export async function haalAccount(db, id) {
  const r = await db.query('SELECT id, email, pakket, abonnement_status, stripe_customer_id, stripe_subscription_id FROM accounts WHERE id = $1', [id]);
  return r.rows[0] || null;
}

// --- Eenmalige links (R3) ---
// Het token gaat alleen in de mail naar de klant; in de database staat alleen de sha256.

async function maakToken(db, accountId, doel) {
  const token = randomBytes(32).toString('base64url');
  const nu = Date.now();
  await db.query('INSERT INTO eenmalige_tokens (token_hash, account_id, doel, verloopt, aangemaakt) VALUES ($1, $2, $3, $4, $5)',
    [sha(token), accountId, doel, new Date(nu + TOKEN_DUUR_MS[doel]).toISOString(), new Date(nu).toISOString()]);
  return token;
}

// Zet het token in één UPDATE op 'gebruikt'. Twee gelijktijdige pogingen: maar één krijgt het account terug.
async function gebruikToken(db, token, doel) {
  if (typeof token !== 'string' || !token || token.length > 100) return null;
  const r = await db.query(
    'UPDATE eenmalige_tokens SET gebruikt = $1 WHERE token_hash = $2 AND doel = $3 AND gebruikt IS NULL AND verloopt > $1 RETURNING account_id',
    [new Date().toISOString(), sha(token), doel]);
  return r.rows[0]?.account_id ?? null;
}

export async function maakVerificatieToken(db, accountId) { return maakToken(db, accountId, 'verificatie'); }

export async function bevestigEmail(db, token) {
  const id = await gebruikToken(db, token, 'verificatie');
  if (!id) throw new Fout('Deze link werkt niet meer. Log in en vraag op je dashboard een nieuwe mail aan.', 400);
  await db.query('UPDATE accounts SET email_geverifieerd = COALESCE(email_geverifieerd, $1) WHERE id = $2', [new Date().toISOString(), id]);
  return id;
}

// Geeft null als er geen account bij het e-mailadres hoort. De app toont in beide gevallen hetzelfde bericht.
export async function wachtwoordVergeten(db, email) {
  email = normaliseerEmail(email);
  const rij = (await db.query('SELECT id FROM accounts WHERE email = $1', [email])).rows[0];
  if (!rij) return null;
  return { accountId: rij.id, email, token: await maakToken(db, rij.id, 'wachtwoord') };
}

// Nieuw wachtwoord via een herstellink. Daarna: alle sessies weg en alle andere herstellinks ongeldig.
// Wie de link uit de mail gebruikt, heeft ook laten zien dat het e-mailadres klopt [A30].
export async function herstelWachtwoord(db, token, wachtwoord) {
  const zwak = controleerSterkte(wachtwoord); if (zwak) throw new Fout(zwak);
  const hash = await hashWachtwoord(wachtwoord);
  const id = await gebruikToken(db, token, 'wachtwoord');
  if (!id) throw new Fout('Deze link werkt niet meer. Vraag een nieuwe aan via Wachtwoord vergeten.', 400, { linkOngeldig: true });
  const nu = new Date().toISOString();
  await db.transactie(async (tx) => {
    await tx.query('UPDATE accounts SET wachtwoord_hash = $1, email_geverifieerd = COALESCE(email_geverifieerd, $2) WHERE id = $3', [hash, nu, id]);
    await tx.query('DELETE FROM sessies WHERE account_id = $1', [id]);
    await tx.query("UPDATE eenmalige_tokens SET gebruikt = $1 WHERE account_id = $2 AND doel = 'wachtwoord' AND gebruikt IS NULL", [nu, id]);
  });
  return id;
}
