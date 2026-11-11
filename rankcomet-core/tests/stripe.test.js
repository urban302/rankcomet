import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { nieuweDb, startApp, registreerEnLogin, post, TEST_ENV } from './helpers.js';
import * as acc from '../src/accounts.js';
import { tekenPayload, controleerHandtekening, controleerStripeEnv } from '../src/stripe.js';

let db, app; before(async () => { db = await nieuweDb(); app = await startApp(db); }); after(async () => { await app.sluit(); await db.sluit(); });
const GEHEIM = TEST_ENV.RC_STRIPE_WEBHOOK_SECRET;
const stuurEvent = (event, kop) => { const p = JSON.stringify(event); return fetch(app.basis + '/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': kop ?? tekenPayload(p, GEHEIM), 'content-type': 'application/json' }, body: p }); };

test('checkout-sessie via gemockte client met juiste prijs en account', async () => {
  const c = await registreerEnLogin(app, 'betaal@test.invalid');
  const r = await post(app.basis, '/abonnement/checkout', { pakket: 'pro' }, c);
  assert.equal(r.status, 303); assert.match(r.headers.get('location'), /^https:\/\/checkout\.stripe\.test\//);
  const p = app.stripe.aanroepen.at(-1);
  assert.equal(p.mode, 'subscription'); assert.equal(p.line_items[0].price, 'price_test_pro'); assert.equal(p.metadata.pakket, 'pro'); assert.equal(p.locale, 'nl');
});

test('handtekeningcontrole: goed, fout, verlopen', () => {
  const p = '{"id":"evt_x"}';
  assert.equal(controleerHandtekening(p, tekenPayload(p, GEHEIM), GEHEIM), true);
  assert.equal(controleerHandtekening(p, tekenPayload(p, 'whsec_ander'), GEHEIM), false);
  assert.equal(controleerHandtekening(p + ' ', tekenPayload(p, GEHEIM), GEHEIM), false);
  assert.equal(controleerHandtekening(p, tekenPayload(p, GEHEIM, Math.floor(Date.now() / 1000) - 3600), GEHEIM), false);
  assert.equal(controleerHandtekening(p, undefined, GEHEIM), false);
});

test('webhook: ongeldige handtekening = 400 en niets verwerkt', async () => {
  const r = await stuurEvent({ id: 'evt_fout', type: 'checkout.session.completed', data: { object: {} } }, 't=1,v1=00');
  assert.equal(r.status, 400);
  assert.equal((await db.query('SELECT COUNT(*) AS n FROM stripe_events WHERE event_id = $1', ['evt_fout'])).rows[0].n * 1, 0);
});

test('webhook idempotent: zelfde event 2x = 1 verwerking; status per account', async () => {
  const a = await acc.registreer(db, 'abo@test.invalid', 'Testwachtwoord-123!');
  const b = await acc.registreer(db, 'abo-b@test.invalid', 'Testwachtwoord-123!');
  const ev = { id: 'evt_test_1', type: 'checkout.session.completed', data: { object: { client_reference_id: a.id, customer: 'cus_test_1', subscription: 'sub_test_1', metadata: { account_id: a.id, pakket: 'pro' } } } };
  assert.equal((await stuurEvent(ev)).status, 200);
  assert.equal((await stuurEvent(ev)).status, 200);
  assert.equal((await db.query('SELECT COUNT(*) AS n FROM stripe_events WHERE event_id = $1', ['evt_test_1'])).rows[0].n * 1, 1);
  let ra = await acc.haalAccount(db, a.id);
  assert.equal(ra.pakket, 'pro'); assert.equal(ra.abonnement_status, 'actief');
  assert.equal((await acc.haalAccount(db, b.id)).abonnement_status, 'geen');
  // Later event dat na verwerking opnieuw komt mag status niet terugdraaien.
  await stuurEvent({ id: 'evt_test_2', type: 'customer.subscription.updated', data: { object: { id: 'sub_test_1', status: 'past_due', metadata: { account_id: a.id, pakket: 'pro' } } } });
  assert.equal((await acc.haalAccount(db, a.id)).abonnement_status, 'achterstallig');
  await stuurEvent(ev);
  assert.equal((await acc.haalAccount(db, a.id)).abonnement_status, 'achterstallig');
  await stuurEvent({ id: 'evt_test_3', type: 'customer.subscription.deleted', data: { object: { id: 'sub_test_1', status: 'canceled', metadata: { account_id: a.id } } } });
  ra = await acc.haalAccount(db, a.id);
  assert.equal(ra.abonnement_status, 'opgezegd'); assert.equal(ra.pakket, 'pro');
});

test('gelijktijdig hetzelfde event: precies één verwerking', async () => {
  const a = await acc.registreer(db, 'race@test.invalid', 'Testwachtwoord-123!');
  const ev = { id: 'evt_race', type: 'checkout.session.completed', data: { object: { customer: 'cus_r', subscription: 'sub_r', metadata: { account_id: a.id, pakket: 'solo' } } } };
  const rs = await Promise.all([1, 2, 3, 4, 5].map(() => stuurEvent(ev)));
  assert.ok(rs.every((r) => r.status === 200));
  assert.equal((await db.query('SELECT COUNT(*) AS n FROM stripe_events WHERE event_id = $1', ['evt_race'])).rows[0].n * 1, 1);
});

test('Stripe-env: alleen testsleutels, webhookgeheim verplicht', () => {
  assert.doesNotThrow(() => controleerStripeEnv(TEST_ENV));
  assert.throws(() => controleerStripeEnv({ ...TEST_ENV, RC_STRIPE_SECRET_KEY: 'sk_' + 'live_xyz' }), /testsleutel/);
  assert.throws(() => controleerStripeEnv({ ...TEST_ENV, RC_STRIPE_WEBHOOK_SECRET: '' }), /ontbreekt/);
});
