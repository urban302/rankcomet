// Google-client voor de Search Console-koppeling (stap 8), overgezet uit vendor-openseo (googleOAuth.ts,
// googleOAuthState.ts, gscClient.ts) in gewoon JavaScript. Alleen wat Rankcomet nodig heeft:
// OAuth met PKCE, tokens vernieuwen en intrekken, de lijst met properties en de zoekprestaties.
// Het transport is injecteerbaar; in tests altijd een nep-Google. Tokens komen nooit in een log.
import { createHash, randomBytes } from 'node:crypto';
import { Fout } from './accounts.js';

export const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GSC_API = 'https://www.googleapis.com/webmasters/v3';
const TIMEOUT_MS = 30000;

// Optioneel bij de start: zonder client-id en -secret is de koppeling "nog niet beschikbaar" (A63).
export function googleConfig(env = process.env) {
  const id = (env.RC_GOOGLE_CLIENT_ID || '').trim(), secret = (env.RC_GOOGLE_CLIENT_SECRET || '').trim();
  return id && secret ? { clientId: id, clientSecret: secret } : null;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
export const maakVerifier = () => b64url(randomBytes(32));
export const challengeVan = (verifier) => b64url(createHash('sha256').update(verifier).digest());

export function maakGoogle(env = process.env, fetchFn = globalThis.fetch, logger = null) {
  const cfg = googleConfig(env);

  async function vraag(url, init, wat) {
    let r;
    try { r = await fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) }); }
    catch (e) { await logger?.log('fout', `google onbereikbaar wat=${wat} ${e.name}`); throw new Fout('Google is even niet bereikbaar. Probeer het later opnieuw.', 503); }
    let data = null; try { data = await r.json(); } catch {}
    return { status: r.status, ok: r.ok, data };
  }

  function vereisConfig() { if (!cfg) throw new Fout('De koppeling met Google Search Console is nog niet beschikbaar.', 503, { geenConfig: true }); return cfg; }

  return {
    beschikbaar: Boolean(cfg),
    // De URL waar de klant naartoe gaat om toestemming te geven.
    authUrl({ redirectUri, state, verifier }) {
      const { clientId } = vereisConfig();
      const u = new URL(AUTH_URL);
      u.searchParams.set('client_id', clientId); u.searchParams.set('redirect_uri', redirectUri); u.searchParams.set('response_type', 'code');
      u.searchParams.set('scope', SCOPE); u.searchParams.set('access_type', 'offline'); u.searchParams.set('prompt', 'consent');
      u.searchParams.set('state', state); u.searchParams.set('code_challenge', challengeVan(verifier)); u.searchParams.set('code_challenge_method', 'S256');
      return u.href;
    },
    // Code inwisselen voor tokens. Geeft { accessToken, refreshToken, verlooptOp }.
    async wisselCode({ code, redirectUri, verifier }) {
      const { clientId, clientSecret } = vereisConfig();
      const body = new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier });
      const r = await vraag(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() }, 'wisselcode');
      if (!r.ok || !r.data?.access_token) { await logger?.log('fout', `google wisselcode status=${r.status} fout=${r.data?.error || '?'}`); throw new Fout('Google accepteerde de koppeling niet. Probeer het opnieuw.', 400); }
      if (!r.data.refresh_token) throw new Fout('Google gaf geen blijvende toegang. Probeer het opnieuw en kies "Toestaan".', 400);
      return { accessToken: r.data.access_token, refreshToken: r.data.refresh_token, verlooptOp: new Date(Date.now() + Math.max(60, (r.data.expires_in || 3600) - 60) * 1000).toISOString() };
    },
    // Nieuw toegangsbewijs met de refresh token. invalid_grant betekent: de klant trok de toegang in.
    async ververs(refreshToken) {
      const { clientId, clientSecret } = vereisConfig();
      const body = new URLSearchParams({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token' });
      const r = await vraag(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() }, 'ververs');
      if (r.data?.error === 'invalid_grant') throw new Fout('Google heeft de toegang ingetrokken. Koppel Search Console opnieuw.', 401, { ingetrokken: true });
      if (!r.ok || !r.data?.access_token) { await logger?.log('fout', `google ververs status=${r.status} fout=${r.data?.error || '?'}`); throw new Fout('Google is even niet bereikbaar. Probeer het later opnieuw.', 503); }
      return { accessToken: r.data.access_token, verlooptOp: new Date(Date.now() + Math.max(60, (r.data.expires_in || 3600) - 60) * 1000).toISOString() };
    },
    // Toegang intrekken bij Google (bij verbreken). Mislukken is geen ramp; de tokens worden hoe dan ook verwijderd.
    async trekIn(token) {
      try { await fetchFn(REVOKE_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString(), signal: AbortSignal.timeout(TIMEOUT_MS) }); return true; }
      catch { return false; }
    },
    // De properties waar dit Google-account bij kan.
    async properties(accessToken) {
      const r = await vraag(`${GSC_API}/sites`, { headers: { authorization: `Bearer ${accessToken}` } }, 'properties');
      if (r.status === 401) throw new Fout('Google heeft de toegang ingetrokken. Koppel Search Console opnieuw.', 401, { ingetrokken: true });
      if (!r.ok) throw new Fout('Google gaf een fout bij het ophalen van je properties.', 503);
      return (r.data?.siteEntry || []).filter((s) => s?.siteUrl && s.permissionLevel !== 'siteUnverifiedUser').map((s) => ({ property: s.siteUrl, rol: s.permissionLevel }));
    },
    // Zoekprestaties per pagina over een periode (searchAnalytics.query).
    async zoekprestaties(accessToken, property, { start, eind, limiet = 100 }) {
      const body = { startDate: start, endDate: eind, dimensions: ['page'], rowLimit: limiet, dataState: 'final' };
      const r = await vraag(`${GSC_API}/sites/${encodeURIComponent(property)}/searchAnalytics/query`, { method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }, 'zoekprestaties');
      if (r.status === 401) throw new Fout('Google heeft de toegang ingetrokken. Koppel Search Console opnieuw.', 401, { ingetrokken: true });
      if (r.status === 403) throw new Fout('Je Google-account heeft geen toegang (meer) tot deze property.', 403);
      if (!r.ok) throw new Fout('Google gaf een fout bij het ophalen van de cijfers.', 503);
      return (r.data?.rows || []).map((row) => ({ pagina: String(row.keys?.[0] || ''), klikken: Number(row.clicks || 0), vertoningen: Number(row.impressions || 0), ctr: Number(row.ctr || 0), positie: row.position == null ? null : Number(row.position) })).filter((row) => row.pagina);
    },
  };
}
