import { maakDb, migreer, leegVoorTest } from '../src/db.js';
import { maakLogger } from '../src/log.js';
import { maakApp } from '../src/app.js';
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

export async function startApp(db, stripe = mockStripe()) {
  const logger = maakLogger(db);
  const server = maakApp({ db, stripe, logger, env: TEST_ENV, veiligeCookie: false });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const basis = `http://127.0.0.1:${server.address().port}`;
  return { server, basis, stripe, logger, sluit: () => new Promise((ok) => server.close(ok)) };
}

export async function post(basis, pad, velden, cookie) {
  return fetch(basis + pad, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) }, body: new URLSearchParams(velden).toString() });
}

export async function registreerEnLogin(basis, email) {
  const r = await post(basis, '/registreren', { email, wachtwoord: 'Testwachtwoord-123!' });
  if (r.status !== 303) throw new Error('registreren mislukt ' + r.status);
  return r.headers.get('set-cookie').split(';')[0];
}
