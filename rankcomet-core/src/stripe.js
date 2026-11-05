// Stripe Billing, alleen testmodus. De Stripe-client wordt geïnjecteerd (in tests een mock); er gaat
// in R1 nooit een echte aanroep naar Stripe. Webhooks: handtekeningcontrole (Stripe-Signature, HMAC-SHA256)
// en idempotentie via tabel stripe_events (zelfde event twee keer = één verwerking; vastgelegd in
// dezelfde transactie als de verwerking, sinds R2).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Fout, haalAccount } from './accounts.js';
import { pakketVoor } from './pakketten.js';
import { laadMerk } from './config.js';

const TOLERANTIE_S = 300;

export function controleerStripeEnv(env = process.env) {
  const sk = env.RC_STRIPE_SECRET_KEY || '';
  if (sk && !sk.startsWith('sk_test_')) throw new Error('RC_STRIPE_SECRET_KEY moet een testsleutel zijn (sk_test_) in deze fase');
  if (!env.RC_STRIPE_WEBHOOK_SECRET) throw new Error('RC_STRIPE_WEBHOOK_SECRET ontbreekt');
}

export async function maakCheckout(db, stripe, account, pakketId, env = process.env) {
  const pk = pakketVoor(pakketId);
  const prijs = env[pk.stripe_price_env];
  if (!prijs) throw new Fout(`Prijs voor ${pk.naam} is nog niet ingesteld.`, 500);
  const basis = laadMerk().basis_url;
  const sessie = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: prijs, quantity: 1 }],
    client_reference_id: account.id,
    metadata: { account_id: account.id, pakket: pakketId },
    subscription_data: { metadata: { account_id: account.id, pakket: pakketId } },
    automatic_tax: { enabled: true }, // [A] btw via Stripe Tax; bedragen in config zijn excl. btw
    tax_id_collection: { enabled: true },
    success_url: `${basis}/dashboard?betaling=gelukt`,
    cancel_url: `${basis}/pakketten?betaling=afgebroken`,
    locale: 'nl',
  });
  return { id: sessie.id, url: sessie.url };
}

export function tekenPayload(payload, geheim, t = Math.floor(Date.now() / 1000)) {
  const sig = createHmac('sha256', geheim).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${sig}`;
}

export function controleerHandtekening(payload, kop, geheim, nu = Math.floor(Date.now() / 1000)) {
  if (!kop || !geheim) return false;
  let t = null; const v1 = [];
  for (const d of String(kop).split(',')) {
    const [k, v] = d.split('=');
    if (k === 't') t = Number(v); else if (k === 'v1' && v) v1.push(v);
  }
  if (!Number.isFinite(t) || Math.abs(nu - t) > TOLERANTIE_S || !v1.length) return false;
  const verwacht = Buffer.from(createHmac('sha256', geheim).update(`${t}.${payload}`).digest('hex'));
  return v1.some((s) => { const b = Buffer.from(s); return b.length === verwacht.length && timingSafeEqual(b, verwacht); });
}

const STATUS = { active: 'actief', trialing: 'proef', past_due: 'achterstallig', unpaid: 'onbetaald', canceled: 'opgezegd', incomplete: 'onvolledig', incomplete_expired: 'verlopen' };

// Verwerkt een webhook. Geeft { status, verwerkt } terug.
export async function verwerkWebhook(db, payload, kop, geheim, logger) {
  if (!controleerHandtekening(payload, kop, geheim)) return { status: 400, verwerkt: false, reden: 'handtekening' };
  const event = JSON.parse(payload);
  // Idempotentie (F-R1-1): claim en verwerking in één transactie. Het event-id is pas definitief
  // vastgelegd als de verwerking slaagt (COMMIT); bij een fout volgt ROLLBACK en wordt een herhaalpoging
  // van Stripe opnieuw verwerkt. Op PG wacht een gelijktijdig dubbel event op het unieke event_id tot de
  // eerste transactie klaar is (dan 'dubbel', of bij ROLLBACK zelf verwerken); op sqlite lopen transacties
  // achter elkaar.
  const uitkomst = await db.transactie(async (tx) => {
    const claim = tx.soort === 'pg'
      ? await tx.query('INSERT INTO stripe_events (event_id, soort, verwerkt) VALUES ($1, $2, $3) ON CONFLICT (event_id) DO NOTHING', [event.id, event.type, new Date().toISOString()])
      : await tx.query('INSERT OR IGNORE INTO stripe_events (event_id, soort, verwerkt) VALUES ($1, $2, $3)', [event.id, event.type, new Date().toISOString()]);
    if (!claim.rowCount) return { status: 200, verwerkt: false, reden: 'dubbel' };
    const o = event.data && event.data.object || {};
    const accountId = (o.metadata && o.metadata.account_id) || o.client_reference_id;
    if (!accountId || !(await haalAccount(tx, accountId))) return { status: 200, verwerkt: true, reden: 'onbekend account' };
    if (event.type === 'checkout.session.completed') {
      await tx.query('UPDATE accounts SET stripe_customer_id = $1, stripe_subscription_id = $2, pakket = $3, abonnement_status = $4 WHERE id = $5',
        [o.customer || null, o.subscription || null, pakketVoor(o.metadata && o.metadata.pakket).id, 'actief', accountId]);
    } else if (event.type.startsWith('customer.subscription.')) {
      const status = event.type === 'customer.subscription.deleted' ? 'opgezegd' : (STATUS[o.status] || 'onbekend');
      const pakket = o.metadata && o.metadata.pakket ? pakketVoor(o.metadata.pakket).id : null;
      await tx.query('UPDATE accounts SET abonnement_status = $1, stripe_subscription_id = $2, pakket = COALESCE($3, pakket) WHERE id = $4',
        [status, o.id || null, pakket, accountId]);
    }
    return { status: 200, verwerkt: true };
  });
  if (!uitkomst.verwerkt) return uitkomst;
  if (uitkomst.reden === 'onbekend account') {
    if (logger) await logger.log('waarschuwing', `stripe-event ${event.type} zonder bekend account`);
    return uitkomst;
  }
  if (logger) await logger.log('info', `stripe-event ${event.type} verwerkt`);
  return { status: 200, verwerkt: true };
}
