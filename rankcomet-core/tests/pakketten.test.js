import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nieuweDb, startApp, registreerEnLogin, post } from './helpers.js';
import * as acc from '../src/accounts.js';
import * as sites from '../src/sites.js';
import { laadPakketten } from '../src/config.js';
import { magArtikelMaken, magZoekwoordVolgen, pakketVoor } from '../src/pakketten.js';

let db, app; before(async () => { db = await nieuweDb(); app = await startApp(db); }); after(async () => { await app.sluit(); await db.sluit(); });

test('pakketten komen uit het configuratiebestand met de afgesproken waarden', () => {
  const p = laadPakketten().pakketten;
  assert.deepEqual([p.solo.prijs_cent, p.solo.max_sites, p.solo.artikelen_per_maand, p.solo.zoekwoorden_volgen], [3900, 1, 10, 100]);
  assert.deepEqual([p.pro.prijs_cent, p.pro.max_sites, p.pro.artikelen_per_maand, p.pro.woocommerce_producten], [8900, 3, 30, true]);
  assert.deepEqual([p.bureau_proef.prijs_cent, p.bureau_proef.max_sites, p.bureau_proef.artikelen_per_maand], [14900, 5, 50]);
  const code = readFileSync(new URL('../src/pakketten.js', import.meta.url), 'utf8') + readFileSync(new URL('../src/sites.js', import.meta.url), 'utf8');
  assert.ok(!/3900|8900|14900/.test(code), 'bedragen horen niet in de code');
});

test('limieten artikelen en zoekwoorden', () => {
  assert.equal(magArtikelMaken('solo', 9), true); assert.equal(magArtikelMaken('solo', 10), false);
  assert.equal(magArtikelMaken('pro', 29), true); assert.equal(magArtikelMaken('pro', 30), false);
  assert.equal(magArtikelMaken('bureau_proef', 50), false);
  assert.equal(magZoekwoordVolgen('solo', 99), true); assert.equal(magZoekwoordVolgen('solo', 100), false);
  assert.throws(() => pakketVoor('bestaat-niet'), /Onbekend pakket/);
});

for (const [pakket, max] of [['solo', 1], ['pro', 3], ['bureau_proef', 5]]) {
  test(`sitelimiet ${pakket} = ${max}, daarboven NL-melding met upgrade`, async () => {
    const a = await acc.registreer(db, `${pakket}@test.invalid`, 'Testwachtwoord-123!', pakket);
    for (let i = 0; i < max; i++) await sites.voegSiteToe(db, a, { domein: `s${i}-${pakket.replace('_', '')}.test`, platform: 'wordpress' });
    const fout = await sites.voegSiteToe(db, a, { domein: `extra-${pakket.replace('_', '')}.test`, platform: 'wordpress' }).catch((e) => e);
    assert.equal(fout.status, 403);
    assert.match(fout.message, /^Uw pakket .* staat maximaal \d+ sites? toe\./);
    if (pakket === 'bureau_proef') assert.equal(fout.upgrade, null); else assert.ok(fout.upgrade);
    assert.equal((await sites.lijstSites(db, a.id)).length, max);
  });
}

test('HTTP: tweede site bij Solo geweigerd met upgrade-link', async () => {
  const c = await registreerEnLogin(app.basis, 'solo-http@test.invalid');
  assert.equal((await post(app.basis, '/sites/nieuw', { domein: 'een.test', taal: 'nl', land: 'NL', platform: 'wordpress' }, c)).status, 303);
  const r = await post(app.basis, '/sites/nieuw', { domein: 'twee.test', taal: 'nl', land: 'NL', platform: 'wordpress' }, c);
  assert.equal(r.status, 403);
  const html = await r.text();
  assert.match(html, /Uw pakket Solo staat maximaal 1 site toe\. Upgrade naar Pro/);
  assert.match(html, /href="\/pakketten"/);
});
