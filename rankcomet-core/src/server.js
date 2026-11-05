// Start de app. Weigert te starten als de EU-config of de geheimen niet kloppen.
import { maakDb, migreer } from './db.js';
import { maakApp } from './app.js';
import { maakLogger } from './log.js';
import { controleerAzureEnv } from './azure.js';
import { laadSleutel } from './geheimen.js';
import { controleerStripeEnv } from './stripe.js';
import { bewaartermijnDagen, laadPakketten } from './config.js';

export async function startControles(env = process.env) {
  if ((env.RC_DB || '') !== 'pg') throw new Error('Productie draait alleen op Postgres (RC_DB=pg)');
  if (!env.RC_DATABASE_URL) throw new Error('RC_DATABASE_URL ontbreekt');
  controleerAzureEnv(env);
  laadSleutel(env);
  controleerStripeEnv(env);
  laadPakketten();
  bewaartermijnDagen(env);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { await startControles(); } catch (e) { process.stderr.write(`Start geweigerd: ${e.message}\n`); process.exit(1); }
  const db = await maakDb(); await migreer(db);
  const logger = maakLogger(db, { stil: false });
  // [A] De echte Stripe-client wordt pas in een latere levering gekoppeld; R1 heeft alleen een mock.
  const stripe = { checkout: { sessions: { create: async () => { throw new Error('Stripe-client nog niet gekoppeld (R1)'); } } } };
  // [A34] Nog geen echte mailer (SMTP of mailprovider in de EU volgt). Tot dan mislukt elke mail; de app
  // logt dat en de klant kan het later opnieuw proberen.
  const mailer = { stuur: async () => { throw new Error('Mailer nog niet gekoppeld (R3)'); } };
  const app = maakApp({ db, stripe, mailer, logger });
  const poort = Number(process.env.RC_POORT || 3100);
  app.listen(poort, '127.0.0.1', () => process.stdout.write(`Rankcomet luistert op 127.0.0.1:${poort}\n`));
  setInterval(() => logger.ruimOp(bewaartermijnDagen()).catch(() => {}), 6 * 3600 * 1000).unref();
}
