// Stap 2: de veilige ophaler voor klantsites (SSRF, doorverwijzingen, grootte, time-out).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maakOphaler, isPriveAdres, STANDAARD } from '../src/ophalen.js';

const PUBLIEK = [{ address: '93.184.216.34', family: 4 }];

// Ophaler met een nep-DNS en een nep-verbinding die bijhoudt waarmee verbonden is.
function opzet({ dns = () => PUBLIEK, antwoord = () => ({ status: 200, headers: {}, body: Buffer.from('<html>ok</html>') }), ...opties } = {}) {
  const verbindingen = [];
  const ophalen = maakOphaler({ lookup: async (h) => dns(h), verbind: async (v) => { verbindingen.push(v); return antwoord(v); }, ...opties });
  return { ophalen, verbindingen };
}

test('privé-, lokale en gereserveerde adressen worden herkend, gewone niet', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1',
    '::1', '::', 'fe80::1', 'fd12::1', 'fc00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::7f00:1', 'ff02::1', 'onzin']) {
    assert.equal(isPriveAdres(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '2a00:1450:400e:80d::200e', '::ffff:8.8.8.8', '64:ff9b::808:808']) {
    assert.equal(isPriveAdres(ip), false, ip);
  }
});

test('geen verbinding met een domein dat (ook) naar een intern adres wijst, ook niet via IPv6', async () => {
  for (const adressen of [[{ address: '127.0.0.1' }], [{ address: '93.184.216.34' }, { address: '10.0.0.5' }], [{ address: '::1' }], [{ address: '::ffff:192.168.0.1' }], []]) {
    const { ophalen, verbindingen } = opzet({ dns: () => adressen });
    const f = await ophalen('https://voorbeeld.nl/', 'voorbeeld.nl').catch((e) => e);
    assert.equal(f.status, 400, JSON.stringify(adressen));
    assert.equal(verbindingen.length, 0, 'er mag niet verbonden worden');
  }
});

test('alleen https op de standaardpoort, geen IP-adres en geen gebruikersnaam in de URL', async () => {
  const { ophalen, verbindingen } = opzet();
  for (const url of ['http://voorbeeld.nl/', 'https://voorbeeld.nl:8443/', 'https://93.184.216.34/', 'https://gebruiker:ww@voorbeeld.nl/', 'ftp://voorbeeld.nl/', 'geen url']) {
    assert.equal((await ophalen(url, 'voorbeeld.nl').catch((e) => e)).status, 400, url);
  }
  assert.equal(verbindingen.length, 0);
});

test('verbindt met het opgezochte adres en geeft de hostnaam mee (DNS-pinning)', async () => {
  const { ophalen, verbindingen } = opzet();
  const r = await ophalen('https://voorbeeld.nl/pad?x=1', 'voorbeeld.nl');
  assert.equal(r.status, 200); assert.equal(r.body, '<html>ok</html>');
  assert.deepEqual(verbindingen.map((v) => [v.adres, v.hostnaam, v.pad]), [['93.184.216.34', 'voorbeeld.nl', '/pad?x=1']]);
  assert.equal(verbindingen[0].timeoutMs, STANDAARD.timeoutMs); assert.equal(verbindingen[0].maxBytes, STANDAARD.maxBytes);
});

test('doorverwijzingen: alleen binnen het eigen domein, elke stap opnieuw gecontroleerd, maximaal 3', async () => {
  const naar = (loc) => ({ status: 301, headers: { location: loc }, body: Buffer.alloc(0) });
  // Naar www en terug naar een pad: mag.
  let { ophalen, verbindingen } = opzet({ antwoord: (v) => v.hostnaam === 'voorbeeld.nl' ? naar('https://www.voorbeeld.nl/') : v.pad === '/' ? naar('/home') : { status: 200, headers: {}, body: Buffer.from('thuis') } });
  assert.equal((await ophalen('https://voorbeeld.nl/', 'voorbeeld.nl')).body, 'thuis');
  assert.deepEqual(verbindingen.map((v) => v.hostnaam + v.pad), ['voorbeeld.nl/', 'www.voorbeeld.nl/', 'www.voorbeeld.nl/home']);
  // Naar een ander domein: niet.
  ({ ophalen, verbindingen } = opzet({ antwoord: () => naar('https://kwaad.example/') }));
  assert.match((await ophalen('https://voorbeeld.nl/', 'voorbeeld.nl').catch((e) => e)).message, /verwijst door naar kwaad\.example/);
  assert.equal(verbindingen.length, 1);
  // Naar http of een intern adres: niet.
  ({ ophalen, verbindingen } = opzet({ antwoord: () => naar('http://voorbeeld.nl/') }));
  assert.equal((await ophalen('https://voorbeeld.nl/', 'voorbeeld.nl').catch((e) => e)).status, 400);
  ({ ophalen, verbindingen } = opzet({ dns: (h) => h === 'intern.voorbeeld.nl' ? [{ address: '10.0.0.1' }] : PUBLIEK, antwoord: () => naar('https://intern.voorbeeld.nl/') }));
  assert.match((await ophalen('https://voorbeeld.nl/', 'voorbeeld.nl').catch((e) => e)).message, /intern adres/);
  assert.equal(verbindingen.length, 1);
  // Lus: stopt na 3 keer.
  ({ ophalen, verbindingen } = opzet({ antwoord: () => naar('https://voorbeeld.nl/') }));
  assert.match((await ophalen('https://voorbeeld.nl/', 'voorbeeld.nl').catch((e) => e)).message, /te vaak door/);
  assert.equal(verbindingen.length, 4);
});

test('een te grote pagina of een trage site geeft een nette fout', async () => {
  const { Fout } = await import('../src/accounts.js');
  let { ophalen } = opzet({ antwoord: () => { throw new Fout('De pagina is te groot om te controleren (maximaal 512 kB).', 400); } });
  assert.match((await ophalen('https://voorbeeld.nl/', 'voorbeeld.nl').catch((e) => e)).message, /te groot/);
  ({ ophalen } = opzet({ antwoord: () => { throw new Fout('Je site reageerde niet binnen 5 seconden.', 400); } }));
  assert.match((await ophalen('https://voorbeeld.nl/', 'voorbeeld.nl').catch((e) => e)).message, /niet binnen 5 seconden/);
});
