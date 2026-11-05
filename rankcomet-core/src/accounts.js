// Accounts en sessies. Een account kan later onder een bureau vallen (bureau_id, nu altijd NULL) [A].
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { hashWachtwoord, controleerWachtwoord, controleerSterkte } from './wachtwoord.js';

const SESSIE_DUUR_MS = 7 * 86400000; // [A] 7 dagen
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
    'SELECT a.id, a.email, a.pakket, a.abonnement_status, s.verloopt FROM sessies s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = $1',
    [sha(token)]);
  const rij = r.rows[0];
  if (!rij || new Date(rij.verloopt) < new Date()) return null;
  return { id: rij.id, email: rij.email, pakket: rij.pakket, abonnement_status: rij.abonnement_status };
}

export async function logout(db, token) { if (token) await db.query('DELETE FROM sessies WHERE token_hash = $1', [sha(token)]); }

export async function haalAccount(db, id) {
  const r = await db.query('SELECT id, email, pakket, abonnement_status, stripe_customer_id, stripe_subscription_id FROM accounts WHERE id = $1', [id]);
  return r.rows[0] || null;
}
