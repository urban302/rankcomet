// Stap 4: de Conquer-pijplijn met kwaliteitspoort, met een nep-model dat de prompt leest.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { nieuweDb, startApp, registreerEnLogin, registreerBevestigd, post, nepInternet, nepPlugin, koppelSite, TEST_ENV } from './helpers.js';
import * as wijz from '../src/wijzigingen.js';
import * as wr from '../src/wachtrij.js';
import * as sites from '../src/sites.js';
import { schrijfArtikel } from '../src/pijplijn.js';
import { beoordeel, WOORDFILTER } from '../src/kwaliteit.js';
import { laadSleutel } from '../src/geheimen.js';

const WW = 'Testwachtwoord-123!';
const PROFIEL = { bedrijf: 'Dakwerken De Vries', diensten: 'dakreparatie, dakisolatie, dakgoten', plaats: 'Utrecht en omgeving', ervaring: 'Sinds 2009', doelgroep: 'huiseigenaren', toon: 'nuchter', uitgesloten: 'prijzen' };
const PAGINAS = [{ id: '1', type: 'page', titel: 'Dakisolatie', url: 'https://ZZZ/dakisolatie/' }, { id: '2', type: 'post', titel: 'Lekkage herkennen', url: 'https://ZZZ/lekkage-herkennen/' }];

// Een artikel dat door de poort komt: lang genoeg, met bedrijf, plaats, dienst, koppen en een interne link.
// `variant` kiest andere zinnen, zodat twee artikelen op één site niet als duplicaat gelden.
const ZINNEN = ['Een dak slijt langzaam en meestal zie je dat pas als het regent.', 'Kijk elk najaar even naar de dakrand en de goten.', 'Mos op pannen houdt vocht vast en dat vriest kapot.', 'Een lekkage begint vaak klein, bij een schoorsteen of een dakraam.', 'Zink en lood gaan lang mee, maar niet eeuwig.', 'Een plat dak heeft andere zorg nodig dan een schuin dak.', 'Bladeren in de goot zorgen voor water tegen de gevel.', 'Vraag altijd om foto\'s van het werk, voor en na.', 'Isolatie werkt alleen als het dak eerst dicht is.', 'Een vakman ziet in een kwartier wat een leek niet ziet.', 'Nokvorsten komen los door wind en vorst.', 'Een dakgoot hoort licht af te lopen naar de afvoer.', 'Ventilatie onder de pannen voorkomt schimmel in de zolder.', 'Dakramen vragen om een goede aansluiting op de pannen.', 'Een dakkapel heeft eigen loodslabben die kunnen scheuren.', 'Steiger of hoogwerker: dat hangt af van het huis.', 'Oude dakbedekking kan asbest bevatten, laat dat uitzoeken.', 'Een offerte hoort duidelijk te zeggen wat er wel en niet in zit.', 'Werk nooit zelf op een nat dak.', 'Een stormschade meld je snel bij de verzekeraar.', 'Zonnepanelen vragen om een dak dat nog jaren meegaat.', 'Vogels nestelen graag onder losse pannen.', 'Een dakinspectie met een drone scheelt klimmen.', 'Isolatie aan de binnenkant of de buitenkant: beide kan.'];
function goedArtikel(zoekwoord, domein, extra = '', variant = 0) {
  const zinnen = Array.from({ length: 8 }, (_, i) => ZINNEN[(variant * 8 + i) % ZINNEN.length]);
  const intro = `<p>Bij Dakwerken De Vries in Utrecht krijgen we vaak vragen over ${zoekwoord}.</p>`;
  const blok = (n) => `<p>${zinnen.slice(n, n + 4).join(' ')} ${zinnen.slice(0, 4).join(' ')}</p>`;
  const tekst = [blok(0), blok(2), blok(4), blok(1), blok(3)].join('');
  return {
    titel: `${zoekwoord}: waar let je op?`,
    inhoud: `<h2>Waarom ${zoekwoord} belangrijk is</h2>${intro}${tekst}<h2>Dakisolatie en dakreparatie</h2>${tekst}<p>Meer weten? Lees ook <a href="https://${domein}/dakisolatie/">onze pagina over dakisolatie</a>.</p>${tekst}${extra}`,
    meta_titel: `${zoekwoord} | Dakwerken De Vries Utrecht`,
    meta_beschrijving: `Alles over ${zoekwoord} in Utrecht en omgeving: waar je op let, wat je zelf kunt doen en wanneer je Dakwerken De Vries belt voor dakreparatie.`,
    focus_zoekwoord: zoekwoord,
  };
}

// Nep-model: leest de prompt. `maakArtikel(prompt, poging)` bepaalt het artikel; de brief is vast.
function nepModel(maakArtikel) {
  const model = { prompts: [], artikelPogingen: 0, fout: null };
  model.chat = async (berichten) => {
    const gebruiker = berichten.find((b) => b.role === 'user').content;
    model.prompts.push({ systeem: berichten.find((b) => b.role === 'system').content, gebruiker });
    if (model.fout) throw model.fout;
    if (gebruiker.startsWith('Maak een opzet')) return { tekst: JSON.stringify({ onderwerp: 'test', koppen: ['a'], interne_links: [] }), tokens: { in: 10, uit: 5 } };
    model.artikelPogingen++;
    return { tekst: JSON.stringify(maakArtikel(gebruiker, model.artikelPogingen)), tokens: { in: 100, uit: 900 } };
  };
  return model;
}

let db, app;
before(async () => { db = await nieuweDb(); app = await startApp(db); });
after(async () => { await app.sluit(); await db.sluit(); });

async function opzet(naam, maakArtikel, { pakket = 'pro', profiel = PROFIEL, internet = app.internet } = {}) {
  const account = await registreerBevestigd(db, `${naam}@test.invalid`, WW, pakket);
  const site = await koppelSite(db, account, { domein: `${naam}.test`, platform: 'wordpress' }, internet);
  const sleutel = await wijz.maakPluginSleutel(db, laadSleutel(TEST_ENV), account.id, site.id);
  const plugin = nepPlugin(internet, site.domein, sleutel, { paginas: PAGINAS.map((p) => ({ ...p, url: p.url.replace('ZZZ', site.domein) })) });
  if (profiel) await sites.bewaarProfiel(db, account.id, site.id, profiel);
  const model = nepModel(maakArtikel || ((_, __) => goedArtikel('dakisolatie subsidie', site.domein)));
  const ctx = { ophalen: internet.ophalen, model, logger: app.logger, geheimenSleutel: laadSleutel(TEST_ENV) };
  return { account, site, plugin, model, ctx };
}

test('van zoekwoord tot voorstel: klantinformatie in de prompt, artikel als voorstel, niets op de site', async () => {
  const { account, site, plugin, model, ctx } = await opzet('pijp');
  const r = await schrijfArtikel(db, ctx, account, site.id, { zoekwoord: 'dakisolatie subsidie' });
  assert.equal(r.wijziging.status, 'voorstel'); assert.equal(r.wijziging.doel_type, 'post'); assert.equal(r.wijziging.doel_id, null);
  assert.match(r.wijziging.reden, /zoekwoord "dakisolatie subsidie" \(kwaliteitsscore \d+/);
  assert.deepEqual(Object.keys(r.wijziging.velden).sort(), ['focus_zoekwoord', 'inhoud', 'meta_beschrijving', 'meta_titel', 'titel']);
  assert.equal(r.artikel.status, 'concept'); assert.ok(r.beoordeling.score >= 70);
  assert.equal(plugin.oproepen.filter((o) => o.startsWith('POST')).length, 0, 'een voorstel verandert niets op de site');
  // De prompts bevatten het siteprofiel en de bestaande pagina's; het model kreeg een brief en één artikelvraag.
  assert.equal(model.prompts.length, 2);
  for (const p of model.prompts) { assert.match(p.systeem, /Dakwerken De Vries/); assert.match(p.systeem, /dakgoten/); assert.match(p.systeem, /Utrecht/); }
  assert.match(model.prompts[1].gebruiker, new RegExp(`Lekkage herkennen \\| https://${site.domein}/lekkage-herkennen/`));
  const art = (await db.query('SELECT status, score, wijziging_id FROM artikelen WHERE site_id = $1', [site.id])).rows[0];
  assert.equal(art.status, 'concept'); assert.equal(art.wijziging_id, r.wijziging.id);
});

test('links naar buiten de eigen pagina\'s worden weggehaald; de tekst blijft', async () => {
  const { account, site, ctx } = await opzet('links', (_, __) => goedArtikel('dakgoot reinigen', 'links.test', '<p>Zie ook <a href="https://kwaad.example/koop">deze winkel</a> en <a href="https://links.test/niet-bestaand/">deze pagina</a>.</p>'));
  const r = await schrijfArtikel(db, ctx, account, site.id, { zoekwoord: 'dakgoot reinigen' });
  const inhoud = r.wijziging.velden.inhoud.nieuw;
  assert.ok(!inhoud.includes('kwaad.example') && !inhoud.includes('niet-bestaand'));
  assert.match(inhoud, /Zie ook deze winkel en deze pagina\./);
  assert.match(inhoud, /<a href="https:\/\/links\.test\/dakisolatie\/">/);
  assert.ok(r.beoordeling.bevindingen.some((b) => b.code === 'links_verwijderd'));
});

test('kwaliteitspoort: een algemeen artikel zonder klantinformatie wordt niet voorgesteld en het artikel wordt teruggeboekt', async () => {
  const algemeen = { titel: 'Alles over isolatie van je woning', inhoud: `<h2>Isolatie</h2>${'<p>Isoleren is verstandig voor elke woning. Het bespaart energie en verhoogt het comfort. Een bedrijf kan u adviseren over de mogelijkheden en materialen die geschikt zijn voor uw situatie en budget.</p>'.repeat(20)}`, meta_titel: 'Isolatie', meta_beschrijving: 'Alles over isolatie: materialen, mogelijkheden en voordelen voor elke woning in Nederland en daarbuiten.', focus_zoekwoord: 'isolatie' };
  const { account, site, model, ctx } = await opzet('algemeen', () => algemeen, { pakket: 'solo' });
  const f = await schrijfArtikel(db, ctx, account, site.id, { zoekwoord: 'isolatie' }).catch((e) => e);
  assert.equal(f.status, 422); assert.match(f.message, /niet door de kwaliteitscontrole/);
  assert.deepEqual(f.bevindingen.filter((b) => b.blokkeert).map((b) => b.code), ['bedrijf', 'plaats', 'dienst']);
  assert.equal(model.artikelPogingen, 2, 'één herkansing met de bevindingen');
  assert.match(model.prompts.at(-1).gebruiker, /De vorige versie is afgekeurd[\s\S]*naam van het bedrijf/);
  assert.equal((await wijz.lijst(db, account.id)).length, 0);
  const art = (await db.query('SELECT status, melding FROM artikelen WHERE site_id = $1', [site.id])).rows[0];
  assert.equal(art.status, 'teruggeboekt'); assert.match(art.melding, /kwaliteitscontrole/);
  // Teruggeboekt telt niet mee: Solo mag 2 per dag, en er passen er nog 2.
  model.chat = nepModel(() => goedArtikel('dakisolatie', site.domein, '', 1)).chat;
  assert.ok(await schrijfArtikel(db, ctx, account, site.id, { zoekwoord: 'dakisolatie' }));
  model.chat = nepModel(() => goedArtikel('dakisolatie kosten', site.domein, '', 2)).chat;
  assert.ok(await schrijfArtikel(db, ctx, account, site.id, { zoekwoord: 'dakisolatie kosten' }));
});

test('woordfilter: een prijs of belofte blokkeert; na de herkansing zonder prijs komt het artikel erdoor', async () => {
  const { account, site, model, ctx } = await opzet('prijs', (prompt, poging) => goedArtikel('dakreparatie', 'prijs.test', poging === 1 ? '<p>Een dakreparatie kost bij ons vanaf 250 euro, gegarandeerd de beste prijs.</p>' : ''));
  const r = await schrijfArtikel(db, ctx, account, site.id, { zoekwoord: 'dakreparatie' });
  assert.equal(model.artikelPogingen, 2);
  assert.match(model.prompts.at(-1).gebruiker, /prijs, bedrag of korting/);
  assert.ok(!r.wijziging.velden.inhoud.nieuw.includes('250 euro'));
  // Direct op de poort: verschillende claims en beloftes blokkeren, gewone zinnen niet.
  const basis = goedArtikel('dakisolatie', site.domein);
  const codes = (zin) => beoordeel({ artikel: { ...basis, inhoud: basis.inhoud + `<p>${zin}</p>` }, zoekwoord: 'dakisolatie', profiel: PROFIEL, paginas: [] }).bevindingen.filter((b) => b.blokkeert).map((b) => b.code);
  assert.deepEqual(codes('Wij zijn de beste dakdekker van Utrecht.'), ['claim']);
  assert.deepEqual(codes('Nummer 1 in dakisolatie.'), ['claim']);
  assert.deepEqual(codes('Binnen 24 uur geregeld, gegarandeerd.'), ['belofte']);
  assert.deepEqual(codes('Nu met 20% korting op dakgoten.'), ['prijs']);
  assert.deepEqual(codes('Dit geneest je vochtprobleem.'), ['medisch']);
  assert.deepEqual(codes('Een goed geïsoleerd dak scheelt stookkosten en voelt comfortabeler.'), []);
  assert.equal(WOORDFILTER.length, 4);
});

test('duplicaatcheck: te veel gelijkenis met een eerder artikel of een bestaande paginatitel blokkeert', async () => {
  const { account, site, ctx } = await opzet('dubbel', () => goedArtikel('dakisolatie subsidie', 'dubbel.test'));
  assert.ok(await schrijfArtikel(db, ctx, account, site.id, { zoekwoord: 'dakisolatie subsidie' }));
  const f = await schrijfArtikel(db, ctx, account, site.id, { zoekwoord: 'dakisolatie subsidie' }).catch((e) => e);
  assert.equal(f.status, 422); assert.ok(f.bevindingen.some((b) => b.code === 'duplicaat'));
  const basis = goedArtikel('lekkage', site.domein);
  const r = beoordeel({ artikel: { ...basis, titel: 'Lekkage herkennen' }, zoekwoord: 'lekkage', profiel: PROFIEL, paginas: PAGINAS });
  assert.ok(r.bevindingen.some((b) => b.code === 'duplicaat_pagina'));
});

test('schrijfhulp onbereikbaar of onleesbaar: nette fout, artikel teruggeboekt, niets voorgesteld', async () => {
  const { account, site, model, ctx } = await opzet('stuk');
  model.fout = Object.assign(new Error('Azure OpenAI gaf 503'), { status: 503 });
  const f = await schrijfArtikel(db, ctx, account, site.id, { zoekwoord: 'dakgoten' }).catch((e) => e);
  assert.equal(f.status, 503); assert.match(f.message, /even niet bereikbaar/);
  model.fout = null; model.chat = async () => ({ tekst: 'dit is geen json', tokens: {} });
  assert.equal((await schrijfArtikel(db, ctx, account, site.id, { zoekwoord: 'dakgoten' }).catch((e) => e)).status, 502);
  assert.equal(Number((await db.query("SELECT COUNT(*) AS n FROM artikelen WHERE site_id = $1 AND status = 'teruggeboekt'", [site.id])).rows[0].n), 2);
  assert.equal((await wijz.lijst(db, account.id)).length, 0);
  const log = (await db.query('SELECT bericht FROM logregels')).rows.map((r) => r.bericht).join('\n');
  assert.ok(!log.includes('Dakwerken De Vries'), 'de prompt hoort niet in de log');
});

test('temporem: niet alles op één dag, en zonder siteprofiel geen reservering', async () => {
  const { account, site, model, ctx } = await opzet('tempo', null, { pakket: 'solo' });
  assert.ok(await schrijfArtikel(db, ctx, account, site.id, { zoekwoord: 'dakisolatie subsidie' }));
  model.chat = nepModel(() => goedArtikel('dakgoot vervangen', site.domein, '', 1)).chat;
  assert.ok(await schrijfArtikel(db, ctx, account, site.id, { zoekwoord: 'dakgoot vervangen' }));
  const n = model.prompts.length;
  const f = await schrijfArtikel(db, ctx, account, site.id, { zoekwoord: 'dakpannen' }).catch((e) => e);
  assert.equal(f.status, 429); assert.match(f.message, /vandaag al 2 artikelen/);
  assert.equal(model.prompts.length, n, 'bij de temporem wordt het model niet aangeroepen');
  const zonder = await opzet('zonderprofiel', null, { profiel: null });
  const g = await schrijfArtikel(db, zonder.ctx, zonder.account, zonder.site.id, { zoekwoord: 'dakisolatie' }).catch((e) => e);
  assert.equal(g.status, 400); assert.equal(g.profiel, zonder.site.id);
  assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM artikelen WHERE site_id = $1', [zonder.site.id])).rows[0].n), 0);
});

test('account A ziet niets van account B: profiel en pijplijn', async () => {
  const a = await opzet('pa');
  const b = await opzet('pb');
  assert.equal(await sites.haalProfiel(db, b.account.id, a.site.id), null);
  assert.equal((await sites.bewaarProfiel(db, b.account.id, a.site.id, PROFIEL).catch((e) => e)).status, 404);
  assert.equal((await schrijfArtikel(db, b.ctx, b.account, a.site.id, { zoekwoord: 'dakisolatie' }).catch((e) => e)).status, 404);
  assert.equal((await sites.haalProfiel(db, a.account.id, a.site.id)).bedrijf, 'Dakwerken De Vries');
  const cb = await registreerEnLogin(app, 'pb-http@test.invalid');
  assert.equal((await fetch(app.basis + `/sites/${a.site.id}/profiel`, { headers: { cookie: cb } })).status, 404);
  assert.equal((await post(app.basis, `/sites/${a.site.id}/artikel`, { zoekwoord: 'x' }, cb)).status, 404);
});

test('via de app: profiel invullen en een artikel laten schrijven', async () => {
  const email = 'app-art@test.invalid';
  const internet = nepInternet();
  const eigen = await startApp(db, undefined, { internet, model: nepModel(() => goedArtikel('dakisolatie subsidie', 'app-art.test')) });
  try {
    const c = await registreerEnLogin(eigen, email);
    const account = (await db.query('SELECT id, pakket FROM accounts WHERE email = $1', [email])).rows[0];
    const site = await koppelSite(db, account, { domein: 'app-art.test', platform: 'wordpress' }, internet);
    const sleutel = await wijz.maakPluginSleutel(db, laadSleutel(TEST_ENV), account.id, site.id);
    nepPlugin(internet, site.domein, sleutel, { paginas: PAGINAS.map((p) => ({ ...p, url: p.url.replace('ZZZ', site.domein) })) });
    // Zonder profiel: duidelijke melding met link.
    const zonder = await post(eigen.basis, `/sites/${site.id}/artikel`, { zoekwoord: 'dakisolatie subsidie' }, c);
    assert.equal(zonder.status, 400); assert.match(await zonder.text(), /Vul eerst het siteprofiel in/);
    assert.equal((await post(eigen.basis, `/sites/${site.id}/profiel`, { bedrijf: 'Dakwerken De Vries', diensten: '' }, c)).status, 400);
    assert.equal((await post(eigen.basis, `/sites/${site.id}/profiel`, PROFIEL, c)).status, 303);
    assert.match(await (await fetch(eigen.basis + `/sites/${site.id}/profiel`, { headers: { cookie: c } })).text(), /value="Dakwerken De Vries"/);
    const r = await post(eigen.basis, `/sites/${site.id}/artikel`, { zoekwoord: 'dakisolatie subsidie' }, c);
    assert.equal(r.status, 303);
    // Stap 11: het schrijven gaat via de wachtrij. De klant ziet "we zijn bezig", de werker doet het werk, dan een mail.
    const terug = new URL(r.headers.get('location'), eigen.basis);
    assert.equal(terug.pathname, `/sites/${site.id}/artikel`);
    let html = await (await fetch(eigen.basis + terug.pathname + terug.search, { headers: { cookie: c } })).text();
    assert.match(html, /We zijn bezig met een artikel over &quot;dakisolatie subsidie&quot;/); assert.match(html, /staat in de rij/);
    assert.match(await (await fetch(eigen.basis + '/dashboard', { headers: { cookie: c } })).text(), /Rankcomet is bezig/);
    const taak = await wr.verwerkEen(db, eigen.server.ctx);
    assert.equal(taak.status, 'klaar');
    const mail = eigen.mailer.mails.find((x) => x.aan === email && /Klaar: artikel/.test(x.onderwerp));
    assert.ok(mail, 'mail als het klaar is'); assert.match(mail.tekst, new RegExp(`/wijzigingen/${taak.wijzigingId}`));
    const pad = `/wijzigingen/${taak.wijzigingId}`;
    const detail = await (await fetch(eigen.basis + pad, { headers: { cookie: c } })).text();
    assert.match(detail, /wacht op jou/); assert.match(detail, /kwaliteitsscore/);
    assert.doesNotMatch(await (await fetch(eigen.basis + '/dashboard', { headers: { cookie: c } })).text(), /Rankcomet is bezig/);
    assert.match(await (await fetch(eigen.basis + `/sites/${site.id}/artikel`, { headers: { cookie: c } })).text(), /dakisolatie subsidie · voorstel klaar · score \d+/);
  } finally { await eigen.sluit(); }
});
