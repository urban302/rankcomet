// Stap 2: eigendom van het domein bewijzen met een koppelcode in een metatag.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { nieuweDb, startApp, registreerEnLogin, registreerBevestigd, post, nepInternet, koppelSite, mockStripe } from './helpers.js';
import * as sites from '../src/sites.js';
import { reserveerArtikel } from '../src/artikelen.js';
import { STANDAARD_GRENZEN } from '../src/grens.js';

const WW = 'Testwachtwoord-123!';
let db, app;
before(async () => { db = await nieuweDb(); app = await startApp(db); });
after(async () => { await app.sluit(); await db.sluit(); });

test('site koppelen via de app: code tonen, controleren, daarna gekoppeld', async () => {
  const c = await registreerEnLogin(app, 'koppel@test.invalid');
  const r = await post(app.basis, '/sites/nieuw', { domein: 'koppel.test', land: 'NL', platform: 'wordpress' }, c);
  assert.equal(r.status, 303);
  const koppelPad = new URL(r.headers.get('location'), app.basis).pathname;
  assert.match(koppelPad, /^\/sites\/[^/]+\/koppelen$/);
  const html = await (await fetch(app.basis + koppelPad, { headers: { cookie: c } })).text();
  const code = html.match(/content=&quot;(rc-[0-9a-f]{32})&quot;/)[1];
  assert.match(html, /Controleer mijn site/);
  assert.match(await (await fetch(app.basis + '/dashboard', { headers: { cookie: c } })).text(), /koppel\.test .*nog koppelen/);

  // Nog geen metatag: nette fout, site blijft ongekoppeld.
  app.internet.paginas['https://koppel.test/'] = '<html><head><title>Koppel</title></head></html>';
  const mis = await post(app.basis, koppelPad + '/controleer', {}, c);
  assert.equal(mis.status, 400); assert.match(await mis.text(), /niet gevonden op https:\/\/koppel\.test\//);
  // Verkeerde code: ook niet.
  app.internet.paginas['https://koppel.test/'] = `<head><meta name="rankcomet-koppelcode" content="rc-${'0'.repeat(32)}"></head>`;
  assert.equal((await post(app.basis, koppelPad + '/controleer', {}, c)).status, 400);
  // Goede code: gekoppeld.
  app.internet.paginas['https://koppel.test/'] = `<head><meta name="rankcomet-koppelcode" content="${code}"></head>`;
  const ok = await post(app.basis, koppelPad + '/controleer', {}, c);
  assert.equal(ok.status, 200); assert.match(await ok.text(), /is nu gekoppeld/);
  assert.match(await (await fetch(app.basis + '/dashboard', { headers: { cookie: c } })).text(), /koppel\.test .*gekoppeld/);
  assert.ok(app.internet.verzoeken.every((u) => u.startsWith('https://koppel.test/')), 'alleen de eigen site wordt opgehaald');
  const log = (await db.query('SELECT bericht FROM logregels')).rows.map((r) => r.bericht).join('\n');
  assert.ok(!log.includes(code), 'koppelcode hoort niet in de log');
});

test('account B kan de koppelcode van account A niet gebruiken, ook niet voor hetzelfde domein', async () => {
  const a = await registreerBevestigd(db, 'eig-a@test.invalid', WW, 'pro');
  const b = await registreerBevestigd(db, 'eig-b@test.invalid', WW, 'pro');
  const internet = nepInternet();
  const siteA = await koppelSite(db, a, { domein: 'gedeeld.test', platform: 'wordpress' }, internet);
  // B voegt hetzelfde domein toe. Op de homepage staat de code van A.
  const siteB = (await sites.voegSiteToe(db, b, { domein: 'gedeeld.test', platform: 'wordpress' })).site;
  const f = await sites.controleerEigendom(db, b.id, siteB.id, internet.ophalen).catch((e) => e);
  assert.equal(f.status, 400);
  assert.equal((await sites.haalSite(db, b.id, siteB.id)).bevestigd, false);
  // B kan de site van A niet zien, niet opvragen en niet controleren.
  assert.equal(await sites.haalSite(db, b.id, siteA.id), null);
  assert.equal((await sites.koppelcodeVoor(db, b.id, siteA.id).catch((e) => e)).status, 404);
  assert.equal((await sites.controleerEigendom(db, b.id, siteA.id, internet.ophalen).catch((e) => e)).status, 404);
  const cb = await registreerEnLogin(app, 'eig-b-http@test.invalid');
  assert.equal((await fetch(app.basis + `/sites/${siteA.id}/koppelen`, { headers: { cookie: cb } })).status, 404);
  assert.equal((await post(app.basis, `/sites/${siteA.id}/koppelen/controleer`, {}, cb)).status, 404);
  // Alleen de code van A, op de site van A, telt. Die blijft gekoppeld.
  assert.equal((await sites.haalSite(db, a.id, siteA.id)).bevestigd, true);
});

test('zonder gekoppelde site geen artikelen', async () => {
  const a = await registreerBevestigd(db, 'eig-art@test.invalid', WW, 'pro');
  const s = (await sites.voegSiteToe(db, a, { domein: 'los.test', platform: 'wordpress' })).site;
  const f = await reserveerArtikel(db, a, s.id).catch((e) => e);
  assert.equal(f.status, 403); assert.match(f.message, /Bevestig eerst dat los\.test van jou is/);
  assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM artikelen WHERE site_id = $1', [s.id])).rows[0].n), 0);
});

test('koppelcontrole: foutcode van de site, doorverwijzing naar www, en een grens per site', async () => {
  const a = await registreerBevestigd(db, 'eig-www@test.invalid', WW, 'pro');
  const s = (await sites.voegSiteToe(db, a, { domein: 'www-site.test', platform: 'wordpress' })).site;
  const { koppelcode } = await sites.koppelcodeVoor(db, a.id, s.id);
  const internet = nepInternet({
    'https://www-site.test/': () => ({ status: 503, headers: {}, body: Buffer.from('storing') }),
  });
  assert.match((await sites.controleerEigendom(db, a.id, s.id, internet.ophalen).catch((e) => e)).message, /foutcode 503/);
  internet.paginas['https://www-site.test/'] = () => ({ status: 301, headers: { location: 'https://www.www-site.test/' }, body: Buffer.alloc(0) });
  internet.paginas['https://www.www-site.test/'] = `<head><meta name="rankcomet-koppelcode" content="${koppelcode}"></head>`;
  assert.equal((await sites.controleerEigendom(db, a.id, s.id, internet.ophalen)).bevestigd, true);

  // Via HTTP met de echte grenzen: maximaal 10 controles per site per uur.
  const eigen = await startApp(db, mockStripe(), { grenzen: STANDAARD_GRENZEN });
  try {
    const c = await registreerEnLogin(eigen, 'eig-grens@test.invalid');
    eigen.internet.paginas['https://grens.test/'] = '<html></html>';
    const r = await post(eigen.basis, '/sites/nieuw', { domein: 'grens.test', land: 'NL', platform: 'wordpress' }, c);
    const pad = new URL(r.headers.get('location'), eigen.basis).pathname + '/controleer';
    for (let i = 0; i < 10; i++) assert.equal((await post(eigen.basis, pad, {}, c)).status, 400);
    assert.equal((await post(eigen.basis, pad, {}, c)).status, 429);
    assert.equal(eigen.internet.verzoeken.length, 10, 'na de grens wordt de site niet meer opgehaald');
  } finally { await eigen.sluit(); }
});

test('sites van vóór stap 2 krijgen alsnog een koppelcode', async () => {
  const a = await registreerBevestigd(db, 'eig-oud@test.invalid', WW, 'pro');
  const s = (await sites.voegSiteToe(db, a, { domein: 'oud.test', platform: 'wordpress' })).site;
  await db.query('UPDATE sites SET koppelcode = NULL WHERE id = $1', [s.id]);
  const een = await sites.koppelcodeVoor(db, a.id, s.id);
  const twee = await sites.koppelcodeVoor(db, a.id, s.id);
  assert.match(een.koppelcode, /^rc-[0-9a-f]{32}$/); assert.equal(een.koppelcode, twee.koppelcode);
});
