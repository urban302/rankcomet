# Rankcomet.ai

Rankcomet.ai is een AI-SEO-agent voor ondernemers en kleine webshops in Nederland en België. Hij koppelt met WordPress en WooCommerce, zoekt kansrijke zoekwoorden, zet artikelen en verbeteringen klaar als concept en publiceert pas na akkoord van de klant.

Gebaseerd op [OpenSEO](https://github.com/every-app/open-seo) (MIT), commit 1523750b76857324573a086b1d93bd3c3612b5b1. De licentie van OpenSEO staat ongewijzigd in `LICENSE` (Copyright (c) 2026 Ben Senescu). De vermelding staat ook op de pagina /over van de app.

## Wat waar staat
| Map | Inhoud |
|---|---|
| `rankcomet-core/` | De app: accounts, pakketten, Stripe (testmodus), NL-UI, EU-config. Node, `node:sqlite` en `pg`. |
| `vendor-openseo/` | Bewaarde OpenSEO-code voor zoekwoordonderzoek. Alleen bron, draait nog niet. Zie `vendor-openseo/LEESMIJ.md`. |
| `docs/` | Context, spec, keuzes van Erwin, overzichten en testrapporten per ronde. |

## Tests draaien
Node 24 (minimaal 22.5). Geen internet nodig: alle pakketten staan in `rankcomet-core/vendor/`.

```
cd rankcomet-core
npm ci --offline
env -u RC_DB -u PGPASSWORD npm test
```

Tegen Postgres: zie `rankcomet-core/installatie.md`.

## Regels
- `CLAUDE.md`: vaste regels voor iedereen die aan de code werkt (ook Claude Code).
- `VOLGENDE-STAPPEN.md`: wat er nog moet gebeuren, één stap per pull request.
- `rankcomet-core/installatie.md`: installatie, env-namen en aannames.

Niets in deze repo wordt automatisch uitgerold. Uitrollen doet de Serverbeheerder, pas na een ja van Erwin.
