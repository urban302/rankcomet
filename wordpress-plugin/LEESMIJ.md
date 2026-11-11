# Rankcomet WordPress-plugin

De plugin koppelt een WordPress- of WooCommerce-site aan Rankcomet. Rankcomet zet teksten als concept klaar; publiceren gebeurt pas na akkoord van de klant in de Rankcomet-app.

## Wat de plugin doet
- Zet de koppelcode als metatag in de head, zodat Rankcomet het eigendom van het domein kan controleren (stap 2).
- Biedt vier REST-routes onder `/wp-json/rankcomet/v1/`: `status`, `doel/<type>/<id>` (huidige waarden lezen), `wijzigingen` (een wijziging toepassen) en `paginas` (gepubliceerde pagina's, voor interne links en de duplicaatcheck).
- Controleert op elk verzoek de handtekening: HMAC-SHA256 met de sleutel van de site over methode, pad, tijd, nonce en de hash van de body. Een tijd die meer dan 5 minuten afwijkt of een nonce die al gezien is, wordt geweigerd.
- Schrijft alleen velden uit de witte lijst in `includes/protocol.php`: titels, teksten, SEO-meta (Yoast of Rank Math) en alt-teksten. Prijs, voorraad, SKU en bestellingen staan niet in die lijst en zijn dus nooit schrijfbaar.
- Past een wijziging met hetzelfde id nooit twee keer toe.

`includes/protocol.php` moet gelijk blijven aan `rankcomet-core/src/wordpress.js` (handtekening) en `rankcomet-core/src/velden.js` (witte lijst). De test `rankcomet-core/tests/plugin-php.test.js` controleert dat.

## Installeren (testsite)
```
cd wordpress-plugin && zip -r rankcomet.zip rankcomet
```
Upload `rankcomet.zip` in WordPress (Plugins, Nieuwe plugin, Plugin uploaden), schakel hem in en vul bij Instellingen, Rankcomet de koppelcode en de sleutel uit de Rankcomet-app in.

Alleen op eigen testsites gebruiken tot de bèta. De plugin is nog niet op een echte WordPress-installatie getest; zie A47 in `rankcomet-core/installatie.md`.

## Tests
```
cd rankcomet-core && npm test
```
Daar zit `plugin-php.test.js` bij: syntaxiscontrole van de plugin en `tests/protocol.test.php` (handtekening, herhaling, witte lijst), met de verwachte handtekening en witte lijst uit de Node-kant.
