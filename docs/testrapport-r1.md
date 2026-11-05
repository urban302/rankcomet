# Testrapport Rankcomet.ai R1 (blok 1)

Tester · Sevenai, 1-11-2026, 16:33 tot 16:40 (Amsterdamse tijd). Enige testronde van vandaag.

- Archief: /workspace/projecten/rankcomet/rankcomet-r1.tar.gz, sha256 6c8c3ff24d92b2c83069df00511b3cef634f23074a1b32af9420332ceed5f1f9 (klopt), 18149195 bytes.
- Testmap: /tmp/tst-rankcomet/mR1-650da124 (chmod 700), sha-lijst: /tmp/tst-rankcomet/mR1-650da124.sha (2217 bestanden).
- Omgeving: alles onder `unshare -rn` met `ip link set lo up`, zonder STRIPE_*, AZURE_*, OPENAI_*, CONQUEROR_*, MONEYBIRD_*, RC_*, PG*, BILLR2_*. Alleen 127.0.0.1 (willekeurige poort), adressen @test.invalid, nepgeheim whsec_testnep... uit tests/helpers.js. Geen installaties.
- Suite van de Bouwer (sqlite): `npm test` geeft 32/32 geslaagd.
- Eigen checks: /tmp/tst-rankcomet/mR1-650da124/tester/eigen.test.mjs, gedraaid met `node --test ../../tester/eigen.test.mjs` vanuit rankcomet-core.

| nr | situatie | verwacht | werkelijk | geslaagd |
|---|---|---|---|---|
| a | Account A vraagt /api/sites/<id van B> op, lijst A, vervalste sessie | 404, lege lijst, 401 | 404, {"sites":[]}, 401; alle site-query's filteren op account_id | ja |
| b1 | Prijzen in config en /pakketten tegen keuzes OV8 | €39, €89, €149 | €39, €89, €149 per maand excl. btw | ja |
| b2 | Sitelimiet Solo, 5 gelijktijdige POSTs /sites/nieuw | 1 site, rest geweigerd | 303,403,403,403,403; 1 site; Pro 3 en Bureau-proef 5 in suite groen | ja |
| c1 | Webhook zonder, met foute en met verlopen handtekening | 400, niets verwerkt | 400, 400, 400 | ja |
| c2 | Zelfde geldig event evt_test_nep1 twee keer | 1 verwerking | 200, 200; 1 rij in stripe_events; status achterstallig | ja |
| c3 | Geldig getekend event dat bij verwerking faalt (onbekend pakket), daarna Stripe-retry | Event niet als verwerkt gemarkeerd, retry opnieuw verwerkt | Poging 1: 400; poging 2: 200 "dubbel", event blijft verloren (F-R1-1) | nee |
| d | Azure: eastus, uksouth, switzerlandnorth, GlobalStandard, api.openai.com, http, vreemd domein | Allemaal geweigerd | Allemaal geweigerd; start geweigerd zonder EU-config (exit 1) | ja |
| e1 | Geheimen AES-256-GCM, ander account als AAD | Versleuteld, ontsleutelen met ander account faalt | v1-formaat zonder klare tekst; ander account geweigerd | ja |
| e2 | Logregels na registreren, inloggen en webhooks; maskeer() op e-mail, IP, sk_live_, whsec_, Bearer, api-key | Geen e-mail, tokens of sleutels | Geen @, sk_ of whsec_ in logregels; alles gemaskeerd. Een losse sleutel zonder voorvoegsel blijft staan [A] | ja |
| f | Teksten in rankcomet-core (pagina's, foutmeldingen, 404, 500) | Nederlands | Alles Nederlands, lang="nl"; "Dashboard" als gangbaar leenwoord [A] | ja |
| g | LICENSE, README, /over | MIT en OpenSEO vermeld | LICENSE MIT ongewijzigd (Ben Senescu); README en /over noemen OpenSEO en MIT | ja |
| h | Scan op sleutels (sk_live, sk_test lang, whsec lang, AKIA, ghp_, xox, private key, AIza, JWT), .env/.pem/.db, e-mailadressen | Niets echts | Geen treffers; .env-bestanden zijn alleen .example met placeholders; adressen zijn example.com, test.invalid, openseo.so (publiek upstream) en placeholders | ja |
| i | Rooktest: registreren, inloggen, site toevoegen, dashboard, pakketten (app in proces op 127.0.0.1) | Flow werkt | 303, site zichtbaar in API en dashboard, pakketten tonen 3 prijzen | ja |
| pg | Suite op test-PG | 32/32 | Niet gedraaid: module pg niet aanwezig (npm ci vraagt internet) | open |

## Rode bevindingen

**F-R1-1** (src/stripe.js, verwerkWebhook): het event-id wordt in stripe_events vastgelegd vóór de verwerking. Faalt de verwerking daarna (hier: onbekend pakket, ook bij een databasefout), dan geeft de eerste poging 400/500 maar markeert de herhaling van Stripe het event als "dubbel" met 200. Het event gaat zo verloren. Naspelen (in rankcomet-core, onder unshare -rn):
```
const ev2 = JSON.stringify({ id: 'evt_test_nep2', type: 'checkout.session.completed', data: { object: { client_reference_id: accId, metadata: { account_id: accId, pakket: 'bestaatniet' } } } });
POST /stripe/webhook met stripe-signature = tekenPayload(ev2, TEST_ENV.RC_STRIPE_WEBHOOK_SECRET), twee keer
Uitkomst: 400, daarna 200 en geen verwerking. Verwacht: claim pas vastleggen na geslaagde verwerking (zelfde transactie) of terugdraaien bij een fout.
```
Volledig script: /tmp/tst-rankcomet/mR1-650da124/tester/eigen.test.mjs (test 'a+b+c+i').

## [A]-punten
- [A] PG-run open: pg 8.13.1 niet geïnstalleerd, geen installatie van internet toegestaan. De race-test op de sitelimiet (count en insert zonder lock of transactie) is alleen op sqlite gedaan; op Postgres kan een gelijktijdige tweede site er wel doorheen komen. Niet getest.
- [A] Rooktest via maakApp in proces; src/server.js zelf start niet zonder Postgres en volledige productieconfig (start geweigerd, exit 1, zoals bedoeld).
- [A] Azure: een endpoint als https://rc-eastus.openai.azure.com wordt geaccepteerd als regio en type EU zijn opgegeven. Regio en deploymenttype zijn opgegeven waarden die de app niet bij Azure controleert ([A13] van de Bouwer). Bij de uitrol controleren.
- [A] Logmaskering vangt een kale Azure-sleutel (32 hex zonder "api-key=") niet; in de huidige code wordt de sleutel nergens gelogd.
- [A] Twee accounts mogen hetzelfde domein toevoegen (A voegt site-b.test toe naast B: 303). Geen lek, wel een productkeuze voor later (eigendomscontrole).
- [A] De OpenSEO-app zelf (web/, src/) is Engelstalig en niet getest; volgens R1-OVERZICHT nog niet omgebouwd.
- [A] Artikel- en zoekwoordlimieten bestaan alleen als hulpfuncties (in suite getest), nog niet afgedwongen in een flow; volgt in latere blokken.
