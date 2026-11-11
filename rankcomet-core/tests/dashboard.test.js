// Stap 5: klantdashboard, strikte CSP, zelf gehoste stijl, layout op 390 px en 1440 px.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { nieuweDb, startApp, registreerEnLogin, registreerBevestigd, post, nepPlugin, koppelSite, TEST_ENV } from './helpers.js';
import * as wijz from '../src/wijzigingen.js';
import { CSP } from '../src/app.js';
import { laadSleutel } from '../src/geheimen.js';
import { createRequire } from 'node:module';

// Playwright staat op de ontwikkelmachine, niet in de repo: laden als het er is, anders overslaan.
const playwright = (() => { try { return createRequire(import.meta.url)('playwright'); } catch { return null; } })();

const WW = 'Testwachtwoord-123!';
let db, app;
before(async () => { db = await nieuweDb(); app = await startApp(db); });
after(async () => { await app.sluit(); await db.sluit(); });

const haal = (pad, cookie) => fetch(app.basis + pad, { redirect: 'manual', headers: cookie ? { cookie } : {} });
const POST_OUD = { titel: 'Oude titel', inhoud: '<p>Oude tekst</p>', meta_titel: '', meta_beschrijving: '', focus_zoekwoord: '', canonical: '' };

async function klantMetVoorstellen(naam) {
  const email = `${naam}@test.invalid`;
  const cookie = await registreerEnLogin(app, email);
  const account = (await db.query('SELECT id, pakket FROM accounts WHERE email = $1', [email])).rows[0];
  const site = await koppelSite(db, account, { domein: `${naam}.test`, platform: 'wordpress' }, app.internet);
  const sleutel = await wijz.maakPluginSleutel(db, laadSleutel(TEST_ENV), account.id, site.id);
  const plugin = nepPlugin(app.internet, site.domein, sleutel, { doelen: { 'post:1': { ...POST_OUD }, 'post:2': { ...POST_OUD } } });
  const ctx = { ophalen: app.internet.ophalen, geheimenSleutel: laadSleutel(TEST_ENV) };
  const bestaand = await wijz.stelVoor(db, ctx, account, site.id, { doelType: 'post', doelId: 1, velden: { titel: 'Betere titel' }, reden: 'Zoekwoord ontbreekt' });
  const nieuw = await wijz.stelVoor(db, ctx, account, site.id, { doelType: 'post', velden: { titel: 'Nieuw artikel', inhoud: '<p>Tekst</p>' }, reden: 'Nieuw artikel voor "dakisolatie"' });
  return { email, cookie, account, site, plugin, ctx, bestaand, nieuw };
}

test('strikte CSP op elke pagina, geen inline stijl of script, stylesheet zelf gehost', async () => {
  const c = await registreerEnLogin(app, 'csp@test.invalid');
  for (const pad of ['/inloggen', '/registreren', '/over', '/wachtwoord-vergeten']) {
    const r = await haal(pad);
    assert.equal(r.headers.get('content-security-policy'), CSP, pad);
    const html = await r.text();
    assert.doesNotMatch(html, /<script|\bstyle=|<style|\bon\w+=/i, pad);
    assert.doesNotMatch(html, /(src|href)="https?:\/\/(?!github\.com)/i, `${pad}: geen externe bronnen`);
    assert.match(html, /<link rel="stylesheet" href="\/stijl\.css">/);
  }
  for (const pad of ['/dashboard', '/wijzigingen', '/sites/nieuw', '/pakketten']) {
    const r = await haal(pad, c);
    assert.equal(r.headers.get('content-security-policy'), CSP, pad);
    assert.doesNotMatch(await r.text(), /<script|\bstyle=|<style|\bon\w+=/i, pad);
  }
  assert.match(CSP, /default-src 'none'/); assert.match(CSP, /style-src 'self'/); assert.doesNotMatch(CSP, /script-src|unsafe-inline|https?:/);
  const css = await haal('/stijl.css');
  assert.equal(css.status, 200); assert.match(css.headers.get('content-type'), /^text\/css/);
  const tekst = await css.text();
  assert.match(tekst, /font-family: system-ui/); assert.doesNotMatch(tekst, /url\(|@import|https?:/, 'geen externe bronnen in de stylesheet');
});

test('dashboard: Wacht op jou bovenaan met Goedkeuren en Niet doen, daarna de maand, live, over en sites', async () => {
  const { cookie, site, plugin, bestaand, nieuw } = await klantMetVoorstellen('dash');
  let html = await (await haal('/dashboard', cookie)).text();
  const posWacht = html.indexOf('Wacht op jou'), posMaand = html.indexOf('Deze maand'), posLive = html.indexOf('Live op je site'), posOver = html.indexOf('Artikelen over'), posSites = html.indexOf('Je sites');
  assert.ok(posWacht > 0 && posWacht < posMaand && posMaand < posLive && posLive < posOver && posOver < posSites, 'volgorde van de kaarten');
  assert.match(html, /dash\.test: Nieuw artikel<\/strong>Nieuw artikel voor &quot;dakisolatie&quot;/);
  assert.match(html, /Na goedkeuren komt het als concept in WordPress/);
  assert.match(html, /Na goedkeuren komt de nieuwe tekst live op je site/);
  assert.equal((html.match(/<button>Goedkeuren<\/button>/g) || []).length, 2);
  assert.equal((html.match(/<button class="rustig">Niet doen<\/button>/g) || []).length, 2);
  assert.match(html, /0<small>artikelen geschreven/);
  assert.match(html, /10<small>artikelen nog over in Solo/);
  assert.match(html, /dash\.test<\/span>: 0 artikelen deze maand, nog 10 over, vandaag nog 2\./);
  assert.match(html, /Artikel laten schrijven/);

  // Goedkeuren vanaf het dashboard: nieuw onderdeel als concept, bestaand onderdeel live. Terug op het dashboard met melding.
  const g1 = await post(app.basis, `/wijzigingen/${nieuw.id}/goedkeuren`, { modus: 'concept', terug: 'dashboard' }, cookie);
  assert.equal(g1.status, 303); assert.match(decodeURIComponent(g1.headers.get('location')), /^\/dashboard\?m=Het staat als concept klaar/);
  assert.equal(Object.values(plugin.doelen).find((d) => d.titel === 'Nieuw artikel')._status, 'draft');
  const g2 = await post(app.basis, `/wijzigingen/${bestaand.id}/goedkeuren`, { modus: 'publiceren', terug: 'dashboard' }, cookie);
  assert.equal(g2.status, 303); assert.equal(plugin.doelen['post:1'].titel, 'Betere titel'); assert.equal(plugin.doelen['post:1']._status, 'publish');

  html = await (await haal('/dashboard?m=Het%20staat%20live', cookie)).text();
  assert.match(html, /<p role="status">Het staat live<\/p>/);
  assert.match(html, /Niets\. Rankcomet heeft nu geen voorstellen voor je\./);
  assert.match(html, /2<small>op je site gezet/);
  // Live op je site: alleen de wijziging van een bestaand onderdeel is terug te zetten.
  assert.equal((html.match(/<button class="rustig">Terugzetten<\/button>/g) || []).length, 1);
  assert.match(html, /dash\.test<\/span>: Betere titel/);
  const t = await post(app.basis, `/wijzigingen/${bestaand.id}/terugzetten`, { terug: 'dashboard' }, cookie);
  assert.equal(t.status, 303); assert.equal(plugin.doelen['post:1'].titel, 'Oude titel');
  html = await (await haal('/dashboard', cookie)).text();
  assert.doesNotMatch(html, /<button class="rustig">Terugzetten<\/button>/);

  // Niet doen vanaf het dashboard.
  const ctx = { ophalen: app.internet.ophalen, geheimenSleutel: laadSleutel(TEST_ENV) };
  const account = (await db.query('SELECT id, pakket FROM accounts WHERE email = $1', ['dash@test.invalid'])).rows[0];
  const w3 = await wijz.stelVoor(db, ctx, account, site.id, { doelType: 'post', doelId: 2, velden: { titel: 'Nee' }, reden: 'test' });
  const n = await post(app.basis, `/wijzigingen/${w3.id}/afwijzen`, { terug: 'dashboard' }, cookie);
  assert.equal(n.status, 303); assert.equal((await wijz.haal(db, account.id, w3.id)).status, 'afgewezen');
  assert.match(await (await haal('/dashboard', cookie)).text(), /1<small>door jou afgewezen/);
});

test('account A ziet op het dashboard niets van account B', async () => {
  await klantMetVoorstellen('da');
  const b = await klantMetVoorstellen('db');
  const html = await (await haal('/dashboard', b.cookie)).text();
  assert.doesNotMatch(html, /da\.test/);
  assert.match(html, /db\.test/);
});

test('layout op 390 px en 1440 px: geen horizontaal scrollen, stijl geladen onder de CSP', { skip: !playwright && 'playwright niet beschikbaar' }, async () => {
  const { chromium } = playwright;
  const { cookie } = await klantMetVoorstellen('layout');
  const browser = await chromium.launch();
  const fouten = [];
  try {
    for (const breedte of [390, 1440]) {
      const context = await browser.newContext({ viewport: { width: breedte, height: 900 } });
      await context.addCookies([{ name: 'rc_sessie', value: cookie.split('=')[1], url: app.basis }]);
      const page = await context.newPage();
      page.on('console', (m) => { if (m.type() === 'error') fouten.push(m.text()); });
      for (const pad of ['/dashboard', '/wijzigingen', '/sites/nieuw']) {
        await page.goto(app.basis + pad);
        const meting = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, breedte: document.documentElement.clientWidth, font: getComputedStyle(document.body).fontFamily, h1: parseFloat(getComputedStyle(document.querySelector('h1')).fontSize), knop: document.querySelector('main button') ? document.querySelector('main button').getBoundingClientRect().height : 48 }));
        assert.ok(meting.scroll <= meting.breedte, `${pad} op ${breedte}px scrolt horizontaal (${meting.scroll} > ${meting.breedte})`);
        assert.match(meting.font, /system-ui/, `${pad}: stylesheet niet geladen (CSP?)`);
        assert.ok(meting.h1 >= 27, `${pad}: kop te klein (${meting.h1}px)`);
        assert.ok(meting.knop >= 44, `${pad}: knop te klein om aan te tikken (${meting.knop}px)`);
        if (pad === '/dashboard' && process.env.RC_SCHERMAFDRUK_MAP) await page.screenshot({ path: `${process.env.RC_SCHERMAFDRUK_MAP}/dashboard-${breedte}.png`, fullPage: true });
      }
      await context.close();
    }
    assert.deepEqual(fouten.filter((f) => /Content Security Policy/i.test(f)), []);
  } finally { await browser.close(); }
});
