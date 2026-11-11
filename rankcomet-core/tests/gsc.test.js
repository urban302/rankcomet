// Stap 8: Search Console-koppeling met OAuth (PKCE), versleutelde tokens, cijfers per pagina, verbreken.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { nieuweDb, startApp, registreerEnLogin, registreerBevestigd, post, koppelSite, nepGoogle, TEST_ENV } from './helpers.js';
import * as gsc from '../src/gsc.js';
import { SCOPE, challengeVan } from '../src/google.js';
import { laadSleutel } from '../src/geheimen.js';

const WW = 'Testwachtwoord-123!';
const RIJEN = (property) => [{ keys: [`https://${property.replace('sc-domain:', '')}/dakisolatie/`], clicks: 40, impressions: 900, ctr: 0.044, position: 6.2 }, { keys: [`https://${property.replace('sc-domain:', '')}/`], clicks: 25, impressions: 1200, ctr: 0.02, position: 9.8 }];

let db, app, google;
before(async () => { google = nepGoogle({ properties: ['https://ander-site.nl/', 'sc-domain:ZZZ'], rijen: RIJEN }); db = await nieuweDb(); app = await startApp(db, undefined, { google }); });
after(async () => { await app.sluit(); await db.sluit(); });

async function siteVan(naam) {
  const account = await registreerBevestigd(db, `${naam}@test.invalid`, WW, 'pro');
  const site = await koppelSite(db, account, { domein: `${naam}.test`, platform: 'wordpress' }, app.internet);
  return { account, site, ctx: { google: google.client, logger: app.logger, geheimenSleutel: laadSleutel(TEST_ENV) } };
}
const stateUit = (url) => new URL(url).searchParams.get('state');

test('koppelen: juiste Google-URL met PKCE, eenmalige state, tokens versleuteld, property kiezen, cijfers per pagina', async () => {
  const { account, site, ctx } = await siteVan('gsc');
  google.properties = ['https://ander-site.nl/', `sc-domain:${site.domein}`];
  const url = await gsc.start(db, ctx, account, site.id);
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.deepEqual([u.searchParams.get('client_id'), u.searchParams.get('scope'), u.searchParams.get('access_type'), u.searchParams.get('prompt'), u.searchParams.get('code_challenge_method'), u.searchParams.get('redirect_uri')], ['nep-client', SCOPE, 'offline', 'consent', 'S256', 'https://rankcomet.ai/google/terug']);
  const state = stateUit(url);
  assert.equal((await db.query('SELECT 1 AS x FROM oauth_staten WHERE state_hash = $1', [state])).rows.length, 0, 'state staat niet leesbaar in de database');
  // Verkeerde code bij Google: nette fout, state is verbruikt.
  const fout = await gsc.terug(db, ctx, account, { code: 'foute-code', state }).catch((e) => e);
  assert.equal(fout.status, 400); assert.match(fout.message, /accepteerde de koppeling niet/);
  assert.match((await gsc.terug(db, ctx, account, { code: 'goede-code', state }).catch((e) => e)).message, /verlopen of al gebruikt/);
  // Opnieuw: goede code. De verifier hoort bij de challenge die naar Google ging.
  const url2 = await gsc.start(db, ctx, account, site.id);
  const r = await gsc.terug(db, ctx, account, { code: 'goede-code', state: stateUit(url2) });
  const wissel = google.aanroepen.findLast((a) => a.pad === '/token');
  assert.equal(challengeVan(wissel.body.code_verifier), new URL(url2).searchParams.get('code_challenge'));
  assert.equal(wissel.body.redirect_uri, 'https://rankcomet.ai/google/terug');
  assert.equal(r.siteId, site.id);
  assert.deepEqual(r.properties.map((p) => [p.property, p.past]), [[`sc-domain:${site.domein}`, true], ['https://ander-site.nl/', false]]);
  const geheimen = (await db.query("SELECT soort, versleuteld FROM geheimen WHERE site_id = $1 AND soort LIKE 'google_%'", [site.id])).rows;
  assert.deepEqual(geheimen.map((g) => g.soort).sort(), ['google_access', 'google_refresh']);
  assert.ok(geheimen.every((g) => !/toegang-|ververs-/.test(g.versleuteld)), 'tokens staan niet leesbaar in de database');
  assert.equal((await gsc.koppeling(db, account.id, site.id)).status, 'property_kiezen');
  // Alleen een property uit de lijst.
  assert.equal((await gsc.kiesProperty(db, ctx, account, site.id, 'sc-domain:kwaad.example').catch((e) => e)).status, 400);
  const k = await gsc.kiesProperty(db, ctx, account, site.id, `sc-domain:${site.domein}`);
  assert.equal(k.paginas, 2);
  const vraag = google.aanroepen.findLast((a) => a.pad.endsWith('/searchAnalytics/query'));
  assert.deepEqual([vraag.body.dimensions, vraag.body.rowLimit, vraag.body.dataState], [['page'], 100, 'final']);
  assert.ok(vraag.body.startDate < vraag.body.endDate);
  const kop = await gsc.koppeling(db, account.id, site.id);
  assert.equal(kop.status, 'gekoppeld'); assert.deepEqual(kop.totaal, { klikken: 65, vertoningen: 2100 });
  assert.deepEqual(kop.paginas.map((p) => [p.pagina, p.klikken, p.positie]), [[`https://${site.domein}/dakisolatie/`, 40, 6.2], [`https://${site.domein}/`, 25, 9.8]]);
  const log = (await db.query('SELECT bericht FROM logregels')).rows.map((x) => x.bericht).join('\n');
  assert.ok(!/toegang-\d|ververs-\d|goede-code/.test(log), 'tokens en codes horen niet in de log');
});

test('één keer per dag ophalen, toegangsbewijs vernieuwen als het verlopen is, ingetrokken toegang zet de koppeling op verbroken', async () => {
  const { account, site, ctx } = await siteVan('dag');
  google.properties = [`sc-domain:${site.domein}`];
  await gsc.terug(db, ctx, account, { code: 'goede-code', state: stateUit(await gsc.start(db, ctx, account, site.id)) });
  await gsc.kiesProperty(db, ctx, account, site.id, `sc-domain:${site.domein}`);
  const n = google.aanroepen.length;
  assert.deepEqual(await gsc.ververs(db, ctx, account, site.id), { overgeslagen: true });
  assert.equal(google.aanroepen.length, n, 'vandaag al opgehaald: geen aanroep');
  // Morgen: wel, en het toegangsbewijs is intussen verlopen, dus eerst vernieuwen met de refresh token.
  await db.query("UPDATE geheimen SET versleuteld = $1 WHERE site_id = $2 AND soort = 'google_access'", [(await import('../src/geheimen.js')).versleutel(ctx.geheimenSleutel, JSON.stringify({ token: 'toegang-oud', verloopt: '2000-01-01T00:00:00.000Z' }), account.id), site.id]);
  const morgen = new Date(Date.now() + 86400000);
  const u = await gsc.ververs(db, ctx, account, site.id, { tijd: morgen });
  assert.equal(u.overgeslagen, false);
  const ververs = google.aanroepen.findLast((a) => a.pad === '/token');
  assert.equal(ververs.body.grant_type, 'refresh_token');
  assert.match(google.aanroepen.at(-1).auth, /^Bearer toegang-\d+$/);
  // De klant trekt de toegang in bij Google: de volgende vernieuwing mislukt, koppeling op 'verbroken'.
  await db.query("DELETE FROM geheimen WHERE site_id = $1 AND soort = 'google_access'", [site.id]);
  google.refreshFout = 'invalid_grant';
  const f = await gsc.ververs(db, ctx, account, site.id, { forceer: true }).catch((e) => e);
  google.refreshFout = null;
  assert.equal(f.ingetrokken, true);
  assert.equal((await gsc.koppeling(db, account.id, site.id)).status, 'verbroken');
  assert.equal((await gsc.samenvatting(db, account.id))[0].status, 'verbroken');
});

test('verbreken: toegang ingetrokken bij Google, tokens, koppeling en cijfers weg', async () => {
  const { account, site, ctx } = await siteVan('weg');
  google.properties = [`sc-domain:${site.domein}`];
  await gsc.terug(db, ctx, account, { code: 'goede-code', state: stateUit(await gsc.start(db, ctx, account, site.id)) });
  await gsc.kiesProperty(db, ctx, account, site.id, `sc-domain:${site.domein}`);
  assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM gsc_cijfers WHERE site_id = $1', [site.id])).rows[0].n), 2);
  await gsc.verbreek(db, ctx, account, site.id);
  assert.match(google.ingetrokken.at(-1), /^ververs-\d+$/);
  assert.equal(await gsc.koppeling(db, account.id, site.id), null);
  for (const t of ['gsc_cijfers', 'oauth_staten']) assert.equal(Number((await db.query(`SELECT COUNT(*) AS n FROM ${t} WHERE site_id = $1`, [site.id])).rows[0].n), 0, t);
  assert.equal(Number((await db.query("SELECT COUNT(*) AS n FROM geheimen WHERE site_id = $1 AND soort LIKE 'google_%'", [site.id])).rows[0].n), 0);
  assert.deepEqual(await gsc.samenvatting(db, account.id), []);
});

test('account A ziet niets van account B: state, koppeling, cijfers, verbreken', async () => {
  const a = await siteVan('ga');
  const b = await siteVan('gb');
  google.properties = [`sc-domain:${a.site.domein}`];
  const url = await gsc.start(db, a.ctx, a.account, a.site.id);
  // B kan de state van A niet verzilveren, ook niet met een goede code; de state blijft voor A bruikbaar.
  assert.match((await gsc.terug(db, b.ctx, b.account, { code: 'goede-code', state: stateUit(url) }).catch((e) => e)).message, /verlopen of al gebruikt/);
  await gsc.terug(db, a.ctx, a.account, { code: 'goede-code', state: stateUit(url) });
  await gsc.kiesProperty(db, a.ctx, a.account, a.site.id, `sc-domain:${a.site.domein}`);
  for (const poging of [() => gsc.start(db, b.ctx, b.account, a.site.id), () => gsc.koppeling(db, b.account.id, a.site.id), () => gsc.ververs(db, b.ctx, b.account, a.site.id), () => gsc.kiesProperty(db, b.ctx, b.account, a.site.id, 'x'), () => gsc.verbreek(db, b.ctx, b.account, a.site.id)]) {
    assert.equal((await poging().catch((e) => e)).status, 404);
  }
  assert.deepEqual(await gsc.samenvatting(db, b.account.id), []);
  assert.equal((await gsc.koppeling(db, a.account.id, a.site.id)).status, 'gekoppeld');
  const cb = await registreerEnLogin(app, 'gb-http@test.invalid');
  assert.equal((await fetch(app.basis + `/sites/${a.site.id}/search-console`, { headers: { cookie: cb } })).status, 404);
  assert.equal((await post(app.basis, `/sites/${a.site.id}/search-console/verbreken`, {}, cb)).status, 404);
});

test('planning: alle gekoppelde sites één keer per dag; zonder Google-client zegt de pagina dat de koppeling nog niet beschikbaar is', async () => {
  const { account, site, ctx } = await siteVan('plan');
  google.properties = [`sc-domain:${site.domein}`];
  await gsc.terug(db, ctx, account, { code: 'goede-code', state: stateUit(await gsc.start(db, ctx, account, site.id)) });
  await gsc.kiesProperty(db, ctx, account, site.id, `sc-domain:${site.domein}`);
  const overmorgen = new Date(Date.now() + 2 * 86400000);
  const u1 = await gsc.verversAlleSites(db, ctx, overmorgen);
  assert.ok(u1.sites >= 1 && u1.ververst >= 1, JSON.stringify(u1));
  const u2 = await gsc.verversAlleSites(db, ctx, overmorgen);
  assert.equal(u2.ververst, 0);
  // Zonder client-id en -secret: pagina met uitleg, start geeft 503, niets opgeslagen.
  const zonder = await startApp(db, undefined, { google: nepGoogle({ beschikbaar: false }) });
  try {
    const email = 'zonder@test.invalid';
    const c = await registreerEnLogin(zonder, email);
    const acc = (await db.query('SELECT id, pakket FROM accounts WHERE email = $1', [email])).rows[0];
    const s = await koppelSite(db, acc, { domein: 'zonder.test', platform: 'wordpress' }, zonder.internet);
    assert.match(await (await fetch(zonder.basis + `/sites/${s.id}/search-console`, { headers: { cookie: c } })).text(), /nog niet beschikbaar/);
    assert.equal((await post(zonder.basis, `/sites/${s.id}/search-console/start`, {}, c)).status, 503);
    assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM oauth_staten WHERE site_id = $1', [s.id])).rows[0].n), 0);
  } finally { await zonder.sluit(); }
});

test('via de app: koppelen, terugkomen van Google, property kiezen, cijfers zien, verbreken; kaart op het dashboard', async () => {
  const email = 'app-gsc@test.invalid';
  const c = await registreerEnLogin(app, email);
  const account = (await db.query('SELECT id, pakket FROM accounts WHERE email = $1', [email])).rows[0];
  const site = await koppelSite(db, account, { domein: 'app-gsc.test', platform: 'wordpress' }, app.internet);
  google.properties = ['https://ander-site.nl/', 'sc-domain:app-gsc.test'];
  let html = await (await fetch(app.basis + `/sites/${site.id}/search-console`, { headers: { cookie: c } })).text();
  assert.match(html, /Koppel Search Console/); assert.match(html, /alleen leesrechten/);
  const start = await post(app.basis, `/sites/${site.id}/search-console/start`, {}, c);
  assert.equal(start.status, 303); assert.match(start.headers.get('location'), /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
  const state = stateUit(start.headers.get('location'));
  // Geweigerd door de klant.
  const nee = await fetch(app.basis + `/google/terug?error=access_denied&state=${state}`, { redirect: 'manual', headers: { cookie: c } });
  assert.equal(nee.status, 400); assert.match(await nee.text(), /geweigerd/);
  const terug = await fetch(app.basis + `/google/terug?code=goede-code&state=${state}`, { redirect: 'manual', headers: { cookie: c } });
  assert.equal(terug.status, 303); assert.equal(terug.headers.get('location'), `/sites/${site.id}/search-console`);
  html = await (await fetch(app.basis + `/sites/${site.id}/search-console`, { headers: { cookie: c } })).text();
  assert.match(html, /Welke property hoort bij app-gsc\.test\?/); assert.match(html, /value="sc-domain:app-gsc\.test" checked> sc-domain:app-gsc\.test \(past bij deze site\)/);
  const kies = await post(app.basis, `/sites/${site.id}/search-console/property`, { property: 'sc-domain:app-gsc.test' }, c);
  assert.equal(kies.status, 303); assert.match(decodeURIComponent(kies.headers.get('location')), /2 pagina's met cijfers/);
  html = await (await fetch(app.basis + `/sites/${site.id}/search-console`, { headers: { cookie: c } })).text();
  assert.match(html, /Gekoppeld: sc-domain:app-gsc\.test/); assert.match(html, /65 klikken en 2100 vertoningen/); assert.match(html, /\/dakisolatie\/<\/span> <span class="stil">· 40 klikken · 900 vertoningen · positie 6\.2/);
  const dash = await (await fetch(app.basis + '/dashboard', { headers: { cookie: c } })).text();
  assert.match(dash, /Google Search Console<\/h2>/); assert.match(dash, /app-gsc\.test<\/span>: 65 klikken en 2100 vertoningen/);
  const weg = await post(app.basis, `/sites/${site.id}/search-console/verbreken`, {}, c);
  assert.equal(weg.status, 303);
  html = await (await fetch(app.basis + weg.headers.get('location'), { headers: { cookie: c } })).text();
  assert.match(html, /Google-gegevens zijn verwijderd/); assert.match(html, /Koppel Search Console/);
  // Een terug-link zonder geldige state (of van een ander account) doet niets.
  assert.equal((await fetch(app.basis + `/google/terug?code=goede-code&state=onzin`, { redirect: 'manual', headers: { cookie: c } })).status, 400);
});
