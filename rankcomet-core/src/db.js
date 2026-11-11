// Database-adapter: Postgres (productie, OVH) en node:sqlite (standaard-testopzet).
// SQL wordt geschreven met $1-plaatshouders; voor sqlite worden die omgezet.
import { readFileSync } from 'node:fs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bureaus (
  id TEXT PRIMARY KEY, naam TEXT NOT NULL, aangemaakt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  bureau_id TEXT NULL REFERENCES bureaus(id),
  email TEXT NOT NULL UNIQUE,
  wachtwoord_hash TEXT NOT NULL,
  pakket TEXT NOT NULL DEFAULT 'solo',
  abonnement_status TEXT NOT NULL DEFAULT 'geen',
  stripe_customer_id TEXT NULL,
  stripe_subscription_id TEXT NULL,
  aangemaakt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessies (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  verloopt TEXT NOT NULL,
  aangemaakt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  domein TEXT NOT NULL,
  taal TEXT NOT NULL,
  land TEXT NOT NULL,
  platform TEXT NOT NULL,
  aangemaakt TEXT NOT NULL,
  UNIQUE (account_id, domein)
);
CREATE TABLE IF NOT EXISTS wachtlijst (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  domein TEXT NOT NULL,
  platform TEXT NOT NULL,
  aangemaakt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS geheimen (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  soort TEXT NOT NULL,
  versleuteld TEXT NOT NULL,
  aangemaakt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stripe_events (
  event_id TEXT PRIMARY KEY,
  soort TEXT NOT NULL,
  verwerkt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS logregels (
  id TEXT PRIMARY KEY,
  tijd TEXT NOT NULL,
  niveau TEXT NOT NULL,
  bericht TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS artikelen (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  site_id TEXT NOT NULL REFERENCES sites(id),
  maand TEXT NOT NULL,
  aangemaakt TEXT NOT NULL
);
-- R3: eenmalige links (e-mail bevestigen, wachtwoord herstellen). Alleen de sha256 van het token
-- staat hier. 'gebruikt' wordt gezet bij het eerste gebruik; daarna werkt de link niet meer.
CREATE TABLE IF NOT EXISTS eenmalige_tokens (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  doel TEXT NOT NULL,
  verloopt TEXT NOT NULL,
  gebruikt TEXT NULL,
  aangemaakt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS eenmalige_tokens_account_idx ON eenmalige_tokens(account_id);
-- Stap 3: voorstellen voor wijzigingen op een klantsite. Niets gaat live zonder goedkeuring in de app.
-- Per veld de nieuwe én de oude waarde, zodat terugzetten altijd kan. Het id is de idempotentiesleutel
-- richting de plugin: dezelfde wijziging twee keer sturen verandert niets.
CREATE TABLE IF NOT EXISTS wijzigingen (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  site_id TEXT NOT NULL REFERENCES sites(id),
  doel_type TEXT NOT NULL,
  doel_id TEXT NULL,
  modus TEXT NOT NULL,
  reden TEXT NOT NULL,
  status TEXT NOT NULL,
  melding TEXT NULL,
  terugzet_van TEXT NULL,
  maand TEXT NOT NULL,
  aangemaakt TEXT NOT NULL,
  bijgewerkt TEXT NOT NULL,
  gepubliceerd TEXT NULL
);
CREATE INDEX IF NOT EXISTS wijzigingen_site_status_idx ON wijzigingen(site_id, status);
-- Stap 4: klantinformatie per site, de basis voor elk artikel en voor de kwaliteitspoort.
CREATE TABLE IF NOT EXISTS siteprofielen (
  site_id TEXT PRIMARY KEY REFERENCES sites(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  bedrijf TEXT NOT NULL,
  diensten TEXT NOT NULL,
  plaats TEXT NOT NULL,
  ervaring TEXT NOT NULL DEFAULT '',
  doelgroep TEXT NOT NULL DEFAULT '',
  toon TEXT NOT NULL DEFAULT '',
  uitgesloten TEXT NOT NULL DEFAULT '',
  bijgewerkt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS wijzigingen_account_idx ON wijzigingen(account_id);
CREATE TABLE IF NOT EXISTS wijziging_velden (
  wijziging_id TEXT NOT NULL REFERENCES wijzigingen(id),
  veld TEXT NOT NULL,
  nieuw TEXT NOT NULL,
  oud TEXT NULL,
  PRIMARY KEY (wijziging_id, veld)
);
CREATE INDEX IF NOT EXISTS artikelen_site_maand_idx ON artikelen(site_id, maand);
CREATE INDEX IF NOT EXISTS sites_account_idx ON sites(account_id);
CREATE INDEX IF NOT EXISTS sessies_account_idx ON sessies(account_id);
CREATE INDEX IF NOT EXISTS logregels_tijd_idx ON logregels(tijd);
`;

function naarSqlite(sql) { return sql.replace(/\$(\d+)/g, '?$1'); }

class SqliteDb {
  constructor(bestand) { this.soort = 'sqlite'; this.bestand = bestand; }
  async open() {
    const { DatabaseSync } = await import('node:sqlite');
    this.db = new DatabaseSync(this.bestand);
    this.db.exec('PRAGMA foreign_keys = ON;');
    return this;
  }
  async query(sql, params = []) {
    const st = this.db.prepare(naarSqlite(sql));
    const obj = {}; params.forEach((v, i) => { obj[String(i + 1)] = v; });
    if (/^\s*(select|with)/i.test(sql) || /returning/i.test(sql)) return { rows: st.all(obj) };
    const r = st.run(obj); return { rows: [], rowCount: Number(r.changes) };
  }
  async exec(sql) { this.db.exec(sql); }
  // Transactie: één verbinding, dus transacties worden achter elkaar uitgevoerd (mutex) met
  // BEGIN IMMEDIATE (schrijfslot). Bij een fout ROLLBACK. Equivalent van de PG-transactie.
  async transactie(fn) {
    const vorige = this._rij || Promise.resolve();
    let klaar; this._rij = new Promise((ok) => { klaar = ok; });
    await vorige;
    try {
      this.db.exec('BEGIN IMMEDIATE');
      try { const r = await fn(this); this.db.exec('COMMIT'); return r; }
      catch (e) { this.db.exec('ROLLBACK'); throw e; }
    } finally { klaar(); }
  }
  async sluit() { this.db.close(); }
}

class PgDb {
  constructor(opties) { this.soort = 'pg'; this.opties = opties; }
  async open() {
    const pg = (await import('pg')).default;
    this.pool = new pg.Pool(this.opties);
    return this;
  }
  async query(sql, params = []) { const r = await this.pool.query(sql, params); return { rows: r.rows, rowCount: r.rowCount }; }
  async exec(sql) { await this.pool.query(sql); }
  // Echte transactie op één verbinding uit de pool; ROLLBACK bij elke fout.
  async transactie(fn) {
    const client = await this.pool.connect();
    const tx = { soort: 'pg', query: async (sql, params = []) => { const r = await client.query(sql, params); return { rows: r.rows, rowCount: r.rowCount }; } };
    try {
      await client.query('BEGIN');
      const r = await fn(tx);
      await client.query('COMMIT');
      return r;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { client.release(); }
  }
  async sluit() { await this.pool.end(); }
}

export async function maakDb(env = process.env) {
  if ((env.RC_DB || 'sqlite') === 'pg') {
    const opties = env.RC_DATABASE_URL ? { connectionString: env.RC_DATABASE_URL } : {
      host: env.PG_TEST_HOST || '127.0.0.1', port: Number(env.PG_TEST_PORT || 55432),
      user: env.PG_TEST_USER || 'postgres', database: env.PG_TEST_DB || 'rankcomet_test',
      password: env.PG_TEST_PWFILE ? readFileSync(env.PG_TEST_PWFILE, 'utf8').trim() : env.PGPASSWORD,
    };
    return new PgDb(opties).open();
  }
  return new SqliteDb(env.RC_SQLITE_BESTAND || ':memory:').open();
}

// Migraties verwijderen niets (alleen CREATE ... IF NOT EXISTS en kolommen toevoegen).
export async function migreer(db) {
  await db.exec(SCHEMA);
  // R3: moment waarop het e-mailadres is bevestigd (NULL = nog niet bevestigd).
  await voegKolomToe(db, 'accounts', 'email_geverifieerd', 'TEXT NULL');
  // Stap 2: koppelcode per site en het moment waarop het eigendom van het domein is bevestigd.
  await voegKolomToe(db, 'sites', 'koppelcode', 'TEXT NULL');
  await voegKolomToe(db, 'sites', 'eigendom_bevestigd', 'TEXT NULL');
  // Stap 3: een geheim kan bij een site horen (de pluginsleutel).
  await voegKolomToe(db, 'geheimen', 'site_id', 'TEXT NULL');
  // Stap 4: artikelen krijgen een zoekwoord, een status, een dag (temporem) en de koppeling met het voorstel.
  await voegKolomToe(db, 'artikelen', 'zoekwoord', 'TEXT NULL');
  await voegKolomToe(db, 'artikelen', 'status', "TEXT NOT NULL DEFAULT 'gereserveerd'");
  await voegKolomToe(db, 'artikelen', 'dag', 'TEXT NULL');
  await voegKolomToe(db, 'artikelen', 'wijziging_id', 'TEXT NULL');
  await voegKolomToe(db, 'artikelen', 'score', 'INTEGER NULL');
  await voegKolomToe(db, 'artikelen', 'melding', 'TEXT NULL');
  await voegKolomToe(db, 'artikelen', 'bijgewerkt', 'TEXT NULL');
}

// Toevoegende migratie: een kolom erbij als die er nog niet is. Verwijdert nooit iets.
async function voegKolomToe(db, tabel, kolom, definitie) {
  if (db.soort === 'pg') return db.exec(`ALTER TABLE ${tabel} ADD COLUMN IF NOT EXISTS ${kolom} ${definitie}`);
  const bestaat = (await db.query(`SELECT name FROM pragma_table_info('${tabel}')`)).rows.some((k) => k.name === kolom);
  if (!bestaat) await db.exec(`ALTER TABLE ${tabel} ADD COLUMN ${kolom} ${definitie}`);
}

// Alleen voor tests: maak alle Rankcomet-tabellen leeg (alleen eigen tabellen).
export async function leegVoorTest(db) {
  for (const t of ['siteprofielen', 'wijziging_velden', 'wijzigingen', 'eenmalige_tokens', 'artikelen', 'logregels', 'stripe_events', 'geheimen', 'wachtlijst', 'sites', 'sessies', 'accounts', 'bureaus']) {
    await db.query(`DELETE FROM ${t}`);
  }
}
