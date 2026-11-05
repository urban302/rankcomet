// R2: F-R1-1 (webhook transactioneel), sitelimiet bij gelijktijdige aanvragen, A6 (artikelen per site), A8 (WooCommerce alleen Pro).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { nieuweDb, startApp, registreerEnLogin, post, TEST_ENV } from './helpers.js';
import * as acc from '../src/accounts.js';
import * as sites from '../src/sites.js';
import { reserveerArtikel } from '../src/artikelen.js';
import { tekenPayload, verwerkWebhook } from '../src/stripe.js';
import { laadPakketten } from '../src/config.js';

let db, app; before(async () => { db = await nieuweDb(); app = await startApp(db); }); after(async () => { await app.sluit(); await db.sluit(); });
const GEHEIM = TEST_ENV.RC_STRIPE_WEBHOOK_SECRET;
const stuur = (ev) => { const p = JSON.stringify(ev); return fetch(app.basis + '/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': tekenPayload(p, GEHEIM), 'content-type': 'application/json' }, body: p }); };
const aantalEvents = async (id) => Number((await db.query('SELECT COUNT(*) AS n FROM stripe_events WHERE event_id = $1', [id])).rows[0].n);

test('F-R1-1: mislukte verwerking (onbekend pakket) legt het event niet vast; herhaalpoging wordt opnieuw verwerkt', async () => {
  const a = await acc.registreer(db, 'retry@test.invalid', 'Testwachtwoord-123!');
  const ev = { id: 'evt_test_nep2', type: 'checkout.session.completed', data: { object: { client_reference_id: a.id, metadata: { account_id: a.id, pakket: 'bestaatniet' } } } };
  const r1 = await stuur(ev); const r2 = await stuur(ev);
  // Naspel Tester: niet meer '400 dan 200 zonder verwerking'. Beide pogingen worden echt verwerkt en falen.
  assert.equal(r1.status, 400); assert.equal(r2.status, 400);
  assert.equal(await aantalEvents('evt_test_nep2'), 0);
  assert.equal((await acc.haalAccount(db, a.id)).abonnement_status, 'geen');
});

test('F-R1-1: tijdelijke databasefout tijdens verwerking, daarna herhaalpoging slaagt', async () => {
  const a = await acc.registreer(db, 'dbfout@test.invalid', 'Testwachtwoord-123!');
  const ev = { id: 'evt_test_dbfout', type: 'checkout.session.completed', data: { object: { customer: 'cus_t', subscription: 'sub_t', metadata: { account_id: a.id, pakket: 'pro' } } } };
  const p = JSON.stringify(ev);
  // Db die in de transactie bij de UPDATE een fout geeft (na de claim): claim moet worden teruggedraaid.
  const kapot = { soort: db.soort, query: (...x) => db.query(...x), transactie: (fn) => db.transactie((tx) => fn({ soort: tx.soort, query: (sql, pr) => { if (/^UPDATE accounts/.test(sql)) throw new Error('nep-databasefout'); return tx.query(sql, pr); } })) };
  await assert.rejects(verwerkWebhook(kapot, p, tekenPayload(p, GEHEIM), GEHEIM), /nep-databasefout/);
  assert.equal(await aantalEvents('evt_test_dbfout'), 0);
  const r = await stuur(ev);
  assert.equal(r.status, 200);
  assert.equal(await aantalEvents('evt_test_dbfout'), 1);
  const na = await acc.haalAccount(db, a.id);
  assert.equal(na.pakket, 'pro'); assert.equal(na.abonnement_status, 'actief');
  const r3 = await stuur(ev); assert.equal(r3.status, 200); assert.equal(await aantalEvents('evt_test_dbfout'), 1);
});

test('gelijktijdige dubbele events (10x): precies één verwerking', async () => {
  const a = await acc.registreer(db, 'race2@test.invalid', 'Testwachtwoord-123!');
  const ev = { id: 'evt_race_r2', type: 'checkout.session.completed', data: { object: { metadata: { account_id: a.id, pakket: 'pro' } } } };
  const p = JSON.stringify(ev); const kop = tekenPayload(p, GEHEIM);
  const rs = await Promise.all(Array.from({ length: 10 }, () => verwerkWebhook(db, p, kop, GEHEIM)));
  assert.ok(rs.every((r) => r.status === 200));
  assert.equal(rs.filter((r) => r.verwerkt).length, 1);
  assert.equal(await aantalEvents('evt_race_r2'), 1);
});

for (const [pakket, max] of [['solo', 1], ['pro', 3], ['bureau_proef', 5]]) {
  test(`sitelimiet ${pakket}: 10 gelijktijdige aanvragen, nooit boven ${max}`, async () => {
    const a = await acc.registreer(db, `gelijk-${pakket}@test.invalid`, 'Testwachtwoord-123!', pakket);
    const rs = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => sites.voegSiteToe(db, a, { domein: `g${i}-${pakket.replace('_', '')}.test`, platform: 'wordpress' })));
    assert.equal(rs.filter((r) => r.status === 'fulfilled').length, max);
    assert.ok(rs.filter((r) => r.status === 'rejected').every((r) => r.reason.status === 403));
    assert.equal((await sites.lijstSites(db, a.id)).length, max);
  });
}

test('A6: Bureau-proef 10 artikelen per site per maand, niet vrij te verdelen (5 x 10 = 50)', async () => {
  const p = laadPakketten().pakketten;
  assert.equal(p.bureau_proef.artikelen_per_site_per_maand, 10); assert.equal(p.bureau_proef.artikelen_per_maand, 50);
  const a = await acc.registreer(db, 'bureau-art@test.invalid', 'Testwachtwoord-123!', 'bureau_proef');
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push((await sites.voegSiteToe(db, a, { domein: `art${i}.test`, platform: 'wordpress' })).site.id);
  const nu = new Date('2026-11-15T12:00:00Z');
  for (let i = 0; i < 10; i++) await reserveerArtikel(db, a, ids[0], nu);
  const f = await reserveerArtikel(db, a, ids[0], nu).catch((e) => e);
  assert.equal(f.status, 403); assert.match(f.message, /^Voor art0\.test is deze maand het maximum van 10 artikelen bereikt\./);
  for (const s of ids.slice(1)) for (let i = 0; i < 10; i++) await reserveerArtikel(db, a, s, nu);
  const f2 = await reserveerArtikel(db, a, ids[4], nu).catch((e) => e);
  assert.equal(f2.status, 403);
  // Nieuwe maand: weer ruimte.
  assert.ok(await reserveerArtikel(db, a, ids[0], new Date('2026-12-01T12:00:00Z')));
});

test('A6: gelijktijdige artikelaanvragen op één site blijven binnen 10', async () => {
  const a = await acc.registreer(db, 'bureau-art2@test.invalid', 'Testwachtwoord-123!', 'bureau_proef');
  const s = (await sites.voegSiteToe(db, a, { domein: 'artrace.test', platform: 'wordpress' })).site.id;
  const rs = await Promise.allSettled(Array.from({ length: 15 }, () => reserveerArtikel(db, a, s)));
  assert.equal(rs.filter((r) => r.status === 'fulfilled').length, 10);
});

test('artikelen: Solo 10 per account; site van een ander account geweigerd', async () => {
  const a = await acc.registreer(db, 'solo-art@test.invalid', 'Testwachtwoord-123!', 'solo');
  const b = await acc.registreer(db, 'solo-art-b@test.invalid', 'Testwachtwoord-123!', 'solo');
  const s = (await sites.voegSiteToe(db, a, { domein: 'soloart.test', platform: 'wordpress' })).site.id;
  for (let i = 0; i < 10; i++) await reserveerArtikel(db, a, s);
  const f = await reserveerArtikel(db, a, s).catch((e) => e);
  assert.equal(f.status, 403); assert.match(f.message, /maximum van 10 artikelen van uw pakket Solo bereikt\. Upgrade naar Pro/);
  assert.equal((await reserveerArtikel(db, b, s).catch((e) => e)).status, 404);
});

test('A8: Solo kan geen WooCommerce koppelen (u-vorm, upgradelink); Pro en Bureau-proef wel', async () => {
  const a = await acc.registreer(db, 'solo-woo@test.invalid', 'Testwachtwoord-123!', 'solo');
  const f = await sites.voegSiteToe(db, a, { domein: 'shop.test', platform: 'woocommerce' }).catch((e) => e);
  assert.equal(f.status, 403); assert.equal(f.upgrade, 'pro');
  assert.match(f.message, /^Uw pakket Solo ondersteunt geen WooCommerce-webshop\. Upgrade naar Pro/);
  assert.equal((await sites.lijstSites(db, a.id)).length, 0);
  for (const pk of ['pro', 'bureau_proef']) {
    const b = await acc.registreer(db, `${pk}-woo@test.invalid`, 'Testwachtwoord-123!', pk);
    assert.equal((await sites.voegSiteToe(db, b, { domein: `shop-${pk.replace('_', '')}.test`, platform: 'woocommerce' })).wachtlijst, false);
  }
  const c = await registreerEnLogin(app.basis, 'solo-woo-http@test.invalid');
  const r = await post(app.basis, '/sites/nieuw', { domein: 'webshop.test', taal: 'nl', land: 'BE', platform: 'woocommerce' }, c);
  assert.equal(r.status, 403);
  const html = await r.text();
  assert.match(html, /Uw pakket Solo ondersteunt geen WooCommerce-webshop\. Upgrade naar Pro/);
  assert.match(html, /href="\/pakketten"/);
});

test('A7 en A16: 100 zoekwoorden voor elk pakket; alleen NL/BE en nl', async () => {
  for (const p of Object.values(laadPakketten().pakketten)) assert.equal(p.zoekwoorden_volgen, 100);
  const a = await acc.registreer(db, 'land@test.invalid', 'Testwachtwoord-123!', 'pro');
  assert.equal((await sites.voegSiteToe(db, a, { domein: 'de.test', land: 'DE', platform: 'wordpress' }).catch((e) => e)).status, 400);
  assert.equal((await sites.voegSiteToe(db, a, { domein: 'en.test', taal: 'en', land: 'NL', platform: 'wordpress' }).catch((e) => e)).status, 400);
});
