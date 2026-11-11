# Rankcomet: vaste regels voor Claude Code

Lees bij de start ook `VOLGENDE-STAPPEN.md`, `docs/CONTEXT-RANKCOMET.md`, `docs/R2-OVERZICHT.md` en `rankcomet-core/installatie.md` (env-namen en aannames A1 tot A56).

## Wat dit is
Rankcomet.ai is een AI-SEO-agent voor ondernemers in Nederland en België. Hij koppelt met WordPress (en WooCommerce), stelt verbeteringen en artikelen voor en zet alles klaar als concept. De ondernemer keurt goed, pas dan gaat iets live.

De repo is een fork van OpenSEO (MIT). Daarnaast staat onze eigen kern in `rankcomet-core/`:
- Node 24 (minimaal 22.5), alleen `node:http`, `node:crypto`, `node:sqlite` en `pg` 8.13.1.
- Productie draait alleen op Postgres (`RC_DB=pg`). SQLite is alleen voor tests.
- Accounts, pakketten (Solo €39, Pro €89, Bureau-proef €149, excl. btw), Stripe in testmodus, NL-UI, EU-config voor Azure OpenAI.
- Van OpenSEO is alleen de code voor zoekwoordonderzoek bewaard, in `vendor-openseo/` (zie de LEESMIJ daar). Die draait nog niet; de kern koppelt hem later via een adapter.
- De WordPress-plugin staat in `wordpress-plugin/` (PHP). `includes/protocol.php` moet gelijk blijven aan `src/wordpress.js` en `src/velden.js`; een test bewaakt dat.

`AGENTS.md` verwijst alleen naar dit bestand. De OpenSEO-regels (Every App, Cloudflare, `wrangler deploy`) gelden niet meer.

## Harde regels (nooit van afwijken)
- **Niets publiceren zonder akkoord van een mens.** Elke wijziging op een klantsite gaat eerst als concept. Publiceren gebeurt pas na een expliciete goedkeuring in de app.
- **Een herhaalpoging publiceert nooit twee keer.** Elke actie richting een klantsite is idempotent (vaste sleutel per wijziging).
- **Prijs- en voorraadvelden blijven onaangeroerd.** Rankcomet schrijft nooit naar prijs, voorraad, SKU of bestelgegevens in WooCommerce.
- **Geen linkruil en geen gekochte links.** Geen functie die backlinks uitwisselt of plaatst.
- **Volumerem.** Er is een harde grens op het aantal artikelen en wijzigingen per site per periode, in code, niet in een prompt.
- **Strikt gescheiden per account.** Elke query op klantdata filtert op het account (en de site). Een site of artikel van een ander account geeft 404 en doet niets. Elke nieuwe functie krijgt een test "account A ziet niets van account B".
- **Alleen EU.** Azure OpenAI alleen in een EU-regio met een DataZone-deploymenttype (zie `src/config.js`). Geen andere AI-diensten buiten de EU.
- **Alleen testdata.** Stripe alleen met `sk_test_`. Live-sleutels worden bij de start geweigerd en dat blijft zo.
- **Geheimen** alleen via env (en Docker-secrets bij de uitrol). Klantsleutels versleuteld met AES-256-GCM (`src/geheimen.js`). Nooit een sleutel, token, wachtwoord of code in een log, test-uitvoer, commit of chatbericht.
- **Geen persoonsgegevens in logs.** Alleen ids, aantallen en fouttypes. `src/log.js` maskeert, maar log er ook niet om heen.
- **De MIT-vermelding van OpenSEO blijft staan** (`LICENSE` en de herkomst in de README).
- **Alleen NL en BE, alleen Nederlands.**
- **Geen nieuwe pakketten zonder overleg.** Runtime-afhankelijkheden staan als tarball in `rankcomet-core/vendor/`. Tests gebruiken alleen `node:test`.
- **Migraties zijn alleen `CREATE ... IF NOT EXISTS` of toevoegend.** Nooit iets verwijderen in een migratie zonder overleg.
- **Niets live zetten.** Werk op een branch en lever aan als pull request naar `main`. Uitrollen doet de Serverbeheerder (Grokbot), pas na een ja van Erwin.

## Tests
```
cd rankcomet-core
npm ci --offline
env -u RC_DB -u PGPASSWORD npm test          # SQLite, nu 93/93 groen
RC_DB=pg PG_TEST_HOST=... PG_TEST_USER=... PG_TEST_DB=... PG_TEST_PWFILE=... npm run test:pg
```
- Tests moeten groen blijven op SQLite. Raakt je wijziging de database, draai dan ook de PG-tests (of meld dat er geen test-PG was).
- Nieuwe functie = nieuwe tests. Test via de publieke ingang (HTTP-route of servicefunctie), niet via interne details.
- Gelijktijdigheid (limieten, publiceren) testen we ook op PG, zoals in A25 (`FOR UPDATE`).

## Schrijfstijl voor alles wat een gebruiker ziet
- Gewoon Nederlands, je-vorm, korte zinnen. Een leek moet het snappen.
- **Geen em-dashes.** Gebruik een komma, punt of "tot".
- Geen systeemwoorden in de app (geen ids, geen statusnamen als `concept_klaar`).
- Commentaar en documentatie in het Nederlands, net als de bestaande code. Markeer aannames met `[A..]` en zet ze in `rankcomet-core/installatie.md`.

## Werkwijze
- Eén stap uit `VOLGENDE-STAPPEN.md` per pull request. Zet in de PR wat je hebt gedaan, welke aannames je nam en wat Erwin moet beslissen.
- Twijfel je over een productkeuze (prijzen, limieten, wat een pakket mag), maak dan een aanname `[A..]`, kies de veiligste optie en zet de vraag in de PR.
- Werk `VOLGENDE-STAPPEN.md` bij als een stap klaar is.
