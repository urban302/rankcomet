# Testrapport Rankcomet.ai R2

Tester · Sevenai, 2-11-2026. Uitslag: GROEN (geen F-R2-bevindingen). Groen is geen uitrolopdracht.

- Archief: /workspace/projecten/rankcomet/rankcomet-r2.tar.gz, sha256 a7ba42e5d7dcc7c0214c33b3112b5030858c6b0ca0dea4cfe8dc7cd88db60511 (klopt).
- Testmap: /tmp/tst-rankcomet/mR2-1a38c035 (chmod 700, sha-lijst.txt). Eigen script: tester/eigen-r2.test.mjs.
- sqlite onder unshare -rn met env -u (STRIPE/AZURE/OPENAI/CONQUEROR/MONEYBIRD, RC_DB, PG*). PG zonder unshare, alleen 127.0.0.1:55432, eigen database tst_rc_r2_11dd02 (blijft staan, test-PG draait door).

| nr | situatie | verwacht | werkelijk | geslaagd |
|---|---|---|---|---|
| a | F-R1-1: evt_test_nep2 (checkout.session.completed, pakket bestaatniet, testgeheim) 2x; evt_test_nep3 eerst fout, daarna geldig; evt_test_nep4 5x gelijktijdig | geen stille 200, herhaling opnieuw verwerkt, dubbel precies 1x | nep2: 400 en 400, 0 rijen in stripe_events; nep3: 400, daarna 200 en pakket pro; nep4: 5x 200, 1 event, 1 verwerking. Gelijk op sqlite en PG | ja |
| b | Sitelimiet Solo, 10 gelijktijdige aanvragen op PG (en sqlite) | 1 site | 303 + 9x 403, 1 site | ja |
| c | npm ci --offline onder unshare -rn, lege cache | slaagt zonder netwerk | 13 pakketten uit vendor/, 0 kwetsbaarheden, exit 0 | ja |
| d | A6: Bureau-proef, 15 gelijktijdige reserveerArtikel op site 1, daarna 10 op site 2, ander account op site 1 | 10 per site, niet verdelen | 10 ok + melding limiet per site; site 2 nog 10; ander account 404 | ja [A1] |
| e | A7: 100 zoekwoorden voor elk pakket | 100 voor solo, pro, bureau_proef | config 100/100/100, magZoekwoordVolgen 99 ja, 100 nee; pakkettenpagina toont 3x 100 | ja [A2] |
| f | A8: Solo koppelt WooCommerce; Pro koppelt WooCommerce | Solo 403 met u-vorm en upgradelink; Pro mag | Solo 403 "Uw pakket Solo ondersteunt geen WooCommerce-webshop. Upgrade naar Pro ...", link /pakketten; Pro 303 | ja |
| g | A16: taal de/en, land DE/FR, nl+BE | alleen NL/BE en nl, Nederlandse teksten | de en en 400 "In de bèta is alleen Nederlands (nl) beschikbaar."; DE en FR 400 "Kies een land uit de lijst."; nl BE 303; formulier alleen Nederlands, Nederland, België | ja |
| h | Rooktest: registreren, inloggen, site toevoegen, dashboard; suites | alles ok | 303/303/303, dashboard toont site, lang=nl. Suite Bouwer: sqlite 43/43, PG 43/43 | ja |

## [A]-punten
- [A1] A6 is alleen afgedwongen in src/artikelen.js (reserveerArtikel); er is nog geen HTTP-route voor artikelen, dus getest op functieniveau. In de flow opnieuw testen zodra die er is.
- [A2] A7 staat in config en magZoekwoordVolgen, maar er is nog geen zoekwoordenflow die het aanroept.
- [A3] Een event met onbekend pakket geeft blijvend 400; Stripe blijft het dan herhalen. Niet stil, wel een terugkerende fout die de beheerder moet zien.
- [A4] Bureau-proef mag WooCommerce koppelen (config, door Bouwer als [A] gemarkeerd).
- [A5] De artikelmaand loopt in UTC (huidigeMaand).
