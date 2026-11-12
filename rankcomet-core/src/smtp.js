// Mailer (stap 13): een kleine SMTP-client op node:net en node:tls, geen extra pakket.
// Werkt met elke SMTP-relay of mailprovider in de EU en met een lokale Postfix.
// Regels in code:
// - Altijd TLS: poort 465 is directe TLS, anders STARTTLS. Zonder TLS alleen naar 127.0.0.1/localhost (A78).
// - Het wachtwoord gaat alleen over de versleutelde verbinding (AUTH PLAIN na STARTTLS).
// - Adressen en onderwerpen met een regeleinde worden geweigerd (geen header-injectie).
// - In fouten en logs staat nooit een adres, wachtwoord of mailtekst; alleen het SMTP-antwoordnummer.
import net from 'node:net';
import tls from 'node:tls';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const LOKAAL = new Set(['127.0.0.1', 'localhost', '::1']);
const TIJDSLIMIET_MS = 20 * 1000;

export class MailFout extends Error {
  constructor(bericht, code = null) { super(bericht); this.name = 'MailFout'; this.code = code; }
}

// Controle bij de start. Zonder RC_SMTP_HOST is er geen mailer; met host zijn afzender (en bij een gebruiker
// het wachtwoord) verplicht.
export function controleerMailEnv(env = process.env) {
  if (!env.RC_SMTP_HOST) return null;
  const host = String(env.RC_SMTP_HOST).trim();
  const poort = Number(env.RC_SMTP_POORT || 587);
  if (!Number.isInteger(poort) || poort < 1 || poort > 65535) throw new Error('RC_SMTP_POORT is geen geldige poort');
  const afzender = String(env.RC_MAIL_AFZENDER || '').trim();
  if (!geldigAdres(afzender)) throw new Error('RC_MAIL_AFZENDER ontbreekt of is geen geldig adres');
  if (env.RC_SMTP_GEBRUIKER && !env.RC_SMTP_WACHTWOORD) throw new Error('RC_SMTP_WACHTWOORD ontbreekt');
  const tlsModus = env.RC_SMTP_TLS || (poort === 465 ? 'direct' : 'starttls');
  if (!['direct', 'starttls', 'geen'].includes(tlsModus)) throw new Error('RC_SMTP_TLS moet direct, starttls of geen zijn');
  if (tlsModus === 'geen' && !LOKAAL.has(host)) throw new Error('RC_SMTP_TLS=geen mag alleen naar 127.0.0.1 of localhost');
  const ca = env.RC_SMTP_CA ? readFileSync(env.RC_SMTP_CA, 'utf8') : undefined;
  return { host, poort, afzender, afzenderNaam: String(env.RC_MAIL_AFZENDER_NAAM || 'Rankcomet').trim(), gebruiker: env.RC_SMTP_GEBRUIKER || null, wachtwoord: env.RC_SMTP_WACHTWOORD || null, tlsModus, ca, ehloNaam: env.RC_SMTP_EHLO || 'app.rankcomet.ai' };
}

export const geldigAdres = (a) => typeof a === 'string' && a.length <= 254 && /^[^\s@<>,;"'()\\]+@[^\s@<>,;"'()\\]+\.[^\s@<>,;"'()\\]+$/.test(a);
const geenRegeleinde = (s) => !/[\r\n]/.test(s);
const kop = (naam, waarde) => `${naam}: ${waarde}`;
// Onderwerp en namen met tekens buiten ASCII gaan als RFC 2047 (UTF-8, base64).
const woord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const base64Regels = (tekst) => Buffer.from(tekst, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');

export function bouwBericht({ van, vanNaam, aan, onderwerp, tekst, datum = new Date(), id = randomBytes(12).toString('hex') }) {
  if (!geldigAdres(aan) || !geldigAdres(van)) throw new MailFout('Ongeldig e-mailadres.');
  if (!geenRegeleinde(onderwerp) || !geenRegeleinde(vanNaam || '')) throw new MailFout('Ongeldig onderwerp.');
  const regels = [
    kop('From', vanNaam ? `${woord(vanNaam)} <${van}>` : van),
    kop('To', aan),
    kop('Subject', woord(onderwerp)),
    kop('Date', datum.toUTCString()),
    kop('Message-ID', `<${id}@${van.split('@')[1]}>`),
    kop('MIME-Version', '1.0'),
    kop('Content-Type', 'text/plain; charset=utf-8'),
    kop('Content-Transfer-Encoding', 'base64'),
    kop('Auto-Submitted', 'auto-generated'),
    '',
    base64Regels(tekst),
  ];
  return regels.join('\r\n') + '\r\n';
}

// Eén SMTP-gesprek. Alles sequentieel; een antwoord is compleet als de laatste regel "250 " heeft (geen streepje).
function gesprek(socket) {
  let buffer = '', wachter = null;
  const antwoorden = [];
  const verwerk = () => {
    for (;;) {
      const eind = buffer.indexOf('\r\n');
      if (eind < 0) return;
      const regel = buffer.slice(0, eind); buffer = buffer.slice(eind + 2);
      antwoorden.push(regel);
      if (/^\d{3} /.test(regel) || !/^\d{3}-/.test(regel)) {
        const alles = antwoorden.splice(0); const code = Number(alles.at(-1).slice(0, 3));
        if (wachter) { const w = wachter; wachter = null; w.ok({ code, regels: alles }); }
      }
    }
  };
  socket.on('data', (d) => { buffer += d.toString('utf8'); verwerk(); });
  socket.on('error', (e) => { if (wachter) { const w = wachter; wachter = null; w.fout(new MailFout(`Verbinding met de mailserver mislukt (${e.code || e.name}).`)); } });
  socket.on('close', () => { if (wachter) { const w = wachter; wachter = null; w.fout(new MailFout('De mailserver verbrak de verbinding.')); } });
  const lees = () => new Promise((ok, fout) => { wachter = { ok, fout }; verwerk(); });
  const zeg = (regel) => { socket.write(regel + '\r\n'); return lees(); };
  return { lees, zeg, vervang(nieuw) { socket = nieuw; buffer = ''; socket.on('data', (d) => { buffer += d.toString('utf8'); verwerk(); }); socket.on('error', (e) => { if (wachter) { const w = wachter; wachter = null; w.fout(new MailFout(`TLS naar de mailserver mislukt (${e.code || e.name}).`)); } }); } };
}

const verwacht = (antwoord, codes, stap) => { if (!codes.includes(antwoord.code)) throw new MailFout(`De mailserver weigerde (${stap}, antwoord ${antwoord.code}).`, antwoord.code); return antwoord; };

export async function verstuurSmtp(instellingen, { aan, onderwerp, tekst }, { timeoutMs = TIJDSLIMIET_MS } = {}) {
  const { host, poort, afzender, afzenderNaam, gebruiker, wachtwoord, tlsModus, ca, ehloNaam } = instellingen;
  if (!geldigAdres(aan)) throw new MailFout('Ongeldig e-mailadres.');
  const bericht = bouwBericht({ van: afzender, vanNaam: afzenderNaam, aan, onderwerp, tekst });
  const tlsOpties = { host, servername: host, ca: ca ? [ca] : undefined, minVersion: 'TLSv1.2' };
  let socket = tlsModus === 'direct' ? tls.connect({ port: poort, ...tlsOpties }) : net.connect({ host, port: poort });
  socket.setTimeout(timeoutMs, () => socket.destroy(new Error('ETIMEDOUT')));
  const g = gesprek(socket);
  try {
    verwacht(await g.lees(), [220], 'begroeting');
    let ehlo = verwacht(await g.zeg(`EHLO ${ehloNaam}`), [250], 'EHLO');
    if (tlsModus === 'starttls') {
      if (!ehlo.regels.some((r) => /STARTTLS/i.test(r))) throw new MailFout('De mailserver biedt geen STARTTLS; zonder TLS versturen we niet.');
      verwacht(await g.zeg('STARTTLS'), [220], 'STARTTLS');
      socket = await new Promise((ok, fout) => { const s = tls.connect({ socket, ...tlsOpties }, () => ok(s)); s.once('error', (e) => fout(new MailFout(`TLS naar de mailserver mislukt (${e.code || e.name}).`))); });
      socket.setTimeout(timeoutMs, () => socket.destroy(new Error('ETIMEDOUT')));
      g.vervang(socket);
      ehlo = verwacht(await g.zeg(`EHLO ${ehloNaam}`), [250], 'EHLO');
    }
    if (gebruiker) {
      if (tlsModus === 'geen' && !LOKAAL.has(host)) throw new MailFout('Geen wachtwoord zonder TLS.');
      const plain = Buffer.from(`\0${gebruiker}\0${wachtwoord}`, 'utf8').toString('base64');
      verwacht(await g.zeg(`AUTH PLAIN ${plain}`), [235], 'aanmelden');
    }
    verwacht(await g.zeg(`MAIL FROM:<${afzender}>`), [250], 'afzender');
    verwacht(await g.zeg(`RCPT TO:<${aan}>`), [250, 251], 'ontvanger');
    verwacht(await g.zeg('DATA'), [354], 'DATA');
    const klaar = verwacht(await g.zeg(bericht + '.'), [250], 'bericht');
    await g.zeg('QUIT').catch(() => {});
    return { code: klaar.code };
  } finally {
    socket.destroy();
  }
}

// De mailer voor de app: { stuur({ aan, onderwerp, tekst }) }. Zonder RC_SMTP_HOST een stub die netjes faalt.
export function maakMailer(env = process.env, logger = null) {
  const instellingen = controleerMailEnv(env);
  if (!instellingen) return { gekoppeld: false, stuur: async () => { throw new MailFout('Mail is nog niet gekoppeld (RC_SMTP_HOST ontbreekt).'); } };
  return {
    gekoppeld: true,
    async stuur(m) {
      try { const r = await verstuurSmtp(instellingen, m); await logger?.log('info', `smtp verstuurd antwoord=${r.code}`); return r; }
      catch (e) { await logger?.log('fout', `smtp mislukt ${e.name}${e.code ? ' antwoord=' + e.code : ''}`); throw e; }
    },
  };
}
