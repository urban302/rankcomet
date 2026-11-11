// Stap 9: contentrefresh: kandidaten op positie, klikken en leeftijd; opfrisvoorstel via de poort; effect per URL.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { nieuweDb, startApp, registreerEnLogin, registreerBevestigd, post, koppelSite, nepPlugin, nepDataforseo, nepGoogle, TEST_ENV } from './helpers.js';
import * as opf from '../src/opfrissen.js';
import * as zw from '../src/zoekwoorden.js';
import * as pos from '../src/posities.js';
import * as gsc from '../src/gsc.js';
import * as wijz from '../src/wijzigingen.js';
import * as wr from '../src/wachtrij.js';
import * as sites from '../src/sites.js';
import { laadSleutel } from '../src/geheimen.js';

const WW = 'Testwachtwoord-123!';
const PROFIEL = { bedrijf: 'Dakwerken De Vries', diensten: 'dakreparatie, dakisolatie, dakgoten', plaats: 'Utrecht en omgeving', ervaring: '', doelgroep: '', toon: '', uitgesloten: '' };
const NU = new Date('2026-11-11T10:00:00Z');
const dagenGeleden = (n) => new Date(NU.getTime() - n * 86400000);
const ZINNEN = ['Een dak slijt langzaam en meestal zie je dat pas als het regent.', 'Kijk elk najaar even naar de dakrand en de goten.', 'Mos op pannen houdt vocht vast en dat vriest kapot.', 'Een lekkage begint vaak klein, bij een schoorsteen of een dakraam.', 'Zink en lood gaan lang mee, maar niet eeuwig.', 'Een plat dak heeft andere zorg nodig dan een schuin dak.', 'Bladeren in de goot zorgen voor water tegen de gevel.', 'Vraag altijd om foto\'s van het werk, voor en na.'];
function goedeTekst(zoekwoord, domein) {
  const blok = `<p>${ZINNEN.join(' ')}</p>`;
  return { titel: `${zoekwoord}: zo pak je het aan`, inhoud: `<h2>${zoekwoord}</h2><p>Bij Dakwerken De Vries in Utrecht krijgen we vaak vragen over ${zoekwoord} en dakisolatie.</p>${blok.repeat(5)}<h2>Wat je zelf kunt doen</h2>${blok.repeat(5)}<p>Lees ook <a href="https://${domein}/dakgoten/">onze pagina over dakgoten</a>.</p>`, meta_titel: `${zoekwoord} | Dakwerken De Vries`, meta_beschrijving: `Alles over ${zoekwoord} in Utrecht en omgeving: wat je zelf kunt doen en wanneer je Dakwerken De Vries belt voor dakreparatie.`, focus_zoekwoord: zoekwoord };
}
function nepModel(domein) {
  const model = { prompts: [] };
  model.chat = async (berichten) => { const g = berichten.find((b) => b.role === 'user').content; model.prompts.push(g); const z = g.match(/gevonden moet worden: "([^"]+)"/)?.[1] || 'dakisolatie'; return { tekst: JSON.stringify(goedeTekst(z, domein)), tokens: { in: 1, uit: 1 } }; };
  return model;
}

let db, app, dfs, google;
before(async () => {
  dfs = nepDataforseo({ ideeen: (w) => [{ keyword: `${w} kosten`, keyword_info: { search_volume: 100 } }], serp: (k, taak) => dfs.serpVoor(k, taak) });
  google = nepGoogle({ rijen: (p, body) => google.rijenVoor(p, body) });
  db = await nieuweDb(); app = await startApp(db, undefined, { dataforseo: dfs, google });
});
after(async () => { await app.sluit(); await db.sluit(); });

// Een site met plugin (pagina's met leeftijd), één gevolgd zoekwoord met posities 28 dagen geleden en nu, en Search Console-cijfers toen en nu.
async function opzet(naam, { positieToen = 4, positieNu = 9, klikkenToen = 100, klikkenNu = 40, leeftijd = 400, pakket = 'pro' } = {}) {
  const account = await registreerBevestigd(db, `${naam}@test.invalid`, WW, pakket);
  const site = await koppelSite(db, account, { domein: `${naam}.test`, platform: 'wordpress' }, app.internet);
  await sites.bewaarProfiel(db, account.id, site.id, PROFIEL);
  const sleutel = await wijz.maakPluginSleutel(db, laadSleutel(TEST_ENV), account.id, site.id);
  const url = `https://${naam}.test/dakisolatie-tips/`;
  const plugin = nepPlugin(app.internet, site.domein, sleutel, {
    paginas: [{ id: '7', type: 'post', titel: 'Dakisolatie tips', url, gewijzigd: dagenGeleden(leeftijd).toISOString() }, { id: '8', type: 'page', titel: 'Dakgoten', url: `https://${naam}.test/dakgoten/`, gewijzigd: dagenGeleden(10).toISOString() }],
    doelen: { 'post:7': { titel: 'Dakisolatie tips', inhoud: '<p>Oude tekst over dakisolatie.</p>', meta_titel: '', meta_beschrijving: '', focus_zoekwoord: 'dakisolatie', canonical: '' } },
  });
  const ctx = { ophalen: app.internet.ophalen, dataforseo: dfs.client, google: google.client, model: nepModel(site.domein), logger: app.logger, geheimenSleutel: laadSleutel(TEST_ENV) };
  // Zoekwoord volgen en posities op twee dagen.
  await zw.onderzoek(db, ctx, account, site.id, { startwoord: 'dakisolatie' });
  const z = (await zw.lijst(db, account.id, site.id))[0];
  await zw.volg(db, account, site.id, z.id);
  const serp = (p) => [{ type: 'organic', rank_group: p, rank_absolute: p, domain: `${naam}.test`, url }];
  dfs.serpVoor = () => serp(positieToen); await pos.controleer(db, ctx, account, site.id, dagenGeleden(28));
  dfs.serpVoor = () => positieNu == null ? [] : serp(positieNu); await pos.controleer(db, ctx, account, site.id, NU);
  // Search Console: twee perioden.
  google.properties = [`sc-domain:${naam}.test`];
  const state = new URL(await gsc.start(db, ctx, account, site.id)).searchParams.get('state');
  await gsc.terug(db, ctx, account, { code: 'goede-code', state });
  google.rijenVoor = () => [{ keys: [url], clicks: klikkenToen, impressions: 1000, ctr: 0.1, position: positieToen }];
  await gsc.kiesProperty(db, ctx, account, site.id, `sc-domain:${naam}.test`);
  await db.query('UPDATE gsc_cijfers SET periode_eind = $1 WHERE site_id = $2', [dagenGeleden(31).toISOString().slice(0, 10), site.id]);
  google.rijenVoor = () => [{ keys: [url], clicks: klikkenNu, impressions: 900, ctr: 0.05, position: positieNu ?? 30 }];
  await gsc.ververs(db, ctx, account, site.id, { forceer: true, tijd: NU });
  return { account, site, plugin, ctx, url, zoekwoordId: z.id };
}

test('kandidaten: oud én gezakt in positie of klikken; een jonge of stabiele pagina niet; drempels per site', async () => {
  const { account, site, ctx } = await opzet('kand');
  const lijst = await opf.kandidaten(db, ctx, account, site.id, NU);
  assert.equal(lijst.length, 1);
  const k = lijst[0];
  assert.deepEqual([k.doelId, k.doelType, k.leeftijdDagen, k.zoekwoord, k.positieVoor, k.klikkenVoor, k.alVoorgesteld], ['7', 'post', 400, 'dakisolatie kosten', 9, 40, false]);
  assert.deepEqual(k.redenen, ['voor "dakisolatie kosten" van positie 4 naar 9', '60% minder klikken in Google (van 100 naar 40)']);
  // Strengere drempels: geen kandidaat meer. Daarna alleen op leeftijd te jong.
  await opf.bewaarInstellingen(db, account.id, site.id, { min_leeftijd_dagen: 180, positie_daling: 10, klik_daling_pct: 80 });
  assert.equal((await opf.kandidaten(db, ctx, account, site.id, NU)).length, 0);
  await opf.bewaarInstellingen(db, account.id, site.id, { min_leeftijd_dagen: 500, positie_daling: 3, klik_daling_pct: 30 });
  assert.equal((await opf.kandidaten(db, ctx, account, site.id, NU)).length, 0);
  assert.equal((await opf.bewaarInstellingen(db, account.id, site.id, { min_leeftijd_dagen: 5, positie_daling: 3, klik_daling_pct: 30 }).catch((e) => e)).status, 400);
  // Alleen klikdaling (positie stabiel) telt ook; alleen uit de top 20 gevallen telt ook.
  const b = await opzet('kandb', { positieToen: 5, positieNu: 5, klikkenToen: 50, klikkenNu: 20 });
  assert.deepEqual((await opf.kandidaten(db, b.ctx, b.account, b.site.id, NU))[0].redenen, ['60% minder klikken in Google (van 50 naar 20)']);
  const c = await opzet('kandc', { positieToen: 8, positieNu: null, klikkenToen: 5, klikkenNu: 1 });
  assert.deepEqual((await opf.kandidaten(db, c.ctx, c.account, c.site.id, NU))[0].redenen, ['voor "dakisolatie kosten" uit de top 20 gevallen (was 8)']);
});

test('opfrisvoorstel: oude tekst in de prompt, voorstel op de bestaande pagina met oude waarden, niets op de site, effect gemeten', async () => {
  const { account, site, plugin, ctx, url } = await opzet('voorstel');
  const r = await opf.maakVoorstel(db, ctx, account, site.id, { doelId: '7' }, NU);
  assert.match(ctx.model.prompts.at(-1), /Oude tekst over dakisolatie/); assert.match(ctx.model.prompts.at(-1), /van positie 4 naar 9/);
  assert.equal(r.wijziging.status, 'voorstel'); assert.equal(r.wijziging.doel_id, '7'); assert.equal(r.wijziging.doel_type, 'post');
  assert.equal(r.wijziging.velden.inhoud.oud, '<p>Oude tekst over dakisolatie.</p>');
  assert.match(r.wijziging.reden, /^Opfrissen: voor "dakisolatie kosten" van positie 4 naar 9, 60% minder klikken.*laatst gewijzigd 400 dagen geleden \(kwaliteitsscore \d+\)$/);
  assert.equal(plugin.doelen['post:7'].inhoud, '<p>Oude tekst over dakisolatie.</p>', 'een voorstel verandert niets op de site');
  assert.equal((await opf.kandidaten(db, ctx, account, site.id, NU))[0].alVoorgesteld, true);
  let e = await opf.effect(db, account.id, site.id, NU);
  assert.deepEqual([e[0].status, e[0].voorstel_status, e[0].positie_voor, e[0].klikken_voor, e[0].url], ['voorstel', 'voorstel', 9, 40, url]);
  // Goedkeuren en publiceren: de nieuwe tekst staat op de site; het effect toont toen en nu.
  await wijz.keurGoed(db, ctx, account, r.wijziging.id, 'publiceren');
  assert.match(plugin.doelen['post:7'].inhoud, /Dakwerken De Vries/);
  dfs.serpVoor = () => [{ type: 'organic', rank_group: 3, rank_absolute: 3, domain: site.domein, url }];
  await pos.controleer(db, ctx, account, site.id, new Date(NU.getTime() + 86400000));
  e = await opf.effect(db, account.id, site.id, new Date(NU.getTime() + 86400000));
  assert.deepEqual([e[0].voorstel_status, e[0].positieNu, e[0].klikkenNu], ['gepubliceerd', 3, 40]);
});

test('daggrens op opfrisvoorstellen, een pagina buiten de lijst wordt geweigerd, zonder profiel niets', async () => {
  const { account, site, ctx } = await opzet('grens', { pakket: 'solo' });
  assert.ok(await opf.maakVoorstel(db, ctx, account, site.id, { doelId: '7' }, NU));
  const f = await opf.maakVoorstel(db, ctx, account, site.id, { doelId: '7' }, NU).catch((e) => e);
  assert.equal(f.status, 429); assert.match(f.message, /vandaag al 1 opfrisvoorstellen/);
  assert.equal((await opf.maakVoorstel(db, ctx, account, site.id, { doelId: '8' }, new Date(NU.getTime() + 86400000)).catch((e) => e)).status, 400, 'jonge pagina staat niet in de lijst');
  await db.query('DELETE FROM siteprofielen WHERE site_id = $1', [site.id]);
  assert.equal((await opf.maakVoorstel(db, ctx, account, site.id, { doelId: '7' }, new Date(NU.getTime() + 86400000)).catch((e) => e)).profiel, site.id);
});

test('Search Console-geschiedenis blijft staan en de pagina toont de laatste periode', async () => {
  const { account, site } = await opzet('gesch');
  const perioden = (await db.query('SELECT DISTINCT periode_eind FROM gsc_cijfers WHERE site_id = $1 ORDER BY periode_eind', [site.id])).rows.map((r) => r.periode_eind);
  assert.equal(perioden.length, 2);
  const k = await gsc.koppeling(db, account.id, site.id);
  assert.deepEqual([k.paginas.length, k.totaal.klikken], [1, 40], 'alleen de laatste periode');
  const kp = await gsc.klikkenPerPagina(db, account.id, site.id);
  assert.deepEqual([Object.values(kp.huidig), Object.values(kp.vorige)], [[40], [100]]);
});

test('account A ziet niets van account B: kandidaten, voorstel, instellingen, effect', async () => {
  const a = await opzet('oa');
  const b = await registreerBevestigd(db, 'ob@test.invalid', WW, 'pro');
  const ctxB = { ...a.ctx };
  for (const poging of [() => opf.kandidaten(db, ctxB, b, a.site.id, NU), () => opf.maakVoorstel(db, ctxB, b, a.site.id, { doelId: '7' }, NU), () => opf.instellingen(db, b.id, a.site.id), () => opf.bewaarInstellingen(db, b.id, a.site.id, { min_leeftijd_dagen: 100, positie_daling: 3, klik_daling_pct: 30 }), () => opf.effect(db, b.id, a.site.id, NU)]) {
    assert.equal((await poging().catch((e) => e)).status, 404);
  }
  assert.deepEqual(await opf.instellingen(db, a.account.id, a.site.id), opf.STANDAARD_DREMPELS);
  const cb = await registreerEnLogin(app, 'ob-http@test.invalid');
  assert.equal((await fetch(app.basis + `/sites/${a.site.id}/opfrissen`, { headers: { cookie: cb } })).status, 404);
  assert.equal((await post(app.basis, `/sites/${a.site.id}/opfrissen/voorstel`, { doel_id: '7' }, cb)).status, 404);
});

test('via de app: lijst met redenen, drempels opslaan, opfrisvoorstel maken en op Wacht op jou zien', async () => {
  const email = 'app-opf@test.invalid';
  const eigen = await startApp(db, undefined, { dataforseo: dfs, google, model: nepModel('app-opf.test') });
  try {
    const c = await registreerEnLogin(eigen, email);
    // Dezelfde opzet, maar met de app-eigen ophaler en nep-internet.
    const account = (await db.query('SELECT id, pakket FROM accounts WHERE email = $1', [email])).rows[0];
    const site = await koppelSite(db, account, { domein: 'app-opf.test', platform: 'wordpress' }, eigen.internet);
    await sites.bewaarProfiel(db, account.id, site.id, PROFIEL);
    const sleutel = await wijz.maakPluginSleutel(db, laadSleutel(TEST_ENV), account.id, site.id);
    const url = 'https://app-opf.test/oud/';
    nepPlugin(eigen.internet, site.domein, sleutel, { paginas: [{ id: '3', type: 'page', titel: 'Oude pagina', url, gewijzigd: dagenGeleden(300).toISOString() }], doelen: { 'pagina:3': { titel: 'Oude pagina', inhoud: '<p>Oud.</p>', meta_titel: '', meta_beschrijving: '', focus_zoekwoord: '', canonical: '' } } });
    const ctx = { ophalen: eigen.internet.ophalen, dataforseo: dfs.client, google: google.client, logger: eigen.logger, geheimenSleutel: laadSleutel(TEST_ENV) };
    await zw.onderzoek(db, ctx, account, site.id, { startwoord: 'dak' });
    const z = (await zw.lijst(db, account.id, site.id))[0]; await zw.volg(db, account, site.id, z.id);
    const serp = (p) => [{ type: 'organic', rank_group: p, rank_absolute: p, domain: site.domein, url }];
    dfs.serpVoor = () => serp(2); await pos.controleer(db, ctx, account, site.id, dagenGeleden(28));
    dfs.serpVoor = () => serp(12); await pos.controleer(db, ctx, account, site.id, NU);
    let html = await (await fetch(eigen.basis + `/sites/${site.id}/opfrissen`, { headers: { cookie: c } })).text();
    assert.match(html, /verdienen \(1\)/); assert.match(html, /Oude pagina<\/span>/); assert.match(html, /van positie 2 naar 12/); assert.match(html, /Opfrisvoorstel maken/);
    assert.equal((await post(eigen.basis, `/sites/${site.id}/opfrissen/instellingen`, { min_leeftijd_dagen: '365', positie_daling: '5', klik_daling_pct: '40' }, c)).status, 303);
    html = await (await fetch(eigen.basis + `/sites/${site.id}/opfrissen`, { headers: { cookie: c } })).text();
    assert.match(html, /verdienen \(0\)/); assert.match(html, /value="365"/);
    await post(eigen.basis, `/sites/${site.id}/opfrissen/instellingen`, { min_leeftijd_dagen: '180', positie_daling: '3', klik_daling_pct: '30' }, c);
    const r = await post(eigen.basis, `/sites/${site.id}/opfrissen/voorstel`, { doel_id: '3' }, c);
    assert.equal(r.status, 303); assert.match(r.headers.get('location'), /^\/sites\/.*\/opfrissen\?m=/);
    // Stap 11: via de wachtrij. Eerst "bezig" op de pagina, dan doet de werker het werk en komt er een mail.
    html = await (await fetch(eigen.basis + `/sites/${site.id}/opfrissen`, { headers: { cookie: c } })).text();
    assert.match(html, /Rankcomet is bezig/); assert.match(html, /het opfrisvoorstel voor \/oud\/ staat in de rij/);
    const taak = await wr.verwerkEen(db, eigen.server.ctx);
    assert.equal(taak.status, 'klaar');
    assert.ok(eigen.mailer.mails.find((x) => x.aan === email && /Klaar: opfrisvoorstel/.test(x.onderwerp)), 'mail als het klaar is');
    assert.match(await (await fetch(eigen.basis + '/dashboard', { headers: { cookie: c } })).text(), /Opfrissen: voor &quot;dak kosten&quot; van positie 2 naar 12/);
    html = await (await fetch(eigen.basis + `/sites/${site.id}/opfrissen`, { headers: { cookie: c } })).text();
    assert.match(html, /al een voorstel gemaakt/); assert.match(html, /\/oud\/<\/span> <span class="stil">· \d{4}-\d{2}-\d{2} · wacht op jou/);
  } finally { await eigen.sluit(); }
});
