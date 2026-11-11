// Stap 7: rank tracking via DataForSEO SERP: één aanroep per zoekwoord per dag, nooit dubbel betalen.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { nieuweDb, startApp, registreerEnLogin, registreerBevestigd, post, koppelSite, nepDataforseo } from './helpers.js';
import * as zw from '../src/zoekwoorden.js';
import * as pos from '../src/posities.js';
import { RANKCHECK_DIEPTE } from '../src/dataforseo.js';

const WW = 'Testwachtwoord-123!';
const organisch = (rang, domain, url) => ({ type: 'organic', rank_group: rang, rank_absolute: rang + 2, domain, url });
// Standaard-SERP: het eigen domein op 3 (met www), een subdomein op 7, en een 'local pack' op absolute positie 1.
const SERP = (zoekwoord, domein) => [{ type: 'local_pack', rank_absolute: 1, domain: domein }, organisch(1, 'concurrent.nl', 'https://concurrent.nl/a'), organisch(2, 'ander.be', 'https://ander.be/b'), organisch(3, `www.${domein}`, `https://www.${domein}/${zoekwoord.replace(/ /g, '-')}/`), organisch(7, `blog.${domein}`, `https://blog.${domein}/x`)];

let db, app, dfs;
before(async () => { dfs = nepDataforseo({ ideeen: (w) => [{ keyword: `${w} kosten`, keyword_info: { search_volume: 100 } }, { keyword: `${w} tips`, keyword_info: { search_volume: 50 } }], serp: (k, taak) => dfs.serpVoor ? dfs.serpVoor(k, taak) : SERP(k, dfs.domein) }); db = await nieuweDb(); app = await startApp(db, undefined, { dataforseo: dfs }); });
after(async () => { await app.sluit(); await db.sluit(); });

async function siteMetGevolgd(naam, pakket = 'pro', land = 'NL') {
  const account = await registreerBevestigd(db, `${naam}@test.invalid`, WW, pakket);
  const site = await koppelSite(db, account, { domein: `${naam}.test`, platform: 'wordpress', land }, app.internet);
  const ctx = { dataforseo: dfs.client, logger: app.logger };
  await zw.onderzoek(db, ctx, account, site.id, { startwoord: 'dak' });
  for (const z of await zw.lijst(db, account.id, site.id)) await zw.volg(db, account, site.id, z.id);
  return { account, site, ctx };
}
const serpAanroepen = () => dfs.aanroepen.filter((a) => a.pad === '/v3/serp/google/organic/live/advanced');

test('positie: alleen organische resultaten, eigen domein of subdomein, rank_group, met URL; juiste SERP-aanvraag', async () => {
  const { account, site, ctx } = await siteMetGevolgd('pos');
  dfs.domein = site.domein;
  const r = await pos.controleer(db, ctx, account, site.id, new Date('2026-11-10T09:00:00Z'));
  assert.deepEqual([r.dag, r.gedaan, r.overgeslagen, r.mislukt], ['2026-11-10', 2, 0, 0]);
  const taak = serpAanroepen().at(-1).taak;
  assert.deepEqual([taak.keyword, taak.location_code, taak.language_code, taak.device, taak.os, taak.depth], ['dak tips', 2528, 'nl', 'desktop', 'windows', RANKCHECK_DIEPTE]);
  const o = await pos.overzicht(db, account.id, site.id, new Date('2026-11-10T09:00:00Z'));
  assert.deepEqual(o.map((z) => [z.zoekwoord, z.positie, z.url, z.verschil]), [['dak kosten', 3, 'https://www.pos.test/dak-kosten/', null], ['dak tips', 3, 'https://www.pos.test/dak-tips/', null]]);
  // Niet in de top 20: positie null, wel gemeten.
  dfs.serpVoor = () => [organisch(1, 'concurrent.nl', 'https://concurrent.nl/')];
  await pos.controleer(db, ctx, account, site.id, new Date('2026-11-11T09:00:00Z'));
  assert.deepEqual((await pos.overzicht(db, account.id, site.id, new Date('2026-11-11T09:00:00Z'))).map((z) => [z.positie, z.dag]), [[null, '2026-11-11'], [null, '2026-11-11']]);
  dfs.serpVoor = null;
});

test('nooit dubbel betalen: herhaling, handmatige controle en gelijktijdige runs geven per zoekwoord per dag één aanroep', async () => {
  const { account, site, ctx } = await siteMetGevolgd('dubbel');
  dfs.domein = site.domein;
  const dag = new Date('2026-11-10T09:00:00Z');
  const n0 = serpAanroepen().length;
  const rs = await Promise.all([pos.controleer(db, ctx, account, site.id, dag), pos.controleer(db, ctx, account, site.id, dag), pos.controleer(db, ctx, account, site.id, dag)]);
  assert.equal(rs.reduce((t, r) => t + r.gedaan, 0), 2);
  assert.equal(rs.reduce((t, r) => t + r.overgeslagen, 0), 4);
  assert.equal(serpAanroepen().length - n0, 2);
  const nog = await pos.controleer(db, ctx, account, site.id, dag);
  assert.deepEqual([nog.gedaan, nog.overgeslagen], [0, 2]);
  assert.equal(serpAanroepen().length - n0, 2);
  // Een nieuwe dag: weer twee aanroepen. Een zoekwoord dat niet meer gevolgd wordt, wordt niet gecontroleerd.
  const een = (await zw.lijst(db, account.id, site.id, { alleenGevolgd: true }))[0];
  await zw.ontvolg(db, account, site.id, een.id);
  const morgen = await pos.controleer(db, ctx, account, site.id, new Date('2026-11-11T09:00:00Z'));
  assert.deepEqual([morgen.gedaan, morgen.overgeslagen], [1, 0]);
  assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM posities WHERE site_id = $1', [site.id])).rows[0].n), 3);
  const log = (await db.query('SELECT bericht FROM logregels')).rows.map((x) => x.bericht).join('\n');
  assert.match(log, /rankcheck account=.* gedaan=1 overgeslagen=0 mislukt=0 kosten_usd=0\.0101/);
  assert.ok(!log.includes('dak kosten'), 'zoekwoorden horen niet in de log');
});

test('verschil met een week geleden, en een mislukte aanroep kost vandaag geen tweede poging', async () => {
  const { account, site, ctx } = await siteMetGevolgd('week');
  dfs.domein = site.domein;
  dfs.serpVoor = () => [organisch(8, `www.${site.domein}`, `https://www.${site.domein}/`)];
  await pos.controleer(db, ctx, account, site.id, new Date('2026-11-03T09:00:00Z'));
  dfs.serpVoor = () => [organisch(5, site.domein, `https://${site.domein}/`)];
  await pos.controleer(db, ctx, account, site.id, new Date('2026-11-10T09:00:00Z'));
  const o = await pos.overzicht(db, account.id, site.id, new Date('2026-11-10T09:00:00Z'));
  assert.deepEqual(o.map((z) => [z.positie, z.weekTerug, z.verschil]), [[5, 8, 3], [5, 8, 3]]);
  // Mislukt: claim blijft staan, geen tweede aanroep vandaag, gisteren blijft de laatste meting.
  dfs.antwoord = () => ({ status_code: 20000, tasks: [{ status_code: 40103, status_message: 'Task execution failed', cost: 0 }] });
  const f = await pos.controleer(db, ctx, account, site.id, new Date('2026-11-11T09:00:00Z'));
  assert.deepEqual([f.gedaan, f.mislukt], [0, 2]);
  dfs.antwoord = null;
  const n = serpAanroepen().length;
  const nog = await pos.controleer(db, ctx, account, site.id, new Date('2026-11-11T10:00:00Z'));
  assert.deepEqual([nog.gedaan, nog.overgeslagen], [0, 2]); assert.equal(serpAanroepen().length, n);
  assert.deepEqual((await pos.overzicht(db, account.id, site.id, new Date('2026-11-11T10:00:00Z'))).map((z) => [z.positie, z.dag]), [[5, '2026-11-10'], [5, '2026-11-10']]);
  dfs.serpVoor = null;
});

test('planning: alle sites met gevolgde zoekwoorden, Belgische site met Belgische locatie, fout bij één site stopt de rest niet', async () => {
  const a = await siteMetGevolgd('pa', 'pro', 'NL');
  const b = await siteMetGevolgd('pb', 'pro', 'BE');
  const zonder = await registreerBevestigd(db, 'pz@test.invalid', WW, 'pro');
  await koppelSite(db, zonder, { domein: 'pz.test', platform: 'wordpress' }, app.internet); // geen zoekwoorden: niets te doen
  dfs.serpVoor = (k, taak) => { if (taak.location_code === 2056) throw new Error('simulatie: storing'); return SERP(k, 'pa.test'); };
  // De planning loopt over álle sites met gevolgde zoekwoorden (ook die van eerdere tests), dus we kijken naar onze eigen sites.
  const dag = new Date('2026-12-20T09:00:00Z');
  const u = await pos.controleerAlleSites(db, { dataforseo: dfs.client, logger: app.logger }, dag);
  dfs.serpVoor = null;
  // De storing bij de Belgische site telt als twee mislukte zoekwoorden; de Nederlandse site is gewoon gemeten.
  assert.ok(u.sites >= 2 && u.gedaan >= 2 && u.mislukt === 2, JSON.stringify(u));
  const log = (await db.query('SELECT bericht FROM logregels')).rows.map((x) => x.bericht).join('\n');
  assert.match(log, new RegExp(`rankcheck account=${b.account.id} site=${b.site.id} dag=2026-12-20 gedaan=0 overgeslagen=0 mislukt=2`));
  assert.deepEqual((await pos.overzicht(db, a.account.id, a.site.id, dag)).map((z) => z.positie), [3, 3]);
  assert.deepEqual((await pos.overzicht(db, b.account.id, b.site.id, dag)).map((z) => z.dag), [null, null], 'B heeft geen geslaagde meting');
  assert.equal((await pos.samenvatting(db, zonder.id)).length, 0, 'site zonder zoekwoorden doet niet mee');
  // Nog een keer dezelfde dag: niets nieuws, dus geen aanroepen.
  const n = serpAanroepen().length;
  const u2 = await pos.controleerAlleSites(db, { dataforseo: dfs.client, logger: app.logger }, dag);
  assert.equal(u2.gedaan, 0); assert.equal(serpAanroepen().length, n);
});

test('account A ziet niets van account B: controle, overzicht en pagina', async () => {
  const a = await siteMetGevolgd('ra');
  const b = await siteMetGevolgd('rb');
  dfs.domein = a.site.domein;
  await pos.controleer(db, a.ctx, a.account, a.site.id);
  assert.equal((await pos.controleer(db, b.ctx, b.account, a.site.id).catch((e) => e)).status, 404);
  assert.equal((await pos.overzicht(db, b.account.id, a.site.id).catch((e) => e)).status, 404);
  assert.deepEqual((await pos.samenvatting(db, b.account.id)).map((s) => s.domein), ['rb.test']);
  assert.equal((await pos.samenvatting(db, b.account.id))[0].gemeten, 0);
  const cb = await registreerEnLogin(app, 'rb-http@test.invalid');
  assert.equal((await post(app.basis, `/sites/${a.site.id}/zoekwoorden/controleren`, {}, cb)).status, 404);
});

test('via de app: Nu controleren, posities op de zoekwoordenpagina en de kaart op het dashboard', async () => {
  const email = 'app-pos@test.invalid';
  const c = await registreerEnLogin(app, email);
  const account = (await db.query('SELECT id, pakket FROM accounts WHERE email = $1', [email])).rows[0];
  const site = await koppelSite(db, account, { domein: 'app-pos.test', platform: 'wordpress' }, app.internet);
  dfs.domein = site.domein;
  assert.equal((await post(app.basis, `/sites/${site.id}/zoekwoorden/onderzoek`, { startwoord: 'dak' }, c)).status, 303);
  let html = await (await fetch(app.basis + `/sites/${site.id}/zoekwoorden`, { headers: { cookie: c } })).text();
  for (const id of [...html.matchAll(/name="id" value="([^"]+)"/g)].map((m) => m[1])) await post(app.basis, `/sites/${site.id}/zoekwoorden/volgen`, { id }, c);
  html = await (await fetch(app.basis + `/sites/${site.id}/zoekwoorden`, { headers: { cookie: c } })).text();
  assert.match(html, /nog niet gemeten/); assert.match(html, /Nu controleren/);
  const r = await post(app.basis, `/sites/${site.id}/zoekwoorden/controleren`, {}, c);
  assert.equal(r.status, 303); assert.match(decodeURIComponent(r.headers.get('location')), /2 posities gecontroleerd/);
  html = await (await fetch(app.basis + `/sites/${site.id}/zoekwoorden`, { headers: { cookie: c } })).text();
  assert.match(html, /<span class="positie">positie 3<\/span> <small><a href="https:\/\/www\.app-pos\.test\/dak-kosten\/">pagina<\/a><\/small>/);
  const r2 = await post(app.basis, `/sites/${site.id}/zoekwoorden/controleren`, {}, c);
  assert.match(decodeURIComponent(r2.headers.get('location')), /waren al gecontroleerd/);
  const dash = await (await fetch(app.basis + '/dashboard', { headers: { cookie: c } })).text();
  assert.match(dash, /Posities in Google/); assert.match(dash, /app-pos\.test<\/span>: 2 van 2 zoekwoorden in de top 10\./);
});
