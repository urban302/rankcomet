// HTTP-app (node:http, geen framework) met de NL-basis-UI: inloggen, dashboard-shell, site toevoegen,
// pakketten, Stripe-checkout (testmodus) en webhook. Afhankelijkheden worden geïnjecteerd.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as acc from './accounts.js';
import * as sites from './sites.js';
import { laadMerk, laadPakketten } from './config.js';
import { prijsTekst } from './pakketten.js';
import { maakCheckout, verwerkWebhook } from './stripe.js';
import { maakBegrenzer, STANDAARD_GRENZEN } from './grens.js';
import { verificatieMail, herstelMail } from './mail.js';
import * as wijz from './wijzigingen.js';
import { schrijfArtikel } from './pijplijn.js';
import * as zw from './zoekwoorden.js';
import * as pos from './posities.js';
import * as gsc from './gsc.js';
import { lijstArtikelen, artikelenOverzicht, huidigeMaand } from './artikelen.js';
import { laadSleutel } from './geheimen.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Eén stylesheet, zelf gehost (public/stijl.css). Geen inline stijl of script: de CSP staat dat niet toe.
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const STIJL = readFileSync(path.join(PUBLIC, 'stijl.css'), 'utf8');
// Privacyverklaring (concept) als html-fragment, openbaar op /privacy. Google eist die URL voor de Search Console-koppeling.
const PRIVACY = readFileSync(path.join(PUBLIC, 'privacy.html'), 'utf8');
export const CSP = "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

function pagina(titel, inhoud, account) {
  const m = laadMerk();
  const nav = account
    ? `<nav><a href="/dashboard">Dashboard</a> <a href="/wijzigingen">Wacht op jou</a> <a href="/sites/nieuw">Site toevoegen</a> <a href="/pakketten">Pakketten</a> <a href="/over">Over</a> <form method="post" action="/uitloggen"><button class="rustig">Uitloggen</button></form></nav>`
    : `<nav><a href="/inloggen">Inloggen</a> <a href="/registreren">Account aanmaken</a> <a href="/over">Over</a></nav>`;
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titel)} · ${esc(m.merk)}</title><link rel="stylesheet" href="/stijl.css"></head><body><header class="kop"><div class="binnen"><a class="merk" href="/">${esc(m.merk)}</a>${nav}</div></header><main><h1>${esc(titel)}</h1>${inhoud}</main><footer><small>${esc(m.merk)} · ${esc(m.domein)} · <a href="/over">Over en licenties</a> · <a href="/privacy">Privacy</a></small></footer></body></html>`;
}

function leesBody(req, max = 1024 * 1024) {
  return new Promise((ok, fout) => {
    const delen = []; let n = 0;
    req.on('data', (d) => { n += d.length; if (n > max) { fout(new acc.Fout('Verzoek te groot.', 413)); req.destroy(); } else delen.push(d); });
    req.on('end', () => ok(Buffer.concat(delen).toString('utf8')));
    req.on('error', fout);
  });
}

const formulier = (t) => Object.fromEntries(new URLSearchParams(t));
const cookie = (req, naam) => { const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${naam}=([^;]+)`)); return m ? decodeURIComponent(m[1]) : null; };

export function maakApp({ db, stripe, mailer, ophalen, model, dataforseo, google, logger, env = process.env, veiligeCookie = true, grenzen = STANDAARD_GRENZEN }) {
  const COOKIE = 'rc_sessie';
  const ctx = { ophalen, model, dataforseo, google, logger, geheimenSleutel: laadSleutel(env) }; // voor de plugin: veilige ophaler en de sleutel om pluginsleutels te ontsleutelen
  const begrenzer = maakBegrenzer(grenzen);
  // [A33] Achter de reverse proxy komt elk verzoek van 127.0.0.1. Met RC_VERTROUW_PROXY=1 gebruiken we het
  // laatste adres uit X-Forwarded-For (dat zet onze eigen proxy). Zonder die instelling negeren we de header,
  // want een bezoeker kan hem zelf invullen.
  const ipVan = (req) => {
    if (env.RC_VERTROUW_PROXY === '1') { const x = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim(); if (x) return x; }
    return req.socket.remoteAddress || 'onbekend';
  };
  const teVeel = async (res, soort, seconden, titel) => {
    await logger.log('info', `te veel pogingen soort=${soort}`);
    const minuten = Math.max(1, Math.ceil(seconden / 60));
    return stuur(res, 429, pagina(titel, `<p role="alert">Te veel pogingen. Probeer het over ${minuten} ${minuten === 1 ? 'minuut' : 'minuten'} opnieuw.</p>`), { 'retry-after': String(seconden) });
  };
  // Mail sturen mag mislukken zonder dat de rest misgaat. We loggen alleen de soort en het fouttype.
  const mail = async (soort, aan, inhoud, accountId) => {
    try { await mailer.stuur({ aan, ...inhoud }); await logger.log('info', `mail verstuurd soort=${soort} account=${accountId}`); return true; }
    catch (e) { await logger.log('fout', `mail mislukt soort=${soort} account=${accountId} ${e.name}`); return false; }
  };
  const zetCookie = (res, w, maxAge) => res.setHeader('set-cookie', `${COOKIE}=${w}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${veiligeCookie ? '; Secure' : ''}`);
  const stuur = (res, status, html, kop = {}) => { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin', ...kop }); res.end(html); };
  const json = (res, status, o) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  const naar = (res, w) => { res.writeHead(303, { location: w }); res.end(); };

  async function afhandelen(req, res) {
    const url = new URL(req.url, 'http://lokaal');
    const pad = url.pathname, m = req.method;
    // Webhook eerst: ruwe body nodig voor de handtekening, geen sessie.
    if (m === 'POST' && pad === '/stripe/webhook') {
      const r = await verwerkWebhook(db, await leesBody(req), req.headers['stripe-signature'], env.RC_STRIPE_WEBHOOK_SECRET, logger);
      return json(res, r.status, { ontvangen: r.status === 200 });
    }
    // CSRF: POST alleen van dezelfde origin (naast SameSite=Strict).
    if (m === 'POST') {
      const o = req.headers.origin;
      if (o && o !== `http://${req.headers.host}` && o !== `https://${req.headers.host}`) return stuur(res, 403, pagina('Geweigerd', '<p>Dit verzoek is geweigerd.</p>'));
    }
    const token = cookie(req, COOKIE);
    const account = await acc.accountVoorSessie(db, token);

    if (m === 'GET' && pad === '/stijl.css') { res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff' }); return res.end(STIJL); }
    if (m === 'GET' && pad === '/') return naar(res, account ? '/dashboard' : '/inloggen');
    if (m === 'GET' && pad === '/over') return stuur(res, 200, pagina('Over Rankcomet', `<p>Rankcomet.ai helpt u met SEO-content voor WordPress en WooCommerce.</p><h2>Licenties</h2><p>Rankcomet is gebouwd op <a href="https://github.com/every-app/open-seo">OpenSEO</a>, uitgegeven onder de MIT-licentie. Copyright (c) 2026 Ben Senescu. De volledige licentietekst staat in het bestand LICENSE in de broncode.</p>`, account));
    if (m === 'GET' && pad === '/privacy') return stuur(res, 200, pagina('Privacyverklaring', PRIVACY, account));
    if (m === 'GET' && pad === '/inloggen') return stuur(res, 200, pagina('Inloggen', inlogForm('/inloggen', 'Inloggen', url.searchParams.get('fout'))));
    if (m === 'GET' && pad === '/registreren') return stuur(res, 200, pagina('Account aanmaken', inlogForm('/registreren', 'Account aanmaken', url.searchParams.get('fout'))));
    if (m === 'POST' && (pad === '/inloggen' || pad === '/registreren')) {
      const f = formulier(await leesBody(req));
      const titel = pad === '/inloggen' ? 'Inloggen' : 'Account aanmaken';
      const email = acc.normaliseerEmail(f.email), ip = ipVan(req);
      const paren = pad === '/inloggen' ? [['login_ip', ip], ['login_email', email]] : [['registreren_ip', ip], ['registreren_email', email]];
      const wacht = begrenzer.wachttijd(paren);
      if (wacht) return teVeel(res, pad.slice(1), wacht, titel);
      // Aanmelden telt elke poging; inloggen alleen mislukte pogingen (zie hieronder).
      if (pad === '/registreren') begrenzer.tel(paren);
      try {
        if (pad === '/registreren') {
          const nieuw = await acc.registreer(db, f.email, f.wachtwoord);
          await mail('verificatie', nieuw.email, verificatieMail(await acc.maakVerificatieToken(db, nieuw.id)), nieuw.id);
        }
        const s = await acc.login(db, f.email, f.wachtwoord);
        zetCookie(res, s.token, 7 * 86400);
        await logger.log('info', `inloggen gelukt account=${s.accountId}`);
        return naar(res, '/dashboard');
      } catch (e) {
        if (!(e instanceof acc.Fout)) throw e;
        await logger.log('info', `inloggen mislukt status=${e.status}`);
        if (pad === '/inloggen') begrenzer.tel(paren);
        return stuur(res, e.status, pagina(titel, inlogForm(pad, titel, e.message)));
      }
    }
    if (m === 'GET' && pad === '/wachtwoord-vergeten') return stuur(res, 200, pagina('Wachtwoord vergeten', vergetenForm()));
    if (m === 'POST' && pad === '/wachtwoord-vergeten') {
      const email = acc.normaliseerEmail(formulier(await leesBody(req)).email);
      const paren = [['herstel_ip', ipVan(req)], ['herstel_email', email]];
      const wacht = begrenzer.wachttijd(paren);
      if (wacht) return teVeel(res, 'herstel', wacht, 'Wachtwoord vergeten');
      begrenzer.tel(paren);
      const r = await acc.wachtwoordVergeten(db, email);
      if (r) await mail('herstel', r.email, herstelMail(r.token), r.accountId);
      // Altijd hetzelfde antwoord, zodat niemand kan uitzoeken welke e-mailadressen een account hebben.
      return stuur(res, 200, pagina('Kijk in je mail', '<p>Hoort er een account bij dit e-mailadres? Dan krijg je binnen een paar minuten een mail met een link. Met die link kies je een nieuw wachtwoord. De link werkt een uur.</p><p>Geen mail gekregen? Kijk ook in je map met ongewenste mail.</p>'));
    }
    if (m === 'GET' && pad === '/wachtwoord-herstellen') return stuur(res, 200, pagina('Nieuw wachtwoord kiezen', herstelForm(url.searchParams.get('token'))));
    if (m === 'POST' && pad === '/wachtwoord-herstellen') {
      const f = formulier(await leesBody(req));
      try {
        await acc.herstelWachtwoord(db, f.token, f.wachtwoord);
        zetCookie(res, '', 0);
        return stuur(res, 200, pagina('Wachtwoord gewijzigd', '<p>Je wachtwoord is gewijzigd. Je bent overal uitgelogd.</p><p><a href="/inloggen">Log in met je nieuwe wachtwoord</a></p>'));
      } catch (e) {
        if (!(e instanceof acc.Fout)) throw e;
        const inhoud = e.linkOngeldig ? `<p role="alert">${esc(e.message)}</p><p><a href="/wachtwoord-vergeten">Nieuwe link aanvragen</a></p>` : herstelForm(f.token, e.message);
        return stuur(res, e.status, pagina('Nieuw wachtwoord kiezen', inhoud));
      }
    }
    // De link in de mail opent een pagina met een knop. Pas de knop bevestigt, zodat een virusscanner
    // die de link alvast opent het token niet opmaakt.
    if (m === 'GET' && pad === '/email-bevestigen') {
      return stuur(res, 200, pagina('E-mailadres bevestigen', `<form method="post" action="/email-bevestigen"><input type="hidden" name="token" value="${esc(url.searchParams.get('token'))}"><button>Bevestig mijn e-mailadres</button></form>`, account));
    }
    if (m === 'POST' && pad === '/email-bevestigen') {
      try {
        await acc.bevestigEmail(db, formulier(await leesBody(req)).token);
        return stuur(res, 200, pagina('E-mailadres bevestigd', `<p>Je e-mailadres is bevestigd. Je kunt nu je site koppelen.</p><p><a href="${account ? '/sites/nieuw' : '/inloggen'}">${account ? 'Site toevoegen' : 'Inloggen'}</a></p>`, account));
      } catch (e) {
        if (!(e instanceof acc.Fout)) throw e;
        return stuur(res, e.status, pagina('E-mailadres bevestigen', `<p role="alert">${esc(e.message)}</p>`, account));
      }
    }
    if (!account) {
      if (pad.startsWith('/api/')) return json(res, 401, { fout: 'Log eerst in.' });
      return naar(res, '/inloggen');
    }
    if (m === 'POST' && pad === '/uitloggen') { await acc.logout(db, token); zetCookie(res, '', 0); return naar(res, '/inloggen'); }
    if (m === 'POST' && pad === '/email-bevestigen/opnieuw') {
      if (account.geverifieerd) return naar(res, '/dashboard');
      const wacht = begrenzer.wachttijd([['opnieuw_account', account.id]]);
      if (wacht) return teVeel(res, 'opnieuw', wacht, 'E-mailadres bevestigen');
      begrenzer.tel([['opnieuw_account', account.id]]);
      const ok = await mail('verificatie', account.email, verificatieMail(await acc.maakVerificatieToken(db, account.id)), account.id);
      return stuur(res, ok ? 200 : 503, pagina('E-mailadres bevestigen', ok ? '<p>We hebben je een nieuwe mail gestuurd. Klik op de link in die mail.</p>' : '<p role="alert">Het versturen van de mail lukte niet. Probeer het later opnieuw.</p>', account));
    }
    if (m === 'GET' && pad === '/dashboard') {
      const [lijst, alles, overzicht, posities, searchConsole] = await Promise.all([sites.lijstSites(db, account.id), wijz.lijst(db, account.id), artikelenOverzicht(db, account), pos.samenvatting(db, account.id), gsc.samenvatting(db, account.id)]);
      const pk = laadPakketten().pakketten[account.pakket];
      const melding = url.searchParams.get('m');
      return stuur(res, 200, pagina('Dashboard', dashboard({ account, pk, sites: lijst, wijzigingen: alles, overzicht, posities, searchConsole, melding }), account));
    }
    if (m === 'GET' && pad === '/api/sites') return json(res, 200, { sites: await sites.lijstSites(db, account.id) });
    if (m === 'GET' && pad.startsWith('/api/sites/')) {
      const s = await sites.haalSite(db, account.id, pad.slice('/api/sites/'.length));
      return s ? json(res, 200, s) : json(res, 404, { fout: 'Site niet gevonden.' });
    }
    if (m === 'GET' && pad === '/sites/nieuw') return stuur(res, 200, pagina('Site toevoegen', account.geverifieerd ? siteForm() : bevestigMelding(), account));
    if (m === 'POST' && pad === '/sites/nieuw') {
      const f = formulier(await leesBody(req));
      try {
        const r = await sites.voegSiteToe(db, account, f);
        if (r.wachtlijst) return stuur(res, 200, pagina('Op de wachtlijst', `<p>${esc(r.bericht)}</p>`, account));
        return naar(res, `/sites/${r.site.id}/koppelen`);
      } catch (e) {
        if (!(e instanceof acc.Fout)) throw e;
        if (e.onbevestigd) return stuur(res, e.status, pagina('Site toevoegen', bevestigMelding(), account));
        const up = e.upgrade ? `<p><a href="/pakketten">Bekijk de pakketten en upgrade</a></p>` : '';
        return stuur(res, e.status, pagina('Site toevoegen', `<p role="alert">${esc(e.message)}</p>${up}${siteForm()}`, account));
      }
    }
    // Stap 2: koppelcode tonen en controleren. Alleen voor een site van dit account (anders 404).
    const koppel = pad.match(/^\/sites\/([^/]+)\/koppelen(\/controleer)?$/);
    if (koppel) {
      const siteId = koppel[1];
      let info;
      try { info = await sites.koppelcodeVoor(db, account.id, siteId); }
      catch (e) { if (!(e instanceof acc.Fout)) throw e; return stuur(res, e.status, pagina('Niet gevonden', '<p>Deze site bestaat niet.</p>', account)); }
      if (m === 'GET' && !koppel[2]) return stuur(res, 200, pagina(`${info.domein} koppelen`, koppelPagina(info, siteId), account));
      if (m === 'POST' && koppel[2]) {
        const wacht = begrenzer.wachttijd([['koppelcontrole_site', siteId]]);
        if (wacht) return teVeel(res, 'koppelcontrole', wacht, `${info.domein} koppelen`);
        begrenzer.tel([['koppelcontrole_site', siteId]]);
        try {
          await sites.controleerEigendom(db, account.id, siteId, ophalen);
          await logger.log('info', `site gekoppeld account=${account.id} site=${siteId}`);
          return stuur(res, 200, pagina('Site gekoppeld', `<p>Gelukt. ${esc(info.domein)} is nu gekoppeld aan je account.</p><p><a href="/dashboard">Naar je dashboard</a></p>`, account));
        } catch (e) {
          if (!(e instanceof acc.Fout)) throw e;
          await logger.log('info', `koppelcontrole mislukt account=${account.id} site=${siteId} status=${e.status}${e.oorzaak ? ' oorzaak=' + e.oorzaak : ''}`);
          return stuur(res, e.status, pagina(`${info.domein} koppelen`, koppelPagina(info, siteId, e.message), account));
        }
      }
    }
    // Stap 3: pluginsleutel per site. De sleutel is één keer zichtbaar, daarna alleen versleuteld opgeslagen.
    const plugin = pad.match(/^\/sites\/([^/]+)\/plugin(\/sleutel)?$/);
    if (plugin) {
      const siteId = plugin[1];
      const site = await sites.haalSite(db, account.id, siteId);
      if (!site) return stuur(res, 404, pagina('Niet gevonden', '<p>Deze site bestaat niet.</p>', account));
      if (m === 'GET' && !plugin[2]) {
        const info = await sites.koppelcodeVoor(db, account.id, siteId);
        return stuur(res, 200, pagina(`Plugin voor ${site.domein}`, pluginPagina(site, info), account));
      }
      if (m === 'POST' && plugin[2]) {
        const sleutel = await wijz.maakPluginSleutel(db, ctx.geheimenSleutel, account.id, siteId);
        await logger.log('info', `pluginsleutel gemaakt account=${account.id} site=${siteId}`);
        return stuur(res, 200, pagina(`Plugin voor ${site.domein}`, `<p>Dit is je nieuwe sleutel. Kopieer hem nu, we laten hem maar één keer zien.</p><pre><code>${esc(sleutel)}</code></pre><p>Plak de sleutel in WordPress bij Instellingen, Rankcomet. Een oude sleutel werkt vanaf nu niet meer.</p><p><a href="/sites/${esc(siteId)}/plugin">Terug</a></p>`, account));
      }
    }
    // Stap 8: Search Console. Google stuurt de klant terug naar /google/terug; de state hoort bij dit account.
    if (m === 'GET' && pad === '/google/terug') {
      try {
        const r = await gsc.terug(db, ctx, account, { code: url.searchParams.get('code'), state: url.searchParams.get('state'), error: url.searchParams.get('error') });
        return naar(res, `/sites/${r.siteId}/search-console`);
      } catch (e) {
        if (!(e instanceof acc.Fout)) throw e;
        return stuur(res, e.status, pagina('Search Console koppelen', `<p role="alert">${esc(e.message)}</p><p><a href="/dashboard">Naar je dashboard</a></p>`, account));
      }
    }
    const gm = pad.match(/^\/sites\/([^/]+)\/search-console(?:\/(start|property|ververs|verbreken))?$/);
    if (gm) {
      const [, siteId, actie] = gm;
      const site = await sites.haalSite(db, account.id, siteId);
      if (!site) return stuur(res, 404, pagina('Niet gevonden', '<p>Deze site bestaat niet.</p>', account));
      const toon = async (status = 200, fout = null) => {
        const k = await gsc.koppeling(db, account.id, siteId);
        let properties = [];
        if (k && k.status === 'property_kiezen') { try { properties = await gsc.propertiesVoor(db, ctx, account, siteId); } catch (e) { if (!(e instanceof acc.Fout)) throw e; fout = fout || e.message; } }
        return stuur(res, status, pagina(`Search Console voor ${site.domein}`, searchConsolePagina(site, k, properties, ctx.google.beschikbaar, url.searchParams.get('m'), fout), account));
      };
      if (m === 'GET' && !actie) return toon();
      if (m === 'POST' && actie) {
        const f = formulier(await leesBody(req));
        try {
          if (actie === 'start') return naar(res, await gsc.start(db, ctx, account, siteId));
          let melding;
          if (actie === 'property') { const r = await gsc.kiesProperty(db, ctx, account, siteId, f.property); melding = `Gekoppeld. ${r.paginas} pagina's met cijfers opgehaald.`; }
          else if (actie === 'ververs') { const r = await gsc.ververs(db, ctx, account, siteId, { forceer: true }); melding = `${r.paginas} pagina's met cijfers opgehaald.`; }
          else { await gsc.verbreek(db, ctx, account, siteId); melding = 'De koppeling is verbroken en de Google-gegevens zijn verwijderd.'; }
          return naar(res, `/sites/${siteId}/search-console?m=${encodeURIComponent(melding)}`);
        } catch (e) {
          if (!(e instanceof acc.Fout)) throw e;
          return toon(e.status, e.message);
        }
      }
    }
    // Stap 6: zoekwoorden per site: onderzoeken, volgen, zelf toevoegen.
    const zm = pad.match(/^\/sites\/([^/]+)\/zoekwoorden(?:\/(onderzoek|toevoegen|volgen|ontvolgen|controleren))?$/);
    if (zm) {
      const [, siteId, actie] = zm;
      const site = await sites.haalSite(db, account.id, siteId);
      if (!site) return stuur(res, 404, pagina('Niet gevonden', '<p>Deze site bestaat niet.</p>', account));
      const toon = async (status = 200, fout = null) => stuur(res, status, pagina(`Zoekwoorden voor ${site.domein}`, zoekwoordenPagina(site, await zw.lijst(db, account.id, siteId), laadPakketten().pakketten[account.pakket], url.searchParams.get('m'), fout, await pos.overzicht(db, account.id, siteId)), account));
      if (m === 'GET' && !actie) return toon();
      if (m === 'POST' && actie) {
        const f = formulier(await leesBody(req));
        try {
          if (actie === 'onderzoek' || actie === 'toevoegen') {
            const wacht = begrenzer.wachttijd([['zoekwoorden_account', account.id]]);
            if (wacht) return teVeel(res, 'zoekwoorden', wacht, `Zoekwoorden voor ${site.domein}`);
            begrenzer.tel([['zoekwoorden_account', account.id]]);
          }
          let melding;
          if (actie === 'onderzoek') { const r = await zw.onderzoek(db, ctx, account, siteId, { startwoord: f.startwoord }); melding = `${r.aantal} ideeën gevonden bij "${f.startwoord}".`; }
          else if (actie === 'toevoegen') { await zw.voegToe(db, ctx, account, siteId, { zoekwoord: f.zoekwoord }); melding = `"${f.zoekwoord}" toegevoegd en gevolgd.`; }
          else if (actie === 'volgen') { await zw.volg(db, account, siteId, f.id); melding = 'Je volgt dit zoekwoord nu.'; }
          else if (actie === 'controleren') { const r = await pos.controleer(db, ctx, account, siteId); melding = r.gedaan ? `${r.gedaan} ${r.gedaan === 1 ? 'positie' : 'posities'} gecontroleerd.` : r.overgeslagen ? 'De posities van vandaag waren al gecontroleerd. Morgen kijken we opnieuw.' : 'Je volgt nog geen zoekwoorden.'; }
          else { await zw.ontvolg(db, account, siteId, f.id); melding = 'Je volgt dit zoekwoord niet meer.'; }
          return naar(res, `/sites/${siteId}/zoekwoorden?m=${encodeURIComponent(melding)}`);
        } catch (e) {
          if (!(e instanceof acc.Fout)) throw e;
          return toon(e.status, e.message);
        }
      }
    }
    // Stap 4: siteprofiel en een artikel laten schrijven.
    const sp = pad.match(/^\/sites\/([^/]+)\/(profiel|artikel)$/);
    if (sp) {
      const [, siteId, wat] = sp;
      const site = await sites.haalSite(db, account.id, siteId);
      if (!site) return stuur(res, 404, pagina('Niet gevonden', '<p>Deze site bestaat niet.</p>', account));
      if (wat === 'profiel') {
        if (m === 'GET') return stuur(res, 200, pagina(`Profiel van ${site.domein}`, profielForm(site, await sites.haalProfiel(db, account.id, siteId), url.searchParams.get('ok') ? 'Opgeslagen.' : null), account));
        if (m === 'POST') {
          try { await sites.bewaarProfiel(db, account.id, siteId, formulier(await leesBody(req))); return naar(res, `/sites/${siteId}/profiel?ok=1`); }
          catch (e) { if (!(e instanceof acc.Fout)) throw e; return stuur(res, e.status, pagina(`Profiel van ${site.domein}`, profielForm(site, formulier(''), null, e.message), account)); }
        }
      }
      if (wat === 'artikel') {
        const artikelen = await lijstArtikelen(db, account.id, siteId);
        if (m === 'GET') return stuur(res, 200, pagina(`Artikel voor ${site.domein}`, artikelForm(site, artikelen, url.searchParams.get('zoekwoord')), account));
        if (m === 'POST') {
          const wacht = begrenzer.wachttijd([['artikel_account', account.id]]);
          if (wacht) return teVeel(res, 'artikel', wacht, `Artikel voor ${site.domein}`);
          begrenzer.tel([['artikel_account', account.id]]);
          const f = formulier(await leesBody(req));
          try {
            const r = await schrijfArtikel(db, ctx, account, siteId, { zoekwoord: f.zoekwoord });
            return naar(res, `/wijzigingen/${r.wijziging.id}`);
          } catch (e) {
            if (!(e instanceof acc.Fout)) throw e;
            const extra = e.profiel ? `<p><a href="/sites/${esc(siteId)}/profiel">Vul het siteprofiel in</a></p>` : e.bevindingen ? `<ul>${e.bevindingen.map((b) => `<li>${esc(b.tekst)}</li>`).join('')}</ul>` : '';
            return stuur(res, e.status, pagina(`Artikel voor ${site.domein}`, `<p role="alert">${esc(e.message)}</p>${extra}${artikelForm(site, await lijstArtikelen(db, account.id, siteId))}`, account));
          }
        }
      }
    }
    // Stap 3: voorstellen bekijken, goedkeuren, afwijzen, terugzetten. Alles gefilterd op account.
    if (m === 'GET' && pad === '/wijzigingen') {
      const alles = await wijz.lijst(db, account.id);
      const rij = (w) => `<li><a href="/wijzigingen/${esc(w.id)}">${esc(w.domein)}: ${esc(doelTekst(w))}</a> · ${esc(statusTekst(w.status))}</li>`;
      const open = alles.filter((w) => w.status === 'voorstel'), rest = alles.filter((w) => w.status !== 'voorstel');
      return stuur(res, 200, pagina('Wacht op jou', `<h2>Nog te beoordelen</h2><ul>${open.map(rij).join('') || '<li>Niets. Rankcomet heeft nu geen voorstellen voor je.</li>'}</ul><h2>Eerder behandeld</h2><ul>${rest.slice(0, 50).map(rij).join('') || '<li>Nog niets.</li>'}</ul>`, account));
    }
    const wm = pad.match(/^\/wijzigingen\/([^/]+)(?:\/(goedkeuren|afwijzen|terugzetten|opnieuw))?$/);
    if (wm) {
      const [, id, actie] = wm;
      const w = await wijz.haal(db, account.id, id);
      if (!w) return stuur(res, 404, pagina('Niet gevonden', '<p>Dit voorstel bestaat niet.</p>', account));
      if (m === 'GET' && !actie) return stuur(res, 200, pagina(doelTekst(w), wijzigingPagina(w), account));
      if (m === 'POST' && actie) {
        const f = formulier(await leesBody(req));
        try {
          let uitkomst;
          if (actie === 'goedkeuren') uitkomst = await wijz.keurGoed(db, ctx, account, id, f.modus);
          else if (actie === 'afwijzen') { await wijz.wijsAf(db, account, id, f.reden); uitkomst = { afgewezen: true }; }
          else if (actie === 'terugzetten') uitkomst = await wijz.zetTerug(db, ctx, account, id);
          else uitkomst = await wijz.publiceer(db, ctx, account, id);
          await logger.log('info', `wijziging ${actie} account=${account.id} wijziging=${id} status=${uitkomst.wijziging ? uitkomst.wijziging.status : 'afgewezen'}`);
          const tekst = uitkomst.afgewezen ? 'Dit voorstel doen we niet.' : uitkomst.terugNaarRij ? 'Je site is intussen aangepast. We hebben het voorstel bijgewerkt; kijk het nog eens na.' : actie === 'terugzetten' ? 'De oude tekst staat weer op je site.' : uitkomst.wijziging.modus === 'publiceren' ? 'Het staat live op je site.' : 'Het staat als concept klaar op je site.';
          if (f.terug === 'dashboard') return naar(res, `/dashboard?m=${encodeURIComponent(tekst)}`);
          return stuur(res, 200, pagina(doelTekst(w), `<p>${esc(tekst)}</p><p><a href="/wijzigingen/${esc(id)}">Bekijk</a> · <a href="/wijzigingen">Terug naar de lijst</a></p>`, account));
        } catch (e) {
          if (!(e instanceof acc.Fout)) throw e;
          await logger.log('info', `wijziging ${actie} mislukt account=${account.id} wijziging=${id} status=${e.status}`);
          if (f.terug === 'dashboard') return naar(res, `/dashboard?m=${encodeURIComponent(e.message)}`);
          return stuur(res, e.status, pagina(doelTekst(w), wijzigingPagina(await wijz.haal(db, account.id, id), e.message), account));
        }
      }
    }
    if (m === 'GET' && pad === '/pakketten') {
      const cfg = laadPakketten();
      const kaarten = cfg.volgorde.map((id) => { const p = cfg.pakketten[id]; return `<section><h2>${esc(p.naam)}</h2><p>${esc(prijsTekst(p.prijs_cent))}</p><ul><li>${p.max_sites} ${p.max_sites === 1 ? 'site' : 'sites'}</li><li>${p.artikelen_per_site_per_maand ? `${p.artikelen_per_site_per_maand} artikelen per site per maand (${p.artikelen_per_maand} totaal)` : `${p.artikelen_per_maand} artikelen per maand`}</li>${p.woocommerce_koppelen ? '<li>WooCommerce-webshop koppelen</li>' : ''}<li>${p.zoekwoorden_volgen} zoekwoorden volgen</li>${p.woocommerce_producten ? '<li>WooCommerce-productteksten</li>' : ''}</ul><form method="post" action="/abonnement/checkout"><input type="hidden" name="pakket" value="${esc(id)}"><button>Kies ${esc(p.naam)}</button></form></section>`; }).join('');
      return stuur(res, 200, pagina('Pakketten', kaarten, account));
    }
    if (m === 'POST' && pad === '/abonnement/checkout') {
      const f = formulier(await leesBody(req));
      const s = await maakCheckout(db, stripe, account, f.pakket, env);
      return naar(res, s.url);
    }
    return stuur(res, 404, pagina('Niet gevonden', '<p>Deze pagina bestaat niet.</p>', account));
  }

  return createServer((req, res) => {
    afhandelen(req, res).catch(async (e) => {
      const status = e instanceof acc.Fout ? e.status : 500;
      try { await logger.log('fout', `verzoek mislukt status=${status} ${e instanceof acc.Fout ? '' : e.name}`); } catch {}
      if (!res.headersSent) stuur(res, status, pagina('Er ging iets mis', `<p>${esc(e instanceof acc.Fout ? e.message : 'Er ging iets mis. Probeer het later opnieuw.')}</p>`));
    });
  });
}

function inlogForm(actie, knop, fout) {
  const vergeten = actie === '/inloggen' ? '<p><a href="/wachtwoord-vergeten">Wachtwoord vergeten?</a></p>' : '';
  return `${fout ? `<p role="alert">${esc(fout)}</p>` : ''}<form method="post" action="${actie}"><label>E-mailadres <input type="email" name="email" required autocomplete="email"></label><label>Wachtwoord <input type="password" name="wachtwoord" required minlength="12"></label><button>${esc(knop)}</button></form>${vergeten}`;
}

function vergetenForm() {
  return '<p>Vul je e-mailadres in. Je krijgt dan een mail met een link om een nieuw wachtwoord te kiezen.</p><form method="post" action="/wachtwoord-vergeten"><label>E-mailadres <input type="email" name="email" required autocomplete="email"></label><button>Stuur de link</button></form>';
}

function herstelForm(token, fout) {
  return `${fout ? `<p role="alert">${esc(fout)}</p>` : ''}<form method="post" action="/wachtwoord-herstellen"><input type="hidden" name="token" value="${esc(token)}"><label>Nieuw wachtwoord <input type="password" name="wachtwoord" required minlength="12" autocomplete="new-password"></label><button>Wachtwoord opslaan</button></form>`;
}

function koppelPagina(info, siteId, fout) {
  return `${fout ? `<p role="alert">${esc(fout)}</p>` : ''}<p>Laat zien dat ${esc(info.domein)} van jou is. Zet deze regel in de <code>&lt;head&gt;</code> van je homepage:</p><pre><code>${esc(info.metatag)}</code></pre><p>In WordPress kan dat met een plugin voor koptekst, of met de Rankcomet-plugin zodra die er is. Klik daarna op de knop.</p><form method="post" action="/sites/${esc(siteId)}/koppelen/controleer"><button>Controleer mijn site</button></form><p><a href="/dashboard">Later doen</a></p>`;
}

function pluginPagina(site, info) {
  return `<p>Met de Rankcomet-plugin zet Rankcomet teksten als concept klaar op ${esc(site.domein)}. Publiceren gebeurt pas nadat jij hier akkoord geeft.</p><ol><li>Installeer de plugin <code>rankcomet.zip</code> in WordPress (Plugins, Nieuwe plugin, Plugin uploaden).</li><li>Ga naar Instellingen, Rankcomet en vul de koppelcode in: <code>${esc(info.koppelcode)}</code></li><li>Maak hieronder een sleutel en plak die in hetzelfde scherm.</li></ol><form method="post" action="/sites/${esc(site.id)}/plugin/sleutel"><button>Maak een sleutel</button></form><p><a href="/dashboard">Terug</a></p>`;
}

const DOEL_TEKST = { post: 'Bericht', pagina: 'Pagina', product: 'Product', productcategorie: 'Productcategorie' };

// Het dashboard (stap 5): bovenaan wat op de klant wacht, daarna deze maand, wat live staat, wat er over is, de sites.
function dashboard({ account, pk, sites: lijst, wijzigingen, overzicht, posities = [], searchConsole = [], melding }) {
  const maand = huidigeMaand();
  const open = wijzigingen.filter((w) => w.status === 'voorstel');
  const dezeMaand = wijzigingen.filter((w) => w.maand === maand);
  const live = wijzigingen.filter((w) => w.status === 'gepubliceerd').slice(0, 20);
  const tel = (st) => dezeMaand.filter((w) => w.status === st && !w.terugzet_van).length;
  const mv = (n, een, meer) => `${n} ${n === 1 ? een : meer}`;
  const titelVan = (w) => w.titel ? w.titel : doelTekst(w);

  // [A55] Goedkeuren op het dashboard: een nieuw onderdeel komt als concept in WordPress; een bestaand onderdeel
  // krijgt de nieuwe tekst live. Wie het anders wil, kiest dat op de detailpagina.
  const kaartWacht = `<section class="kaart wacht" aria-labelledby="wacht"><h2 id="wacht">Wacht op jou</h2>${open.length ? open.map((w) => {
    const modus = w.doel_id ? 'publiceren' : 'concept';
    const gevolg = w.doel_id ? 'Na goedkeuren komt de nieuwe tekst live op je site.' : 'Na goedkeuren komt het als concept in WordPress.';
    return `<div class="voorstel"><div class="wat"><strong>${esc(w.domein)}: ${esc(titelVan(w))}</strong>${esc(w.reden)}<br><small>${esc(gevolg)} <a href="/wijzigingen/${esc(w.id)}">Bekijk het verschil</a></small></div><div class="acties"><form method="post" action="/wijzigingen/${esc(w.id)}/goedkeuren"><input type="hidden" name="modus" value="${modus}"><input type="hidden" name="terug" value="dashboard"><button>Goedkeuren</button></form><form method="post" action="/wijzigingen/${esc(w.id)}/afwijzen"><input type="hidden" name="terug" value="dashboard"><button class="rustig">Niet doen</button></form></div></div>`;
  }).join('') : '<p class="stil">Niets. Rankcomet heeft nu geen voorstellen voor je.</p>'}</section>`;

  const kaartMaand = `<section class="kaart"><h2>Deze maand</h2><div class="kaarten"><div><div class="cijfer">${overzicht.totaal}<small>${overzicht.totaal === 1 ? 'artikel geschreven' : 'artikelen geschreven'}</small></div></div><div><div class="cijfer">${tel('gepubliceerd') + tel('teruggezet')}<small>op je site gezet</small></div></div><div><div class="cijfer">${tel('afgewezen')}<small>door jou afgewezen</small></div></div><div><div class="cijfer">${overzicht.over}<small>${overzicht.over === 1 ? 'artikel' : 'artikelen'} nog over in ${esc(pk.naam)}</small></div></div></div></section>`;

  const kaartLive = `<section class="kaart"><h2>Live op je site</h2>${live.length ? `<ul class="lijst">${live.map((w) => {
    const terug = w.doel_id && !w.terugzet_van && Number(w.zonder_oud) === 0; // zelfde regel als zetTerug: alleen met oude waarden
    return `<li><span class="sitenaam">${esc(w.domein)}</span>: ${esc(titelVan(w))} <span class="stil">· ${esc(w.gepubliceerd ? w.gepubliceerd.slice(0, 10) : '')}</span> · <a href="/wijzigingen/${esc(w.id)}">bekijk</a>${terug ? ` <form method="post" action="/wijzigingen/${esc(w.id)}/terugzetten"><input type="hidden" name="terug" value="dashboard"><button class="rustig">Terugzetten</button></form>` : ''}</li>`;
  }).join('')}</ul>` : '<p class="stil">Nog niets. Zodra je een voorstel goedkeurt, staat het hier, met een knop om het terug te zetten.</p>'}</section>`;

  const kaartOver = `<section class="kaart"><h2>Artikelen over</h2><p>Je pakket ${esc(pk.naam)}: ${mv(pk.artikelen_per_maand, 'artikel', 'artikelen')} per maand${pk.artikelen_per_site_per_maand ? `, ${pk.artikelen_per_site_per_maand} per site` : ''}, hooguit ${pk.artikelen_per_site_per_dag} per site per dag.</p>${overzicht.sites.length ? `<ul class="lijst">${overzicht.sites.map((s) => `<li><span class="sitenaam">${esc(s.domein)}</span>: ${mv(s.dezeMaand, 'artikel', 'artikelen')} deze maand, nog ${s.over} over${s.over ? `, vandaag nog ${s.vandaagNog}` : ''}.</li>`).join('')}</ul>` : ''}</section>`;

  const kaartPosities = `<section class="kaart"><h2>Posities in Google</h2>${posities.length ? `<ul class="lijst">${posities.map((s) => `<li><span class="sitenaam">${esc(s.domein)}</span>: ${s.gemeten ? `${s.top10} van ${s.gevolgd} ${s.gevolgd === 1 ? 'zoekwoord' : 'zoekwoorden'} in de top 10${s.beter || s.slechter ? `, sinds vorige week ${s.beter} omhoog en ${s.slechter} omlaag` : ''}` : `${s.gevolgd} ${s.gevolgd === 1 ? 'zoekwoord' : 'zoekwoorden'} gevolgd, nog niet gemeten`}. <a href="/sites/${esc(s.id)}/zoekwoorden">Bekijk</a></li>`).join('')}</ul>` : '<p class="stil">Volg zoekwoorden bij een site, dan zie je hier elke dag waar je staat.</p>'}</section>`;

  const kaartGsc = searchConsole.length ? `<section class="kaart"><h2>Google Search Console</h2><ul class="lijst">${searchConsole.map((s) => `<li><span class="sitenaam">${esc(s.domein)}</span>: ${s.status === 'gekoppeld' && s.periode_start ? `${s.klikken} klikken en ${s.vertoningen} vertoningen van ${esc(s.periode_start)} tot ${esc(s.periode_eind)}` : s.status === 'verbroken' ? 'de koppeling is verbroken, koppel opnieuw' : 'nog geen cijfers'}. <a href="/sites/${esc(s.site_id)}/search-console">Bekijk</a></li>`).join('')}</ul></section>` : '';

  const kaartSites = `<section class="kaart"><h2>Je sites</h2>${lijst.length ? `<ul class="lijst">${lijst.map((s) => `<li><span class="sitenaam">${esc(s.domein)}</span> <span class="stil">· ${esc(s.platform)} · ${esc(s.land)}</span><br>${s.bevestigd ? `<span class="links"><a href="/sites/${esc(s.id)}/zoekwoorden">Zoekwoorden</a><a href="/sites/${esc(s.id)}/search-console">Search Console</a><a href="/sites/${esc(s.id)}/artikel">Artikel laten schrijven</a><a href="/sites/${esc(s.id)}/profiel">Profiel</a><a href="/sites/${esc(s.id)}/plugin">Plugin</a></span>` : `<a href="/sites/${esc(s.id)}/koppelen">Nog koppelen: laat zien dat deze site van jou is</a>`}</li>`).join('')}</ul>` : '<p>Nog geen sites.</p>'}<p>${lijst.length} van ${pk.max_sites} ${pk.max_sites === 1 ? 'site' : 'sites'} in gebruik. <a href="/sites/nieuw">Site toevoegen</a></p></section>`;

  return `${account.geverifieerd ? '' : bevestigMelding()}${melding ? `<p role="status">${esc(melding)}</p>` : ''}${kaartWacht}${kaartMaand}${kaartPosities}${kaartGsc}${kaartLive}${kaartOver}${kaartSites}`;
}
const STATUS_TEKST = { voorstel: 'wacht op jou', goedgekeurd: 'wordt verwerkt', gepubliceerd: 'staat op je site', afgewezen: 'niet gedaan', teruggezet: 'teruggezet', mislukt: 'niet gelukt' };
const doelTekst = (w) => `${DOEL_TEKST[w.doel_type] || w.doel_type}${w.doel_id ? ` ${w.doel_id}` : ' (nieuw)'}`;
const statusTekst = (st) => STATUS_TEKST[st] || st;

function wijzigingPagina(w, fout) {
  const velden = Object.entries(w.velden).map(([veld, v]) => `<section><h3>${esc(veld.replace(/_/g, ' '))}</h3>${v.oud !== null ? `<p><strong>Nu:</strong></p><pre>${esc(v.oud)}</pre>` : ''}<p><strong>Voorstel:</strong></p><pre>${esc(v.nieuw)}</pre></section>`).join('');
  let knoppen = '';
  if (w.status === 'voorstel') knoppen = `<form method="post" action="/wijzigingen/${esc(w.id)}/goedkeuren"><label><input type="radio" name="modus" value="concept" checked> Als concept klaarzetten (ik publiceer zelf in WordPress)</label><label><input type="radio" name="modus" value="publiceren"> Meteen publiceren</label><button>Goedkeuren</button></form><form method="post" action="/wijzigingen/${esc(w.id)}/afwijzen"><label>Waarom niet? (mag leeg) <input name="reden"></label><button class="rustig">Niet doen</button></form>`;
  if (w.status === 'gepubliceerd' && w.doel_id && !Object.values(w.velden).some((v) => v.oud === null)) knoppen = `<form method="post" action="/wijzigingen/${esc(w.id)}/terugzetten"><button>Terugzetten naar de oude tekst</button></form>`;
  if (w.status === 'mislukt') knoppen = `<form method="post" action="/wijzigingen/${esc(w.id)}/opnieuw"><button>Opnieuw proberen</button></form>`;
  return `${fout ? `<p role="alert">${esc(fout)}</p>` : ''}${w.melding ? `<p role="status">${esc(w.melding)}</p>` : ''}<p>Status: ${esc(statusTekst(w.status))}. Reden: ${esc(w.reden)}</p>${velden}${knoppen}<p><a href="/wijzigingen">Terug naar de lijst</a></p>`;
}

function profielForm(site, p, melding, fout) {
  p = p || {};
  const veld = (naam, label, uitleg, groot) => `<label>${label}${groot ? `<textarea name="${naam}" rows="3">${esc(p[naam] || '')}</textarea>` : `<input name="${naam}" value="${esc(p[naam] || '')}">`}<small>${esc(uitleg)}</small></label>`;
  return `${fout ? `<p role="alert">${esc(fout)}</p>` : ''}${melding ? `<p role="status">${esc(melding)}</p>` : ''}<p>Met deze informatie schrijft Rankcomet over jouw bedrijf, en niet over zomaar een bedrijf. Elk artikel wordt hierop gecontroleerd.</p><form method="post" action="/sites/${esc(site.id)}/profiel">${veld('bedrijf', 'Naam van je bedrijf', 'Zoals klanten het kennen.')}${veld('diensten', 'Diensten of producten', 'Gescheiden door komma\'s, bijvoorbeeld: dakreparatie, dakisolatie, dakgoten.', true)}${veld('plaats', 'Plaats en werkgebied', 'Bijvoorbeeld: Utrecht en omgeving.')}${veld('ervaring', 'Ervaring en achtergrond', 'Sinds wanneer, opleiding, specialisatie. Alleen wat echt zo is.', true)}${veld('doelgroep', 'Voor wie', 'Bijvoorbeeld: particulieren met een eigen woning.')}${veld('toon', 'Toon', 'Bijvoorbeeld: nuchter en vriendelijk.')}${veld('uitgesloten', 'Onderwerpen die je niet wilt', 'Bijvoorbeeld: prijzen, concurrenten.', true)}<button>Opslaan</button></form>`;
}

const ARTIKEL_STATUS = { gereserveerd: 'bezig', concept: 'voorstel klaar', teruggeboekt: 'niet gelukt' };
function artikelForm(site, artikelen, zoekwoord = '') {
  const rijen = artikelen.map((a) => `<li>${esc(a.zoekwoord || '')} · ${esc(ARTIKEL_STATUS[a.status] || a.status)}${a.score != null ? ` · score ${esc(a.score)}` : ''}${a.wijziging_id ? ` · <a href="/wijzigingen/${esc(a.wijziging_id)}">bekijk</a>` : ''}${a.status === 'teruggeboekt' && a.melding ? ` · ${esc(a.melding)}` : ''}</li>`).join('');
  return `<p>Vul een zoekwoord in. Rankcomet kiest een onderwerp, schrijft een artikel met interne links en meta, controleert het en zet het als voorstel klaar. Jij keurt het goed voor het op je site komt. Dit duurt ongeveer een minuut.</p><form method="post" action="/sites/${esc(site.id)}/artikel"><label>Zoekwoord <input name="zoekwoord" required minlength="2" maxlength="100" placeholder="bijvoorbeeld: dakisolatie kosten" value="${esc(zoekwoord || '')}"></label><button>Schrijf een artikel</button></form><h2>Eerdere artikelen</h2><ul>${rijen || '<li>Nog geen.</li>'}</ul>`;
}

const INTENTIE_TEKST = { informatie: 'wil iets weten', navigatie: 'zoekt een site', commercieel: 'vergelijkt', kopen: 'wil kopen', onbekend: '' };
function positieTekst(p) {
  if (!p || p.positie == null) return p && p.dag ? 'niet in de top 20' : 'nog niet gemeten';
  const v = p.verschil == null ? '' : p.verschil > 0 ? ` (${p.verschil} omhoog)` : p.verschil < 0 ? ` (${-p.verschil} omlaag)` : ' (gelijk)';
  return `positie ${p.positie}${v}`;
}

function zoekwoordenPagina(site, lijst, pk, melding, fout, posities = []) {
  const perId = Object.fromEntries(posities.map((p) => [p.id, p]));
  const gevolgd = lijst.filter((z) => z.gevolgd), ideeen = lijst.filter((z) => !z.gevolgd);
  const rij = (z, knop) => `<li><span class="sitenaam">${esc(z.zoekwoord)}</span> <span class="stil">· ${z.volume != null ? `${z.volume} per maand` : 'volume onbekend'}${z.moeilijkheid != null ? ` · moeilijkheid ${z.moeilijkheid}` : ''}${INTENTIE_TEKST[z.intentie] ? ` · ${INTENTIE_TEKST[z.intentie]}` : ''}</span> ${knop}</li>`;
  const volgKnop = (z) => `<form method="post" action="/sites/${esc(site.id)}/zoekwoorden/volgen"><input type="hidden" name="id" value="${esc(z.id)}"><button class="rustig">Volgen</button></form>`;
  const ontvolgKnop = (z) => `<span class="positie">${esc(positieTekst(perId[z.id]))}</span>${perId[z.id]?.url ? ` <small><a href="${esc(perId[z.id].url)}">pagina</a></small>` : ''} <a href="/sites/${esc(site.id)}/artikel?zoekwoord=${encodeURIComponent(z.zoekwoord)}">Artikel laten schrijven</a> <form method="post" action="/sites/${esc(site.id)}/zoekwoorden/ontvolgen"><input type="hidden" name="id" value="${esc(z.id)}"><button class="rustig">Niet meer volgen</button></form>`;
  return `${fout ? `<p role="alert">${esc(fout)}</p>` : ''}${melding ? `<p role="status">${esc(melding)}</p>` : ''}<section class="kaart"><h2>Zoekwoorden die je volgt (${gevolgd.length} van ${pk.zoekwoorden_volgen})</h2>${gevolgd.length ? `<p class="stil">Elke dag kijkt Rankcomet waar je site staat in Google (${esc(site.land === 'BE' ? 'België' : 'Nederland')}, de eerste 20 resultaten). Tussen haakjes het verschil met een week geleden.</p><ul class="lijst">${gevolgd.map((z) => rij(z, ontvolgKnop(z))).join('')}</ul><form method="post" action="/sites/${esc(site.id)}/zoekwoorden/controleren"><button class="rustig">Nu controleren</button></form>` : '<p class="stil">Nog geen. Doe een onderzoek of voeg zelf een zoekwoord toe.</p>'}</section><section class="kaart"><h2>Onderzoek doen</h2><p>Vul een woord in waar je op gevonden wilt worden. Rankcomet zoekt ideeën met het aantal zoekopdrachten per maand in ${esc(site.land === 'BE' ? 'België' : 'Nederland')}. Hooguit ${pk.onderzoeken_per_site_per_dag} onderzoeken per dag.</p><form method="post" action="/sites/${esc(site.id)}/zoekwoorden/onderzoek"><label>Startwoord <input name="startwoord" required minlength="2" maxlength="100" placeholder="bijvoorbeeld: dakisolatie"></label><button>Zoek ideeën</button></form><form method="post" action="/sites/${esc(site.id)}/zoekwoorden/toevoegen"><label>Of voeg zelf een zoekwoord toe <input name="zoekwoord" required minlength="2" maxlength="100"></label><button class="rustig">Toevoegen en volgen</button></form></section><section class="kaart"><h2>Ideeën (${ideeen.length})</h2>${ideeen.length ? `<ul class="lijst">${ideeen.map((z) => rij(z, volgKnop(z))).join('')}</ul>` : '<p class="stil">Nog geen ideeën.</p>'}</section>`;
}

function searchConsolePagina(site, k, properties, beschikbaar, melding, fout) {
  const kop = `${fout ? `<p role="alert">${esc(fout)}</p>` : ''}${melding ? `<p role="status">${esc(melding)}</p>` : ''}`;
  if (!beschikbaar) return `${kop}<section class="kaart"><p>De koppeling met Google Search Console is nog niet beschikbaar. Zodra Google onze aanvraag heeft goedgekeurd, kun je hier je Search Console koppelen en zie je per pagina de klikken en vertoningen uit Google.</p></section>`;
  if (!k) return `${kop}<section class="kaart"><p>Koppel je Google Search Console, dan ziet Rankcomet per pagina hoe vaak je in Google wordt getoond en aangeklikt. We vragen alleen leesrechten. Je kunt de koppeling altijd verbreken; dan verwijderen we de Google-gegevens.</p><form method="post" action="/sites/${esc(site.id)}/search-console/start"><button>Koppel Search Console</button></form></section>`;
  if (k.status === 'property_kiezen') return `${kop}<section class="kaart"><h2>Welke property hoort bij ${esc(site.domein)}?</h2>${properties.length ? `<form method="post" action="/sites/${esc(site.id)}/search-console/property">${properties.map((p, i) => `<label><input type="radio" name="property" value="${esc(p.property)}"${(p.past && !properties.slice(0, i).some((q) => q.past)) ? ' checked' : ''}> ${esc(p.property)}${p.past ? ' (past bij deze site)' : ''}</label>`).join('')}<button>Kies deze property</button></form>` : '<p class="stil">Je Google-account heeft geen properties in Search Console. Voeg je site eerst toe in Search Console.</p>'}<form method="post" action="/sites/${esc(site.id)}/search-console/verbreken"><button class="rustig">Koppeling verbreken</button></form></section>`;
  if (k.status === 'verbroken') return `${kop}<section class="kaart"><p role="alert">${esc(k.melding || 'De koppeling is verbroken.')}</p><form method="post" action="/sites/${esc(site.id)}/search-console/start"><button>Opnieuw koppelen</button></form><form method="post" action="/sites/${esc(site.id)}/search-console/verbreken"><button class="rustig">Koppeling verwijderen</button></form></section>`;
  const rijen = k.paginas.map((p) => `<li><span class="sitenaam">${esc(p.pagina.replace(/^https?:\/\/[^/]+/, '') || '/')}</span> <span class="stil">· ${p.klikken} klikken · ${p.vertoningen} vertoningen${p.positie != null ? ` · positie ${p.positie.toFixed(1)}` : ''}</span></li>`).join('');
  return `${kop}<section class="kaart"><h2>Gekoppeld: ${esc(k.property)}</h2><p>${k.periode_start ? `Cijfers van ${esc(k.periode_start)} tot ${esc(k.periode_eind)}: ${k.totaal.klikken} klikken en ${k.totaal.vertoningen} vertoningen. Rankcomet haalt ze elke dag op.` : 'Nog geen cijfers opgehaald.'}</p><form method="post" action="/sites/${esc(site.id)}/search-console/ververs"><button class="rustig">Nu ophalen</button></form></section><section class="kaart"><h2>Pagina's</h2>${rijen ? `<ul class="lijst">${rijen}</ul>` : '<p class="stil">Nog geen cijfers. Google heeft voor deze periode niets voor deze property, of de site is nieuw.</p>'}</section><section class="kaart"><h2>Koppeling verbreken</h2><p>Dan trekken we de toegang bij Google in en verwijderen we alle Google-gegevens van deze site.</p><form method="post" action="/sites/${esc(site.id)}/search-console/verbreken"><button class="rustig">Verbreken</button></form></section>`;
}

function bevestigMelding() {
  return '<section role="status"><p><strong>Bevestig je e-mailadres.</strong> We hebben je een mail gestuurd met een link. Daarna kun je je site koppelen.</p><form method="post" action="/email-bevestigen/opnieuw"><button>Stuur de mail opnieuw</button></form></section>';
}

function siteForm() {
  const m = laadMerk();
  const landen = Object.entries(m.landen).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  const actief = Object.entries(m.platforms_actief).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  const wacht = Object.entries(m.platforms_wachtlijst).map(([k, v]) => `<option value="${k}">${esc(v)} (wachtlijst)</option>`).join('');
  return `<form method="post" action="/sites/nieuw"><label>Domein <input name="domein" required placeholder="voorbeeld.nl"></label><label>Taal <select name="taal"><option value="nl">Nederlands</option></select></label><label>Land <select name="land">${landen}</select></label><label>Platform <select name="platform">${actief}<optgroup label="Binnenkort">${wacht}</optgroup></select></label><button>Site toevoegen</button></form>`;
}
