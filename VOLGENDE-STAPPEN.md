# Rankcomet: volgende stappen

Stand: R2 op `main` (commit 3c11373). Stap 0 tot en met 9 klaar en de teksten voor de Search Console-aanvraag staan klaar, 117/117 tests groen op SQLite en Postgres. Niets is uitgerold.

Werk de stappen op volgorde af, één pull request per stap. Lees eerst `CLAUDE.md`.

## Stap 0: OpenSEO-fork opschonen (keuze A van Erwin), KLAAR
Gedaan: zoekwoordcode bewaard in `vendor-openseo/` (met LEESMIJ), de rest van OpenSEO verwijderd, README en AGENTS.md vervangen, `package-lock.json` van de kern toegevoegd (stond door de oude `.gitignore` niet in git), testworkflow voor de kern. Zie de pull request voor de lijst per map.

Doel: alleen houden wat Rankcomet echt gaat gebruiken, zodat de repo klein en begrijpelijk is.
1. Breng in kaart wat de fork bevat (`src/`, `web/`, `plugins/`, `drizzle/`, `deploy/`, Cloudflare- en Every App-config, `docs/`, `specs/`). Schrijf in de PR per map: houden, weg, of later.
2. Houden: de zoekwoordonderzoek-logica die we later via een adapter aan `rankcomet-core` koppelen (DataForSEO-aanroepen, verwerking van zoekwoorden en SERP-data). Zet die in een eigen map, bijvoorbeeld `rankcomet-core/src/zoekwoorden/` of `vendor-openseo/`, met een korte LEESMIJ over de herkomst.
3. Weg: wat we niet gebruiken, zoals de Cloudflare Workers- en Every App-opzet, de website `web/`, de MCP-plugins, Lovable- en marketingdocs en de OpenSEO-releasenotes. Twijfel? Zet het onder "later" en laat het staan.
4. Altijd houden: `LICENSE` (MIT) en een herkomstregel in de README ("gebaseerd op OpenSEO, MIT"). Onze eigen docs (`docs/CONTEXT-RANKCOMET.md`, `R1/R2-OVERZICHT.md`, `installatie*.md`, `keuzes-erwin-*.md`, `testrapport-*.md`, `spec.md`) blijven staan.
5. Vervang `AGENTS.md` door een korte versie die naar `CLAUDE.md` verwijst, of haal de OpenSEO-regels eruit die niet meer gelden.
6. Pas `README.md` aan: wat Rankcomet is, hoe je de tests draait, waar de regels staan.
7. Tests blijven 43/43 groen.

## Stap 1: R3, accounts afmaken, KLAAR
Gedaan: wachtwoord vergeten met eenmalige link, e-mailverificatie (zonder bevestiging geen site koppelen), rate limiting op inloggen, aanmelden, wachtwoord vergeten en bevestigingsmail, artikelmaand in Nederlandse tijd. Aannames A29 tot A36 in `rankcomet-core/installatie.md`. Nog nodig voor de uitrol: een echte mailer (A34) en RC_VERTROUW_PROXY=1 achter de proxy (A33).

Besloten door Erwin bij stap 0: de zoekwoordcode in `vendor-openseo/` wordt zelf omgezet naar gewoon JavaScript, zonder nieuwe pakketten. Search Console, rank tracking en de veilige fetcher blijven staan.

- Wachtwoord vergeten: eenmalige link (token als sha256 in de database, kort geldig, één keer bruikbaar). Mail versturen via een geïnjecteerde mailer; in tests een nep-mailer.
- E-mailverificatie bij aanmelden. Zonder verificatie geen site koppelen.
- Rate limiting op inloggen, aanmelden en wachtwoord vergeten (per IP en per e-mailadres, zonder die waarden te loggen).
- Artikelmaand in Nederlandse tijd (`Europe/Amsterdam`) in plaats van UTC (A22). Test rond middernacht op de eerste van de maand en rond de zomertijdwissel.
- Besloten door Erwin op 5-11 (geen open vraag meer):
  - A20: ja, Bureau-proef mag een WooCommerce-site koppelen (zoals nu in de code).
  - A21: ja, bij Bureau-proef geldt naast 10 per site ook een totaal van 50 per account (zoals nu in de code).

## Stap 2: eigendom van het domein controleren, KLAAR
Gedaan: koppelcode per site, controle van een metatag op de homepage via de veilige ophaler (`rankcomet-core/src/ophalen.js`), artikelen alleen op een bevestigde site, grens van 10 controles per site per uur. Aannames A37 tot A40. De WordPress-plugin (stap 3) kan de metatag zelf plaatsen.

- Een site telt pas als gekoppeld als de klant bewijst dat het domein van hem is.
- Werkwijze: Rankcomet maakt een koppelcode per site. De klant plakt die in de WordPress-plugin (stap 3) of in een metatag. Rankcomet controleert de code op de site.
- Fetchen van klantsites alleen via een veilige fetcher: alleen https, geen interne of privé-IP-adressen (SSRF), korte time-out, maximale grootte.
- Test: account B kan de koppelcode van account A niet gebruiken.

## Stap 3: WordPress-plugin en WooCommerce, KLAAR
Gedaan: plugin in `wordpress-plugin/` met ondertekende REST-routes, voorstellen met goedkeuring in de app (`rankcomet-core/src/wijzigingen.js`), oude waarden per veld en terugzetten met één klik, witte lijst van velden aan beide kanten, idempotentie op het id, volumerem per site per maand. Aannames A41 tot A47. Nog te doen voor de bèta: de plugin op een echte WordPress-testsite met Yoast, Rank Math en WooCommerce draaien (A47).

- Een kleine WordPress-plugin die met Rankcomet praat via een ondertekende verbinding (sleutel per site, versleuteld opgeslagen).
- Alles wat Rankcomet aanpast, komt als concept of als voorstel klaar. Publiceren pas na akkoord in de Rankcomet-app.
- Per wijziging terugzetten: bewaar de oude waarde, zodat de klant elke wijziging met één klik kan terugdraaien.
- WooCommerce (alleen in pakketten die het mogen): alleen titels, beschrijvingen, meta en alt-teksten. Prijs, voorraad, SKU en bestellingen zijn nooit schrijfbaar, ook niet per ongeluk (aparte test).
- Een herhaalpoging publiceert nooit twee keer (idempotentiesleutel per wijziging, test met dubbele aanroep).

## Stap 4: de Conquer-pipeline met kwaliteitspoort, KLAAR
Gedaan: siteprofiel per site, pijplijn in `rankcomet-core/src/pijplijn.js` (reserveren met maand- en temporem, brief, artikel met interne links en meta, kwaliteitspoort in `src/kwaliteit.js`, één herkansing, voorstel via stap 3), prompts in `rankcomet-core/prompts/`, terugboeken bij elke mislukking. Aannames A48 tot A53. Nog te doen: de echte Azure-aanroep testen zodra de sleutels er zijn (A48), en een wachtrij zodat het schrijven niet in het verzoek zelf gebeurt (A52).

- Van zoekwoord tot conceptartikel: onderwerp kiezen, opzet, tekst, interne links, meta.
- Kwaliteitspoort vóór een concept naar de klant gaat:
  - het artikel gebruikt eigen klantinformatie (diensten, plaats, ervaring) en is niet generiek;
  - duplicaatcheck tegen eigen artikelen en bestaande pagina's;
  - woordfilter: geen verzonnen prijzen, beloftes of claims.
- Volumerem in code: maximum per site per maand volgens het pakket, plus een rem op het tempo (niet alles op één dag).
- Prompts komen in `rankcomet-core/prompts/`. Harde regels staan in code, nooit alleen in een prompt.
- Een mislukte generatie boekt het artikel terug (zie A22).

## Stap 5: klantdashboard, KLAAR
Gedaan: dashboard met "Wacht op jou" (Goedkeuren en Niet doen per voorstel), deze maand, live op je site (met Terugzetten), artikelen over per site, je sites. Strikte CSP zonder inline stijl of script, eigen stylesheet, systeemletters. Layouttest op 390 px en 1440 px met Playwright (lokaal). Aannames A54 tot A56.

- In dezelfde stijl als de Sevenai-app v2: rustig, groot, een leek moet het snappen.
- Bovenaan "Wacht op jou": concepten en voorstellen die een akkoord nodig hebben, met een duidelijke knop "Goedkeuren" en "Niet doen".
- Daaronder: wat Rankcomet deze maand deed, wat er live staat, wat er terug te zetten is, en hoeveel artikelen er nog over zijn.
- Strikte CSP: geen inline script of style, geen externe bronnen, fonts zelf hosten.
- Test op 390 px en 1440 px.

## Los, nu al regelen
- Google Search Console OAuth-verificatie vroeg aanvragen bij Google. Dat duurt weken. Erwin doet de aanvraag. KLAARGEZET: `docs/google-search-console-aanvraag.md` (velden van het toestemmingsscherm, de ene scope met toelichting in het Engels en Nederlands, videoscript, tijdlijn) en de privacyverklaring (concept) op `/privacy` in de app (`rankcomet-core/public/privacy.html`). Erwin vult de rechtspersoon in en dient de aanvraag in; de video kan pas na blok 4 (de koppeling zelf).

## Open vragen voor Erwin (uit de pull requests van stap 1 tot 5)
- Mailprovider in de EU en het afzendadres (A34); tot die er is kan niemand zijn e-mailadres bevestigen.
- Azure OpenAI: EU-endpoint, regio, deploymentnaam en sleutel (A48); daarna één echt artikel draaien en de kosten meten.
- Een WordPress-testsite met Yoast, Rank Math en WooCommerce om de plugin echt te draaien (A47).
- Grenzen: rate limiting (A32), wijzigingen per site per maand (A43), artikelen per site per dag (A49), het woordfilter (A50).
- "Goedkeuren als concept" bij een bestaand bericht zet het tijdelijk offline (A46, A55): zo houden of anders?
- Een wachtrij voor het schrijven, zodat het niet in het verzoek zelf gebeurt (A52).
- Ook een bestand toestaan voor de koppelcontrole, naast de metatag (stap 2)? Mag één domein bij meer accounts bevestigd zijn?
- De oude teksten in de u-vorm naar de je-vorm (A36).
- Stijl van de Sevenai-app v2: schermafdruk of kleuren en letters (A54).

## Blok 4 (akkoord Erwin 11-11): zoekwoorden, rank tracking, Search Console

### Stap 6: zoekwoorden per site, KLAAR
Gedaan: DataForSEO-client in gewoon JavaScript (`rankcomet-core/src/dataforseo.js`, overgezet uit `vendor-openseo/`), zoekwoordonderzoek met volume, moeilijkheid en intentie, bewaren per site, volgen met de pakketlimiet (A7: 100), eigen zoekwoorden met Google Ads-volume, daggrens op onderzoeken, pagina `/sites/<id>/zoekwoorden` met de link naar "Artikel laten schrijven". Aannames A57 tot A59. Nog nodig: een DataForSEO-login (RC_DATAFORSEO_LOGIN en RC_DATAFORSEO_WACHTWOORD) om echt te draaien en de kosten per onderzoek te meten.

### Stap 7: rank tracking, KLAAR
Gedaan: dagelijkse positie per gevolgd zoekwoord via DataForSEO SERP (`rankcomet-core/src/posities.js`), met de URL die rankt; claim per zoekwoord per dag zodat een herhaling, "Nu controleren" of gelijktijdige runs nooit dubbel betalen; planning elk uur in `src/server.js`; positie en verschil met een week geleden op de zoekwoordenpagina, kaart "Posities in Google" op het dashboard. Aannames A60 tot A62.

### Stap 8: Search Console-koppeling, KLAAR
Gedaan: OAuth met PKCE en de ene scope (`rankcomet-core/src/google.js`, `src/gsc.js`), eenmalige state per account en site, tokens versleuteld in `geheimen`, property kiezen (de passende bovenaan), klikken, vertoningen en positie per pagina over 28 dagen, één keer per dag ververst in de planning, verbreken trekt in en verwijdert alles, kaart op het dashboard. Zonder `RC_GOOGLE_CLIENT_ID` en `RC_GOOGLE_CLIENT_SECRET` zegt de pagina dat de koppeling nog niet beschikbaar is. Aannames A63 tot A66. Nog te doen: de echte Google-client (na de aanvraag, zie `docs/google-search-console-aanvraag.md`); de redirect-URI die daar moet staan is `https://rankcomet.ai/google/terug`. Dan kan ook de demovideo worden opgenomen.

## Na blok 4 (akkoord Erwin 11-11: doorgaan tot het klaar is)

### Stap 9: contentrefresh, KLAAR
Gedaan: kandidaten op leeftijd (datum uit de plugin), positiedaling (rank tracking, 28 dagen) en klikdaling (Search Console, met geschiedenis), drempels per site, opfrisvoorstel via de pijplijn en de kwaliteitspoort op de bestaande pagina (`rankcomet-core/src/opfrissen.js`, `prompts/opfrissen.md`), daggrens per site, effect per URL (toen tegenover nu). Aannames A67 tot A70.

### Stap 10: maandrapport, KLAAR
Gedaan: `rankcomet-core/src/rapport.js` telt per account per maand de artikelen, voorstellen (op de site gezet, afgewezen, teruggezet), opfrissingen en per site de posities (top 10 aan het begin en einde van de maand, omhoog en omlaag) en de klikken uit Search Console (laatste periode tegenover een maand eerder). Pagina's `/rapport` en `/rapport/<maand>`, mail op de eerste van de maand via de uurlijkse planning, één keer per account per maand (claim in de tabel `rapporten`). Aannames A71 tot A73.

### Stap 11: wachtrij voor het schrijven, KLAAR
Gedaan: `rankcomet-core/src/wachtrij.js` met de tabel `taken`. De controles en de reservering (volumerem, temporem, daggrens) gebeuren nog in het verzoek; het schrijven zelf doet de werker (`startWerker` in `server.js`, elke 5 seconden, één taak tegelijk). "Rankcomet is bezig" op het dashboard, de artikelpagina en de opfrispagina; mail als het klaar is of niet is gelukt. Nooit twee keer dezelfde taak (UNIQUE open_sleutel) en een claim is één atomaire UPDATE. Een vastgelopen taak wordt afgemeld, niet opnieuw gedraaid. Aannames A74 tot A76.

### Stap 12: je-vorm, KLAAR
Gedaan: de laatste zes teksten in de u-vorm (pakketlimieten in `sites.js` en `artikelen.js`, de pagina Over) staan in de je-vorm, de tests die erop matchen zijn aangepast, en `tests/je-vorm.test.js` bewaakt dat de u-vorm niet terugkomt in app, mails, prompts, publieke pagina's en plugin.

## Daarna
- Bèta NL, januari 2027, zodra de open vragen voor Erwin zijn beantwoord en de spullen er zijn.

## Niet doen
- Niets uitrollen. Geen `wrangler deploy`, geen Every App, geen push naar `main`.
- Geen live Stripe-sleutels, geen echte klantdata in tests.
