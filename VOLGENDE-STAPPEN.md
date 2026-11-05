# Rankcomet: volgende stappen

Stand: R2 op `main` (commit 3c11373). Stap 0 klaar (fork opgeschoond), 46/46 tests groen op SQLite. Niets is uitgerold.

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

## Stap 1: R3, accounts afmaken
- Wachtwoord vergeten: eenmalige link (token als sha256 in de database, kort geldig, één keer bruikbaar). Mail versturen via een geïnjecteerde mailer; in tests een nep-mailer.
- E-mailverificatie bij aanmelden. Zonder verificatie geen site koppelen.
- Rate limiting op inloggen, aanmelden en wachtwoord vergeten (per IP en per e-mailadres, zonder die waarden te loggen).
- Artikelmaand in Nederlandse tijd (`Europe/Amsterdam`) in plaats van UTC (A22). Test rond middernacht op de eerste van de maand en rond de zomertijdwissel.
- Besloten door Erwin op 5-11 (geen open vraag meer):
  - A20: ja, Bureau-proef mag een WooCommerce-site koppelen (zoals nu in de code).
  - A21: ja, bij Bureau-proef geldt naast 10 per site ook een totaal van 50 per account (zoals nu in de code).

## Stap 2: eigendom van het domein controleren
- Een site telt pas als gekoppeld als de klant bewijst dat het domein van hem is.
- Werkwijze: Rankcomet maakt een koppelcode per site. De klant plakt die in de WordPress-plugin (stap 3) of in een metatag. Rankcomet controleert de code op de site.
- Fetchen van klantsites alleen via een veilige fetcher: alleen https, geen interne of privé-IP-adressen (SSRF), korte time-out, maximale grootte.
- Test: account B kan de koppelcode van account A niet gebruiken.

## Stap 3: WordPress-plugin en WooCommerce
- Een kleine WordPress-plugin die met Rankcomet praat via een ondertekende verbinding (sleutel per site, versleuteld opgeslagen).
- Alles wat Rankcomet aanpast, komt als concept of als voorstel klaar. Publiceren pas na akkoord in de Rankcomet-app.
- Per wijziging terugzetten: bewaar de oude waarde, zodat de klant elke wijziging met één klik kan terugdraaien.
- WooCommerce (alleen in pakketten die het mogen): alleen titels, beschrijvingen, meta en alt-teksten. Prijs, voorraad, SKU en bestellingen zijn nooit schrijfbaar, ook niet per ongeluk (aparte test).
- Een herhaalpoging publiceert nooit twee keer (idempotentiesleutel per wijziging, test met dubbele aanroep).

## Stap 4: de Conquer-pipeline met kwaliteitspoort
- Van zoekwoord tot conceptartikel: onderwerp kiezen, opzet, tekst, interne links, meta.
- Kwaliteitspoort vóór een concept naar de klant gaat:
  - het artikel gebruikt eigen klantinformatie (diensten, plaats, ervaring) en is niet generiek;
  - duplicaatcheck tegen eigen artikelen en bestaande pagina's;
  - woordfilter: geen verzonnen prijzen, beloftes of claims.
- Volumerem in code: maximum per site per maand volgens het pakket, plus een rem op het tempo (niet alles op één dag).
- Prompts komen in `rankcomet-core/prompts/`. Harde regels staan in code, nooit alleen in een prompt.
- Een mislukte generatie boekt het artikel terug (zie A22).

## Stap 5: klantdashboard
- In dezelfde stijl als de Sevenai-app v2: rustig, groot, een leek moet het snappen.
- Bovenaan "Wacht op jou": concepten en voorstellen die een akkoord nodig hebben, met een duidelijke knop "Goedkeuren" en "Niet doen".
- Daaronder: wat Rankcomet deze maand deed, wat er live staat, wat er terug te zetten is, en hoeveel artikelen er nog over zijn.
- Strikte CSP: geen inline script of style, geen externe bronnen, fonts zelf hosten.
- Test op 390 px en 1440 px.

## Los, nu al regelen
- Google Search Console OAuth-verificatie vroeg aanvragen bij Google. Dat duurt weken. Erwin doet de aanvraag; Claude Code kan de benodigde teksten (privacybeleid, scopes, uitleg) klaarzetten.

## Niet doen
- Niets uitrollen. Geen `wrangler deploy`, geen Every App, geen push naar `main`.
- Geen live Stripe-sleutels, geen echte klantdata in tests.
