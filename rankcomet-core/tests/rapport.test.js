// Stap 10: maandrapport als pagina en als mail, één keer per account per maand.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { nieuweDb, startApp, registreerEnLogin, registreerBevestigd, koppelSite, nepPlugin, nepDataforseo, TEST_ENV, nepMailer } from './helpers.js';
import * as rap from '../src/rapport.js';
import * as wijz from '../src/wijzigingen.js';
import * as zw from '../src/zoekwoorden.js';
import * as pos from '../src/posities.js';
import { laadSleutel } from '../src/geheimen.js';

const WW = 'Testwachtwoord-123!';
const POST_OUD = { titel: 'Oud', inhoud: '<p>Oud</p>', meta_titel: '', meta_beschrijving: '', focus_zoekwoord: '', canonical: '' };

let db, app, dfs;
before(async () => { dfs = nepDataforseo({ ideeen: (w) => [{ keyword: `${w} a`, keyword_info: { search_volume: 10 } }, { keyword: `${w} b`, keyword_info: { search_volume: 5 } }], serp: (k, taak) => dfs.serpVoor(k, taak) }); db = await nieuweDb(); app = await startApp(db, undefined, { dataforseo: dfs }); });
after(async () => { await app.sluit(); await db.sluit(); });

// Een account met activiteit in oktober 2026: 2 voorstellen (1 gepubliceerd, 1 afgewezen), posities eind september en eind oktober, Search Console-cijfers.
async function opzet(naam) {
  const account = await registreerBevestigd(db, `${naam}@test.invalid`, WW, 'pro');
  await db.query("UPDATE accounts SET aangemaakt = '2026-09-10T10:00:00.000Z' WHERE id = $1", [account.id]);
  const site = await koppelSite(db, account, { domein: `${naam}.test`, platform: 'wordpress' }, app.internet);
  const sleutel = await wijz.maakPluginSleutel(db, laadSleutel(TEST_ENV), account.id, site.id);
  const plugin = nepPlugin(app.internet, site.domein, sleutel, { doelen: { 'post:1': { ...POST_OUD }, 'post:2': { ...POST_OUD } } });
  const ctx = { ophalen: app.internet.ophalen, dataforseo: dfs.client, logger: app.logger, geheimenSleutel: laadSleutel(TEST_ENV) };
  const w1 = await wijz.stelVoor(db, ctx, account, site.id, { doelType: 'post', doelId: 1, velden: { titel: 'Nieuw 1' }, reden: 'test' });
  const w2 = await wijz.stelVoor(db, ctx, account, site.id, { doelType: 'post', doelId: 2, velden: { titel: 'Nieuw 2' }, reden: 'test' });
  await wijz.keurGoed(db, ctx, account, w1.id, 'publiceren');
  await wijz.wijsAf(db, account, w2.id, 'nee');
  await db.query("UPDATE wijzigingen SET maand = '2026-10' WHERE account_id = $1", [account.id]);
  await db.query("INSERT INTO artikelen (id, account_id, site_id, maand, aangemaakt, status, dag) VALUES ('art-' || $1, $2, $3, '2026-10', '2026-10-05T10:00:00.000Z', 'concept', '2026-10-05')", [naam, account.id, site.id]);
  await zw.onderzoek(db, ctx, account, site.id, { startwoord: 'dak' });
  for (const z of await zw.lijst(db, account.id, site.id)) await zw.volg(db, account, site.id, z.id);
  const serp = (p) => [{ type: 'organic', rank_group: p, rank_absolute: p, domain: site.domein, url: `https://${site.domein}/x/` }];
  dfs.serpVoor = () => serp(15); await pos.controleer(db, ctx, account, site.id, new Date('2026-09-30T10:00:00Z'));
  dfs.serpVoor = () => serp(4); await pos.controleer(db, ctx, account, site.id, new Date('2026-10-30T10:00:00Z'));
  await db.query("INSERT INTO gsc_koppelingen (site_id, account_id, property, status, gekoppeld, periode_eind, bijgewerkt) VALUES ($1, $2, 'sc-domain:x', 'gekoppeld', '2026-09-01', '2026-10-28', '2026-10-28')", [site.id, account.id]);
  for (const [eind, klikken] of [['2026-09-28', 80], ['2026-10-28', 120]]) await db.query("INSERT INTO gsc_cijfers (id, account_id, site_id, pagina, klikken, vertoningen, ctr, positie, periode_start, periode_eind, aangemaakt) VALUES ('gsc-' || $1 || $2, $3, $4, 'https://x/', $5, 1000, 0.1, 5, '2026-09-01', $1, $1)", [eind, naam, account.id, site.id, klikken]);
  return { account, site, plugin, ctx };
}

test('maandrapport: wat Rankcomet deed en wat het opleverde, per account en per site', async () => {
  const { account, site } = await opzet('rap');
  const r = await rap.maandrapport(db, account.id, '2026-10');
  assert.equal(r.naam, 'oktober 2026');
  assert.deepEqual([r.artikelen, r.voorstellen, r.gepubliceerd, r.afgewezen, r.teruggezet, r.opfrissingen, r.openNu], [1, 2, 1, 1, 0, 0, 0]);
  assert.equal(r.sites.length, 1);
  const s = r.sites[0];
  assert.deepEqual([s.domein, s.artikelen, s.gepubliceerd], [`rap.test`, 1, 1]);
  assert.deepEqual(s.posities, { gevolgd: 2, gemeten: 2, top10Eind: 2, top10Begin: 0, beter: 2, slechter: 0 });
  assert.deepEqual(s.searchConsole, { periodeEind: '2026-10-28', klikken: 120, vertoningen: 1000, klikkenVorige: 80 });
  // November: niets gedaan, posities blijven staan (laatste meting), Search Console idem.
  const nov = await rap.maandrapport(db, account.id, '2026-11');
  assert.deepEqual([nov.artikelen, nov.voorstellen, nov.sites[0].posities.top10Eind, nov.sites[0].posities.top10Begin], [0, 0, 2, 2]);
  assert.deepEqual(await rap.maanden(db, account.id, new Date('2026-11-11T10:00:00Z')), ['2026-11', '2026-10', '2026-09']);
  assert.equal((await rap.maandrapport(db, account.id, '2026-13').catch((e) => e)).status, 400);
  assert.equal((await rap.maandrapport(db, 'bestaat-niet', '2026-10').catch((e) => e)).status, 404);
  void site;
});

test('mail op de eerste van de maand: één keer per account, ook bij gelijktijdige runs; een mislukte mail krijgt één nieuwe kans', async () => {
  const { account } = await opzet('mail');
  const mailer = nepMailer();
  const ctx = { mailer, logger: app.logger };
  const tijd = new Date('2026-11-01T08:00:00Z');
  const uit = await Promise.all([rap.verstuurMaandrapporten(db, ctx, tijd), rap.verstuurMaandrapporten(db, ctx, tijd), rap.verstuurMaandrapporten(db, ctx, tijd)]);
  const mijn = mailer.mails.filter((m) => m.aan === 'mail@test.invalid');
  assert.equal(mijn.length, 1, 'precies één mail voor dit account');
  assert.equal(uit.reduce((t, u) => t + u.verstuurd, 0), mailer.mails.length);
  assert.equal(uit[0].maand, '2026-10');
  assert.match(mijn[0].onderwerp, /maandrapport over oktober 2026/);
  assert.match(mijn[0].tekst, /- 1 artikel geschreven\n- 2 voorstellen gedaan, 1 op je site gezet, 1 afgewezen\n- mail\.test: 2 van 2 zoekwoorden in de top 10 \(was 0\), 120 klikken uit Google \(vorige periode 80\)/);
  assert.match(mijn[0].tekst, /https:\/\/rankcomet\.ai\/rapport\/2026-10/);
  // Later die maand nog een run: niets opnieuw.
  const n = mailer.mails.length;
  const u2 = await rap.verstuurMaandrapporten(db, ctx, new Date('2026-11-15T08:00:00Z'));
  assert.equal(u2.verstuurd, 0); assert.equal(mailer.mails.length, n);
  // Mislukte mail: status mislukt, de volgende run probeert nog één keer en slaagt.
  const kapot = await opzet('kapot');
  const stuk = { mails: [], stuur: async () => { throw new Error('smtp stuk'); } };
  const u3 = await rap.verstuurMaandrapporten(db, { mailer: stuk, logger: app.logger }, tijd);
  assert.equal(u3.mislukt, 1);
  assert.equal((await db.query("SELECT status FROM rapporten WHERE account_id = $1 AND maand = '2026-10'", [kapot.account.id])).rows[0].status, 'mislukt');
  const u4 = await rap.verstuurMaandrapporten(db, ctx, tijd);
  assert.equal(u4.verstuurd, 1); assert.equal(mailer.mails.filter((m) => m.aan === 'kapot@test.invalid').length, 1);
  const log = (await db.query('SELECT bericht FROM logregels')).rows.map((x) => x.bericht).join('\n');
  assert.ok(!log.includes('@test.invalid'), 'geen e-mailadressen in de log');
  void account;
});

test('account A ziet niets van account B: rapport en pagina', async () => {
  const a = await opzet('ra');
  const b = await registreerBevestigd(db, 'rb@test.invalid', WW, 'solo');
  const rb = await rap.maandrapport(db, b.id, '2026-10');
  assert.deepEqual([rb.artikelen, rb.voorstellen, rb.sites.length], [0, 0, 0]);
  assert.equal((await rap.maandrapport(db, a.account.id, '2026-10')).voorstellen, 2);
  const cb = await registreerEnLogin(app, 'rb-http@test.invalid');
  const html = await (await fetch(app.basis + '/rapport/' + '2026-11', { headers: { cookie: cb } })).text();
  assert.doesNotMatch(html, /ra\.test/);
  assert.equal((await fetch(app.basis + '/rapport/2020-01', { headers: { cookie: cb } })).status, 404, 'vóór het account bestond: geen rapport');
});

test('via de app: lijst met maanden en het rapport zelf', async () => {
  const email = 'app-rap@test.invalid';
  const c = await registreerEnLogin(app, email);
  const account = (await db.query('SELECT id FROM accounts WHERE email = $1', [email])).rows[0];
  await db.query("UPDATE accounts SET aangemaakt = '2026-10-20T10:00:00.000Z' WHERE id = $1", [account.id]);
  const lijst = await (await fetch(app.basis + '/rapport', { headers: { cookie: c } })).text();
  assert.match(lijst, /href="\/rapport\/2026-11">november 2026</); assert.match(lijst, /href="\/rapport\/2026-10">oktober 2026</); assert.doesNotMatch(lijst, /2026-09/);
  const html = await (await fetch(app.basis + '/rapport/2026-11', { headers: { cookie: c } })).text();
  assert.match(html, /<h1>Rapport november 2026<\/h1>/); assert.match(html, /0<small>artikelen geschreven/); assert.match(html, /Nog geen gekoppelde sites/);
  assert.equal((await fetch(app.basis + '/rapport/2026-1x', { headers: { cookie: c } })).status, 404);
  assert.match(await (await fetch(app.basis + '/dashboard', { headers: { cookie: c } })).text(), /href="\/rapport">Maandrapport<\/a>/);
});
