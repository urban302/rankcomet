# Google Search Console: de OAuth-aanvraag bij Google

Erwin dient de aanvraag in; dit document bevat alles wat je daarvoor nodig hebt, klaar om te plakken. De goedkeuring door Google duurt weken, dus doe dit vroeg. Tot de goedkeuring komen de rankings in de bèta alleen uit rank tracking via DataForSEO (spec, hoofdstuk 2).

Waarom een aanvraag nodig is: Rankcomet leest voor klanten hun Search Console-gegevens. Dat is een "gevoelige" scope volgens Google. Zolang de app niet is geverifieerd, ziet elke klant een waarschuwing "deze app is niet geverifieerd", mogen er hooguit 100 testgebruikers zijn en verloopt elke koppeling na 7 dagen. Na verificatie vervalt dat allemaal.

## 1. Wat je vooraf nodig hebt
- Een Google Cloud-project op een Google-account van het bedrijf (niet een privéaccount). Naam: `Rankcomet`.
- De API **Google Search Console API** ingeschakeld in dat project (APIs & Services, Library).
- Het domein `rankcomet.ai` geverifieerd in Google Search Console op datzelfde account (nodig om het als "geautoriseerd domein" op te geven).
- Een werkende privacyverklaring op `https://rankcomet.ai/privacy` en voorwaarden op `https://rankcomet.ai/voorwaarden`. De app serveert `/privacy` al (concept, zie onder); `/voorwaarden` komt met de AV.
- De rechtspersoon, het adres en het KvK-nummer, voor de privacyverklaring. Die staan nu als `[RECHTSPERSOON]`, `[ADRES]` en `[KVK]` in `rankcomet-core/public/privacy.html`.

## 2. OAuth-toestemmingsscherm (OAuth consent screen)
Kies **External** (de klanten zijn geen Google Workspace-gebruikers van ons).

| Veld | Waarde |
|---|---|
| App name | `Rankcomet` |
| User support email | `support@rankcomet.ai` (of het adres dat Erwin kiest; moet bestaan en gelezen worden) |
| App logo | het Rankcomet-logo, 120 x 120 px. Let op: zodra je een logo uploadt, is verificatie altijd verplicht. |
| App home page | `https://rankcomet.ai` |
| App privacy policy link | `https://rankcomet.ai/privacy` |
| App terms of service link | `https://rankcomet.ai/voorwaarden` |
| Authorized domains | `rankcomet.ai` |
| Developer contact information | hetzelfde e-mailadres |

## 3. Scopes
Rankcomet vraagt precies één scope aan. Niet meer; elke extra scope maakt de beoordeling zwaarder.

| Scope | Waarom |
|---|---|
| `https://www.googleapis.com/auth/webmasters.readonly` | Alleen lezen: klikken, vertoningen, posities en zoekopdrachten per pagina van de site van de klant. Rankcomet schrijft nooit iets in Search Console. |

Google vraagt bij een gevoelige scope om een toelichting. Deze tekst kun je plakken (Google beoordeelt in het Engels; de Nederlandse versie staat erbij voor jezelf).

**Scope justification (Engels, plakken in het formulier):**

> Rankcomet is an SEO assistant for small businesses in the Netherlands and Belgium. A customer connects their own website (WordPress or WooCommerce) and may optionally connect the Google Search Console property for that same website. Rankcomet uses the `webmasters.readonly` scope solely to read Search Analytics data (clicks, impressions, average position and queries per page) for that property. This data is shown to the customer in their dashboard and is used to decide which existing pages are losing visibility and should be proposed for a content refresh. Rankcomet never writes to Search Console and never accesses properties other than the ones the customer explicitly selects. Data is stored on servers in the European Union, encrypted at rest, is only visible to the account that connected it, and is deleted when the customer disconnects Search Console or deletes their account. No Google user data is used for advertising, sold, or shared with third parties.

**Toelichting (Nederlands, voor jezelf):**

> Rankcomet is een SEO-hulp voor kleine ondernemers in Nederland en België. Een klant koppelt zijn eigen website en kan daarnaast de Search Console-property van diezelfde site koppelen. Rankcomet gebruikt de scope `webmasters.readonly` alleen om de zoekprestaties te lezen (klikken, vertoningen, gemiddelde positie en zoekopdrachten per pagina). Die cijfers staan in het dashboard van de klant en bepalen welke bestaande pagina's zichtbaarheid verliezen en een opfrisvoorstel verdienen. Rankcomet schrijft nooit in Search Console en kijkt nooit naar andere properties dan die de klant zelf kiest. De gegevens staan op servers in de EU, versleuteld, zijn alleen zichtbaar voor het account dat ze koppelde en worden verwijderd zodra de klant de koppeling of het account opzegt. Google-gegevens worden niet gebruikt voor advertenties, niet verkocht en niet gedeeld met derden.

## 4. Demovideo
Google vraagt een korte video (YouTube, mag "niet vermeld" zijn) die de hele OAuth-flow laat zien, in het Engels of met Engelse ondertitels. Script van ongeveer 2 minuten:

1. Open `https://rankcomet.ai`, log in op een testaccount. Laat het dashboard zien.
2. Ga naar de site van de klant en klik op "Search Console koppelen". Laat zien dat de URL van het toestemmingsscherm begint met `accounts.google.com` en dat de app-naam "Rankcomet" is.
3. Laat het toestemmingsscherm zien met precies één gevraagde toestemming: "View Search Console data for your verified sites". Klik op Toestaan.
4. Terug in Rankcomet: kies de property (de passende staat bovenaan aangevinkt). Laat de pagina zien met klikken, vertoningen en positie per pagina, en de kaart op het dashboard.
5. Laat zien waar de klant de koppeling weer verbreekt, en zeg dat de opgeslagen gegevens dan worden verwijderd.
6. Laat de privacyverklaring op `https://rankcomet.ai/privacy` zien, met de alinea over Google-gegevens.

Let op: de video kan pas worden opgenomen als de Search Console-koppeling in de app zit (blok 4 in de spec). Dien de aanvraag daarom in zodra die koppeling op een testomgeving werkt; het toestemmingsscherm en de scopes kun je al eerder invullen en opslaan.

## 5. Tijdlijn en wat Google nog kan vragen
- Zet de app eerst op **Testing** met een paar testgebruikers (de testaccounts van Erwin). Dan werkt de koppeling meteen, met de waarschuwing en de wekelijkse vervaldatum.
- Dien daarna de verificatie in (**Publish app**, dan **Prepare for verification**). Reken op 2 tot 6 weken en op één of twee rondes vragen per e-mail, meestal over de privacyverklaring (moet het gebruik van Google-gegevens letterlijk noemen) of over de video.
- Omdat de scope gevoelig is en niet "restricted", is er geen externe beveiligingsaudit (CASA) nodig. Die zou wel nodig zijn bij Gmail- of Drive-scopes; die vragen we niet aan.
- Elk jaar vraagt Google om een korte herbevestiging.

## 6. Wat er in de code al klaarstaat
- `rankcomet-core/public/privacy.html`: de privacyverklaring (concept), geserveerd op `/privacy`, openbaar, met de verplichte alinea over Google-gegevens en de "Google API Services User Data Policy".
- De koppeling zelf is gebouwd in stap 8 (`rankcomet-core/src/google.js` en `src/gsc.js`): OAuth met PKCE, tokens versleuteld, property kiezen, cijfers per pagina, verbreken. Hij werkt zodra `RC_GOOGLE_CLIENT_ID` en `RC_GOOGLE_CLIENT_SECRET` in de omgeving staan. **Geautoriseerde redirect-URI** bij het aanmaken van de OAuth-client: `https://rankcomet.ai/google/terug` (precies zo; op een testomgeving de basis-URL van die omgeving plus `/google/terug`).
