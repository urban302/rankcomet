import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { nieuweDb } from './helpers.js';
import * as acc from '../src/accounts.js';
import { hashWachtwoord, controleerWachtwoord } from '../src/wachtwoord.js';

let db; before(async () => { db = await nieuweDb(); }); after(async () => db.sluit());

test('wachtwoord-hash is scrypt met zout en controleerbaar', async () => {
  const h1 = await hashWachtwoord('Lang-genoeg-wachtwoord'); const h2 = await hashWachtwoord('Lang-genoeg-wachtwoord');
  assert.match(h1, /^scrypt\$32768\$8\$1\$/); assert.notEqual(h1, h2);
  assert.equal(await controleerWachtwoord('Lang-genoeg-wachtwoord', h1), true);
  assert.equal(await controleerWachtwoord('fout-wachtwoord-xx', h1), false);
});

test('registreren weigert zwak wachtwoord en dubbel e-mailadres', async () => {
  await assert.rejects(acc.registreer(db, 'a@test.invalid', 'kort'), /minstens 12/);
  await acc.registreer(db, 'Dubbel@Test.invalid', 'Testwachtwoord-123!');
  await assert.rejects(acc.registreer(db, 'dubbel@test.invalid', 'Testwachtwoord-123!'), /bestaat al/);
});

test('login, sessie en uitloggen', async () => {
  await acc.registreer(db, 'login@test.invalid', 'Testwachtwoord-123!');
  await assert.rejects(acc.login(db, 'login@test.invalid', 'verkeerd-wachtwoord'), /klopt niet/);
  await assert.rejects(acc.login(db, 'onbekend@test.invalid', 'Testwachtwoord-123!'), /klopt niet/);
  const s = await acc.login(db, 'login@test.invalid', 'Testwachtwoord-123!');
  const a = await acc.accountVoorSessie(db, s.token);
  assert.equal(a.email, 'login@test.invalid');
  const opgeslagen = (await db.query('SELECT token_hash FROM sessies')).rows.map((r) => r.token_hash);
  assert.ok(!opgeslagen.includes(s.token), 'sessietoken mag niet leesbaar in de database staan');
  await acc.logout(db, s.token);
  assert.equal(await acc.accountVoorSessie(db, s.token), null);
});

test('verlopen sessie geeft geen toegang', async () => {
  const s = await acc.login(db, 'login@test.invalid', 'Testwachtwoord-123!');
  await db.query('UPDATE sessies SET verloopt = $1', ['2000-01-01T00:00:00.000Z']);
  assert.equal(await acc.accountVoorSessie(db, s.token), null);
});

test('datamodel heeft ruimte voor latere bureaulaag', async () => {
  const r = await db.query('SELECT bureau_id FROM accounts LIMIT 1');
  assert.equal(r.rows[0].bureau_id, null);
});

test('juiste database-opzet in gebruik', () => {
  assert.equal(db.soort, process.env.RC_DB === 'pg' ? 'pg' : 'sqlite');
});
