# Installatie Rankcomet.ai (R2, blok 1 + herstel)

Niets hiervan is uitgerold. De uitrol op OVH doet de Serverbeheerder, pas na een aparte ja van Erwin.

## Vereisten
- Node.js 24 (minimaal 22.5 voor node:sqlite in de tests)
- Postgres 14+ (productie)

## Stappen (lokaal/test)
```
cd rankcomet/rankcomet-core
npm ci --offline      # sinds R2: alle dependencies staan in vendor/ (geen internet nodig)
npm test
```
Productie: `RC_DB=pg RC_DATABASE_URL=... (overige env) node src/server.js`. De app weigert te starten als Postgres, de EU-Azure-config, de geheimensleutel of de Stripe-testconfig ontbreekt of niet klopt. Zet de app achter een reverse proxy met TLS (cookie is Secure).

## Env-variabelen (alleen namen)
| Naam | Doel |
|---|---|
| RC_DB | pg in productie; leeg/sqlite alleen tests |
| RC_DATABASE_URL | Postgres-verbinding (productie) |
| RC_POORT | luisterpoort, standaard 3100 op 127.0.0.1 |
| RC_STRIPE_SECRET_KEY | Stripe-sleutel, alleen sk_test_ toegestaan |
| RC_STRIPE_WEBHOOK_SECRET | webhook-geheim (whsec_) |
| RC_STRIPE_PRICE_SOLO | Stripe price-id Solo |
| RC_STRIPE_PRICE_PRO | Stripe price-id Pro |
| RC_STRIPE_PRICE_BUREAU_PROEF | Stripe price-id Bureau-proef |
| RC_GEHEIMEN_SLEUTEL | AES-256-GCM-sleutel, 32 bytes base64 |
| RC_AZURE_OPENAI_ENDPOINT | https://<naam>.openai.azure.com |
| RC_AZURE_OPENAI_REGIO | EU-regio |
| RC_AZURE_OPENAI_DEPLOYMENT_TYPE | DataZoneStandard e.d. |
| RC_AZURE_OPENAI_DEPLOYMENT | deploymentnaam |
| RC_AZURE_OPENAI_KEY | API-sleutel |
| RC_AZURE_OPENAI_API_VERSIE | optioneel, standaard 2024-10-21 |
| RC_LOG_BEWAAR_DAGEN | optioneel, standaard 90 |
| RC_CONFIG_DIR | optioneel, map met pakketten.json en merk.json |
| RC_SQLITE_BESTAND | alleen tests |
| PG_TEST_HOST / PG_TEST_PORT / PG_TEST_USER / PG_TEST_DB / PG_TEST_PWFILE | alleen tests tegen de test-PG |

## Aannames
- [A1] Blok 1 is gebouwd als los Node-pakket `rankcomet-core/` in de OpenSEO-fork (Node 24, alleen node:http/node:crypto/node:sqlite + `pg`), niet in de TanStack/Cloudflare-stack van OpenSEO. OpenSEO draait standaard op Cloudflare Workers + D1 (Postgres is daar opt-in, met better-auth/drizzle); de kleinste route naar Node + Postgres op OVH was een eigen kern. De OpenSEO-code (zoekwoordonderzoek) wordt in een later blok via een adapter aangesloten.
- [A2] Standaard-testopzet = node:sqlite in geheugen; productie alleen Postgres (start geweigerd zonder RC_DB=pg).
- [A3] Wachtwoord-hash scrypt N=2^15, r=8, p=1, 16-byte zout; minimaal 12 tekens.
- [A4] Sessies: willekeurig token van 32 bytes, alleen sha256 in de database, 7 dagen geldig, cookie HttpOnly, Secure, SameSite=Strict; CSRF ook via Origin-controle.
- [A5] Datamodel account > site; kolom accounts.bureau_id (nu altijd NULL) + tabel bureaus als ruimte voor de latere bureaulaag.
- [A6] Besloten door Erwin 1-11: Bureau-proef 10 artikelen per maand PER SITE (5 sites, dus 50 totaal), niet vrij te verdelen. Afgedwongen in src/artikelen.js (reserveerArtikel, transactie + rijslot); config `artikelen_per_site_per_maand`.
- [A7] Besloten door Erwin 1-11: 100 zoekwoorden volgen voor elk pakket.
- [A8] Besloten door Erwin 1-11: WooCommerce alleen in Pro. Solo kan geen WooCommerce-site koppelen (403, u-vormmelding, upgradelink naar /pakketten). Config `woocommerce_koppelen`.
- [A9] Upgradepad Solo > Pro > Bureau-proef; boven Bureau-proef: 'neem contact op'.
- [A10] Btw via Stripe Tax (automatic_tax) en btw-nummer via tax_id_collection; bedragen in config zijn excl. btw. Btw verlegd/ICP nog niet getest.
- [A11] De echte Stripe-client is in R1 niet gekoppeld; alleen een geïnjecteerde mock. Live-sleutels (sk_live_) worden bij de start geweigerd.
- [A12] Webhook-tolerantie 300 s (Stripe-standaard); idempotentie via primaire sleutel op stripe_events.event_id (INSERT ... ON CONFLICT DO NOTHING), sinds R2 in dezelfde transactie als de verwerking (F-R1-1); een event-volgorde-garantie is er niet.
- [A13] Azure EU: regio moet in een vaste EU-lijst staan (swedencentral, westeurope, northeurope, francecentral, germanywestcentral, italynorth, polandcentral, spaincentral) en het deploymenttype moet DataZoneStandard/DataZoneProvisionedManaged/DataZoneBatch zijn; endpoint https://<naam>.openai.azure.com of .cognitiveservices.azure.com. De app kan het deploymenttype niet bij Azure verifiëren; het is een opgegeven waarde (in de uitrol te controleren).
- [A14] AES-256-GCM-geheimen zoals billr2: sleutel 32 bytes base64 in env, 12-byte nonce, account-id als AAD, formaat v1.iv.ct.tag. Sleutelrotatie nog niet gebouwd.
- [A15] Logs: e-mail, IP, sleutels/tokens en wachtwoord=... gemaskeerd; logregels in de database, bewaartermijn RC_LOG_BEWAAR_DAGEN (standaard 90), opruimen elke 6 uur.
- [A16] Besloten door Erwin 1-11: alleen NL en BE, alleen nl.
- [A17] Wachtlijst-platforms: Shopify, Webflow, Wix, Lightspeed, Ander platform.
- [A18] Geen prompts in R1; map rankcomet-core/prompts/ is leeg (met LEESMIJ).
- [A19] Migraties zijn alleen CREATE ... IF NOT EXISTS en verwijderen niets.
- [A20] (R2) Bureau-proef mag een WooCommerce-site koppelen (net als Pro, `woocommerce_koppelen: true`). Bevestigd door Erwin op 5-11.
- [A21] (R2, bevestigd door Erwin op 5-11) Bureau-proef: naast 10 per site geldt ook het totaal van 50 per account; Solo (10) en Pro (30) houden alleen een limiet per account.
- [A22] (R2) Een artikelmaand is de kalendermaand in UTC (`YYYY-MM`). Een artikel telt zodra het is gereserveerd; terugboeken bij een mislukte generatie volgt in het artikelblok.
- [A23] (R2) Een webhook die bij de verwerking faalt (bijv. onbekend pakket) geeft 400 (Fout) of 500 (andere fout) en wordt niet vastgelegd; Stripe probeert het opnieuw. Een blijvend fout event blijft dus terugkomen tot Stripe stopt (max. ca. 3 dagen); er is nog geen aparte 'dead letter'-tabel.
- [A24] (R2) Transacties op sqlite (alleen tests): één verbinding, transacties achter elkaar via een mutex met BEGIN IMMEDIATE. Losse query's buiten een transactie kunnen daar tussendoor lopen; dat is alleen in de testopzet zo.
- [A25] (R2) Sitelimiet en artikellimiet op PG: transactie + `SELECT ... FROM accounts WHERE id = $1 FOR UPDATE` (rijslot per account). Bewezen: zonder FOR UPDATE geeft de test met 10 gelijktijdige aanvragen op PG te veel sites; met het slot nooit.
- [A26] (R2) Vendoring: de 13 runtime-pakketten (pg 8.13.1 en afhankelijkheden, zie package-lock.json) staan als npm-pack-tarballs in `rankcomet-core/vendor/` met `file:`-verwijzingen in package.json. node_modules wordt niet meegeleverd (uitgesloten in het archief, zoals in R1); `npm ci --offline` bouwt het uit vendor/ op. Testdeps zijn er niet (alleen node:test). De tarballs zijn met `npm pack` gemaakt uit de pg-installatie van R1 (zelfde versies); hun sha512 staat in package-lock.json en wijkt af van de registry-tarballs.
- [A27] (stap 0) Van OpenSEO is alleen de zoekwoordcode bewaard (plus een paar bestanden voor Search Console, rank tracking en de veilige fetcher onder "later"), in `vendor-openseo/` op de oorspronkelijke paden. Het is alleen bron; de adapter zet het later om naar JavaScript in de kern. De rest is verwijderd en staat nog in commit 3c11373.
- [A28] (stap 0) `rankcomet-core/package-lock.json` staat nu in git. De oude `.gitignore` van OpenSEO sloot elk `package-lock.json` uit, waardoor `npm ci --offline` op een verse checkout niet werkte. Het bestand is opnieuw gemaakt met `npm install --offline` uit `vendor/`; alle 13 pakketten wijzen naar `file:vendor/...`.
