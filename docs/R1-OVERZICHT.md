# Rankcomet.ai R1 (blok 1): overzicht

Status: ingeleverd voor de test. Niet "af"; dat bepaalt de Tester. Niets uitgerold, niets op een server gezet.

## Basis
- Fork van OpenSEO (MIT), commit 1523750b76857324573a086b1d93bd3c3612b5b1 (30-10-2026). LICENSE ongewijzigd; MIT-vermelding in README.md en op /over.
- Blok 1 staat in `rankcomet/rankcomet-core/` (Node 24, node:http, node:crypto, node:sqlite, pg 8.13.1). Waarom een eigen kern: zie [A1] in installatie.md.

## Gebouwd
1. Fork + licentievermelding (README, /over).
2. Accounts: registreren/inloggen met e-mail + wachtwoord (scrypt), sessies (alleen hash in DB, 7 dagen, HttpOnly/Secure/SameSite=Strict, Origin-controle). Datamodel bureaus > accounts > sites (bureau_id nu NULL). Alle site-query's gefilterd op account_id; tests op laag- en HTTP-niveau.
3. Pakketten in `config/pakketten.json` (Solo €39 / 1 site / 10 art. / 100 zw; Pro €89 / 3 / 30 / WooCommerce-producten; Bureau-proef €149 / 5 / 50), excl. btw. Sitelimiet afgedwongen met NL-melding ("Je pakket Solo staat maximaal 1 site toe. Upgrade naar Pro ...") en link naar /pakketten. Hulpfuncties voor artikel- en zoekwoordlimieten (gebruik in latere blokken).
4. Stripe testmodus met mock: checkout-sessie (subscription, locale nl, Stripe Tax), webhook /stripe/webhook met HMAC-controle (300 s tolerantie) en idempotentie (stripe_events, ook bij 5 gelijktijdige gelijke events = 1). Abonnementsstatus per account (actief, achterstallig, opgezegd, ...). Live-sleutels geweigerd.
5. NL-UI: inloggen, registreren, dashboard-shell, site toevoegen (domein, taal nl, land NL/BE, WordPress/WooCommerce; overige platforms naar wachtlijst), pakketten, over. Merk/domein in `config/merk.json`.
6. EU-config: start alleen met Postgres; Azure OpenAI-client accepteert alleen EU-regio + Data Zone-deployment + Azure-endpoint, anders startweigering (transport gemockt in tests). AES-256-GCM-geheimen met account-AAD. Logs gemaskeerd (e-mail, IP, sleutels, tokens), bewaartermijn RC_LOG_BEWAAR_DAGEN standaard 90 met opruimen.
7. 32 tests (node:test), groen op sqlite en op de test-PG (database rankcomet_test).

## Testen (exacte commando's)
```
cd /tmp/wRC1 && mkdir t && tar -xzf /workspace/projecten/rankcomet/rankcomet-r1.tar.gz -C t   # of een eigen map
cd t/rankcomet/rankcomet-core && npm ci
# standaard (sqlite in geheugen)
env -u RC_DB -u PGPASSWORD npm test
# test-PG (database rankcomet_test moet bestaan)
env -u PGPASSWORD RC_DB=pg PG_TEST_HOST=127.0.0.1 PG_TEST_PORT=55432 PG_TEST_PWFILE=/tmp/pgtest/pw npm run test:pg
```
Let op: de PG-tests maken de Rankcomet-tabellen in rankcomet_test leeg (alleen die database).

## Bekende beperkingen
- De OpenSEO-app zelf (TanStack Start, Cloudflare/D1, better-auth) is niet omgebouwd en niet getest; alleen meegeleverd als fork. Koppeling met de Rankcomet-kern volgt.
- Geen echte Stripe-client, geen klantportaal, geen facturen/btw-verlegd-test.
- Geen wachtwoord-vergeten, e-mailverificatie, rate limiting op inloggen, 2FA.
- UI is kale HTML zonder styling.
- Azure-deploymenttype wordt niet bij Azure geverifieerd (opgegeven waarde).
- Geen sleutelrotatie voor geheimen; geheimen-tabel nog zonder gebruik (CMS-tokens komen in blok 2).
- Geen wachtrij/workers (spec 5.8) in R1.

## Open punten
- Conqueror: voor R1 geen sleutels nodig. Voor blok 3 zijn API-gegevens van het Conqueror-account nodig (regelt Erwin).
- Stripe: testaccount + price-id's voor de drie pakketten (env), en het webhook-geheim.
- Azure OpenAI EU-deployment (zelfde model als billr2): endpoint, regio, deploymentnaam.
- Bevestigen: [A6] 50 artikelen Bureau-proef, [A7] 100 zoekwoorden voor alle pakketten, [A8] WooCommerce bij Solo, [A16] landen NL/BE.
- Rechtspersoon/AV/privacyverklaring op de site: nog niet in de UI.
- Uitrol op OVH: niets gedaan; vraagt een aparte ja van Erwin en de Serverbeheerder.
