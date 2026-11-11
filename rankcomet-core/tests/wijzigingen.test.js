// Stap 3: voorstellen, goedkeuren, publiceren, terugzetten, idempotentie, witte lijst, volumerem.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { nieuweDb, startApp, registreerEnLogin, registreerBevestigd, post, nepInternet, nepPlugin, koppelSite, TEST_ENV } from './helpers.js';
import * as wijz from '../src/wijzigingen.js';
import { laadSleutel } from '../src/geheimen.js';
import { Fout } from '../src/accounts.js';

const WW = 'Testwachtwoord-123!';
let db, app, ctx;
before(async () => { db = await nieuweDb(); app = await startApp(db); ctx = { ophalen: app.internet.ophalen, geheimenSleutel: laadSleutel(TEST_ENV) }; });
after(async () => { await app.sluit(); await db.sluit(); });

// Gekoppelde site met een nep-plugin die de echte pluginsleutel kent.
async function siteMetPlugin(naam, { pakket = 'pro', platform = 'wordpress', doelen = {}, internet = app.internet } = {}) {
  const account = await registreerBevestigd(db, `${naam}@test.invalid`, WW, pakket);
  const site = await koppelSite(db, account, { domein: `${naam}.test`, platform }, internet);
  const sleutel = await wijz.maakPluginSleutel(db, ctx.geheimenSleutel, account.id, site.id);
  const plugin = nepPlugin(internet, site.domein, sleutel, { doelen });
  return { account, site, sleutel, plugin };
}

const POST_OUD = { titel: 'Oude titel', inhoud: '<p>Oude tekst</p>', meta_titel: '', meta_beschrijving: '', focus_zoekwoord: '', canonical: '' };

test('pluginsleutel: versleuteld opgeslagen, één keer zichtbaar, oude sleutel werkt niet meer', async () => {
  const { account, site, sleutel } = await siteMetPlugin('sleutel');
  const rij = (await db.query("SELECT versleuteld FROM geheimen WHERE site_id = $1 AND soort = 'plugin_sleutel'", [site.id])).rows[0];
  assert.ok(rij && !rij.versleuteld.includes(sleutel), 'sleutel mag niet leesbaar in de database staan');
  assert.deepEqual(await wijz.pluginStatus(db, ctx, account.id, site.id), { plugin: '0.1.0', woocommerce: true, seo: 'yoast' });
  // Nieuwe sleutel in Rankcomet, plugin heeft nog de oude: nette fout.
  await wijz.maakPluginSleutel(db, ctx.geheimenSleutel, account.id, site.id);
  const f = await wijz.pluginStatus(db, ctx, account.id, site.id).catch((e) => e);
  assert.equal(f.status, 400); assert.match(f.message, /sleutel .* klopt niet/);
  const log = (await db.query('SELECT bericht FROM logregels')).rows.map((r) => r.bericht).join('\n');
  assert.ok(!log.includes(sleutel));
});

test('voorstel -> goedkeuren als concept -> op de site als concept, met oude waarden bewaard', async () => {
  const { account, site, plugin } = await siteMetPlugin('concept', { doelen: { 'post:12': { ...POST_OUD } } });
  const w = await wijz.stelVoor(db, ctx, account, site.id, { doelType: 'post', doelId: 12, velden: { titel: 'Nieuwe titel', inhoud: '<p>Nieuw</p>' }, reden: 'Zoekwoord "test" ontbreekt' });
  assert.equal(w.status, 'voorstel');
  assert.deepEqual(w.velden.titel, { nieuw: 'Nieuwe titel', oud: 'Oude titel' });
  assert.equal(plugin.doelen['post:12'].titel, 'Oude titel', 'een voorstel verandert niets op de site');
  const r = await wijz.keurGoed(db, ctx, account, w.id, 'concept');
  assert.equal(r.wijziging.status, 'gepubliceerd'); assert.equal(r.wijziging.modus, 'concept');
  assert.equal(plugin.doelen['post:12'].titel, 'Nieuwe titel'); assert.equal(plugin.doelen['post:12']._status, 'draft');
  assert.equal(plugin.oproepen.filter((o) => o.startsWith('POST')).length, 1);
  // Nog een keer goedkeuren kan niet.
  assert.equal((await wijz.keurGoed(db, ctx, account, w.id).catch((e) => e)).status, 409);
});

test('een herhaalpoging publiceert nooit twee keer (zelfde id, ook na een mislukte poging)', async () => {
  const internet = nepInternet();
  const { account, site, plugin } = await siteMetPlugin('dubbel', { doelen: { 'post:5': { ...POST_OUD } }, internet });
  const eigenCtx = { ...ctx, ophalen: internet.ophalen };
  // De plugin past de wijziging toe, maar het antwoord gaat verloren (verbinding valt weg).
  const echt = internet.paginas[`https://${site.domein}/wp-json/rankcomet/v1/wijzigingen`];
  let keer = 0;
  internet.paginas[`https://${site.domein}/wp-json/rankcomet/v1/wijzigingen`] = (v) => { const r = echt(v); if (++keer === 1) throw new Fout('Je site reageerde niet binnen 5 seconden.', 400); return r; };
  const w = await wijz.stelVoor(db, eigenCtx, account, site.id, { doelType: 'post', doelId: 5, velden: { titel: 'Eén keer' }, reden: 'test' });
  const f = await wijz.keurGoed(db, eigenCtx, account, w.id, 'publiceren').catch((e) => e);
  assert.equal(f.status, 400);
  assert.equal((await wijz.haal(db, account.id, w.id)).status, 'mislukt');
  assert.equal(plugin.toegepast.size, 1);
  // Opnieuw proberen: de plugin herkent het id en doet niets; Rankcomet zet het op gepubliceerd.
  const r = await wijz.publiceer(db, eigenCtx, account, w.id);
  assert.equal(r.wijziging.status, 'gepubliceerd'); assert.equal(r.alGedaan, true);
  assert.equal(plugin.toegepast.size, 1); assert.equal(plugin.doelen['post:5'].titel, 'Eén keer');
  // En nog een keer: niets gebeurt.
  const n = plugin.oproepen.length;
  assert.equal((await wijz.publiceer(db, eigenCtx, account, w.id)).alGedaan, true);
  assert.equal(plugin.oproepen.length, n);
});

test('twee gelijktijdige goedkeuringen: één wint, de plugin krijgt de wijziging één keer', async () => {
  const { account, site, plugin } = await siteMetPlugin('race', { doelen: { 'post:7': { ...POST_OUD } } });
  const w = await wijz.stelVoor(db, ctx, account, site.id, { doelType: 'post', doelId: 7, velden: { titel: 'Race' }, reden: 'test' });
  const rs = await Promise.allSettled([wijz.keurGoed(db, ctx, account, w.id, 'publiceren'), wijz.keurGoed(db, ctx, account, w.id, 'publiceren')]);
  assert.equal(rs.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(rs.find((r) => r.status === 'rejected').reason.status, 409);
  assert.equal(plugin.oproepen.filter((o) => o.startsWith('POST')).length, 1);
});

test('prijs, voorraad, SKU en bestellingen zijn nooit schrijfbaar, ook niet per ongeluk', async () => {
  const { account, site, plugin } = await siteMetPlugin('woo', { platform: 'woocommerce', doelen: { 'product:3': { titel: 'Stoel', beschrijving: 'Hout', korte_beschrijving: '', afbeelding_alt: '', meta_titel: '', meta_beschrijving: '', focus_zoekwoord: '', canonical: '' } } });
  for (const veld of ['prijs', 'price', 'regular_price', 'sale_price', 'voorraad', 'stock', 'stock_quantity', 'stock_status', 'sku', 'bestelling', 'order', 'post_status', 'post_author']) {
    const f = await wijz.stelVoor(db, ctx, account, site.id, { doelType: 'product', doelId: 3, velden: { titel: 'Nieuwe stoel', [veld]: '1' }, reden: 'test' }).catch((e) => e);
    assert.equal(f.status, 400, veld); assert.equal(f.veld, veld);
  }
  assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM wijzigingen WHERE site_id = $1', [site.id])).rows[0].n), 0);
  // Ook de plugin zelf weigert een veld buiten de lijst, al zou Rankcomet het sturen.
  const { onderteken, PLUGIN_PAD } = await import('../src/wordpress.js');
  const body = JSON.stringify({ id: 'rechtstreeks-1', doel_type: 'product', doel_id: '3', modus: 'concept', velden: { titel: 'X', regular_price: '1' } });
  const sleutel = (await import('../src/geheimen.js')).ontsleutel(ctx.geheimenSleutel, (await db.query("SELECT versleuteld FROM geheimen WHERE site_id = $1", [site.id])).rows[0].versleuteld, account.id);
  const r = await app.internet.ophalen(`https://${site.domein}${PLUGIN_PAD}/wijzigingen`, site.domein, { methode: 'POST', headers: onderteken(sleutel, 'POST', `${PLUGIN_PAD}/wijzigingen`, body), body });
  assert.equal(r.status, 400); assert.equal(JSON.parse(r.body).veld, 'regular_price');
  assert.equal(plugin.doelen['product:3'].titel, 'Stoel');
  // Toegestane productvelden werken wel.
  const w = await wijz.stelVoor(db, ctx, account, site.id, { doelType: 'product', doelId: 3, velden: { beschrijving: 'Eikenhout, handgemaakt', afbeelding_alt: 'Eiken stoel' }, reden: 'test' });
  await wijz.keurGoed(db, ctx, account, w.id, 'publiceren');
  assert.equal(plugin.doelen['product:3'].beschrijving, 'Eikenhout, handgemaakt');
});

test('WooCommerce-teksten alleen op een WooCommerce-site en in een pakket dat het mag', async () => {
  const gewoon = await siteMetPlugin('geenwoo', { platform: 'wordpress' });
  assert.match((await wijz.stelVoor(db, ctx, gewoon.account, gewoon.site.id, { doelType: 'product', doelId: 1, velden: { titel: 'x' }, reden: 't' }).catch((e) => e)).message, /geen WooCommerce-webshop/);
  // Solo mag geen WooCommerce koppelen; zet de site handmatig op woocommerce om de pakketcontrole los te testen.
  const solo = await siteMetPlugin('solowoo', { pakket: 'solo' });
  await db.query("UPDATE sites SET platform = 'woocommerce' WHERE id = $1", [solo.site.id]);
  assert.equal((await wijz.stelVoor(db, ctx, solo.account, solo.site.id, { doelType: 'productcategorie', doelId: 2, velden: { beschrijving: 'x' }, reden: 't' }).catch((e) => e)).status, 403);
});

test('site intussen met de hand gewijzigd: voorstel gaat terug naar de rij, niets gepubliceerd', async () => {
  const { account, site, plugin } = await siteMetPlugin('drift', { doelen: { 'post:9': { ...POST_OUD } } });
  const w = await wijz.stelVoor(db, ctx, account, site.id, { doelType: 'post', doelId: 9, velden: { titel: 'Voorstel' }, reden: 'test' });
  plugin.doelen['post:9'].titel = 'Zelf aangepast';
  const r = await wijz.keurGoed(db, ctx, account, w.id, 'publiceren');
  assert.equal(r.terugNaarRij, true); assert.equal(r.wijziging.status, 'voorstel');
  assert.match(r.wijziging.melding, /intussen aangepast \(titel\)/);
  assert.equal(r.wijziging.velden.titel.oud, 'Zelf aangepast');
  assert.equal(plugin.doelen['post:9'].titel, 'Zelf aangepast');
  // Opnieuw goedkeuren met de bijgewerkte oude waarde werkt.
  assert.equal((await wijz.keurGoed(db, ctx, account, w.id, 'publiceren')).wijziging.status, 'gepubliceerd');
});

test('terugzetten met één klik: oude waarden terug, telt niet voor de volumerem', async () => {
  const { account, site, plugin } = await siteMetPlugin('terug', { doelen: { 'post:4': { ...POST_OUD, meta_titel: 'Oude meta' } } });
  const w = await wijz.stelVoor(db, ctx, account, site.id, { doelType: 'post', doelId: 4, velden: { titel: 'Nieuw', meta_titel: 'Nieuwe meta' }, reden: 'test' });
  await wijz.keurGoed(db, ctx, account, w.id, 'publiceren');
  assert.equal(plugin.doelen['post:4'].titel, 'Nieuw');
  const r = await wijz.zetTerug(db, ctx, account, w.id);
  assert.equal(r.wijziging.status, 'gepubliceerd'); assert.equal(r.wijziging.terugzet_van, w.id);
  assert.equal(plugin.doelen['post:4'].titel, 'Oude titel'); assert.equal(plugin.doelen['post:4'].meta_titel, 'Oude meta');
  assert.equal((await wijz.haal(db, account.id, w.id)).status, 'teruggezet');
  assert.equal((await wijz.zetTerug(db, ctx, account, w.id).catch((e) => e)).status, 409);
  // Een nieuw onderdeel (zonder oude waarden) is niet terug te zetten.
  const nieuw = await wijz.stelVoor(db, ctx, account, site.id, { doelType: 'post', velden: { titel: 'Nieuw bericht', inhoud: 'Tekst' }, reden: 'test' });
  const g = await wijz.keurGoed(db, ctx, account, nieuw.id, 'concept');
  assert.ok(g.wijziging.doel_id); assert.equal(plugin.doelen[`post:${g.wijziging.doel_id}`]._status, 'draft');
  assert.equal((await wijz.zetTerug(db, ctx, account, nieuw.id).catch((e) => e)).status, 400);
});

test('volumerem: niet meer goedgekeurde wijzigingen per site per maand dan het pakket toestaat', async () => {
  const { account, site } = await siteMetPlugin('rem', { pakket: 'solo', doelen: { 'post:1': { ...POST_OUD } } });
  const max = (await import('../src/pakketten.js')).pakketVoor('solo').wijzigingen_per_site_per_maand;
  assert.equal(max, 30);
  for (let i = 0; i < max; i++) {
    const w = await wijz.stelVoor(db, ctx, account, site.id, { doelType: 'post', doelId: 1, velden: { titel: `Versie ${i}` }, reden: 'test' });
    await wijz.keurGoed(db, ctx, account, w.id, 'publiceren');
  }
  const extra = await wijz.stelVoor(db, ctx, account, site.id, { doelType: 'post', doelId: 1, velden: { titel: 'Te veel' }, reden: 'test' });
  const f = await wijz.keurGoed(db, ctx, account, extra.id, 'publiceren').catch((e) => e);
  assert.equal(f.status, 403); assert.match(f.message, /maximum van 30 wijzigingen/);
  assert.equal((await wijz.haal(db, account.id, extra.id)).status, 'voorstel');
});

test('account A ziet niets van account B: voorstellen, sites en sleutels', async () => {
  const a = await siteMetPlugin('wa', { doelen: { 'post:2': { ...POST_OUD } } });
  const b = await siteMetPlugin('wb');
  const w = await wijz.stelVoor(db, ctx, a.account, a.site.id, { doelType: 'post', doelId: 2, velden: { titel: 'Van A' }, reden: 'test' });
  assert.equal(await wijz.haal(db, b.account.id, w.id), null);
  assert.deepEqual(await wijz.lijst(db, b.account.id), []);
  for (const poging of [() => wijz.keurGoed(db, ctx, b.account, w.id), () => wijz.wijsAf(db, b.account, w.id), () => wijz.zetTerug(db, ctx, b.account, w.id), () => wijz.publiceer(db, ctx, b.account, w.id),
    () => wijz.stelVoor(db, ctx, b.account, a.site.id, { doelType: 'post', doelId: 2, velden: { titel: 'x' }, reden: 't' }), () => wijz.maakPluginSleutel(db, ctx.geheimenSleutel, b.account.id, a.site.id), () => wijz.pluginStatus(db, ctx, b.account.id, a.site.id)]) {
    assert.equal((await poging().catch((e) => e)).status, 404);
  }
  assert.equal((await wijz.haal(db, a.account.id, w.id)).status, 'voorstel');
  assert.equal(a.plugin.doelen['post:2'].titel, 'Oude titel');
  const cb = await registreerEnLogin(app, 'wb-http@test.invalid');
  assert.equal((await fetch(app.basis + `/wijzigingen/${w.id}`, { headers: { cookie: cb } })).status, 404);
  assert.equal((await post(app.basis, `/wijzigingen/${w.id}/goedkeuren`, { modus: 'publiceren' }, cb)).status, 404);
  assert.equal((await post(app.basis, `/sites/${a.site.id}/plugin/sleutel`, {}, cb)).status, 404);
});

test('via de app: Wacht op jou, goedkeuren en afwijzen', async () => {
  const email = 'app-wijz@test.invalid';
  const c = await registreerEnLogin(app, email);
  const account = (await db.query('SELECT id, pakket FROM accounts WHERE email = $1', [email])).rows[0];
  const site = await koppelSite(db, account, { domein: 'app-wijz.test', platform: 'wordpress' }, app.internet);
  // Sleutel maken via de app; de pagina toont hem één keer.
  const sl = await post(app.basis, `/sites/${site.id}/plugin/sleutel`, {}, c);
  const sleutel = (await sl.text()).match(/<code>([A-Za-z0-9_-]{43})<\/code>/)[1];
  const plugin = nepPlugin(app.internet, site.domein, sleutel, { doelen: { 'post:1': { ...POST_OUD }, 'post:2': { ...POST_OUD } } });
  const w1 = await wijz.stelVoor(db, ctx, account, site.id, { doelType: 'post', doelId: 1, velden: { titel: 'Eerste' }, reden: 'Reden 1' });
  const w2 = await wijz.stelVoor(db, ctx, account, site.id, { doelType: 'post', doelId: 2, velden: { titel: 'Tweede' }, reden: 'Reden 2' });
  const dash = await (await fetch(app.basis + '/dashboard', { headers: { cookie: c } })).text();
  assert.match(dash, /Wacht op jou:<\/strong> 2 voorstellen/);
  const detail = await (await fetch(app.basis + `/wijzigingen/${w1.id}`, { headers: { cookie: c } })).text();
  assert.match(detail, /Oude titel/); assert.match(detail, /Eerste/); assert.match(detail, /Goedkeuren/); assert.match(detail, /Niet doen/);
  const ok = await post(app.basis, `/wijzigingen/${w1.id}/goedkeuren`, { modus: 'publiceren' }, c);
  assert.equal(ok.status, 200); assert.match(await ok.text(), /staat live op je site/);
  assert.equal(plugin.doelen['post:1'].titel, 'Eerste'); assert.equal(plugin.doelen['post:1']._status, 'publish');
  const nee = await post(app.basis, `/wijzigingen/${w2.id}/afwijzen`, { reden: 'Niet mijn stijl' }, c);
  assert.equal(nee.status, 200);
  assert.equal((await wijz.haal(db, account.id, w2.id)).status, 'afgewezen');
  assert.equal(plugin.doelen['post:2'].titel, 'Oude titel');
  assert.match(await (await fetch(app.basis + '/wijzigingen', { headers: { cookie: c } })).text(), /Niets\. Rankcomet heeft nu geen voorstellen/);
  const terug = await post(app.basis, `/wijzigingen/${w1.id}/terugzetten`, {}, c);
  assert.equal(terug.status, 200); assert.equal(plugin.doelen['post:1'].titel, 'Oude titel');
});
