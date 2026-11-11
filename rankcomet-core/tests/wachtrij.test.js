// Stap 11: wachtrij voor het schrijven. Eén taak tegelijk, nooit twee keer dezelfde, mail als het klaar is.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { nieuweDb, startApp, registreerBevestigd, registreerEnLogin, koppelSite, nepPlugin, nepInternet, nepMailer, TEST_ENV, post } from './helpers.js';
import * as wr from '../src/wachtrij.js';
import * as wijz from '../src/wijzigingen.js';
import * as sites from '../src/sites.js';
import { bereidArtikelVoor } from '../src/pijplijn.js';
import { laadSleutel } from '../src/geheimen.js';

const WW = 'Testwachtwoord-123!';
const PROFIEL = { bedrijf: 'Dakwerken De Vries', diensten: 'dakreparatie, dakisolatie, dakgoten', plaats: 'Utrecht en omgeving', ervaring: 'Sinds 2009', doelgroep: 'huiseigenaren', toon: 'nuchter', uitgesloten: 'prijzen' };
const PAGINAS = [{ id: '1', type: 'page', titel: 'Dakisolatie', url: 'https://ZZZ/dakisolatie/' }, { id: '2', type: 'post', titel: 'Lekkage herkennen', url: 'https://ZZZ/lekkage-herkennen/' }];
const ZINNEN = ['Een goed geïsoleerd dak houdt de warmte binnen en de kou buiten, zeker in de wintermaanden.', 'Onze dakdekkers kijken eerst naar de staat van de dakbedekking en de aansluitingen.', 'Bij een plat dak werkt isolatie aan de buitenkant meestal het best, want dan blijft de binnenruimte vrij.', 'Vocht in de constructie herken je aan donkere plekken en een muffe lucht op zolder.', 'Een dakgoot die goed afwatert voorkomt dat water langs de gevel loopt en schade geeft.', 'Vraag altijd om een inspectie voordat je een offerte laat maken, dan weet je waar je aan toe bent.', 'Dakpannen die los liggen kun je beter meteen laten vastzetten, voordat de wind ze meeneemt.', 'Een nieuwe dakbedekking gaat gemakkelijk twintig tot dertig jaar mee als het onderhoud klopt.', 'Dampremmende folie hoort aan de warme kant van de isolatie, anders ontstaat er condens.', 'Zonnepanelen combineer je het best met isolatie, zodat het dak maar één keer open hoeft.', 'Laat de nokvorsten controleren na een storm, want die raken als eerste los.', 'Een lekkage bij de schoorsteen komt vaak door een versleten loodslab, niet door de pannen.'];
function goedArtikel(zoekwoord, domein, variant = 0) {
  const zinnen = Array.from({ length: 8 }, (_, i) => ZINNEN[(variant * 4 + i) % ZINNEN.length]);
  const blok = (n) => `<p>${zinnen.slice(n, n + 4).join(' ')} ${zinnen.slice(0, 4).join(' ')}</p>`;
  const inhoud = `<p>Bij Dakwerken De Vries in Utrecht en omgeving krijgen we vaak vragen over ${zoekwoord}.</p><h2>Waarom ${zoekwoord} belangrijk is</h2>${blok(0)}${blok(1)}<h2>Dakisolatie en dakreparatie</h2>${blok(2)}${blok(3)}<p>Lees ook onze pagina over <a href="https://${domein}/dakisolatie/">dakisolatie</a> of hoe je <a href="https://${domein}/lekkage-herkennen/">lekkage herkent</a>.</p><h2>Tot slot</h2>${blok(1)}${blok(2)}${blok(3)}${blok(0)}`;
  return { titel: `${zoekwoord}: wat je moet weten ${variant}`, inhoud, meta_titel: `${zoekwoord} | Dakwerken De Vries Utrecht`, meta_beschrijving: `Alles over ${zoekwoord} in Utrecht en omgeving: waar je op let, wat je zelf kunt doen en wanneer je Dakwerken De Vries belt voor dakreparatie.`, focus_zoekwoord: zoekwoord };
}
function nepModel(domein) {
  const model = { prompts: 0, variant: 0, fout: null, traag: null };
  model.chat = async (berichten) => {
    model.prompts++;
    if (model.traag) await model.traag;
    if (model.fout) throw model.fout;
    const g = berichten.find((b) => b.role === 'user').content;
    if (g.startsWith('Maak een opzet')) return { tekst: JSON.stringify({ onderwerp: 'test', koppen: ['a'], interne_links: [] }), tokens: { in: 1, uit: 1 } };
    const z = g.match(/(?:gevonden moet worden: |voor het zoekwoord )"([^"]+)"/)?.[1] || 'dak';
    return { tekst: JSON.stringify(goedArtikel(z, domein, model.variant++)), tokens: { in: 1, uit: 1 } };
  };
  return model;
}

let db, app;
before(async () => { db = await nieuweDb(); app = await startApp(db); });
after(async () => { await app.sluit(); await db.sluit(); });

async function opzet(naam, { pakket = 'pro' } = {}) {
  const account = await registreerBevestigd(db, `${naam}@test.invalid`, WW, pakket);
  const site = await koppelSite(db, account, { domein: `${naam}.test`, platform: 'wordpress' }, app.internet);
  const sleutel = await wijz.maakPluginSleutel(db, laadSleutel(TEST_ENV), account.id, site.id);
  nepPlugin(app.internet, site.domein, sleutel, { paginas: PAGINAS.map((p) => ({ ...p, url: p.url.replace('ZZZ', site.domein) })) });
  await sites.bewaarProfiel(db, account.id, site.id, PROFIEL);
  const model = nepModel(site.domein), mailer = nepMailer();
  const ctx = { ophalen: app.internet.ophalen, model, mailer, logger: app.logger, geheimenSleutel: laadSleutel(TEST_ENV) };
  return { account, site, model, mailer, ctx };
}
async function artikelTaak(o, zoekwoord) {
  const v = await bereidArtikelVoor(db, o.ctx, o.account, o.site.id, { zoekwoord });
  return wr.plaatsTaak(db, { accountId: o.account.id, siteId: o.site.id, soort: 'artikel', sleutel: v.artikel.id, invoer: { artikelId: v.artikel.id, zoekwoord: v.zoekwoord } });
}
const status = async (id) => (await db.query('SELECT status, melding, wijziging_id, open_sleutel FROM taken WHERE id = $1', [id])).rows[0];

test('één taak tegelijk, nooit dubbel: drie werkers tegelijk op twee taken, elke taak precies één keer', async () => {
  const o = await opzet('rij');
  const t1 = await artikelTaak(o, 'dakisolatie kosten'), t2 = await artikelTaak(o, 'dakgoot vervangen');
  assert.equal(t1.bestond, false); assert.equal(t2.bestond, false);
  const lijstVoor = await wr.lijst(db, o.account.id, { siteId: o.site.id });
  assert.deepEqual(lijstVoor.map((t) => [t.status, t.open]), [['wacht', true], ['wacht', true]]);
  // Drie werkers tegelijk: twee doen een taak, de derde vindt niets. Geen taak wordt twee keer gedaan.
  const uit = await Promise.all([wr.verwerkEen(db, o.ctx, { proces: 'a' }), wr.verwerkEen(db, o.ctx, { proces: 'b' }), wr.verwerkEen(db, o.ctx, { proces: 'c' })]);
  assert.deepEqual(uit.map((u) => u?.status ?? null).sort(), ['klaar', 'klaar', null].sort());
  assert.equal(new Set(uit.filter(Boolean).map((u) => u.id)).size, 2);
  assert.equal(o.model.prompts, 4, 'twee artikelen, elk een opzet en een tekst');
  const voorstellen = await wijz.lijst(db, o.account.id, { siteId: o.site.id, status: 'voorstel' });
  assert.equal(voorstellen.length, 2);
  assert.equal(o.mailer.mails.filter((m) => /^Klaar: artikel/.test(m.onderwerp)).length, 2);
  assert.match(o.mailer.mails[0].tekst, /\/wijzigingen\/[0-9a-f-]+/);
  assert.equal(await wr.verwerkEen(db, o.ctx), null, 'de rij is leeg');
  assert.equal((await status(t1.id)).open_sleutel, null);
  const na = await wr.lijst(db, o.account.id);
  assert.deepEqual(na.map((t) => t.status), ['klaar', 'klaar']);
  assert.ok(na.every((t) => t.wijzigingId));
});

test('dezelfde taak nooit twee keer in de rij: de tweede keer komt de bestaande terug; na afronden mag het weer', async () => {
  const o = await opzet('dubbel');
  const a = await wr.plaatsTaak(db, { accountId: o.account.id, siteId: o.site.id, soort: 'opfrissen', sleutel: '/oud/', invoer: { opfrissingId: 'x', kandidaat: {} } });
  const b = await wr.plaatsTaak(db, { accountId: o.account.id, siteId: o.site.id, soort: 'opfrissen', sleutel: '/OUD/', invoer: { opfrissingId: 'y', kandidaat: {} } });
  assert.equal(b.id, a.id); assert.equal(b.bestond, true);
  assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM taken WHERE account_id = $1', [o.account.id])).rows[0].n), 1);
  // Uitvoeren mislukt netjes (de opfrissing bestaat niet): status mislukt, mail "niet gelukt", geen crash.
  const uit = await wr.verwerkEen(db, o.ctx);
  assert.equal(uit.status, 'mislukt');
  assert.match(o.mailer.mails.at(-1).onderwerp, /^Niet gelukt: opfrisvoorstel/);
  const c = await wr.plaatsTaak(db, { accountId: o.account.id, siteId: o.site.id, soort: 'opfrissen', sleutel: '/oud/', invoer: { opfrissingId: 'z', kandidaat: {} } });
  assert.equal(c.bestond, false); assert.notEqual(c.id, a.id);
  assert.equal((await wr.verwerkEen(db, o.ctx)).id, c.id); // rij weer leeg
});

test('schrijfhulp stuk: taak mislukt, artikel teruggeboekt, mail met de reden; geen e-mailadres in de log', async () => {
  const o = await opzet('stuk');
  const t = await artikelTaak(o, 'dakpannen vervangen');
  o.model.fout = new Error('model kapot');
  const uit = await wr.verwerkEen(db, o.ctx);
  assert.equal(uit.status, 'mislukt'); assert.match(uit.melding, /schrijfhulp is even niet bereikbaar/);
  assert.equal((await db.query('SELECT status FROM artikelen WHERE account_id = $1', [o.account.id])).rows[0].status, 'teruggeboekt');
  const mail = o.mailer.mails.at(-1);
  assert.match(mail.onderwerp, /^Niet gelukt: artikel voor stuk\.test/); assert.match(mail.tekst, /schrijfhulp is even niet bereikbaar/); assert.match(mail.tekst, /\/sites\/.*\/artikel/);
  assert.equal((await status(t.id)).status, 'mislukt');
  const log = (await db.query('SELECT bericht FROM logregels')).rows.map((x) => x.bericht).join('\n');
  assert.ok(!log.includes('@test.invalid'));
});

test('vastgelopen taak (proces weg): afgemeld, niet opnieuw gedraaid, reservering teruggeboekt', async () => {
  const o = await opzet('vast');
  const t = await artikelTaak(o, 'dak lekkage');
  const lang = new Date(Date.now() - 2 * wr.VASTGELOPEN_MS).toISOString();
  await db.query("UPDATE taken SET status = 'bezig', gestart = $1, proces = 'oud' WHERE id = $2", [lang, t.id]);
  const uit = await wr.verwerkEen(db, o.ctx);
  assert.equal(uit, null, 'niets opnieuw gedraaid');
  assert.equal(o.model.prompts, 0);
  const s = await status(t.id);
  assert.equal(s.status, 'mislukt'); assert.match(s.melding, /duurde te lang/); assert.equal(s.open_sleutel, null);
  assert.equal((await db.query('SELECT status FROM artikelen WHERE account_id = $1', [o.account.id])).rows[0].status, 'teruggeboekt');
  assert.match(o.mailer.mails.at(-1).onderwerp, /^Niet gelukt/);
  // Een taak die nog maar net bezig is, blijft met rust.
  const t2 = await artikelTaak(o, 'dak lekkage');
  await db.query("UPDATE taken SET status = 'bezig', gestart = $1 WHERE id = $2", [new Date().toISOString(), t2.id]);
  assert.equal(await wr.verwerkEen(db, o.ctx), null);
  assert.equal((await status(t2.id)).status, 'bezig');
});

test('de werker: rondes overlappen niet en doen de rij leeg', async () => {
  const o = await opzet('werker');
  await artikelTaak(o, 'dakkapel isoleren'); await artikelTaak(o, 'zinken dakgoot');
  const w = wr.startWerker(db, o.ctx, { interval: 60 * 1000 });
  try {
    const [a, b] = await Promise.all([w.ronde(), w.ronde()]); // de tweede ronde start niet terwijl de eerste loopt
    void a; void b;
    assert.equal((await wr.lijst(db, o.account.id)).filter((t) => t.status === 'klaar').length, 2);
    assert.equal(o.model.prompts, 4);
  } finally { w.stop(); }
});

test('account A ziet niets van account B: lijst, pagina en dashboard', async () => {
  const a = await opzet('wa');
  await artikelTaak(a, 'dakisolatie subsidie');
  const b = await registreerBevestigd(db, 'wb@test.invalid', WW, 'solo');
  assert.deepEqual(await wr.lijst(db, b.id), []);
  assert.equal((await wr.lijst(db, b.id, { siteId: a.site.id })).length, 0);
  const cb = await registreerEnLogin(app, 'wb-http@test.invalid');
  assert.equal((await fetch(app.basis + `/sites/${a.site.id}/artikel`, { headers: { cookie: cb } })).status, 404);
  assert.equal((await post(app.basis, `/sites/${a.site.id}/artikel`, { zoekwoord: 'dakisolatie subsidie' }, cb)).status, 404);
  const dash = await (await fetch(app.basis + '/dashboard', { headers: { cookie: cb } })).text();
  assert.doesNotMatch(dash, /Rankcomet is bezig/); assert.doesNotMatch(dash, /wa\.test/);
  assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM taken WHERE account_id = $1', [a.account.id])).rows[0].n), 1);
  void nepInternet;
});
