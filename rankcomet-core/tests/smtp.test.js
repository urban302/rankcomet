// Stap 13: de SMTP-mailer, getest tegen een nep-mailserver in het testproces (zonder TLS, met STARTTLS en met
// directe TLS op een zelfgetekend certificaat). Plus de koppeling met de app: de bevestigingsmail komt echt aan.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { maakMailer, controleerMailEnv, bouwBericht, verstuurSmtp, MailFout } from '../src/smtp.js';
import { maakApp } from '../src/app.js';
import { maakLogger } from '../src/log.js';
import { nieuweDb, RUIM, TEST_ENV, post, mockStripe } from './helpers.js';

// Nep-SMTP-server: onthoudt het hele gesprek, kan STARTTLS, weigert een ontvanger die op "weiger" begint.
function nepSmtp({ cert = null, direct = false } = {}) {
  const gesprekken = [];
  const afhandelen = (socket, gesprek, naTls = false) => {
    let buffer = '', inData = false;
    if (!naTls) socket.write('220 nep.test ESMTP\r\n');
    socket.on('data', (d) => {
      buffer += d.toString('utf8');
      for (;;) {
        const eind = buffer.indexOf('\r\n'); if (eind < 0) return;
        const regel = buffer.slice(0, eind); buffer = buffer.slice(eind + 2);
        if (inData) { if (regel === '.') { inData = false; socket.write('250 2.0.0 Ok: queued\r\n'); } else gesprek.data.push(regel); continue; }
        gesprek.regels.push(regel);
        const [cmd] = regel.split(' ');
        if (cmd === 'EHLO') socket.write(`250-nep.test\r\n${cert && !gesprek.tls ? '250-STARTTLS\r\n' : ''}250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n`);
        else if (cmd === 'STARTTLS') { socket.write('220 Go ahead\r\n'); socket.removeAllListeners('data'); const s = new tls.TLSSocket(socket, { isServer: true, key: cert.key, cert: cert.cert }); gesprek.tls = true; afhandelen(s, gesprek, true); return; }
        else if (cmd === 'AUTH') { gesprek.auth = Buffer.from(regel.split(' ')[2], 'base64').toString('utf8').split('\0'); socket.write(gesprek.auth[2] === 'goed' ? '235 ok\r\n' : '535 nee\r\n'); }
        else if (cmd === 'MAIL') socket.write('250 ok\r\n');
        else if (cmd === 'RCPT') socket.write(/<weiger/.test(regel) ? '550 5.1.1 no such user\r\n' : '250 ok\r\n');
        else if (cmd === 'DATA') { inData = true; socket.write('354 go\r\n'); }
        else if (cmd === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
        else socket.write('500 wat\r\n');
      }
    });
    socket.on('error', () => {});
  };
  const nieuw = (socket) => { const g = { regels: [], data: [], auth: null, tls: direct }; gesprekken.push(g); afhandelen(socket, g); };
  const server = direct ? tls.createServer({ key: cert.key, cert: cert.cert }, nieuw) : net.createServer(nieuw);
  return { gesprekken, server, start: () => new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server.address().port))), stop: () => new Promise((ok) => server.close(() => ok())) };
}

// Zelfgetekend certificaat voor 127.0.0.1 (openssl staat op elke testmachine en in CI).
function maakCert() {
  const map = mkdtempSync(path.join(tmpdir(), 'rc-smtp-'));
  const cnf = path.join(map, 'o.cnf');
  writeFileSync(cnf, '[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n[dn]\nCN=127.0.0.1\n[v3]\nsubjectAltName=IP:127.0.0.1\n');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-keyout', path.join(map, 'k.pem'), '-out', path.join(map, 'c.pem'), '-config', cnf], { stdio: 'ignore' });
  return { key: readFileSync(path.join(map, 'k.pem')), cert: readFileSync(path.join(map, 'c.pem')), caBestand: path.join(map, 'c.pem') };
}

const decodeer = (data) => { const leeg = data.indexOf(''); return { koppen: data.slice(0, leeg), tekst: Buffer.from(data.slice(leeg + 1).join(''), 'base64').toString('utf8') }; };
let cert;
before(() => { cert = maakCert(); });

test('zonder RC_SMTP_HOST: geen mailer, versturen faalt netjes; foute env wordt bij de start geweigerd', () => {
  const m = maakMailer({});
  assert.equal(m.gekoppeld, false);
  assert.rejects(m.stuur({ aan: 'a@b.nl', onderwerp: 'x', tekst: 'y' }), /nog niet gekoppeld/);
  assert.throws(() => controleerMailEnv({ RC_SMTP_HOST: 'smtp.test' }), /RC_MAIL_AFZENDER/);
  assert.throws(() => controleerMailEnv({ RC_SMTP_HOST: 'smtp.test', RC_MAIL_AFZENDER: 'noreply@rankcomet.ai', RC_SMTP_GEBRUIKER: 'u' }), /RC_SMTP_WACHTWOORD/);
  assert.throws(() => controleerMailEnv({ RC_SMTP_HOST: 'smtp.test', RC_MAIL_AFZENDER: 'noreply@rankcomet.ai', RC_SMTP_TLS: 'geen' }), /alleen naar 127.0.0.1/);
  assert.throws(() => controleerMailEnv({ RC_SMTP_HOST: 'smtp.test', RC_MAIL_AFZENDER: 'noreply@rankcomet.ai', RC_SMTP_POORT: 'abc' }), /poort/);
  assert.equal(controleerMailEnv({ RC_SMTP_HOST: 'smtp.test', RC_MAIL_AFZENDER: 'noreply@rankcomet.ai', RC_SMTP_POORT: '465' }).tlsModus, 'direct');
  assert.equal(controleerMailEnv({ RC_SMTP_HOST: 'smtp.test', RC_MAIL_AFZENDER: 'noreply@rankcomet.ai' }).tlsModus, 'starttls');
});

test('bericht: koppen, UTF-8-onderwerp als RFC 2047, tekst als base64; regeleindes in adres of onderwerp geweigerd', () => {
  const b = bouwBericht({ van: 'noreply@rankcomet.ai', vanNaam: 'Rankcomet', aan: 'klant@voorbeeld.nl', onderwerp: 'Bevestig je e-mailadres, alsjeblieft', tekst: 'Hoi,\n\nKlik op de link.\n' });
  assert.match(b, /^From: Rankcomet <noreply@rankcomet\.ai>\r\nTo: klant@voorbeeld\.nl\r\nSubject: Bevestig je e-mailadres, alsjeblieft\r\n/);
  assert.match(b, /\r\nContent-Type: text\/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n/);
  assert.match(bouwBericht({ van: 'a@b.nl', aan: 'c@d.nl', onderwerp: 'Één maandrapport', tekst: 'x' }), /Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=\r\n/);
  assert.throws(() => bouwBericht({ van: 'a@b.nl', aan: 'c@d.nl\r\nBcc: e@f.nl', onderwerp: 'x', tekst: 'y' }), MailFout);
  assert.throws(() => bouwBericht({ van: 'a@b.nl', aan: 'c@d.nl', onderwerp: 'x\nBcc: e@f.nl', tekst: 'y' }), MailFout);
  assert.throws(() => bouwBericht({ van: 'a@b.nl', aan: 'geen adres', onderwerp: 'x', tekst: 'y' }), MailFout);
});

test('zonder TLS naar 127.0.0.1: aanmelden, afzender, ontvanger, inhoud; een geweigerde ontvanger geeft een fout zonder adres', async () => {
  const s = nepSmtp(); const poort = await s.start();
  try {
    const env = { RC_SMTP_HOST: '127.0.0.1', RC_SMTP_POORT: String(poort), RC_SMTP_TLS: 'geen', RC_MAIL_AFZENDER: 'noreply@rankcomet.ai', RC_SMTP_GEBRUIKER: 'relay', RC_SMTP_WACHTWOORD: 'goed' };
    const r = await verstuurSmtp(controleerMailEnv(env), { aan: 'klant@voorbeeld.nl', onderwerp: 'Test', tekst: 'Hoi,\nregel twee.\n' });
    assert.equal(r.code, 250);
    const g = s.gesprekken[0];
    assert.deepEqual(g.regels.map((x) => x.split(' ')[0]), ['EHLO', 'AUTH', 'MAIL', 'RCPT', 'DATA', 'QUIT']);
    assert.deepEqual(g.auth, ['', 'relay', 'goed']);
    assert.ok(g.regels.includes('MAIL FROM:<noreply@rankcomet.ai>')); assert.ok(g.regels.includes('RCPT TO:<klant@voorbeeld.nl>'));
    const { koppen, tekst } = decodeer(g.data);
    assert.equal(tekst, 'Hoi,\nregel twee.\n'); assert.ok(koppen.includes('Subject: Test'));
    const fout = await verstuurSmtp(controleerMailEnv(env), { aan: 'weiger@voorbeeld.nl', onderwerp: 'Test', tekst: 'x' }).catch((e) => e);
    assert.ok(fout instanceof MailFout); assert.equal(fout.code, 550); assert.doesNotMatch(fout.message, /voorbeeld\.nl/);
    const fout2 = await verstuurSmtp(controleerMailEnv({ ...env, RC_SMTP_WACHTWOORD: 'fout' }), { aan: 'klant@voorbeeld.nl', onderwerp: 'Test', tekst: 'x' }).catch((e) => e);
    assert.equal(fout2.code, 535); assert.doesNotMatch(fout2.message, /fout'|goed/);
  } finally { await s.stop(); }
});

test('STARTTLS: het wachtwoord gaat pas na de TLS-upgrade; zonder STARTTLS-aanbod wordt er niet verstuurd', async () => {
  const s = nepSmtp({ cert }); const poort = await s.start();
  try {
    const env = { RC_SMTP_HOST: '127.0.0.1', RC_SMTP_POORT: String(poort), RC_MAIL_AFZENDER: 'noreply@rankcomet.ai', RC_SMTP_GEBRUIKER: 'relay', RC_SMTP_WACHTWOORD: 'goed', RC_SMTP_CA: cert.caBestand };
    const r = await verstuurSmtp(controleerMailEnv(env), { aan: 'klant@voorbeeld.nl', onderwerp: 'Via STARTTLS', tekst: 'ok' });
    assert.equal(r.code, 250);
    const g = s.gesprekken[0];
    assert.deepEqual(g.regels.map((x) => x.split(' ')[0]), ['EHLO', 'STARTTLS', 'EHLO', 'AUTH', 'MAIL', 'RCPT', 'DATA', 'QUIT']);
    assert.ok(g.tls);
    // Zonder vertrouwd certificaat: TLS-fout, niets verstuurd.
    const fout = await verstuurSmtp(controleerMailEnv({ ...env, RC_SMTP_CA: undefined }), { aan: 'klant@voorbeeld.nl', onderwerp: 'x', tekst: 'x' }).catch((e) => e);
    assert.ok(fout instanceof MailFout, String(fout)); assert.equal(s.gesprekken[1].regels.filter((x) => x.startsWith('AUTH')).length, 0);
  } finally { await s.stop(); }
  const zonder = nepSmtp(); const p2 = await zonder.start();
  try {
    const fout = await verstuurSmtp(controleerMailEnv({ RC_SMTP_HOST: '127.0.0.1', RC_SMTP_POORT: String(p2), RC_MAIL_AFZENDER: 'noreply@rankcomet.ai' }), { aan: 'klant@voorbeeld.nl', onderwerp: 'x', tekst: 'x' }).catch((e) => e);
    assert.match(fout.message, /geen STARTTLS/); assert.equal(zonder.gesprekken[0].regels.filter((x) => x.startsWith('MAIL')).length, 0);
  } finally { await zonder.stop(); }
});

test('directe TLS (poort 465-stijl) werkt met een vertrouwd certificaat', async () => {
  const s = nepSmtp({ cert, direct: true }); const poort = await s.start();
  try {
    const r = await verstuurSmtp(controleerMailEnv({ RC_SMTP_HOST: '127.0.0.1', RC_SMTP_POORT: String(poort), RC_SMTP_TLS: 'direct', RC_MAIL_AFZENDER: 'noreply@rankcomet.ai', RC_SMTP_CA: cert.caBestand }), { aan: 'klant@voorbeeld.nl', onderwerp: 'Direct', tekst: 'ok' });
    assert.equal(r.code, 250);
    assert.deepEqual(s.gesprekken[0].regels.map((x) => x.split(' ')[0]), ['EHLO', 'MAIL', 'RCPT', 'DATA', 'QUIT']);
  } finally { await s.stop(); }
});

test('via de app: registreren stuurt de bevestigingsmail echt via SMTP; de log bevat geen adres of wachtwoord', async () => {
  const s = nepSmtp(); const poort = await s.start();
  const db = await nieuweDb(); const logger = maakLogger(db);
  const mailer = maakMailer({ RC_SMTP_HOST: '127.0.0.1', RC_SMTP_POORT: String(poort), RC_SMTP_TLS: 'geen', RC_MAIL_AFZENDER: 'noreply@rankcomet.ai', RC_SMTP_GEBRUIKER: 'relay', RC_SMTP_WACHTWOORD: 'goed' }, logger);
  const server = maakApp({ db, stripe: mockStripe(), mailer, ophalen: async () => { throw new Error('geen internet'); }, model: null, dataforseo: null, google: null, logger, env: TEST_ENV, veiligeCookie: false, grenzen: RUIM });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const basis = `http://127.0.0.1:${server.address().port}`;
  try {
    const r = await post(basis, '/registreren', { email: 'nieuw@voorbeeld.nl', wachtwoord: 'Testwachtwoord-123!' });
    assert.equal(r.status, 303);
    const g = s.gesprekken[0];
    assert.ok(g, 'er is een SMTP-gesprek geweest');
    assert.ok(g.regels.includes('RCPT TO:<nieuw@voorbeeld.nl>'));
    const { koppen, tekst } = decodeer(g.data);
    assert.ok(koppen.some((k) => /^Subject: /.test(k)));
    assert.match(tekst, /https:\/\/rankcomet\.ai\/email-bevestigen\?token=/);
    const log = (await db.query('SELECT bericht FROM logregels')).rows.map((x) => x.bericht).join('\n');
    assert.match(log, /smtp verstuurd antwoord=250/); assert.match(log, /mail verstuurd soort=verificatie/);
    assert.doesNotMatch(log, /voorbeeld\.nl|goed|relay/);
  } finally { await new Promise((ok) => server.close(ok)); await s.stop(); await db.sluit(); }
});
