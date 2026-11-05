# Bouwspec Rankcomet.ai, MVP (NL-bèta, daarna DE)

*Versie 2, 01-11-2026. Opgesteld door de Analist voor de Projectleider · Sevenai, op basis van de opdracht van Erwin van 27-10-2026 11:57 en de besluiten van Erwin en de Projectleider van 01-11-2026. [A] = aanname. [OV n] = open vraag n in hoofdstuk 10.*

*Gelezen bronnen:*
- *de bouwplan-Page "Rankcomet.ai: bouwplan NL + DE (en validatie)" (canvas c59c0888, laatst bijgewerkt 27-10-2026 11:52 Amsterdamse tijd), gelezen uit de store van Projectleider · Research;*
- */workspace/projecten/rankcomet/status.md (bijgewerkt 01-11-2026 09:05);*
- *de opdracht van de Projectleider;*
- *de uitspraken van Erwin van 01-11-2026;*
- *de lijst met functies van Conqueror (gelezen via de koppeling, alleen de namen en omschrijvingen, niets aangeroepen).*

*Niet gevonden: page.tsx en prognose.json uit /projecten/research/2026-10-27-rankcomet-conqueror/. Volgens het besluit van de Projectleider (01-11, OV1 b) is de bouwplan-Page genoeg. Die Page bevat de prognose in tabellen.*

*Besluiten van 01-11-2026:*
- *Erwin: "We kunnen beide doen maar ik denk dat je bij consumenten sneller klanten kan krijgen" en "Ja en we kunnen iig al starten met bouwen en verkopen. [...] Ik kan gewoon een grokbot de taken laten uitvoeren, het verkopen tot de tijd de bot en dashboard klaar is".*
- *Daaruit volgt: de eerste doelgroep zijn zelfstandige ondernemers (zzp en kleine webshops) op WordPress en WooCommerce, met daarnaast 3 tot 5 bureaus uit Erwins netwerk als proefklant. White-label en de bureaulaag komen later, als bureaus erom vragen.*

## Tegenstrijdigheden en aandachtspunten

1. **Hosting: Hetzner of OVH.** In het bouwplan staan Hetzner (DE) als hosting en een kostenpost van ongeveer €45 per maand. De opdracht schrijft OVH voor, in de EU-omgeving van Sevenai. Deze spec volgt de opdracht: OVH, in hetzelfde datacenter als billr2 (OV12 a). De hostingkosten uit het bouwplan gelden daardoor niet zonder meer.
2. **AI-model: Anthropic of Azure OpenAI.** Het bouwplan rekent de kosten per artikel (ongeveer €0,30) met Sonnet 5.5 van anthropic.com. De opdracht schrijft Azure OpenAI in de EU Data Zone voor. Deze spec volgt de opdracht, met hetzelfde model als bij billr2 en een nieuwe kostenmeting (OV6 a). Tot die meting is de LLM-kost per artikel onbekend.
3. **Doelgroep: bureaus of zelfstandigen.**
   - De opdracht en het bouwplan noemen bureaus met white-label als eerste doelgroep (bouwplan: "Primair: bureaus en freelancers", "kern").
   - Erwin kiest op 01-11 voor zelfstandige ondernemers en kleine webshops. Bureaus doen mee als proefklant, zonder white-label.
   - Volgens het bouwplan hebben losse site-eigenaren de hoogste churn ("SMB 6,2% per maand, Visionary 2026"). Het is daar een "instap"-groep. Volgens de validatie heeft de NL-markt ook bureaus als wederverkopers nodig.
   - Deze spec volgt het besluit van Erwin. De prognose van het bouwplan rekent met een andere klantmix (50/35/15%, aanname in de bron) en geldt daardoor niet zonder meer.
4. **Shopify en Webflow: MVP of v1.** Volgens de opdracht en status.md horen Shopify en Webflow bij de MVP. Het bouwplan zet ze in v1: de Shopify-app wordt ingediend in feb 2027 en Webflow volgt ook in feb 2027. Deze spec volgt het bouwplan: de MVP is alleen WordPress en WooCommerce. Shopify en Webflow komen in v1, in feb 2027.
5. **Toestemming van de eigenaar van Conqueror.**
   - In status.md staat de toestemming als gegeven.
   - Het bouwplan zet die juist op de checklist, "vóór de eerste regel code", met een NO-GO in nov 2026 als ze niet rond is. Het wijst op art. 5.5 (verbod op white-label zonder schriftelijke afspraak) en art. 9 ("software, design, text").
   - De opdracht zegt "volgens Research heeft Erwin schriftelijke toestemming". Ik heb dat stuk niet gezien.
   - Het bouwen van functies die op Conqueror lijken (de Conquer-pijplijn en het design) start pas als de toestemming bevestigd is [A] [OV3].
6. **Betalen: Stripe of Mollie.** In het bouwplan (kosten, checklist en volgorde) staat Stripe. De validatie op dezelfde Page noemt "Mollie/iDEAL-facturatie". Voor zzp'ers en kleine webshops in NL kan iDEAL zwaarder wegen [A]. Tot het besluit volgt deze spec het bouwplan [A] [OV7].
7. **Prijzen en uren verschillen binnen de Page.**
   - Validatie (27-10, ochtend): Solo €39 (10 artikelen), Bureau €149 (5 sites), 180 uur bouwtijd, €120 vaste kosten per maand.
   - Bouwplan (vervolgronde): Solo €39, Pro of webshop €89, Bureau €249 (10 sites), 340 uur, ongeveer €230 per maand.
   - Alle prijzen zijn in de bron aannames [OV8].
8. **Past de spec bij de belofte en de planning?** Volgens het bouwplan is de MVP (fork, pijplijn, WordPress en WooCommerce, Stripe, NL-UI) 160 uur werk in nov tot dec 2026. In die MVP zat de bureaulaag nog niet. Door het besluit van 01-11 zitten white-label en Shopify en Webflow niet in de bèta. Daardoor past een NL-bèta in januari 2027 op WordPress en WooCommerce, met goedkeuring vóór publicatie, bij het bouwplan [A].
   - Risico: de koppeling met Google Search Console wordt volgens het bouwplan pas in jan 2027 ingediend, met een doorlooptijd van "weken" (aanname in de bron). Tot de goedkeuring komen de rankings in de bèta alleen uit rank tracking via DataForSEO [A].
9. **De handmatige dienst en de EU-eis.** Tot het dashboard klaar is, voert Erwin SEO-taken voor klanten uit met een Grokbot (5.11). Dat valt buiten de productie-eis van OVH en Azure EU, omdat het geen productie is maar een werkplaats die Erwin zelf inricht. De AVV en de afspraken met die klanten zijn de verantwoordelijkheid van Erwin, buiten het bouwteam [A].
10. **"Zelf publiceren" en "goedkeuring vóór elke publicatie".** De agent publiceert zelf, maar nooit zonder menselijk akkoord. Ook een automatische refresh gaat pas live na een klik. Dat is strenger dan "ververst hij content zelf" uit het bouwplan. Het acceptatiecriterium "4 weken zonder handwerk" lees ik als: zonder handwerk behalve de goedkeuringsklik [A].
11. **Klonen en onderscheid.** Volgens de validatie scoort Rankcomet 1/5 op onderscheid en is het advies "EERST VALIDEREN". Het validatieplan gaat uit van minstens 3 bureaus met intentie en 20 aanmeldingen op de wachtlijst. Of die drempel gehaald is, staat niet in de bronnen [OV4]. De drempel was op bureaus gericht. Voor zzp'ers en kleine webshops is er in de bronnen geen drempel.
12. **GEO-zichtbaarheid alleen voor de VS.** De functie van Conqueror voor AI-zichtbaarheid is volgens de functieomschrijving "fixed to the US". Besluit OV9 c: GEO voor NL en DE komt na de bèta.
13. **Eindtijd.** In status.md is de eindtijd 1-11 13:00 zelf als [A] gemarkeerd. Geen inhoudelijke tegenspraak.

## Open vragen voor Erwin (kort)

- **OV3:** ligt de schriftelijke toestemming van de eigenaar van Conqueror vast, en waar staat het stuk?
- **OV4:** is de validatiedrempel gehaald?
- **OV5:** welke domeinen gebruiken we voor de MVP?
- **OV7:** Stripe of Mollie?
- **OV8:** welke Solo-prijs voor zzp en kleine webshops, en welke eventuele proefprijs voor de 3 tot 5 bureaus?

## 1. De klus in één zin

Rankcomet zoekt voor de WordPress- of WooCommerce-site van een zelfstandige ondernemer of kleine webshop in het Nederlands (later ook in het Duits) zelf kansrijke zoekwoorden, schrijft daar artikelen of product- en categorieteksten bij, zet die pas na goedkeuring door de klant live, ververst verouderde content (ook pas na goedkeuring) en volgt de rankings in een eenvoudig dashboard.

## 2. Kanalen

| Kanaal | Richting | Gebruik |
|---|---|---|
| Dashboard (web) | Klant, beide kanten | Een site per account (Solo) [A]. Zoekwoorden, voorstellen, de goedkeuringsrij, rankings en een maandoverzicht. De proefbureaus krijgen een account met meerdere sites, zonder white-label [A]. |
| WordPress-plugin | Rankcomet naar site, en terug | REST via app-wachtwoord of plugin-token. Posts, pagina's en custom post types. Yoast- of Rank Math-velden (title, description, focus keyword, canonical), afbeeldingen en categorieën. |
| WooCommerce | Rankcomet naar site | Producten (lange en korte beschrijving), productcategorieën en SEO-velden via Yoast of Rank Math. Altijd als concept of pas na goedkeuring. |
| Google Search Console | Site naar Rankcomet | Alleen lezen (scope webmasters.readonly): klikken, vertoningen en posities. Zodra Google de koppeling goedkeurt. |
| DataForSEO | Rankcomet naar dienst | Zoekvolumes, moeilijkheid, SERP's en rank tracking. |
| Azure OpenAI EU Data Zone | Rankcomet naar model | Briefs, teksten, meta en de kwaliteitscontrole. |
| E-mail (uitgaand) | Rankcomet naar klant | Meldingen: "voorstel wacht op goedkeuring", het maandoverzicht en storingen. Onder het merk Rankcomet. |
| Shopify-app, Webflow | Later (v1, feb 2027) | Zie 5.3. Niet in de MVP. |
| White-label, MCP/API | Later | Alleen als bureaus erom vragen. |

## 3. Trigger

- **Nieuw project:** de klant voegt zijn site toe en koppelt WordPress of WooCommerce. Daarna start er automatisch een eerste zoekwoordonderzoek en een audit.
- **Planning:** per site een vast ritme van nieuwe voorstellen, bijvoorbeeld per week [A]. Het aantal per maand wordt begrensd door het pakket (bouwplan: Solo 10 artikelen) en door een rem op het volume (zie 6).
- **Refresh (besluit OV11 d):** een combinatie van een positiedaling, een daling van de klikken in Search Console en de leeftijd van de inhoud. De drempels zijn per site instelbaar. De standaardwaarden kiest de Bouwer bij de bouw [A].
- **Handmatig:** de knop "Maak voorstel" per zoekwoord (zoals de "Conquer-knop" van Conqueror).
- **Dagelijks:** rank tracking (bouwplan: 100 zoekwoorden per site per dag in het kostenmodel).

## 4. Benodigde gegevens per soort klus

| Klus | Verplicht | Optioneel |
|---|---|---|
| Account aanmaken | Naam, e-mail, bedrijfsnaam, factuuradres, pakket | Btw-nummer (verplicht voor verlegde btw bij zakelijke klanten in een ander EU-land), KvK-nummer |
| Site toevoegen | Domein, taal (nl, later de), land, type (WordPress of WooCommerce) | Merkstem, doelgroep, concurrenten, uitgesloten onderwerpen |
| CMS koppelen | URL plus app-wachtwoord of plugin-token | Gekozen SEO-plugin (Yoast of Rank Math), te gebruiken custom post types |
| Zoekwoordonderzoek | 1 tot 5 seed-zoekwoorden of het domein, markt (land en taal) | Tags, uitgesloten termen |
| Artikel of producttekst | Zoekwoord, doeltype (post, pagina, CPT, product, productcategorie), taal | Interne links, auteur (E-E-A-T), bronnen, afbeelding, categorie |
| Refresh | Bestaande URL, de huidige versie (ophalen uit het CMS), de reden | Nieuwe zoekwoorden |
| Rankings | Domein, zoekwoordenlijst | Search Console-koppeling |
| Proefbureau | Bureaunaam, de sites van zijn klanten (alleen met een getekende AVV) | Medewerkers met een eigen login [A] |

## 5. Output

### 5.1 Zoekwoordonderzoek (van OpenSEO)
Een lijst met zoekwoorden per site: volume, moeilijkheid (KD), intentie, CPC en trend. Plus de live SERP en de concurrerende domeinen. Bewaard als "opgeslagen zoekwoorden" met tags. De agent rangschikt op kans (een combinatie van volume, KD en de huidige positie) [A]. Voor webshops ligt de nadruk op zoekwoorden voor producten en categorieën [A].

### 5.2 Contentgeneratie (zelf bouwen: de Conquer-pijplijn)
De vaste stappen volgens het bouwplan: onderzoek, dan een brief, dan het artikel, dan de interne links, dan de goedkeuring, dan publiceren. Elke versie wordt bewaard met een nummer (v1, v2 ...), met wie het voorstelde, de reden en een momentopname van de oude versie. Zo werkt Conqueror ook ("propose ... revision", "this changes NOTHING"). De output: titel, tekst, meta title, meta description, focus keyword, canonical, een voorstel voor de interne links en een kwaliteitsscore. Het taalgebruik is eenvoudig, zodat een zzp'er zonder SEO-kennis kan beoordelen [A].

### 5.3 Publicatie per platform
- **WordPress (MVP):** concept, of publicatie na goedkeuring. Ondersteunt posts, pagina's en CPT's. Vult de meta van Yoast of Rank Math in, en de categorie en de afbeelding.
- **WooCommerce (MVP):** de lange en korte productbeschrijving, en de teksten van productcategorieën. Prijs, voorraad en andere velden blijven ongemoeid [A].
- **Shopify (v1, feb 2027, volgens het bouwplan):** producten, collecties, pagina's en blogartikelen, met de SEO-velden, via OAuth en de Admin API, met de compliance-webhooks en de app-review.
- **Webflow (v1, feb 2027, volgens het bouwplan):** CMS-items aanmaken of bijwerken, daarna één site-publish. Volgens het bouwplan geldt "limited to one successful publish per minute" en een limiet van 60 of 120 verzoeken per minuut. Bij een 429 volgt Retry-After met backoff.
- **Altijd:** elke publicatie heeft een vaste sleutel, zodat een retry nooit tot een dubbele publicatie leidt (acceptatiecriterium uit het bouwplan). Terugdraaien kan naar de vorige versie [A, zoals bij Conqueror].

### 5.4 Contentrefresh
Een voorstel met de oude en de nieuwe tekst naast elkaar, de reden (zie 3, besluit OV11 d) en daarna een meting van het effect per URL (zoals "get_change_performance" bij Conqueror).

### 5.5 Rankings en GEO-zichtbaarheid
Een dagelijks overzicht van de posities per zoekwoord, en de cijfers uit Search Console zodra die koppeling werkt. GEO-zichtbaarheid (genoemd en geciteerd worden in AI-antwoorden) komt na de bèta (besluit OV9 c). In de MVP zit geen GEO.

### 5.6 Rapporten
Een maandoverzicht per site, als mail en op een webpagina, onder het merk Rankcomet. White-label (logo en kleuren van een bureau) komt later, als bureaus erom vragen. De MIT-vermelding van OpenSEO staat op de about-pagina en in de repo (zie 6).

### 5.7 Accounts en proefbureaus
- **MVP:** één account per klant, met één site (Solo). Of de webshopvariant meer sites krijgt, hangt af van OV8 [A].
- **Proefbureaus (3 tot 5, uit Erwins netwerk):** een gewoon account met meerdere sites, zonder white-label en zonder klantlogins [A]. Data zijn strikt gescheiden per account.
- **Later, als bureaus erom vragen:** de bureaulaag (bureau, klant, site), rollen, goedkeuring door de eindklant en white-label.

### 5.8 Architectuur op het EU-platform
- App, API, workers en Postgres op OVH, in hetzelfde datacenter als billr2 (besluit OV12 a).
- Een wachtrij voor taken (onderzoek, schrijven, publiceren en tracking), met retries en een vaste sleutel per taak.
- Azure OpenAI in de EU Data Zone, met hetzelfde model als bij billr2 (besluit OV6 a). De kosten per artikel worden opnieuw gemeten tijdens de bouw.
- Geheimen (CMS-tokens en OAuth-tokens) versleuteld opgeslagen, zoals bij billr2 met AES-GCM [A].
- De basis is een fork van OpenSEO (MIT), met de LICENSE en het copyright behouden.
- Externe diensten: DataForSEO, Google Search Console, Stripe (of Mollie, OV7) en de transactionele mail. Allemaal subverwerkers in de AVV (zie 5.10).
- Het datamodel houdt rekening met een latere bureaulaag (een account kan later onder een bureau vallen) [A].

### 5.9 Bouwvolgorde in blokken
Aangepast aan het besluit van 01-11, met de fasering van het bouwplan voor Shopify en Webflow:
1. Fork van OpenSEO, inloggen, accounts, Stripe (of Mollie, OV7), NL-UI, OVH en Azure EU.
2. De WordPress-plugin en WooCommerce.
3. De Conquer-pijplijn NL, met de goedkeuringsrij en het versiebeheer (na OV3).
4. De koppeling met Search Console (aanvraag indienen in jan 2027 volgens het bouwplan) en rank tracking.
5. Bèta NL (jan 2027): zzp'ers en kleine webshops op WordPress en WooCommerce, plus 3 tot 5 proefbureaus. Het bouwplan noemt 10 bètasites.
6. De Shopify-app (indienen feb 2027).
7. Webflow (feb 2027).
8. DE-lokalisatie (mrt tot apr 2027) en de lancering in DE (apr 2027).
9. Later, als bureaus erom vragen: de bureaulaag met white-label. GEO na de bèta.

Uren volgens het bouwplan: MVP 160, v1 120 en DE 60, samen 340 (allemaal aannames in de bron). In de v1-uren zat de bureaulaag. Door het doorschuiven ervan worden de v1-uren waarschijnlijk lager, maar een nieuw getal is er niet [A].

### 5.10 Compliance NL en DE
- **NL:** de AV, de privacyverklaring en een verwerkersovereenkomst (art. 28 AVG) met de klanten. Bij zakelijke klanten in een ander EU-land komt er een factuur met "btw verlegd" en een ICP-opgaaf. Particulieren betalen NL-btw (bouwplan, belastingdienst.nl). Zzp'ers in NL betalen gewoon NL-btw [A].
- **DE:**
  - een Impressum volgens § 5 DDG: naam en adres, e-mail, handelsregister en nummer, btw-nummer, "leicht erkennbar, unmittelbar erreichbar";
  - een AVV volgens de DSGVO, met een lijst van subverwerkers;
  - hosting in de EU;
  - Duitse prompts, de keuze tussen du en Sie, en een review door een native speaker.
- **AVV (besluit OV13 a):** de Analist maakt een concept-AVV op basis van de verwerkersovereenkomst van billr2, met de veilige standaard [A]. Daarin staan als subverwerkers: OVH, Microsoft (Azure OpenAI EU), DataForSEO (de vestiging is nog niet gecontroleerd), Google (Search Console), de betaaldienst en de mailprovider.
- **Rechtspersoon:** de bronnen noemen geen verwerker. Veilige standaard: dezelfde partij als bij billr2 (Seven Digital B.V.), nog te bevestigen door de Projectleider [A].
- **Licentie:** de MIT-vermelding van OpenSEO staat in de repo en op de about-pagina.

### 5.11 Verkoop vóór de lancering
Erwin regelt de handmatige SEO-dienst vóór de lancering zelf, buiten het Sevenai-bouwteam (Erwin, 01-11-2026 09:58: "Maak je daar maar geen zorgen over dat fix ik wel. Ik kan een apart account aanmaken en de bot zo instellen dat het alle SEO taken automatiseert en terugkoppelt met de klant"). Hij richt die dienst zelf in, met een apart account. Het bouwteam bouwt daar niets voor, gebruikt geen klantdata en logt niet in bij klanten.

Aanvulling (Erwin, 01-11-2026: "Ja en we kunnen iig al starten met bouwen en verkopen. [...] Ik kan gewoon een grokbot de taken laten uitvoeren, het verkopen tot de tijd de bot en dashboard klaar is"):
- Tot het dashboard klaar is, verkoopt Erwin een handmatige dienst aan de eerste klanten.
- Grokbot is daarbij de werkplaats, geen productie. Wat daar gebeurt, valt buiten deze spec en buiten de EU-productieomgeving van Rankcomet (zie tegenstrijdigheid 9).
- Het bouwteam bouwt niets voor die werkplaats, koppelt die niet aan Rankcomet en neemt geen gegevens uit die werkplaats over in de productie. De enige uitzondering is wat een klant zelf opnieuw invoert na de lancering [A].
- Klanten van de handmatige dienst stappen bij de lancering over naar het dashboard. Hun sites worden dan opnieuw gekoppeld via de normale route (4) [A].

## 6. Harde regels

1. **Geen publicatie zonder menselijk akkoord.** Elke wijziging in een CMS (nieuw, refresh of meta) gaat pas na een klik van de klant of van een bevoegd persoon. Er bestaat geen instelling voor "auto-publish".
2. **Geen backlink-uitwisseling.** Geen linkruil, geen gekochte links en geen netwerk van links, volgens het spambeleid van Google ("Excessive link exchanges", link spam).
3. **Een rem op het volume.** Geen massa pagina's zonder meerwaarde (scaled content abuse). Er is een maximum per site per maand, volgens het pakket, en een kwaliteitscontrole vóór de goedkeuringsrij [A].
4. **Productie alleen in de EU:** OVH en Azure OpenAI EU Data Zone. Geen model buiten de EU voor klantinhoud.
5. **De MIT-vermelding van OpenSEO blijft staan.**
6. **Alleen testdata** tijdens de bouw en de tests: eigen testsites (WordPress en WooCommerce). Geen sites van echte klanten vóór de bèta en vóór een getekende AVV. Geen gegevens uit de werkplaats van 5.11.
7. **Een retry publiceert nooit dubbel.**
8. **Velden buiten SEO en tekst blijven ongemoeid** (prijs, voorraad, varianten) [A].
9. **Geheimen nooit in logs of de chat.**
10. **Strikte scheiding per account.**

## 7. Menselijk controlemoment

- **De goedkeuringsrij:** per voorstel ziet de klant het verschil met de huidige versie, de reden, de kwaliteitsscore en de plek op de site. De keuzes: goedkeuren en publiceren, goedkeuren als concept, aanpassen, of afwijzen met een reden.
- **Wie keurt goed:** de accounthouder. Bij een proefbureau doet het bureau dat zelf. Goedkeuring door de eindklant van een bureau komt later, met de bureaulaag.
- **Bulk goedkeuren:** mag, maar per item blijft het verschil zichtbaar [A].
- **Refresh:** dezelfde rij en hetzelfde akkoord.
- **Het log:** wie wat wanneer goedkeurde en publiceerde.

## 8. Uitzonderingen en wat er dan gebeurt

| Situatie | Wat er gebeurt |
|---|---|
| Het CMS-token is verlopen of ingetrokken | De publicatie stopt en het voorstel blijft goedgekeurd in de wachtrij. De klant krijgt een melding om opnieuw te koppelen. |
| Yoast en Rank Math ontbreken allebei | Alleen de tekst wordt gepubliceerd, de meta niet, met een waarschuwing in het voorstel [A]. |
| De site is intussen met de hand gewijzigd | Vóór de publicatie wordt de versie opnieuw opgehaald. Is die anders dan bij het voorstel, dan gaat het voorstel terug naar de rij [A]. |
| Een storing bij DataForSEO of Azure | De taak gaat terug in de wachtrij. Na herhaald falen volgt een melding, en er wordt niets gepubliceerd. |
| De kwaliteitscontrole keurt af | Het voorstel komt niet in de rij en wordt opnieuw geschreven. Na een tweede afkeuring komt het in de rij met de markering "handmatig nakijken" [A]. |
| De pakketlimiet is bereikt | Geen nieuwe voorstellen, wel een melding met de mogelijkheid om op te waarderen. |
| De klant reageert niet op de goedkeuring | Een herinnering, daarna blijft het voorstel staan. Er wordt nooit iets automatisch gepubliceerd. |
| De klant heeft geen WordPress of WooCommerce (bijvoorbeeld Shopify, Webflow of Wix) | In de MVP niet te koppelen. De klant komt op een wachtlijst voor v1 (Shopify en Webflow) of later (Wix) [A]. |
| Een proefbureau vraagt om white-label | Noteren als vraag van een bureau. Dat is de trigger om de bureaulaag in te plannen. |
| Search Console is nog niet goedgekeurd door Google | Rankings alleen via DataForSEO, en refresh alleen op positie en leeftijd [A]. |
| Er komt echte klantdata of een persoonsgegeven in een testomgeving | Stoppen, niet bewaren en melden aan de Projectleider. |

## 9. Nulmeting

Alle cijfers komen van de bouwplan-Page (27-10-2026). In die bron zijn de groeicijfers en de prijzen zelf aannames.

- **Markt:** live Shopify-winkels NL 68.082 en DE 103.786 (storeleads, 23-10-2026), voor v1. WordPress heeft 39,6% van alle sites en WooCommerce draait op 19,7% van de WP-sites (w3techs, wereldwijd, geen landcijfer). Het aantal zzp'ers of kleine webshops op WordPress in NL staat niet in de bronnen.
- **Zoekvolume per maand (zoekwoordplanner, 27-10):**
  - "seo tool": NL 2.400, DE 8.100;
  - "ai seo" 590 (NL), "ki seo" 390 (DE);
  - "seo teksten laten schrijven" 320 (NL);
  - mediaan-CPC: NL $3,34, DE $2,96.
- **Kosten per artikel (bouwplan):** DataForSEO ongeveer €0,15. LLM ongeveer €0,30, maar met Sonnet, dus dat geldt niet voor Azure (tegenstrijdigheid 2). Rank tracking ongeveer €2 per site per maand.
- **Churn (bouwplan):** SMB 6,2% per maand (Visionary 2026), 4,5% (RetentionCheck), en goed is onder 3,5% (Churntools).
- **Pakketten (aanname in de bron):** Solo €39, Pro of webshop €89, Bureau €249. De gemiddelde ARPU is ongeveer €85, met de klantmix 50/35/15%.
- **Prognose basis (bouwplan, met de oude doelgroepmix):** MRR €510 in jan 2027, €2.564 in apr 2027 en €9.774 in okt 2027. De cash-investering is €3.907. Door de nieuwe doelgroep geldt deze prognose niet zonder meer (tegenstrijdigheid 3).
- **Acceptatie MVP (bouwplan):**
  - 10 bètasites publiceren 4 weken zonder handwerk;
  - minstens 90% van de artikelen wordt goedgekeurd zonder herschrijven;
  - de velden van Yoast en Rank Math kloppen;
  - een retry publiceert niet dubbel.
- **Acceptatie DE (bouwplan):** een native review van minstens 4 op 5 op 20 artikelen; het Impressum en de AVV staan online.
- **Go/no-go (bouwplan):** de bèta gaat door bij minstens 5 betalers of intentieverklaringen. DE gaat door als NL minstens 15 klanten heeft en de churn onder 7% blijft.
- **Nog te meten zodra de bèta draait:** de tijd van voorstel tot goedkeuring, het percentage afgewezen voorstellen, de verandering in posities en klikken per gepubliceerde URL, en de kosten per artikel op Azure. Beginwaarden zijn er niet.

## 10. Open vragen

**Opgelost**
1. **page.tsx en prognose.json niet gevonden.** Opgelost (Projectleider, 01-11): **b**, de bouwplan-Page is genoeg.
2. **Wat zit er in de NL-bèta?** Vervallen (Erwin, 01-11): zzp'ers en kleine webshops op WordPress en WooCommerce, plus 3 tot 5 proefbureaus. Shopify en Webflow in v1, volgens het bouwplan.
6. **Welk Azure-model?** Opgelost (Projectleider, 01-11): **a**, hetzelfde model als bij billr2, met een nieuwe kostenmeting.
9. **GEO-cijfers voor NL en DE.** Opgelost (Projectleider, 01-11): **c**, na de bèta.
10. **White-label.** Vervallen (Erwin, 01-11): later, als bureaus erom vragen.
11. **Wanneer een refresh-voorstel?** Opgelost (Projectleider, 01-11): **d**, een combinatie van positie, klikken en leeftijd, met per site instelbare drempels.
12. **Welk OVH-datacenter?** Opgelost (Projectleider, 01-11): **a**, hetzelfde als billr2.
13. **Concept-AVV.** Opgelost (Projectleider, 01-11): **a**, de Analist maakt een concept op basis van de verwerkersovereenkomst van billr2.

**Open, voor Erwin**

3. **De schriftelijke toestemming van de eigenaar van Conqueror.** (Erwin) Ligt die vast, met daarin de functies, het design, de teksten en de doorverkoop? En waar staat het stuk?
   a) Ja, het stuk staat op [pad].
   b) Nog niet. Dan bouwen we eerst alleen het OpenSEO-deel.
4. **Is de validatiedrempel gehaald** (minstens 3 bureaus met intentie en 20 aanmeldingen op de wachtlijst)? (Erwin)
   a) Ja.
   b) Nee, maar toch bouwen.
   c) Nog niet gemeten.
5. **Welke domeinen voor de MVP?** (Erwin) Het bouwplan noemt .nl en .de als "lijken vrij", .ai als geregistreerd (is die van jou?) en .com als bezet.
   a) rankcomet.ai.
   b) rankcomet.nl en .de.
   c) Allebei.
7. **Facturatie.** (Erwin)
   a) Stripe (bouwplan).
   b) Mollie, met iDEAL (validatie).
8. **Prijzen voor de bèta.** (Erwin) Alle bedragen komen van de bouwplan-Page en zijn daar aannames, excl. btw, per maand.
   Deel 1, de Solo-prijs voor zzp'ers en kleine webshops:
   a) Solo €39: 1 site, 10 artikelen, 100 zoekwoorden volgen (bouwplan en validatie).
   b) Solo €39 voor zzp'ers, en voor webshops Pro €89: 3 sites, 30 artikelen, WooCommerce-producten (bouwplan).
   c) Een andere prijs, op te geven door Erwin.
   Deel 2, een eventuele proefprijs voor de 3 tot 5 bureaus:
   a) Bureau €249: 10 sites, 100 artikelen (bouwplan; white-label zit er dan nog niet in).
   b) Bureau €149: 5 sites (validatie).
   c) Gratis tijdens de bèta.
   d) Een andere proefprijs, op te geven door Erwin.

## Opmerking over gegevens

In de bronnen staan alleen openbare namen. Klantgegevens van Rankcomet zijn er niet. De bouwplan-Page noemt de copyrighthouder van OpenSEO, de rechtspersoon achter Conqueror en de voornaam van een klant uit een openbare testimonial. Die voornaam heb ik niet overgenomen.

KLAAR VOOR GOEDKEURING ERWIN
