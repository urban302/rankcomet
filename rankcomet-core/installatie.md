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
| RC_DATAFORSEO_LOGIN | DataForSEO API-login (stap 6; de app start niet zonder) |
| RC_DATAFORSEO_WACHTWOORD | DataForSEO API-wachtwoord |
| RC_LOG_BEWAAR_DAGEN | optioneel, standaard 90 |
| RC_VERTROUW_PROXY | optioneel; `1` = IP-adres voor de rate limiting uit X-Forwarded-For halen (alleen achter onze eigen reverse proxy) |
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
- [A22] (R2, gewijzigd in R3) Een artikelmaand is de kalendermaand in Nederlandse tijd (`Europe/Amsterdam`, `YYYY-MM`), ook rond de zomertijdwissel. Een artikel telt zodra het is gereserveerd; terugboeken bij een mislukte generatie volgt in het artikelblok.
- [A23] (R2) Een webhook die bij de verwerking faalt (bijv. onbekend pakket) geeft 400 (Fout) of 500 (andere fout) en wordt niet vastgelegd; Stripe probeert het opnieuw. Een blijvend fout event blijft dus terugkomen tot Stripe stopt (max. ca. 3 dagen); er is nog geen aparte 'dead letter'-tabel.
- [A24] (R2) Transacties op sqlite (alleen tests): één verbinding, transacties achter elkaar via een mutex met BEGIN IMMEDIATE. Losse query's buiten een transactie kunnen daar tussendoor lopen; dat is alleen in de testopzet zo.
- [A25] (R2) Sitelimiet en artikellimiet op PG: transactie + `SELECT ... FROM accounts WHERE id = $1 FOR UPDATE` (rijslot per account). Bewezen: zonder FOR UPDATE geeft de test met 10 gelijktijdige aanvragen op PG te veel sites; met het slot nooit.
- [A26] (R2) Vendoring: de 13 runtime-pakketten (pg 8.13.1 en afhankelijkheden, zie package-lock.json) staan als npm-pack-tarballs in `rankcomet-core/vendor/` met `file:`-verwijzingen in package.json. node_modules wordt niet meegeleverd (uitgesloten in het archief, zoals in R1); `npm ci --offline` bouwt het uit vendor/ op. Testdeps zijn er niet (alleen node:test). De tarballs zijn met `npm pack` gemaakt uit de pg-installatie van R1 (zelfde versies); hun sha512 staat in package-lock.json en wijkt af van de registry-tarballs.
- [A27] (stap 0, bevestigd door Erwin) Van OpenSEO is alleen de zoekwoordcode bewaard (plus Search Console, rank tracking en de veilige fetcher, die blijven staan), in `vendor-openseo/` op de oorspronkelijke paden. Het is alleen bron; de adapter zet het zelf om naar gewoon JavaScript in de kern, zonder nieuwe pakketten. De rest is verwijderd en staat nog in commit 3c11373.
- [A28] (stap 0) `rankcomet-core/package-lock.json` staat nu in git. De oude `.gitignore` van OpenSEO sloot elk `package-lock.json` uit, waardoor `npm ci --offline` op een verse checkout niet werkte. Het bestand is opnieuw gemaakt met `npm install --offline` uit `vendor/`; alle 13 pakketten wijzen naar `file:vendor/...`.
- [A29] (R3) Eenmalige links: e-mail bevestigen werkt 24 uur, wachtwoord herstellen 1 uur. Elke link werkt één keer (tabel `eenmalige_tokens`, alleen de sha256 van het token). Een nieuwe bevestigingsmail maakt oudere links niet ongeldig; een nieuw wachtwoord maakt alle open herstellinks ongeldig.
- [A30] (R3) Na een wachtwoordherstel: alle sessies van het account worden verwijderd (overal uitgelogd) en het e-mailadres telt als bevestigd, want de klant heeft de link uit de mail gebruikt.
- [A31] (R3) Rate limiting staat in het geheugen van het app-proces (één proces). Een herstart zet de tellers op nul. Bij meer processen moet de telling naar de database.
- [A32] (R3) Grenzen: inloggen max. 10 mislukte pogingen per e-mailadres en 30 per IP per kwartier; aanmelden max. 5 per e-mailadres en 10 per IP per uur; wachtwoord vergeten max. 3 per e-mailadres en 10 per IP per uur; bevestigingsmail opnieuw max. 3 per account per uur. Daarboven 429 met Retry-After. Gevolg: wie 10 keer een fout wachtwoord voor iemands adres invult, houdt die persoon een kwartier buiten; die kan wel zijn wachtwoord herstellen.
- [A33] (R3) Achter de reverse proxy zet de Serverbeheerder RC_VERTROUW_PROXY=1; dan telt het laatste adres in X-Forwarded-For. Zonder die instelling wordt de header genegeerd (anders kan een bezoeker de grens omzeilen). Zonder RC_VERTROUW_PROXY achter een proxy delen alle bezoekers één IP-teller.
- [A34] (R3) Er is nog geen echte mailer. In `src/server.js` mislukt elke mail; de app logt dat (alleen soort, account-id en fouttype) en de klant kan de bevestigingsmail later opnieuw aanvragen. Links in mails gebruiken `basis_url` uit `config/merk.json`, nooit de Host-header.
- [A35] (R3) Zonder bevestigd e-mailadres kan een klant inloggen en de wachtlijst gebruiken, maar geen site koppelen (403, ook via de servicefunctie).
- [A36] (R3) Nieuwe teksten (mails, wachtwoord vergeten, bevestigen) staan in de je-vorm, zoals CLAUDE.md vraagt. Bestaande teksten uit R1/R2 staan nog in de u-vorm; die zijn in deze stap niet aangepast.
- [A37] (stap 2) De veilige ophaler (`src/ophalen.js`) weigert alles behalve https op poort 443, zoekt de hostnaam eerst op en weigert elk adres uit de privé- en gereserveerde reeksen (IPv4 en IPv6, inclusief IPv4-in-IPv6 en NAT64). Hij verbindt met het opgezochte adres zelf (DNS-pinning) met de hostnaam voor TLS en Host. Time-out 5 seconden, maximaal 512 kB, maximaal 3 doorverwijzingen en alleen naar het eigen domein of een subdomein daarvan. Niet omzeilbaar via een instelling.
- [A38] (stap 2) Eigendom van het domein: elke site krijgt een koppelcode (`rc-` plus 32 hextekens, kolom `sites.koppelcode`). De klant zet `<meta name="rankcomet-koppelcode" content="...">` in de head van de homepage (`https://<domein>/`); de WordPress-plugin (stap 3) gaat dat zelf doen. Na controle staat het moment in `sites.eigendom_bevestigd`. De koppelcode is niet geheim (hij staat openbaar op de site), maar telt alleen voor de eigen site van het eigen account.
- [A39] (stap 2) Zonder bevestigd eigendom telt een site wel mee voor de sitelimiet, maar kan Rankcomet er geen artikelen voor maken (403). De koppelcontrole is begrensd tot 10 per site per uur, omdat elke controle de klantsite ophaalt.
- [A40] (stap 2) De echte https-verbinding is niet in de testsuite opgenomen (daar is een eigen certificaat voor nodig); de regels eromheen wel, met een nep-DNS en nep-verbinding. De verbinding zelf is handmatig gecontroleerd tegen een lokale https-server: SNI en Host zijn de hostnaam en een certificaat voor een andere naam wordt geweigerd.
- [A41] (stap 3) Witte lijst van velden in `src/velden.js` en in de plugin (`includes/protocol.php`), met maximale lengtes per veld. post en pagina: titel, inhoud, meta_titel, meta_beschrijving, focus_zoekwoord, canonical. product: titel, beschrijving, korte_beschrijving, afbeelding_alt plus de SEO-velden. productcategorie: naam, beschrijving, meta_titel, meta_beschrijving. Alles daarbuiten (prijs, voorraad, SKU, bestellingen, status, auteur) bestaat niet als veld en wordt aan beide kanten geweigerd.
- [A42] (stap 3) Verbinding met de plugin: per site een sleutel van 32 bytes, één keer zichtbaar, in `geheimen` versleuteld met het account-id als AAD. Elk verzoek draagt tijd, nonce en een HMAC-SHA256 over methode, pad, tijd, nonce en de sha256 van de body. De plugin weigert een tijd die meer dan 5 minuten afwijkt en een nonce die hij al zag (10 minuten bewaard). Het antwoord van de plugin wordt niet apart ondertekend; TLS plus de domeincontrole van de ophaler dekken dat. Een nieuwe sleutel maakt de oude meteen ongeldig.
- [A43] (stap 3) Volumerem: `wijzigingen_per_site_per_maand` in `config/pakketten.json` (Solo 30, Pro 60, Bureau-proef 60), gecontroleerd bij goedkeuren in een transactie met rijslot op de site. Terugzetten telt niet mee. Voorstellen doen is onbeperkt; alleen goedkeuren telt.
- [A44] (stap 3) Idempotentie: het id van de wijziging is de sleutel. De plugin bewaart per id het antwoord (`option rankcomet_toegepast_<id>`, zonder autoload) en geeft dat opnieuw zonder iets te doen. Rankcomet behandelt een al gepubliceerde wijziging als klaar. Na een mislukte poging gaat de status op `mislukt`; opnieuw proberen gebruikt hetzelfde id.
- [A45] (stap 3) Vóór publiceren haalt Rankcomet de huidige waarden opnieuw op. Een veld telt als met de hand gewijzigd als de huidige waarde noch de oude, noch de nieuwe is; dan gaat het voorstel met een melding terug naar de rij en wordt de oude waarde bijgewerkt. Bij terugzetten slaan we die controle over (de klant klikte er zelf op).
- [A46] (stap 3) Modus `concept` zet een bestaand onderdeel in WordPress op de status concept (WordPress kent geen los concept naast een gepubliceerd bericht). Modus `publiceren` laat de status staan of zet een nieuw onderdeel meteen live. Een nieuw onderdeel kan Rankcomet niet terugzetten; de klant verwijdert het zelf.
- [A47] (stap 3) De plugin is nog niet op een echte WordPress-installatie met Yoast, Rank Math en WooCommerce gedraaid. Getest zijn de syntaxis, het protocol (handtekening, herhaling, witte lijst, gelijk aan de Node-kant) en de hele Rankcomet-kant tegen een nep-plugin die hetzelfde protocol spreekt. Zonder Yoast of Rank Math slaat de plugin de SEO-meta over. Productcategorie-meta alleen via termmeta (Rank Math); Yoast bewaart die anders en wordt daar nog niet ingevuld.
- [A48] (stap 4) De schrijfhulp is Azure OpenAI via `maakModel` in `src/azure.js` (JSON-modus, temperatuur 0,4, max. 4000 tokens, time-out 2 minuten). Alleen het antwoord en de tokenaantallen komen terug; prompts worden niet gelogd. De echte aanroep is nog niet tegen Azure getest (geen sleutels); de pijplijn is getest met een nep-model dat de prompt leest.
- [A49] (stap 4) Temporem: `artikelen_per_site_per_dag` in `config/pakketten.json` (Solo 2, Pro 3, Bureau-proef 3), gecontroleerd in dezelfde transactie als de maandlimiet. Dag in Nederlandse tijd.
- [A50] (stap 4) Woordfilter in `src/kwaliteit.js`: prijzen en bedragen, claims ("de beste", "nummer 1", "100%"), beloftes ("gegarandeerd", "binnen 24 uur"), medische claims. Elke treffer blokkeert. Bewust streng; liever een artikel opnieuw dan een verzonnen prijs op een klantsite.
- [A51] (stap 4) Kwaliteitspoort: bedrijfsnaam, plaats en minstens één dienst uit het siteprofiel moeten voorkomen; minstens 600 woorden; het zoekwoord in titel of tekst; geen gelijkenis boven 35% (Jaccard op reeksen van 5 woorden) met een eerder artikel op de site en geen titel gelijk aan een bestaande pagina. Links naar adressen buiten de paginalijst van de plugin worden altijd weggehaald (de ankertekst blijft). Punten voor meta-lengtes, tussenkoppen en interne links; onder score 70 geen voorstel.
- [A52] (stap 4) Eén herkansing: wordt een artikel afgekeurd, dan krijgt het model de bevindingen en schrijft het één keer opnieuw. Daarna gaat het artikel terug (A22) en ziet de klant waarom. Het schrijven gebeurt nog in het verzoek zelf (ongeveer een minuut); een wachtrij komt later. Pipeline begrensd tot 10 artikelen per account per uur.
- [A53] (stap 4) Zonder siteprofiel (bedrijf, diensten, plaats) schrijft Rankcomet niets. Het profiel is de bron van de klantinformatie in de prompt en de maatstaf van de poort.
- [A54] (stap 5) Strikte CSP op elke pagina: `default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`. Geen script-src: de app gebruikt geen JavaScript in de browser. Eén stylesheet uit `rankcomet-core/public/stijl.css`, door de app zelf geserveerd op `/stijl.css`. Systeemletters (system-ui), dus geen webfont en niets om te hosten. De stijl "Sevenai-app v2" is niet in de repo beschikbaar; gekozen: rustig, groot, één accentkleur, kaarten, knoppen van minstens 48 px.
- [A55] (stap 5) Goedkeuren op het dashboard: een nieuw onderdeel komt als concept in WordPress, een bestaand onderdeel krijgt de nieuwe tekst live. Dat staat bij elk voorstel. Wie het anders wil, kiest dat op de detailpagina. Hangt samen met A46.
- [A56] (stap 5) De layouttest op 390 px en 1440 px gebruikt Playwright als dat op de machine staat (niet in de repo, geen nieuw pakket) en wordt anders overgeslagen. Op de CI-runner draait hij dus niet; lokaal wel.
- [A57] (stap 6) DataForSEO-client in `src/dataforseo.js`, overgezet uit `vendor-openseo/src/server/lib/dataforseo/` (core, envelope, labs, google-ads). Alleen Nederland (2528) en België (2056), taal nl. Statuscodes zoals OpenSEO ze behandelt: 20000 goed, 40501 "geen resultaten" is leeg maar geen fout, 40101/40103/50401/50402 storing bij DataForSEO, 20100/40601/40602 nog bezig. Twee herhalingen bij 5xx, time-out 60 s. Alleen pad, status en kosten in de log; nooit de zoekwoorden van de klant of de inloggegevens. DataForSEO is een verwerker buiten de EU (spec 5.10): alleen zoekwoorden gaan erheen, geen persoonsgegevens.
- [A58] (stap 6) Per site hooguit 500 niet-gevolgde ideeën bewaard; oudere worden vervangen. Gevolgde zoekwoorden blijven altijd staan. Eén zoekwoord per site (UNIQUE); een nieuw onderzoek werkt bestaande rijen bij en laat de volgstatus staan.
- [A59] (stap 6) Daggrens op onderzoeken: `onderzoeken_per_site_per_dag` in `config/pakketten.json` (Solo 3, Pro 5, Bureau-proef 5), omdat elk onderzoek geld kost. Eigen zoekwoorden toevoegen (Google Ads-volume) valt niet onder die grens maar wel onder de rate limit van 30 zoekwoordacties per account per uur. Kosten per onderzoek staan in `onderzoeken.kosten_usd`.
