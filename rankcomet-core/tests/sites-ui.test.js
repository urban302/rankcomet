import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { nieuweDb, startApp, registreerEnLogin, post } from './helpers.js';
import { normaliseerDomein } from '../src/sites.js';

let db, app; before(async () => { db = await nieuweDb(); app = await startApp(db); }); after(async () => { await app.sluit(); await db.sluit(); });

test('domein wordt genormaliseerd en gecontroleerd', () => {
  assert.equal(normaliseerDomein('https://www.Voorbeeld.NL/pad'), 'voorbeeld.nl');
  assert.throws(() => normaliseerDomein('geen domein'), /geldig domein/);
});

test('NL-UI: inlogpagina, dashboard, formulier en about met MIT', async () => {
  const inlog = await (await fetch(app.basis + '/inloggen')).text();
  assert.match(inlog, /<html lang="nl">/); assert.match(inlog, /E-mailadres/); assert.match(inlog, /Rankcomet/);
  assert.equal((await fetch(app.basis + '/dashboard', { redirect: 'manual' })).status, 303);
  const c = await registreerEnLogin(app, 'ui@test.invalid');
  const dash = await (await fetch(app.basis + '/dashboard', { headers: { cookie: c } })).text();
  assert.match(dash, /Nog geen sites/); assert.match(dash, /Pakket: <strong>Solo/);
  const form = await (await fetch(app.basis + '/sites/nieuw', { headers: { cookie: c } })).text();
  for (const s of ['WordPress', 'WooCommerce', 'Shopify (wachtlijst)', 'Nederland', 'value="nl"']) assert.ok(form.includes(s), s);
  const over = await (await fetch(app.basis + '/over')).text();
  assert.match(over, /MIT-licentie/); assert.match(over, /Ben Senescu/);
  const pk = await (await fetch(app.basis + '/pakketten', { headers: { cookie: c } })).text();
  assert.match(pk, /€39 per maand excl\. btw/); assert.match(pk, /€89/); assert.match(pk, /€149/);
});

test('ander platform gaat naar de wachtlijst, telt niet als site', async () => {
  const c = await registreerEnLogin(app, 'wacht@test.invalid');
  const r = await post(app.basis, '/sites/nieuw', { domein: 'winkel.test', taal: 'nl', land: 'NL', platform: 'shopify' }, c);
  assert.equal(r.status, 200); assert.match(await r.text(), /wachtlijst/);
  assert.equal((await db.query('SELECT COUNT(*) AS n FROM wachtlijst')).rows[0].n * 1, 1);
  const lijst = await (await fetch(app.basis + '/api/sites', { headers: { cookie: c } })).json();
  assert.equal(lijst.sites.length, 0);
});

test('verkeerde taal en onbekend land geweigerd', async () => {
  const c = await registreerEnLogin(app, 'taal@test.invalid');
  assert.equal((await post(app.basis, '/sites/nieuw', { domein: 'x.test', taal: 'de', land: 'NL', platform: 'wordpress' }, c)).status, 400);
  assert.equal((await post(app.basis, '/sites/nieuw', { domein: 'x.test', taal: 'nl', land: 'US', platform: 'wordpress' }, c)).status, 400);
});

test('POST van een andere origin wordt geweigerd (CSRF)', async () => {
  const c = await registreerEnLogin(app, 'csrf@test.invalid');
  const r = await fetch(app.basis + '/sites/nieuw', { method: 'POST', redirect: 'manual', headers: { cookie: c, origin: 'https://kwaad.test', 'content-type': 'application/x-www-form-urlencoded' }, body: 'domein=y.test&platform=wordpress' });
  assert.equal(r.status, 403);
});

test('sessiecookie is HttpOnly en SameSite=Strict', async () => {
  const r = await post(app.basis, '/registreren', { email: 'cookie@test.invalid', wachtwoord: 'Testwachtwoord-123!' });
  const sc = r.headers.get('set-cookie');
  assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/);
});
