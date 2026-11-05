# Rankcomet.ai R2: overzicht (voorbereid, nog niet opgeleverd)

Status: voorbereid in /tmp/wRC2. Niet "af"; dat bepaalt de Tester. Niets uitgerold, niets op een server.
Basis: R1 (archief-sha 6c8c3ff2…f1f9). Archief: /tmp/wRC2/rankcomet-r2.tar.gz.

## Gewijzigd
1. F-R1-1 (src/stripe.js, verwerkWebhook): de claim in stripe_events en de verwerking lopen in één transactie (`db.transactie`, nieuw in src/db.js). Fout bij de verwerking = ROLLBACK; de herhaalpoging wordt opnieuw verwerkt. Gelijktijdige dubbele events: op PG wacht de tweede op het unieke event_id, op sqlite lopen transacties achter elkaar. Naspel Tester (evt_test_nep2 twee keer): nu 400 en 400, niets vastgelegd.
2. Sitelimiet (src/sites.js): telling en insert in een transactie met `SELECT ... FOR UPDATE` op het account (PG). Test: 10 gelijktijdige aanvragen per pakket, nooit boven de limiet. Zonder het slot faalt die test op PG (gecontroleerd).
3. Offline: pg 8.13.1 en de 12 afhankelijkheden als tarballs in rankcomet-core/vendor/, `file:`-verwijzingen, package-lock.json zonder registry-URL's. `npm ci --offline` werkt met een lege cache zonder netwerk.
4. Besluiten Erwin 1-11: A6 (10 artikelen per site per maand bij Bureau-proef, src/artikelen.js + tabel artikelen), A7, A8 (WooCommerce alleen Pro; Solo krijgt 403 met u-vormmelding en upgradelink), A16. Pakkettenpagina toont de artikellimiet per site en 'WooCommerce-webshop koppelen'.

## Testen
```
tar -xzf rankcomet-r2.tar.gz -C <map> && cd <map>/rankcomet/rankcomet-core
npm ci --offline
env -u RC_DB -u PGPASSWORD npm test
env -u PGPASSWORD RC_DB=pg PG_TEST_HOST=127.0.0.1 PG_TEST_PORT=55432 PG_TEST_PWFILE=/tmp/pgtest/pw npm run test:pg
```
43 tests (32 uit R1, 11 nieuw in tests/r2.test.js). Eén R1-test aangepast: de tweede Solo-site in de HTTP-test is nu WordPress (WooCommerce wordt bij Solo eerder geweigerd).

## Archief
`tar --sort=name --mtime='2026-10-25 14:00' --owner=0 --group=0 --numeric-owner --exclude='__pycache__' --exclude='node_modules' --exclude='rankcomet/.git' -cf - rankcomet | gzip -n > rankcomet-r2.tar.gz` (vanuit /tmp/wRC2). node_modules en .git zijn uitgesloten, zoals in R1; de dependencies zitten in vendor/ ([A26]).
