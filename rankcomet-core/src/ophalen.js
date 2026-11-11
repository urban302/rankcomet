// Veilig ophalen van een pagina op een klantsite (stap 2). Alleen voor de koppelcontrole.
// Regels, in code en niet omzeilbaar:
// - alleen https, standaardpoort, geen gebruikersnaam/wachtwoord in de URL;
// - de hostnaam wordt eerst opgezocht; is één van de adressen intern of privé (localhost, 10/8,
//   192.168/16, 172.16/12, 169.254/16, IPv6 link-local en dergelijke), dan geen verbinding (SSRF);
// - we verbinden met het opgezochte adres zelf (DNS-pinning), met de hostnaam voor TLS en Host,
//   zodat een domein niet tussen opzoeken en verbinden naar een intern adres kan wijzen;
// - korte time-out, maximale grootte, maximaal 3 doorverwijzingen en alleen binnen hetzelfde domein.
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Fout } from './accounts.js';

export const STANDAARD = { timeoutMs: 5000, maxBytes: 512 * 1024, maxDoorverwijzingen: 3 };

// Privé-, lokale en gereserveerde adressen. [A37] Lijst volgens IANA special-purpose registers.
const PRIVE_V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

const v4Getal = (ip) => ip.split('.').reduce((n, d) => n * 256 + Number(d), 0);
const inV4Blok = (ip, [basis, bits]) => bits === 0 || (v4Getal(ip) >>> (32 - bits)) === (v4Getal(basis) >>> (32 - bits));

// IPv6 naar 8 groepen van 16 bits.
function v6Groepen(ip) {
  let [kop, staart = ''] = ip.includes('::') ? ip.split('::') : [ip, null];
  const naarGroepen = (deel) => deel ? deel.split(':').flatMap((g) => {
    if (!g.includes('.')) return [parseInt(g, 16)];
    const n = v4Getal(g); return [n >>> 16, n & 0xffff]; // ingebed IPv4
  }) : [];
  const a = naarGroepen(kop), b = staart === null ? [] : naarGroepen(staart);
  return [...a, ...Array(8 - a.length - b.length).fill(0), ...b];
}

export function isPriveAdres(ip) {
  if (isIP(ip) === 4) return PRIVE_V4.some((blok) => inV4Blok(ip, blok));
  if (isIP(ip) !== 6) return true; // geen geldig adres: niet verbinden
  const g = v6Groepen(ip.replace(/%.*$/, ''));
  const alleNul = (tot) => g.slice(0, tot).every((x) => x === 0);
  if (alleNul(7) && g[7] <= 1) return true;                       // :: en ::1
  if (alleNul(5) && g[5] === 0xffff) return isPriveAdres(`${g[6] >>> 8}.${g[6] & 255}.${g[7] >>> 8}.${g[7] & 255}`); // ::ffff:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPriveAdres(`${g[6] >>> 8}.${g[6] & 255}.${g[7] >>> 8}.${g[7] & 255}`); // 64:ff9b::/96 (NAT64)
  if ((g[0] & 0xfe00) === 0xfc00) return true;                     // fc00::/7 (uniek lokaal)
  if ((g[0] & 0xffc0) === 0xfe80) return true;                     // fe80::/10 (link-local)
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;             // documentatie
  if ((g[0] & 0xff00) === 0xff00) return true;                     // multicast
  return false;
}

// Standaardverbinding: één https-verzoek naar een vast adres. Geeft { status, headers, body (Buffer) }.
// Volgt zelf geen doorverwijzingen; dat doet veiligOphalen, met controle per stap.
function verbindHttps({ adres, hostnaam, pad, methode = 'GET', headers = {}, body = null, timeoutMs, maxBytes }) {
  return new Promise((ok, fout) => {
    const req = httpsRequest({
      host: adres, servername: hostnaam, port: 443, path: pad, method: methode, timeout: timeoutMs,
      headers: { accept: 'text/html, application/json', 'user-agent': 'Rankcomet/1 (+https://rankcomet.ai/over)', ...headers, host: hostnaam, ...(body ? { 'content-length': Buffer.byteLength(body) } : {}) },
    }, (res) => {
      const delen = []; let n = 0;
      res.on('data', (d) => {
        n += d.length;
        if (n > maxBytes) { req.destroy(new Fout('De pagina is te groot om te controleren (maximaal 512 kB).', 400)); return; }
        delen.push(d);
      });
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: Buffer.concat(delen) }));
    });
    req.on('timeout', () => req.destroy(new Fout('Je site reageerde niet binnen 5 seconden.', 400)));
    req.on('error', (e) => fout(e instanceof Fout ? e : new Fout('We konden geen veilige verbinding maken met je site.', 400, { oorzaak: e.code })));
    req.end(body);
  });
}

// Maakt een ophaler. In tests worden lookup en verbind vervangen door nepversies.
export function maakOphaler({ lookup = (h) => dnsLookup(h, { all: true }), verbind = verbindHttps, ...opties } = {}) {
  const o = { ...STANDAARD, ...opties };

  // Controleert de URL en zoekt de hostnaam op. Geeft { url, adres }.
  async function controleer(urlTekst, domein) {
    let url;
    try { url = new URL(urlTekst); } catch { throw new Fout('Dit adres klopt niet.', 400); }
    if (url.protocol !== 'https:') throw new Fout('We controleren alleen via https. Zorg dat je site een werkend https-adres heeft.', 400);
    if (url.port && url.port !== '443') throw new Fout('We controleren alleen op de standaardpoort (443).', 400);
    if (url.username || url.password) throw new Fout('Dit adres klopt niet.', 400);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (isIP(host)) throw new Fout('Vul een domeinnaam in, geen IP-adres.', 400);
    if (host !== domein && !host.endsWith('.' + domein)) throw new Fout(`Je site verwijst door naar ${host}. Dat hoort niet bij ${domein}, dus daar kijken we niet.`, 400);
    let adressen;
    try { adressen = await lookup(host); } catch { throw new Fout(`We konden ${host} niet vinden. Klopt de domeinnaam?`, 400); }
    if (!adressen.length) throw new Fout(`We konden ${host} niet vinden. Klopt de domeinnaam?`, 400);
    if (adressen.some((a) => isPriveAdres(a.address))) throw new Fout(`${host} wijst naar een intern adres. Daar maken we geen verbinding mee.`, 400);
    return { url, host, adres: adressen[0].address };
  }

  // Haalt een pagina op. `domein` is het domein waar alles binnen moet blijven (ook na doorverwijzen).
  // Met een methode anders dan GET (de plugin) volgen we geen doorverwijzingen: de handtekening hoort bij
  // precies dit pad, en een POST die ergens anders terechtkomt willen we niet.
  return async function veiligOphalen(urlTekst, domein, { methode = 'GET', headers = {}, body = null } = {}) {
    let huidig = urlTekst;
    for (let stap = 0; ; stap++) {
      const { url, host, adres } = await controleer(huidig, domein);
      const r = await verbind({ adres, hostnaam: host, pad: url.pathname + url.search, methode, headers, body, timeoutMs: o.timeoutMs, maxBytes: o.maxBytes });
      if (methode === 'GET' && [301, 302, 303, 307, 308].includes(r.status) && r.headers.location) {
        if (stap >= o.maxDoorverwijzingen) throw new Fout('Je site verwijst te vaak door. We stoppen na 3 keer.', 400);
        huidig = new URL(r.headers.location, url).href;
        continue;
      }
      return { status: r.status, url: url.href, headers: r.headers, body: r.body.toString('utf8') };
    }
  };
}
