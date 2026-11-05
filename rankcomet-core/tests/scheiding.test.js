import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { nieuweDb, startApp, registreerEnLogin, post, registreerBevestigd } from './helpers.js';
import * as acc from '../src/accounts.js';
import * as sites from '../src/sites.js';

let db, app; before(async () => { db = await nieuweDb(); app = await startApp(db); }); after(async () => { await app.sluit(); await db.sluit(); });

test('account A ziet nooit sites van account B (laag sites)', async () => {
  const a = await registreerBevestigd(db, 'a@test.invalid', 'Testwachtwoord-123!', 'pro');
  const b = await registreerBevestigd(db, 'b@test.invalid', 'Testwachtwoord-123!', 'pro');
  const sb = (await sites.voegSiteToe(db, b, { domein: 'site-b.test', platform: 'wordpress', land: 'NL' })).site;
  await sites.voegSiteToe(db, a, { domein: 'site-a.test', platform: 'woocommerce', land: 'BE' });
  assert.deepEqual((await sites.lijstSites(db, a.id)).map((s) => s.domein), ['site-a.test']);
  assert.equal(await sites.haalSite(db, a.id, sb.id), null);
  assert.equal(await sites.verwijderSite(db, a.id, sb.id), false);
  assert.ok(await sites.haalSite(db, b.id, sb.id), 'site B moet blijven bestaan');
  // Hetzelfde domein mag bij een ander account bestaan, zonder lek.
  await sites.voegSiteToe(db, a, { domein: 'site-b.test', platform: 'wordpress' });
  assert.equal((await sites.lijstSites(db, b.id)).length, 1);
});

test('account A ziet nooit sites van account B (HTTP)', async () => {
  const ca = await registreerEnLogin(app, 'http-a@test.invalid');
  const cb = await registreerEnLogin(app, 'http-b@test.invalid');
  assert.equal((await post(app.basis, '/sites/nieuw', { domein: 'geheim-b.test', taal: 'nl', land: 'NL', platform: 'wordpress' }, cb)).status, 303);
  const lijstB = await (await fetch(app.basis + '/api/sites', { headers: { cookie: cb } })).json();
  const idB = lijstB.sites[0].id;
  const lijstA = await (await fetch(app.basis + '/api/sites', { headers: { cookie: ca } })).json();
  assert.equal(lijstA.sites.length, 0);
  assert.equal((await fetch(app.basis + '/api/sites/' + idB, { headers: { cookie: ca } })).status, 404);
  const dash = await (await fetch(app.basis + '/dashboard', { headers: { cookie: ca } })).text();
  assert.ok(!dash.includes('geheim-b.test'));
  assert.equal((await fetch(app.basis + '/api/sites')).status, 401);
});
