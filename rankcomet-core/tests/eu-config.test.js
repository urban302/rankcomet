import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { nieuweDb, TEST_ENV } from './helpers.js';
import { controleerAzureEnv, maakAzureClient } from '../src/azure.js';
import { laadSleutel, versleutel, ontsleutel } from '../src/geheimen.js';
import { maakLogger, maskeer } from '../src/log.js';
import { bewaartermijnDagen } from '../src/config.js';
import { startControles } from '../src/server.js';

let db; before(async () => { db = await nieuweDb(); }); after(async () => db.sluit());

test('Azure: EU Data Zone geaccepteerd, gemockt transport', async () => {
  const aanroepen = [];
  const c = maakAzureClient(TEST_ENV, async (url, opt) => { aanroepen.push({ url, opt }); return { choices: [{ message: { content: 'Hallo' } }] }; });
  const r = await c.chat([{ role: 'user', content: 'test' }]);
  assert.equal(r.choices[0].message.content, 'Hallo');
  assert.match(aanroepen[0].url, /^https:\/\/rc-test\.openai\.azure\.com\/openai\/deployments\/gpt-test\//);
});

test('Azure: niet-EU regio, globale deployment of vreemd endpoint geweigerd', () => {
  assert.throws(() => controleerAzureEnv({ ...TEST_ENV, RC_AZURE_OPENAI_REGIO: 'eastus' }), /niet in de EU/);
  assert.throws(() => controleerAzureEnv({ ...TEST_ENV, RC_AZURE_OPENAI_DEPLOYMENT_TYPE: 'GlobalStandard' }), /geen EU Data Zone/);
  assert.throws(() => controleerAzureEnv({ ...TEST_ENV, RC_AZURE_OPENAI_ENDPOINT: 'https://api.openai.com' }), /openai\.azure\.com/);
  assert.throws(() => controleerAzureEnv({ ...TEST_ENV, RC_AZURE_OPENAI_ENDPOINT: 'http://rc-test.openai.azure.com' }), /openai\.azure\.com/);
  assert.throws(() => controleerAzureEnv({ ...TEST_ENV, RC_AZURE_OPENAI_ENDPOINT: '' }), /ongeldig/);
});

test('start geweigerd zonder Postgres of EU-config', async () => {
  const goed = { ...TEST_ENV, RC_DB: 'pg', RC_DATABASE_URL: 'postgres://test.invalid/x' };
  await assert.doesNotReject(startControles(goed));
  await assert.rejects(startControles({ ...goed, RC_DB: 'sqlite' }), /Postgres/);
  await assert.rejects(startControles({ ...goed, RC_AZURE_OPENAI_REGIO: 'westus' }), /EU/);
  await assert.rejects(startControles({ ...goed, RC_GEHEIMEN_SLEUTEL: '' }), /ontbreekt/);
});

test('AES-256-GCM: heen en terug, AAD per account, manipulatie gedetecteerd', () => {
  const k = laadSleutel(TEST_ENV);
  const blob = versleutel(k, 'cms-token-test', 'account-a');
  assert.ok(!blob.includes('cms-token-test'));
  assert.equal(ontsleutel(k, blob, 'account-a'), 'cms-token-test');
  assert.throws(() => ontsleutel(k, blob, 'account-b'));
  const d = blob.split('.'); d[2] = Buffer.from('xxxx').toString('base64');
  assert.throws(() => ontsleutel(k, d.join('.'), 'account-a'));
  assert.throws(() => ontsleutel(randomBytes(32), blob, 'account-a'));
  assert.throws(() => laadSleutel({ RC_GEHEIMEN_SLEUTEL: randomBytes(16).toString('base64') }), /32 bytes/);
});

test('logs zonder persoonsgegevens of sleutels', async () => {
  const t = maskeer('mail jan@voorbeeld.nl ip 192.168.1.10 sleutel sk_test_abc123 Bearer abc.def wachtwoord=geheim123');
  for (const x of ['jan@voorbeeld.nl', '192.168.1.10', 'sk_test_abc123', 'abc.def', 'geheim123']) assert.ok(!t.includes(x), x);
  const l = maakLogger(db); await l.log('info', 'inlog van piet@test.invalid');
  const r = (await db.query('SELECT bericht FROM logregels')).rows;
  assert.ok(r.every((x) => !x.bericht.includes('@test.invalid')));
});

test('bewaartermijn logs: standaard 90 dagen, instelbaar, oud wordt opgeruimd', async () => {
  assert.equal(bewaartermijnDagen({}), 90);
  assert.equal(bewaartermijnDagen({ RC_LOG_BEWAAR_DAGEN: '30' }), 30);
  assert.throws(() => bewaartermijnDagen({ RC_LOG_BEWAAR_DAGEN: 'nul' }));
  await db.query('DELETE FROM logregels');
  await db.query('INSERT INTO logregels (id, tijd, niveau, bericht) VALUES ($1, $2, $3, $4)', ['oud', new Date(Date.now() - 91 * 86400000).toISOString(), 'info', 'oud']);
  await db.query('INSERT INTO logregels (id, tijd, niveau, bericht) VALUES ($1, $2, $3, $4)', ['nieuw', new Date(Date.now() - 89 * 86400000).toISOString(), 'info', 'nieuw']);
  assert.equal(await maakLogger(db).ruimOp(90), 1);
  assert.deepEqual((await db.query('SELECT id FROM logregels')).rows.map((r) => r.id), ['nieuw']);
});
