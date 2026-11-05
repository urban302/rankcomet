// HTTP-app (node:http, geen framework) met de NL-basis-UI: inloggen, dashboard-shell, site toevoegen,
// pakketten, Stripe-checkout (testmodus) en webhook. Afhankelijkheden worden geïnjecteerd.
import { createServer } from 'node:http';
import * as acc from './accounts.js';
import * as sites from './sites.js';
import { laadMerk, laadPakketten } from './config.js';
import { prijsTekst } from './pakketten.js';
import { maakCheckout, verwerkWebhook } from './stripe.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function pagina(titel, inhoud, account) {
  const m = laadMerk();
  const nav = account
    ? `<nav><a href="/dashboard">Dashboard</a> <a href="/sites/nieuw">Site toevoegen</a> <a href="/pakketten">Pakketten</a> <a href="/over">Over</a> <form method="post" action="/uitloggen" style="display:inline"><button>Uitloggen</button></form></nav>`
    : `<nav><a href="/inloggen">Inloggen</a> <a href="/registreren">Account aanmaken</a> <a href="/over">Over</a></nav>`;
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titel)} · ${esc(m.merk)}</title></head><body><header><strong>${esc(m.merk)}</strong> ${nav}</header><main><h1>${esc(titel)}</h1>${inhoud}</main><footer><small>${esc(m.merk)} · ${esc(m.domein)} · <a href="/over">Over en licenties</a></small></footer></body></html>`;
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

export function maakApp({ db, stripe, logger, env = process.env, veiligeCookie = true }) {
  const COOKIE = 'rc_sessie';
  const zetCookie = (res, w, maxAge) => res.setHeader('set-cookie', `${COOKIE}=${w}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${veiligeCookie ? '; Secure' : ''}`);
  const stuur = (res, status, html, kop = {}) => { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin', ...kop }); res.end(html); };
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

    if (m === 'GET' && pad === '/') return naar(res, account ? '/dashboard' : '/inloggen');
    if (m === 'GET' && pad === '/over') return stuur(res, 200, pagina('Over Rankcomet', `<p>Rankcomet.ai helpt u met SEO-content voor WordPress en WooCommerce.</p><h2>Licenties</h2><p>Rankcomet is gebouwd op <a href="https://github.com/every-app/open-seo">OpenSEO</a>, uitgegeven onder de MIT-licentie. Copyright (c) 2026 Ben Senescu. De volledige licentietekst staat in het bestand LICENSE in de broncode.</p>`, account));
    if (m === 'GET' && pad === '/inloggen') return stuur(res, 200, pagina('Inloggen', inlogForm('/inloggen', 'Inloggen', url.searchParams.get('fout'))));
    if (m === 'GET' && pad === '/registreren') return stuur(res, 200, pagina('Account aanmaken', inlogForm('/registreren', 'Account aanmaken', url.searchParams.get('fout'))));
    if (m === 'POST' && (pad === '/inloggen' || pad === '/registreren')) {
      const f = formulier(await leesBody(req));
      try {
        if (pad === '/registreren') await acc.registreer(db, f.email, f.wachtwoord);
        const s = await acc.login(db, f.email, f.wachtwoord);
        zetCookie(res, s.token, 7 * 86400);
        await logger.log('info', `inloggen gelukt account=${s.accountId}`);
        return naar(res, '/dashboard');
      } catch (e) {
        if (!(e instanceof acc.Fout)) throw e;
        await logger.log('info', `inloggen mislukt status=${e.status}`);
        return stuur(res, e.status, pagina(pad === '/inloggen' ? 'Inloggen' : 'Account aanmaken', inlogForm(pad, pad === '/inloggen' ? 'Inloggen' : 'Account aanmaken', e.message)));
      }
    }
    if (!account) {
      if (pad.startsWith('/api/')) return json(res, 401, { fout: 'Log eerst in.' });
      return naar(res, '/inloggen');
    }
    if (m === 'POST' && pad === '/uitloggen') { await acc.logout(db, token); zetCookie(res, '', 0); return naar(res, '/inloggen'); }
    if (m === 'GET' && pad === '/dashboard') {
      const lijst = await sites.lijstSites(db, account.id);
      const pk = laadPakketten().pakketten[account.pakket];
      const rijen = lijst.map((s) => `<li>${esc(s.domein)} · ${esc(s.platform)} · ${esc(s.land)}</li>`).join('') || '<li>Nog geen sites. <a href="/sites/nieuw">Voeg uw eerste site toe</a>.</li>';
      return stuur(res, 200, pagina('Dashboard', `<p>Pakket: <strong>${esc(pk.naam)}</strong> (${esc(lijst.length)} van ${pk.max_sites} sites) · Abonnement: ${esc(account.abonnement_status)}</p><h2>Uw sites</h2><ul>${rijen}</ul>`, account));
    }
    if (m === 'GET' && pad === '/api/sites') return json(res, 200, { sites: await sites.lijstSites(db, account.id) });
    if (m === 'GET' && pad.startsWith('/api/sites/')) {
      const s = await sites.haalSite(db, account.id, pad.slice('/api/sites/'.length));
      return s ? json(res, 200, s) : json(res, 404, { fout: 'Site niet gevonden.' });
    }
    if (m === 'GET' && pad === '/sites/nieuw') return stuur(res, 200, pagina('Site toevoegen', siteForm(), account));
    if (m === 'POST' && pad === '/sites/nieuw') {
      const f = formulier(await leesBody(req));
      try {
        const r = await sites.voegSiteToe(db, account, f);
        if (r.wachtlijst) return stuur(res, 200, pagina('Op de wachtlijst', `<p>${esc(r.bericht)}</p>`, account));
        return naar(res, '/dashboard');
      } catch (e) {
        if (!(e instanceof acc.Fout)) throw e;
        const up = e.upgrade ? `<p><a href="/pakketten">Bekijk de pakketten en upgrade</a></p>` : '';
        return stuur(res, e.status, pagina('Site toevoegen', `<p role="alert">${esc(e.message)}</p>${up}${siteForm()}`, account));
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
  return `${fout ? `<p role="alert">${esc(fout)}</p>` : ''}<form method="post" action="${actie}"><label>E-mailadres <input type="email" name="email" required autocomplete="email"></label><label>Wachtwoord <input type="password" name="wachtwoord" required minlength="12"></label><button>${esc(knop)}</button></form>`;
}

function siteForm() {
  const m = laadMerk();
  const landen = Object.entries(m.landen).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  const actief = Object.entries(m.platforms_actief).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  const wacht = Object.entries(m.platforms_wachtlijst).map(([k, v]) => `<option value="${k}">${esc(v)} (wachtlijst)</option>`).join('');
  return `<form method="post" action="/sites/nieuw"><label>Domein <input name="domein" required placeholder="voorbeeld.nl"></label><label>Taal <select name="taal"><option value="nl">Nederlands</option></select></label><label>Land <select name="land">${landen}</select></label><label>Platform <select name="platform">${actief}<optgroup label="Binnenkort">${wacht}</optgroup></select></label><button>Site toevoegen</button></form>`;
}
