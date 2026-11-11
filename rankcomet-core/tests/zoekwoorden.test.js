// Stap 6: zoekwoorden per site via DataForSEO (echte client, nep-transport), volgen met limiet, eigen woorden.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { nieuweDb, startApp, registreerEnLogin, registreerBevestigd, post, koppelSite, nepDataforseo } from './helpers.js';
import * as zw from '../src/zoekwoorden.js';
import { LANDEN, isAdsZoekwoord } from '../src/dataforseo.js';

const WW = 'Testwachtwoord-123!';
const idee = (zoekwoord, volume, extra = {}) => ({ keyword: zoekwoord, keyword_info: { search_volume: volume, cpc: 1.5, competition: 0.3 }, keyword_properties: { keyword_difficulty: 42 }, search_intent_info: { main_intent: 'informational' }, ...extra });
const IDEEEN = (w) => [idee(`${w} kosten`, 1200), idee(`${w} subsidie`, 800, { search_intent_info: { main_intent: 'commercial' } }), idee(`${w} zelf doen`, 300), { keyword: '   ' }, { geen: 'keyword' }];

let db, app;
before(async () => { db = await nieuweDb(); app = await startApp(db, undefined, { dataforseo: nepDataforseo({ ideeen: IDEEEN, volumes: (ks) => ks.map((k) => ({ keyword: k, search_volume: 90, cpc: 0.8, competition_index: 55 })) }) }); });
after(async () => { await app.sluit(); await db.sluit(); });

async function siteVan(naam, pakket = 'pro', land = 'NL') {
  const account = await registreerBevestigd(db, `${naam}@test.invalid`, WW, pakket);
  const site = await koppelSite(db, account, { domein: `${naam}.test`, platform: 'wordpress', land }, app.internet);
  return { account, site, ctx: { dataforseo: app.dataforseo.client, logger: app.logger } };
}

test('onderzoek: ideeën met volume, moeilijkheid en intentie, bewaard per site, juiste locatie en taal', async () => {
  const { account, site, ctx } = await siteVan('zw');
  const r = await zw.onderzoek(db, ctx, account, site.id, { startwoord: '  Dakisolatie ' });
  assert.equal(r.aantal, 3);
  assert.deepEqual(r.zoekwoorden.map((z) => [z.zoekwoord, z.volume, z.moeilijkheid, z.intentie, z.gevolgd]), [['dakisolatie kosten', 1200, 42, 'informatie', false], ['dakisolatie subsidie', 800, 42, 'commercieel', false], ['dakisolatie zelf doen', 300, 42, 'informatie', false]]);
  const aanroep = app.dataforseo.aanroepen.at(-1);
  assert.equal(aanroep.pad, '/v3/dataforseo_labs/google/keyword_ideas/live');
  assert.deepEqual([aanroep.taak.keywords, aanroep.taak.location_code, aanroep.taak.language_code, aanroep.taak.limit], [['dakisolatie'], LANDEN.NL.location_code, 'nl', 50]);
  assert.equal(aanroep.auth, 'Basic ' + Buffer.from('nep-login:nep-wachtwoord').toString('base64'));
  // Nog een keer: zelfde woorden worden bijgewerkt, niet verdubbeld.
  await zw.onderzoek(db, ctx, account, site.id, { startwoord: 'dakisolatie' });
  assert.equal((await zw.lijst(db, account.id, site.id)).length, 3);
  // Belgische site: locatiecode van België.
  const be = await siteVan('zwbe', 'pro', 'BE');
  await zw.onderzoek(db, be.ctx, be.account, be.site.id, { startwoord: 'dakwerken' });
  assert.equal(app.dataforseo.aanroepen.at(-1).taak.location_code, LANDEN.BE.location_code);
  const log = (await db.query('SELECT bericht FROM logregels')).rows.map((x) => x.bericht).join('\n');
  assert.match(log, /zoekwoordonderzoek account=.* aantal=3 kosten_usd=0\.0101/);
  assert.ok(!log.includes('dakisolatie'), 'zoekwoorden van de klant horen niet in de log');
});

test('volgen: hooguit zoekwoorden_volgen per site (A7: 100), ook bij gelijktijdige aanvragen; ontvolgen maakt ruimte', async () => {
  const { account, site, ctx } = await siteVan('volg', 'solo');
  const veel = nepDataforseo({ ideeen: () => Array.from({ length: 50 }, (_, i) => idee(`woord ${i}`, 10 + i)) });
  await zw.onderzoek(db, { ...ctx, dataforseo: veel.client }, account, site.id, { startwoord: 'woord' });
  await zw.onderzoek(db, { ...ctx, dataforseo: nepDataforseo({ ideeen: () => Array.from({ length: 50 }, (_, i) => idee(`term ${i}`, 10 + i)) }).client }, account, site.id, { startwoord: 'term' });
  await zw.onderzoek(db, { ...ctx, dataforseo: nepDataforseo({ ideeen: () => Array.from({ length: 5 }, (_, i) => idee(`extra ${i}`, 10)) }).client }, account, site.id, { startwoord: 'extra' });
  const alles = await zw.lijst(db, account.id, site.id);
  assert.equal(alles.length, 105);
  const rs = await Promise.allSettled(alles.map((z) => zw.volg(db, account, site.id, z.id)));
  assert.equal(rs.filter((r) => r.status === 'fulfilled').length, 100);
  assert.ok(rs.filter((r) => r.status === 'rejected').every((r) => r.reason.status === 403 && /maximum van je pakket/.test(r.reason.message)));
  assert.equal((await zw.lijst(db, account.id, site.id, { alleenGevolgd: true })).length, 100);
  const een = (await zw.lijst(db, account.id, site.id, { alleenGevolgd: true }))[0];
  await zw.ontvolg(db, account, site.id, een.id);
  assert.equal((await zw.lijst(db, account.id, site.id, { alleenGevolgd: true })).length, 99);
  const nogNiet = (await zw.lijst(db, account.id, site.id)).find((z) => !z.gevolgd);
  assert.equal((await zw.volg(db, account, site.id, nogNiet.id)).gevolgd, true);
});

test('eigen zoekwoord: volume uit Google Ads, meteen gevolgd; ongeldige woorden voor Google Ads worden niet gestuurd', async () => {
  const { account, site, ctx } = await siteVan('eigen');
  const r = await zw.voegToe(db, ctx, account, site.id, { zoekwoord: 'Dakgoot Reinigen Utrecht' });
  assert.equal(r.gevolgd, true);
  const z = (await zw.lijst(db, account.id, site.id, { alleenGevolgd: true }))[0];
  assert.deepEqual([z.zoekwoord, z.volume, z.bron, z.gevolgd], ['dakgoot reinigen utrecht', 90, 'eigen', true]);
  assert.equal(app.dataforseo.aanroepen.at(-1).pad, '/v3/keywords_data/google_ads/search_volume/live');
  assert.equal(isAdsZoekwoord('wat kost dit?'), false); assert.equal(isAdsZoekwoord('dakisolatie'), true);
  const n = app.dataforseo.aanroepen.length;
  await zw.voegToe(db, ctx, account, site.id, { zoekwoord: 'wat kost dit?' });
  assert.equal(app.dataforseo.aanroepen.length, n, 'niets gestuurd');
  assert.equal((await zw.lijst(db, account.id, site.id)).find((x) => x.zoekwoord === 'wat kost dit?').volume, null);
});

test('daggrens op onderzoeken (kost geld) en nette fouten als DataForSEO hapert', async () => {
  const { account, site, ctx } = await siteVan('grens', 'solo');
  for (let i = 0; i < 3; i++) await zw.onderzoek(db, ctx, account, site.id, { startwoord: `woord${i}` });
  const n = app.dataforseo.aanroepen.length;
  const f = await zw.onderzoek(db, ctx, account, site.id, { startwoord: 'woord4' }).catch((e) => e);
  assert.equal(f.status, 429); assert.match(f.message, /vandaag al 3 onderzoeken/);
  assert.equal(app.dataforseo.aanroepen.length, n, 'bij de grens geen aanroep');
  assert.deepEqual(await zw.kostenOverzicht(db, account.id, site.id), { vandaag: 3, kostenUsd: 0.0303 });
  // Storingen: taak mislukt bij DataForSEO, API-sleutel geweigerd, druk, onbereikbaar.
  const ander = await siteVan('storing', 'pro');
  const dfs = nepDataforseo();
  const ctx2 = { dataforseo: dfs.client, logger: app.logger };
  dfs.antwoord = () => ({ status_code: 20000, tasks: [{ status_code: 40103, status_message: 'Task execution failed', cost: 0 }] });
  assert.equal((await zw.onderzoek(db, ctx2, ander.account, ander.site.id, { startwoord: 'aa' }).catch((e) => e)).status, 503);
  dfs.antwoord = () => ({ status_code: 20000, tasks: [{ status_code: 40501, status_message: 'No Search Results.', cost: 0.01, result: null }] });
  assert.equal((await zw.onderzoek(db, ctx2, ander.account, ander.site.id, { startwoord: 'bb' })).aantal, 0, 'geen resultaten is geen fout');
  dfs.antwoord = null; dfs.httpStatus = 401;
  assert.match((await zw.onderzoek(db, ctx2, ander.account, ander.site.id, { startwoord: 'cc' }).catch((e) => e)).message, /weigert onze toegang/);
  dfs.httpStatus = 429;
  assert.equal((await zw.onderzoek(db, ctx2, ander.account, ander.site.id, { startwoord: 'dd' }).catch((e) => e)).status, 429);
  dfs.httpStatus = 200; dfs.client = (await import('../src/dataforseo.js')).maakDataforseo({ RC_DATAFORSEO_LOGIN: 'x', RC_DATAFORSEO_WACHTWOORD: 'y' }, async () => { throw new TypeError('fetch failed'); });
  assert.match((await zw.onderzoek(db, { ...ctx2, dataforseo: dfs.client }, ander.account, ander.site.id, { startwoord: 'ee' }).catch((e) => e)).message, /even niet bereikbaar/);
  const log = (await db.query('SELECT bericht FROM logregels')).rows.map((x) => x.bericht).join('\n');
  assert.ok(!log.includes('nep-wachtwoord') && !log.includes('nep-login'), 'inloggegevens van DataForSEO horen niet in de log');
});

test('account A ziet niets van account B: zoekwoorden, onderzoek en volgen', async () => {
  const a = await siteVan('za');
  const b = await siteVan('zb');
  await zw.onderzoek(db, a.ctx, a.account, a.site.id, { startwoord: 'dak' });
  const vanA = (await zw.lijst(db, a.account.id, a.site.id))[0];
  for (const poging of [() => zw.lijst(db, b.account.id, a.site.id), () => zw.onderzoek(db, b.ctx, b.account, a.site.id, { startwoord: 'dak' }), () => zw.volg(db, b.account, a.site.id, vanA.id), () => zw.volg(db, b.account, b.site.id, vanA.id), () => zw.ontvolg(db, b.account, b.site.id, vanA.id), () => zw.voegToe(db, b.ctx, b.account, a.site.id, { zoekwoord: 'x' })]) {
    assert.equal((await poging().catch((e) => e)).status, 404);
  }
  assert.equal((await zw.lijst(db, b.account.id, b.site.id)).length, 0);
  assert.equal((await zw.lijst(db, a.account.id, a.site.id)).find((z) => z.id === vanA.id).gevolgd, false);
  const cb = await registreerEnLogin(app, 'zb-http@test.invalid');
  assert.equal((await fetch(app.basis + `/sites/${a.site.id}/zoekwoorden`, { headers: { cookie: cb } })).status, 404);
  assert.equal((await post(app.basis, `/sites/${a.site.id}/zoekwoorden/volgen`, { id: vanA.id }, cb)).status, 404);
});

test('via de app: onderzoek doen, volgen, artikel laten schrijven met het zoekwoord vooraf ingevuld', async () => {
  const email = 'app-zw@test.invalid';
  const c = await registreerEnLogin(app, email);
  const account = (await db.query('SELECT id, pakket FROM accounts WHERE email = $1', [email])).rows[0];
  const site = await koppelSite(db, account, { domein: 'app-zw.test', platform: 'wordpress' }, app.internet);
  const r = await post(app.basis, `/sites/${site.id}/zoekwoorden/onderzoek`, { startwoord: 'dakisolatie' }, c);
  assert.equal(r.status, 303); assert.match(decodeURIComponent(r.headers.get('location')), /3 ideeën gevonden/);
  let html = await (await fetch(app.basis + `/sites/${site.id}/zoekwoorden`, { headers: { cookie: c } })).text();
  assert.match(html, /Zoekwoorden die je volgt \(0 van 100\)/); assert.match(html, /dakisolatie kosten<\/span> <span class="stil">· 1200 per maand · moeilijkheid 42 · wil iets weten/);
  const id = html.match(/name="id" value="([^"]+)"/)[1];
  assert.equal((await post(app.basis, `/sites/${site.id}/zoekwoorden/volgen`, { id }, c)).status, 303);
  html = await (await fetch(app.basis + `/sites/${site.id}/zoekwoorden`, { headers: { cookie: c } })).text();
  assert.match(html, /Zoekwoorden die je volgt \(1 van 100\)/);
  assert.match(html, /href="\/sites\/[^/]+\/artikel\?zoekwoord=dakisolatie%20kosten"/);
  assert.match(await (await fetch(app.basis + `/sites/${site.id}/artikel?zoekwoord=dakisolatie%20kosten`, { headers: { cookie: c } })).text(), /name="zoekwoord"[^>]*value="dakisolatie kosten"/);
  assert.match(await (await fetch(app.basis + '/dashboard', { headers: { cookie: c } })).text(), /Zoekwoorden<\/a>/);
  const fout = await post(app.basis, `/sites/${site.id}/zoekwoorden/onderzoek`, { startwoord: 'x' }, c);
  assert.equal(fout.status, 400); assert.match(await fout.text(), /2 tot 100 tekens/);
});
