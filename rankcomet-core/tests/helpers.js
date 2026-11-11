import { maakDb, migreer, leegVoorTest } from '../src/db.js';
import { maakLogger } from '../src/log.js';
import { maakApp } from '../src/app.js';
import * as acc from '../src/accounts.js';
import * as sites from '../src/sites.js';
import { maakOphaler } from '../src/ophalen.js';
import { STANDAARD_GRENZEN } from '../src/grens.js';
import { randomBytes } from 'node:crypto';

export const TEST_ENV = {
  RC_STRIPE_SECRET_KEY: 'sk_test_' + 'nep'.repeat(4),
  RC_STRIPE_WEBHOOK_SECRET: 'whsec_' + 'testnep'.repeat(3),
  RC_STRIPE_PRICE_SOLO: 'price_test_solo', RC_STRIPE_PRICE_PRO: 'price_test_pro', RC_STRIPE_PRICE_BUREAU_PROEF: 'price_test_bureau',
  RC_GEHEIMEN_SLEUTEL: randomBytes(32).toString('base64'),
  RC_AZURE_OPENAI_ENDPOINT: 'https://rc-test.openai.azure.com', RC_AZURE_OPENAI_REGIO: 'swedencentral',
  RC_AZURE_OPENAI_DEPLOYMENT_TYPE: 'DataZoneStandard', RC_AZURE_OPENAI_DEPLOYMENT: 'gpt-test', RC_AZURE_OPENAI_KEY: 'nep-azure-sleutel',
};

export async function nieuweDb() {
  const db = await maakDb(process.env);
  await migreer(db); await leegVoorTest(db);
  return db;
}

export function mockStripe() {
  const aanroepen = [];
  return { aanroepen, checkout: { sessions: { create: async (p) => { aanroepen.push(p); return { id: 'cs_test_' + aanroepen.length, url: 'https://checkout.stripe.test/c/' + aanroepen.length }; } } } };
}

// Nep-mailer: bewaart de mails, zodat een test de link eruit kan halen.
export function nepMailer() {
  const mails = [];
  return { mails, stuur: async (m) => { mails.push(m); }, laatsteAan: (aan) => mails.filter((m) => m.aan === aan).at(-1) };
}

// Pad + query uit de link in een mail (de link wijst naar basis_url, de test praat met de lokale app).
export function linkUit(mail) { const u = new URL(mail.tekst.match(/https:\/\/\S+/)[0]); return { pad: u.pathname, token: u.searchParams.get('token') }; }

// Ruime grenzen, zodat tests die veel accounts aanmaken niet tegen de rate limiting aanlopen.
const RUIM = Object.fromEntries(Object.keys(STANDAARD_GRENZEN).map((k) => [k, { max: 1e6, ms: 60000 }]));

// Nep-internet voor de koppelcontrole: een tabel van url -> html (of een functie). Alles wat er niet in
// staat, bestaat niet. Gebruikt dezelfde ophaler als productie, met een nep-DNS en nep-verbinding.
export function nepInternet(paginas = {}) {
  const internet = {
    paginas, verzoeken: [],
    ophalen: maakOphaler({
      lookup: async (host) => Object.keys(paginas).some((u) => new URL(u).hostname === host) ? [{ address: '93.184.216.34', family: 4 }] : [],
      verbind: async ({ hostnaam, pad }) => {
        internet.verzoeken.push(`https://${hostnaam}${pad}`);
        const p = paginas[`https://${hostnaam}${pad}`];
        if (p === undefined) return { status: 404, headers: {}, body: Buffer.from('niet gevonden') };
        return typeof p === 'function' ? p() : { status: 200, headers: {}, body: Buffer.from(p) };
      },
    }),
  };
  return internet;
}

// Site toevoegen én koppelen via de echte flow: de koppelcode staat op de nep-homepage.
export async function koppelSite(db, account, velden, internet = nepInternet()) {
  const { site } = await sites.voegSiteToe(db, account, velden);
  const { metatag } = await sites.koppelcodeVoor(db, account.id, site.id);
  internet.paginas[`https://${site.domein}/`] = `<html><head>${metatag}</head></html>`;
  await sites.controleerEigendom(db, account.id, site.id, internet.ophalen);
  return site;
}

export async function startApp(db, stripe = mockStripe(), { grenzen = RUIM, env = TEST_ENV, internet = nepInternet() } = {}) {
  const logger = maakLogger(db);
  const mailer = nepMailer();
  const server = maakApp({ db, stripe, mailer, ophalen: internet.ophalen, logger, env, veiligeCookie: false, grenzen });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const basis = `http://127.0.0.1:${server.address().port}`;
  return { server, basis, stripe, mailer, internet, logger, sluit: () => new Promise((ok) => server.close(ok)) };
}

// Account met bevestigd e-mailadres, via de gewone servicefuncties.
export async function registreerBevestigd(db, email, wachtwoord, pakket) {
  const a = await acc.registreer(db, email, wachtwoord, pakket);
  await acc.bevestigEmail(db, await acc.maakVerificatieToken(db, a.id));
  return a;
}

export async function post(basis, pad, velden, cookie) {
  return fetch(basis + pad, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) }, body: new URLSearchParams(velden).toString() });
}

// Aanmelden via HTTP en (standaard) het e-mailadres bevestigen met de link uit de mail.
export async function registreerEnLogin(app, email, { bevestig = true } = {}) {
  const r = await post(app.basis, '/registreren', { email, wachtwoord: 'Testwachtwoord-123!' });
  if (r.status !== 303) throw new Error('registreren mislukt ' + r.status);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  if (bevestig) {
    const { token } = linkUit(app.mailer.laatsteAan(email));
    const b = await post(app.basis, '/email-bevestigen', { token }, cookie);
    if (b.status !== 200) throw new Error('bevestigen mislukt ' + b.status);
  }
  return cookie;
}
