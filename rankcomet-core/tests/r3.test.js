// R3 (stap 1): wachtwoord vergeten, e-mailverificatie, rate limiting, artikelmaand in Nederlandse tijd.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { nieuweDb, startApp, registreerEnLogin, registreerBevestigd, post, linkUit, mockStripe, TEST_ENV } from './helpers.js';
import * as acc from '../src/accounts.js';
import * as sites from '../src/sites.js';
import { reserveerArtikel } from '../src/artikelen.js';
import { STANDAARD_GRENZEN } from '../src/grens.js';

const WW = 'Testwachtwoord-123!', NIEUW = 'Nieuw-wachtwoord-456!';
let db, app;
before(async () => { db = await nieuweDb(); app = await startApp(db); });
after(async () => { await app.sluit(); await db.sluit(); });

const ingelogd = async (cookie) => (await fetch(app.basis + '/dashboard', { redirect: 'manual', headers: { cookie } })).status === 200;

test('wachtwoord vergeten: eenmalige link, oude sessies weg, nieuw wachtwoord werkt', async () => {
  const email = 'vergeten@test.invalid';
  const oud = await registreerEnLogin(app, email);
  // Onbekend adres: zelfde antwoord, geen mail.
  const aantal = app.mailer.mails.length;
  const onbekend = await post(app.basis, '/wachtwoord-vergeten', { email: 'niemand@test.invalid' });
  const bekend = await post(app.basis, '/wachtwoord-vergeten', { email: 'Vergeten@Test.invalid' });
  assert.equal(onbekend.status, 200); assert.equal(bekend.status, 200);
  assert.equal(await onbekend.text(), await bekend.text());
  assert.equal(app.mailer.mails.length, aantal + 1);

  const { pad, token } = linkUit(app.mailer.laatsteAan(email));
  assert.equal(pad, '/wachtwoord-herstellen');
  assert.equal((await db.query('SELECT 1 AS x FROM eenmalige_tokens WHERE token_hash = $1', [token])).rows.length, 0, 'token mag niet leesbaar in de database staan');
  assert.match(await (await fetch(app.basis + pad + '?token=' + token)).text(), /Nieuw wachtwoord/);

  // Een te kort wachtwoord maakt de link niet op.
  assert.equal((await post(app.basis, pad, { token, wachtwoord: 'kort' })).status, 400);
  assert.equal((await post(app.basis, pad, { token, wachtwoord: NIEUW })).status, 200);
  assert.equal(await ingelogd(oud), false, 'oude sessie moet weg zijn');
  await assert.rejects(acc.login(db, email, WW), /klopt niet/);
  assert.ok(await acc.login(db, email, NIEUW));
  // Tweede keer dezelfde link: werkt niet meer.
  const opnieuw = await post(app.basis, pad, { token, wachtwoord: 'Nog-een-wachtwoord-789!' });
  assert.equal(opnieuw.status, 400); assert.match(await opnieuw.text(), /werkt niet meer/);
});

test('herstellink: verlopen werkt niet, en twee gelijktijdige pogingen wijzigen maar één keer', async () => {
  await acc.registreer(db, 'verlopen@test.invalid', WW);
  const r = await acc.wachtwoordVergeten(db, 'verlopen@test.invalid');
  await db.query('UPDATE eenmalige_tokens SET verloopt = $1 WHERE account_id = $2', ['2000-01-01T00:00:00.000Z', r.accountId]);
  await assert.rejects(acc.herstelWachtwoord(db, r.token, NIEUW), /werkt niet meer/);

  const r2 = await acc.wachtwoordVergeten(db, 'verlopen@test.invalid');
  const uitslag = await Promise.allSettled([acc.herstelWachtwoord(db, r2.token, NIEUW), acc.herstelWachtwoord(db, r2.token, 'Ander-wachtwoord-789!')]);
  assert.equal(uitslag.filter((u) => u.status === 'fulfilled').length, 1);
});

test('e-mailverificatie: zonder bevestiging geen site koppelen, daarna wel', async () => {
  const email = 'onbevestigd@test.invalid';
  const c = await registreerEnLogin(app, email, { bevestig: false });
  assert.match(await (await fetch(app.basis + '/dashboard', { headers: { cookie: c } })).text(), /Bevestig je e-mailadres/);
  const geweigerd = await post(app.basis, '/sites/nieuw', { domein: 'onbevestigd.test', land: 'NL', platform: 'wordpress' }, c);
  assert.equal(geweigerd.status, 403);
  assert.equal((await db.query('SELECT 1 AS x FROM sites WHERE domein = $1', ['onbevestigd.test'])).rows.length, 0);

  const { pad, token } = linkUit(app.mailer.laatsteAan(email));
  assert.equal(pad, '/email-bevestigen');
  // Alleen de link openen (zoals een virusscanner doet) bevestigt nog niets.
  await fetch(app.basis + pad + '?token=' + token);
  assert.equal((await post(app.basis, '/sites/nieuw', { domein: 'onbevestigd.test', land: 'NL', platform: 'wordpress' }, c)).status, 403);
  assert.equal((await post(app.basis, pad, { token }, c)).status, 200);
  assert.equal((await post(app.basis, '/sites/nieuw', { domein: 'onbevestigd.test', land: 'NL', platform: 'wordpress' }, c)).status, 303);
  assert.equal((await post(app.basis, pad, { token }, c)).status, 400, 'link werkt maar één keer');
});

test('account A ziet niets van account B: links werken alleen voor het eigen account en het eigen doel', async () => {
  const a = await acc.registreer(db, 'link-a@test.invalid', WW, 'pro');
  const b = await acc.registreer(db, 'link-b@test.invalid', WW, 'pro');
  await acc.bevestigEmail(db, await acc.maakVerificatieToken(db, a.id));
  // A is bevestigd, B niet.
  assert.ok(await sites.voegSiteToe(db, a, { domein: 'link-a.test', platform: 'wordpress' }));
  assert.equal((await sites.voegSiteToe(db, b, { domein: 'link-b.test', platform: 'wordpress' }).catch((e) => e)).status, 403);
  // Een herstellink van A wijzigt alleen het wachtwoord van A.
  const herstelA = await acc.wachtwoordVergeten(db, 'link-a@test.invalid');
  await acc.herstelWachtwoord(db, herstelA.token, NIEUW);
  assert.ok(await acc.login(db, 'link-b@test.invalid', WW));
  // Een bevestigingslink is geen herstellink, en andersom.
  const verifB = await acc.maakVerificatieToken(db, b.id);
  await assert.rejects(acc.herstelWachtwoord(db, verifB, NIEUW), /werkt niet meer/);
  const herstelB = await acc.wachtwoordVergeten(db, 'link-b@test.invalid');
  await assert.rejects(acc.bevestigEmail(db, herstelB.token), /werkt niet meer/);
});

test('bevestigingsmail opnieuw sturen: nieuwe link, met een grens per account', async () => {
  const email = 'opnieuw@test.invalid';
  const eigen = await startApp(db, mockStripe(), { grenzen: STANDAARD_GRENZEN });
  try {
    const c = await registreerEnLogin(eigen, email, { bevestig: false });
    for (let i = 0; i < 3; i++) assert.equal((await post(eigen.basis, '/email-bevestigen/opnieuw', {}, c)).status, 200);
    assert.equal(eigen.mailer.mails.filter((m) => m.aan === email).length, 4);
    assert.equal((await post(eigen.basis, '/email-bevestigen/opnieuw', {}, c)).status, 429);
    // De nieuwste link werkt.
    assert.equal((await post(eigen.basis, '/email-bevestigen', { token: linkUit(eigen.mailer.laatsteAan(email)).token }, c)).status, 200);
  } finally { await eigen.sluit(); }
});

test('rate limiting op inloggen, aanmelden en wachtwoord vergeten, zonder IP of e-mail in de log', async () => {
  const eigen = await startApp(db, mockStripe(), { grenzen: STANDAARD_GRENZEN });
  try {
    await registreerBevestigd(db, 'slot@test.invalid', WW);
    await registreerBevestigd(db, 'ander@test.invalid', WW);
    // Per e-mailadres: na 10 mislukte pogingen 429, ook met het goede wachtwoord.
    for (let i = 0; i < 10; i++) assert.equal((await post(eigen.basis, '/inloggen', { email: 'slot@test.invalid', wachtwoord: 'fout-wachtwoord-1' })).status, 401);
    const dicht = await post(eigen.basis, '/inloggen', { email: 'slot@test.invalid', wachtwoord: WW });
    assert.equal(dicht.status, 429); assert.ok(Number(dicht.headers.get('retry-after')) > 0);
    assert.match(await dicht.text(), /Te veel pogingen/);
    // Een ander account vanaf hetzelfde IP kan nog inloggen.
    assert.equal((await post(eigen.basis, '/inloggen', { email: 'ander@test.invalid', wachtwoord: WW })).status, 303);
    // Per IP: na 30 mislukte pogingen (verspreid over adressen) dicht voor iedereen vanaf dat IP.
    for (let i = 0; i < 20; i++) await post(eigen.basis, '/inloggen', { email: `gok${i}@test.invalid`, wachtwoord: 'fout-wachtwoord-1' });
    assert.equal((await post(eigen.basis, '/inloggen', { email: 'ander@test.invalid', wachtwoord: WW })).status, 429);

    // Aanmelden: maximaal 10 per uur per IP.
    for (let i = 0; i < 10; i++) assert.equal((await post(eigen.basis, '/registreren', { email: `nieuw${i}@test.invalid`, wachtwoord: WW })).status, 303);
    assert.equal((await post(eigen.basis, '/registreren', { email: 'nieuw10@test.invalid', wachtwoord: WW })).status, 429);
    assert.equal((await db.query('SELECT 1 AS x FROM accounts WHERE email = $1', ['nieuw10@test.invalid'])).rows.length, 0);

    // Wachtwoord vergeten: maximaal 3 per uur per e-mailadres.
    for (let i = 0; i < 3; i++) assert.equal((await post(eigen.basis, '/wachtwoord-vergeten', { email: 'ander@test.invalid' })).status, 200);
    assert.equal((await post(eigen.basis, '/wachtwoord-vergeten', { email: 'ander@test.invalid' })).status, 429);

    const log = (await db.query('SELECT bericht FROM logregels')).rows.map((r) => r.bericht).join('\n');
    assert.match(log, /te veel pogingen soort=inloggen/);
    assert.doesNotMatch(log, /\[e-mail\]|\[ip\]|@|127\.0\.0\.1/, 'log mag geen e-mail of IP bevatten, ook niet gemaskeerd');
    for (const m of eigen.mailer.mails) assert.ok(!log.includes(linkUit(m).token), 'token mag niet in de log staan');
  } finally { await eigen.sluit(); }
});

test('X-Forwarded-For telt alleen met RC_VERTROUW_PROXY=1', async () => {
  const grenzen = { ...STANDAARD_GRENZEN, login_ip: { max: 2, ms: 60000 } };
  const poging = (a, ip, email) => fetch(a.basis + '/inloggen', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': ip }, body: new URLSearchParams({ email, wachtwoord: 'fout-wachtwoord-1' }).toString() });
  const metProxy = await startApp(db, mockStripe(), { grenzen, env: { ...TEST_ENV, RC_VERTROUW_PROXY: '1' } });
  const zonder = await startApp(db, mockStripe(), { grenzen });
  try {
    await poging(metProxy, '198.51.100.1', 'p1@test.invalid'); await poging(metProxy, '198.51.100.1', 'p2@test.invalid');
    assert.equal((await poging(metProxy, '198.51.100.1', 'p3@test.invalid')).status, 429);
    assert.equal((await poging(metProxy, '198.51.100.2', 'p4@test.invalid')).status, 401);
    // Zonder de instelling kan een bezoeker de grens niet ontlopen met een zelfgekozen header.
    await poging(zonder, '198.51.100.1', 'z1@test.invalid'); await poging(zonder, '198.51.100.2', 'z2@test.invalid');
    assert.equal((await poging(zonder, '198.51.100.3', 'z3@test.invalid')).status, 429);
  } finally { await metProxy.sluit(); await zonder.sluit(); }
});

test('A22: artikelmaand volgt de Nederlandse tijd, in winter- en zomertijd', async () => {
  const a = await registreerBevestigd(db, 'maand@test.invalid', WW, 'pro');
  const s = (await sites.voegSiteToe(db, a, { domein: 'maand.test', platform: 'wordpress' })).site.id;
  const maand = async (iso) => (await reserveerArtikel(db, a, s, new Date(iso))).maand;
  assert.equal(await maand('2026-10-31T22:59:59Z'), '2026-10'); // 23:59:59 wintertijd
  assert.equal(await maand('2026-10-31T23:30:00Z'), '2026-11'); // 00:30 op 1 november
  assert.equal(await maand('2026-09-30T21:59:59Z'), '2026-09'); // 23:59:59 zomertijd
  assert.equal(await maand('2026-09-30T22:00:00Z'), '2026-10'); // 00:00 op 1 oktober
  assert.equal(await maand('2026-03-31T22:00:00Z'), '2026-04'); // net na de wissel naar zomertijd (29 maart)
  assert.equal(await maand('2026-02-28T23:00:00Z'), '2026-03'); // nog wintertijd
});

test('A22: de limiet begint opnieuw om middernacht Nederlandse tijd, niet om middernacht UTC', async () => {
  const a = await registreerBevestigd(db, 'middernacht@test.invalid', WW, 'solo');
  const s = (await sites.voegSiteToe(db, a, { domein: 'middernacht.test', platform: 'wordpress' })).site.id;
  for (let i = 0; i < 10; i++) await reserveerArtikel(db, a, s, new Date('2026-11-30T22:30:00Z')); // 23:30 op 30 november
  assert.equal((await reserveerArtikel(db, a, s, new Date('2026-11-30T22:45:00Z')).catch((e) => e)).status, 403);
  // 00:30 op 1 december in Nederland, terwijl het in UTC nog 30 november is.
  assert.equal((await reserveerArtikel(db, a, s, new Date('2026-11-30T23:30:00Z'))).maand, '2026-12');
});
