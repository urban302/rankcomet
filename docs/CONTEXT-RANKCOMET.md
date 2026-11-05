# Context: Rankcomet.ai (AI-SEO-agent op het Sevenai-platform)

Stand: 5-11-2026 (Amsterdamse tijd). Opgesteld uit de projectbestanden in /workspace/projecten/rankcomet/, de inhoudsopgave van rankcomet-r2.tar.gz en de Rankcomet-regels in /workspace/sevenai/status.md.
[A] = aanname of niet zelf gecontroleerd. Er staan geen geheimen, sleutels, tokens of persoonsgegevens in dit bestand.

## 1. Samenvatting
- Rankcomet.ai is een AI-SEO-agent: een fork van OpenSEO (MIT) plus functies naar het voorbeeld van Conqueror, eerst voor NL (bèta jan 2027), daarna DE (apr 2027).
- De MVP is alleen WordPress en WooCommerce. Shopify en Webflow volgen in v1 (feb 2027), Wix later (wachtlijst).
- Opdracht van Erwin op 27-10-2026; spec v2 goedgekeurd op 1-11-2026 16:23 (goedkeurmoment 1); de bouw startte dezelfde dag.
- R1 (blok 1) opgeleverd 1-11, testronde ROOD op één punt (F-R1-1). R2 (herstel + keuzes Erwin) opgeleverd 2-11 09:28, testronde GROEN (43/43 op sqlite en Postgres).
- Niets staat op een server. R3 start na vrijdag 6-11 09:04 (verbruiksreset). Blok 3 (Conquer-pijplijn) wacht op het stuk over de Conqueror-toestemming plus de sleutels.

## 2. Wat het product is
- **In één zin (spec):** Rankcomet zoekt voor de WordPress- of WooCommerce-site van een zzp'er of kleine webshop zelf kansrijke zoekwoorden, schrijft daar artikelen of product- en categorieteksten bij, zet die pas na goedkeuring door de klant live, ververst verouderde content (ook na goedkeuring) en volgt de rankings in een eenvoudig dashboard.
- **Doelgroep (besluit Erwin 1-11):** zelfstandige ondernemers en kleine webshops; daarnaast 3 tot 5 bureaus uit Erwins netwerk als proefklant, zonder white-label. Bureaulaag/white-label later, als bureaus erom vragen.
- **Kanalen:** dashboard (web), WordPress-plugin (REST, Yoast/Rank Math-velden, CPT's), WooCommerce (product- en categorieteksten), Google Search Console (alleen lezen), DataForSEO (zoekvolumes, SERP's, rank tracking), Azure OpenAI EU Data Zone, uitgaande e-mail onder merk Rankcomet.
- **Onderdelen:** zoekwoordonderzoek (uit OpenSEO), contentgeneratie via de "Conquer-pijplijn" (onderzoek → brief → artikel → interne links → goedkeuring → publiceren, met versiebeheer), publicatie per platform, contentrefresh (trigger: positie + klikken + leeftijd, drempels per site), rankings, maandrapport. GEO-zichtbaarheid pas na de bèta.
- **Harde regels:** geen publicatie zonder menselijk akkoord (geen auto-publish); geen backlink-uitwisseling; rem op volume; productie alleen in de EU (OVH + Azure EU); MIT-vermelding OpenSEO blijft; alleen testdata tijdens bouw; een retry publiceert nooit dubbel; velden buiten SEO/tekst (prijs, voorraad) blijven ongemoeid; geheimen nooit in logs of chat; strikte scheiding per account.
- **Verkoop vóór lancering:** Erwin verkoopt zelf een handmatige SEO-dienst met een Grokbot als werkplaats, buiten het bouwteam en buiten de productieomgeving.

## 3. Architectuur en techniek
- **Basis:** fork van OpenSEO (MIT), commit 1523750b (30-10-2026). LICENSE ongewijzigd; MIT-vermelding in README.md en op /over.
- **Eigen kern `rankcomet-core/`** [A1 van de Bouwer]: Node 24 (min. 22.5), alleen node:http, node:crypto, node:sqlite plus `pg` 8.13.1. Reden: OpenSEO draait standaard op Cloudflare Workers + D1 (TanStack Start, better-auth, drizzle); de kleinste route naar Node + Postgres op OVH was een eigen kern. De OpenSEO-code (zoekwoordonderzoek) wordt later via een adapter aangesloten.
- **Database:** productie alleen Postgres 14+ (start geweigerd zonder `RC_DB=pg`); tests op sqlite in geheugen en op een lokale test-PG. Migraties alleen `CREATE ... IF NOT EXISTS`.
- **Accounts:** e-mail + wachtwoord (scrypt, min. 12 tekens), sessietoken 32 bytes, alleen sha256 in DB, 7 dagen, cookie HttpOnly/Secure/SameSite=Strict, Origin-controle tegen CSRF. Datamodel bureaus > accounts > sites (bureau_id nu NULL).
- **Betalen:** Stripe in testmodus met mock; checkout (subscription, locale nl, Stripe Tax, btw-nummer), webhook met HMAC-controle (300 s), idempotentie via stripe_events. Live-sleutels worden geweigerd. Echte Stripe-client nog niet gekoppeld.
- **AI:** Azure OpenAI-client accepteert alleen een EU-regio uit een vaste lijst, een Data Zone-deploymenttype en een Azure-endpoint; anders startweigering. Hetzelfde model als billr2; kosten per artikel worden opnieuw gemeten.
- **Geheimen:** AES-256-GCM met account-id als AAD (zoals billr2); sleutelrotatie nog niet gebouwd.
- **Logs:** e-mail, IP, sleutels/tokens en wachtwoorden gemaskeerd; bewaartermijn standaard 90 dagen, opruimen elke 6 uur.
- **Concurrency (R2):** Stripe-claim en verwerking in één transactie; sitelimiet en artikellimiet met `SELECT ... FOR UPDATE` per account op PG.
- **Offline installatie (R2):** de 13 runtime-pakketten (pg en afhankelijkheden) als tarballs in `rankcomet-core/vendor/`; `npm ci --offline` werkt zonder netwerk.

## 4. Wat er per ronde gebouwd is
### R1 (blok 1), 1-11-2026, archief rankcomet-r1.tar.gz (sha256 6c8c3ff2…f1f9)
1. Fork + licentievermelding (README, /over).
2. Accounts, inloggen, sessies; alle site-query's gefilterd op account_id.
3. Pakketten in `config/pakketten.json` (Solo €39, Pro €89, Bureau-proef €149, excl. btw); sitelimiet met NL-melding en link naar /pakketten; hulpfuncties voor artikel- en zoekwoordlimieten.
4. Stripe testmodus (checkout, webhook, abonnementsstatus per account).
5. NL-UI (kale HTML): inloggen, registreren, dashboard-shell, site toevoegen (overige platforms → wachtlijst), pakketten, over. Merk in `config/merk.json`.
6. EU-config: Postgres verplicht, Azure EU-controle, AES-GCM-geheimen, gemaskeerde logs.
7. 32 tests (node:test).

### R2 (herstel + keuzes Erwin), 2-11-2026 09:28, archief rankcomet-r2.tar.gz (sha256 a7ba42e5…0511)
1. Herstel F-R1-1 (src/stripe.js, nieuw `db.transactie` in src/db.js): bij een fout ROLLBACK, herhaalpoging wordt opnieuw verwerkt.
2. Sitelimiet met transactie + rijslot (src/sites.js).
3. Offline dependencies in vendor/.
4. Keuzes Erwin verwerkt: A6 (10 artikelen per site per maand bij Bureau-proef, src/artikelen.js + tabel artikelen), A7 (100 zoekwoorden voor elk pakket), A8 (WooCommerce alleen Pro; Solo krijgt 403 met u-vormmelding en upgradelink), A16 (alleen NL/BE, alleen nl). Pakkettenpagina toont artikellimiet per site en 'WooCommerce-webshop koppelen'.
5. 43 tests (32 uit R1 + 11 nieuw in tests/r2.test.js).

### Bestanden in rankcomet-core (R2)
| Map/bestand | Inhoud |
|---|---|
| src/server.js, app.js | Startpunt en HTTP-app |
| src/accounts.js, wachtwoord.js | Accounts, sessies, scrypt |
| src/sites.js | Sites toevoegen, sitelimiet, platformcontrole |
| src/pakketten.js, artikelen.js | Pakketlimieten, artikelreservering |
| src/stripe.js | Checkout en webhook |
| src/azure.js, config.js | Azure EU-client, configcontrole |
| src/db.js, geheimen.js, log.js | Opslag/transacties, AES-GCM, gemaskeerde logs |
| config/pakketten.json, merk.json | Pakketten en merk |
| prompts/LEESMIJ.md | Lege promptmap (nog geen prompts) |
| tests/ | accounts, eu-config, pakketten, r2, scheiding, sites-ui, stripe + helpers |
| vendor/ | 13 npm-tarballs (pg 8.13.1 e.a.) |
| installatie.md, package.json, package-lock.json | Installatie en afhankelijkheden |

Daarnaast bevat het archief de volledige OpenSEO-fork (src/, docs/, deploy/, drizzle/, scripts/, .agents/skills/, GitHub-workflows); die is Engelstalig, niet omgebouwd en niet getest. Archief: 2564 items; node_modules en .git uitgesloten.

## 5. Testuitslagen
- **R1 (Tester, 1-11, 16:33–16:40): ROOD.** sqlite 32/32 groen; eigen checks groen op scheiding per account, prijzen, sitelimiet, webhookhandtekening, idempotentie, Azure-EU-weigering, versleuteling, logmaskering, Nederlandse teksten, licentie, sleutelscan en rooktest. Rood: **F-R1-1** – een event dat bij de verwerking faalt, werd bij de herhaling als "dubbel" gemarkeerd en ging verloren. PG-run niet gedraaid (pg niet installeerbaar zonder internet).
- **R2 (Tester, 2-11, 09:31): GROEN**, geen nieuwe bevindingen. F-R1-1 hersteld (sqlite en PG); sitelimiet bij 10 gelijktijdige aanvragen nooit overschreden; `npm ci --offline` slaagt zonder netwerk; A6, A7, A8, A16 en rooktest groen; suite sqlite 43/43 en PG 43/43. Groen is geen uitrolopdracht.
- **Kanttekeningen R2:** A6 en A7 alleen op functieniveau getest (er is nog geen artikel- of zoekwoordenflow); een event met onbekend pakket geeft blijvend 400 (Stripe blijft herhalen, geen dead-letter-tabel); artikelmaand loopt in UTC.

## 6. Keuzes van Erwin (1-11-2026)
- Goedkeurmoment 1 (16:23): spec v2 goedgekeurd, de Bouwer mag beginnen.
- OV3 a: de Conqueror-toestemming ligt schriftelijk vast; Erwin zet het stuk op de box. Conqueror-functies vallen binnen scope.
- OV4 a: validatie gehaald (3 bureaus met intentie, 20 op de wachtlijst).
- OV5 a: domein rankcomet.ai.
- OV7 a: facturatie via Stripe.
- OV8: Solo €39, Pro €89 voor webshops, proefprijs bureaus €149.
- A7: 100 zoekwoorden per pakket. A8: WooCommerce alleen in Pro. A16: alleen NL en BE, in het Nederlands. A6: 10 artikelen per site per maand (50 bij Bureau-proef met 5 sites).
- Overige besluiten (Projectleider/Erwin 1-11): bouwplan-Page volstaat als bron; Azure-model zoals billr2; GEO na de bèta; refresh op positie+klikken+leeftijd; OVH-datacenter zoals billr2; Analist maakt concept-AVV op basis van billr2.
- 3-11 16:56 (via Joost): nieuwe leveringen, waaronder Rankcomet R3, pas na de verbruiksreset vr 6-11 09:04.

## 7. Waar het draait en installatie
- **Draait nergens live.** Gepland: OVH, zelfde datacenter als billr2, achter een reverse proxy met TLS. Uitrol alleen door de Serverbeheerder na een aparte ja van Erwin.
- **Lokaal/test:**
  ```
  tar -xzf rankcomet-r2.tar.gz -C <map> && cd <map>/rankcomet/rankcomet-core
  npm ci --offline
  env -u RC_DB -u PGPASSWORD npm test          # sqlite
  RC_DB=pg PG_TEST_HOST=127.0.0.1 PG_TEST_PORT=55432 PG_TEST_PWFILE=<pad> npm run test:pg
  ```
- **Productie:** `RC_DB=pg RC_DATABASE_URL=... node src/server.js` (poort standaard 3100 op 127.0.0.1). De app start niet als Postgres, Azure-EU-config, geheimensleutel of Stripe-testconfig ontbreekt.
- **Env-variabelen (alleen namen; waarden staan nergens in de bestanden):** RC_DB, RC_DATABASE_URL, RC_POORT, RC_STRIPE_SECRET_KEY, RC_STRIPE_WEBHOOK_SECRET, RC_STRIPE_PRICE_SOLO/PRO/BUREAU_PROEF, RC_GEHEIMEN_SLEUTEL, RC_AZURE_OPENAI_ENDPOINT/REGIO/DEPLOYMENT_TYPE/DEPLOYMENT/KEY/API_VERSIE, RC_LOG_BEWAAR_DAGEN, RC_CONFIG_DIR; alleen tests: RC_SQLITE_BESTAND, PG_TEST_*. Er bestaan nog geen productiesleutels voor Rankcomet [A: niet gevonden in de bronnen].

## 8. Wat er openstaat
### R3 en volgende blokken
- R3 start na vr 6-11 09:04, na sein aan de Bouwer. Genoemd onderwerp: artikelmaand in NL-tijd i.p.v. UTC.
- Bouwvolgorde spec: 2) WordPress-plugin + WooCommerce; 3) Conquer-pijplijn NL met goedkeuringsrij en versiebeheer; 4) Search Console + rank tracking; 5) bèta NL jan 2027; 6) Shopify-app feb 2027; 7) Webflow feb 2027; 8) DE-lokalisatie en lancering apr 2027; 9) bureaulaag/white-label en GEO later.
- [A] Of R3 al aan blok 2 begint of eerst kleine punten afrondt, staat niet expliciet in de bronnen.

### Blok 3 (Conquer-pijplijn)
- Wacht op het schriftelijke stuk over de Conqueror-toestemming (Erwin zet het op de box) en de API-gegevens van het Conqueror-account (regelt Erwin).

### Open vragen en benodigdheden
- **A20:** mag de Bureau-proef WooCommerce koppelen? Nu toegestaan als aanname, niet door Erwin besloten.
- **Artikelmaand:** UTC of NL-tijd (staat voor R3).
- **A21:** Bureau-proef: naast 10 per site ook max. 50 per account – bevestigen.
- **Sleutels/config nodig:** Stripe-testaccount, price-id's en webhook-geheim; Azure OpenAI EU-endpoint, regio en deploymentnaam; DataForSEO; Conqueror-API.
- **Nog niet gebouwd:** echte Stripe-client, klantportaal, facturen/btw-verlegd; wachtwoord-vergeten, e-mailverificatie, rate limiting, 2FA; styling UI; sleutelrotatie; wachtrij/workers; prompts; koppeling OpenSEO-app met de kern; eigendomscontrole van domeinen (twee accounts kunnen hetzelfde domein toevoegen).
- **Compliance:** rechtspersoon, AV, privacyverklaring en concept-AVV nog niet in de UI; Azure-deploymenttype wordt niet bij Azure geverifieerd (bij uitrol controleren).
- **Spec-aandachtspunten:** prognose uit het bouwplan geldt niet zonder meer (andere doelgroep, Azure i.p.v. Anthropic, OVH i.p.v. Hetzner); Search Console-goedkeuring kan weken duren.

## 9. Waar de bestanden staan
| Pad | Inhoud |
|---|---|
| /workspace/projecten/rankcomet/spec.md | Bouwspec v2 (Analist, 1-11) |
| …/keuzes-erwin-2026-11-01.md | Keuzes Erwin bij goedkeurmoment 1 |
| …/R1-OVERZICHT.md, R2-OVERZICHT.md | Opleveroverzichten per ronde |
| …/installatie.md, installatie-r2.md | Installatie, env-namen en aannames A1–A26 |
| …/testrapport-r1.md, testrapport-r2.md | Testrapporten |
| …/status.md | Projectstatus (laatst 1-11 09:05, verouderd) |
| …/rankcomet-r1.tar.gz, rankcomet-r2.tar.gz (+ .sha256) | Code-archieven |
| /workspace/sevenai/status.md | Teamstatus met Rankcomet-regels |
| Bouwplan-Page (canvas c59c0888, store Projectleider · Research) | Oorspronkelijk bouwplan en validatie |
