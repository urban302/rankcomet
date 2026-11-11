# vendor-openseo: bewaarde OpenSEO-code

Herkomst: [OpenSEO](https://github.com/every-app/open-seo), commit 1523750b76857324573a086b1d93bd3c3612b5b1 (30-10-2026), MIT-licentie, Copyright (c) 2026 Ben Senescu. De licentietekst staat in `LICENSE` in de hoofdmap.

In stap 0 (opschonen van de fork) is alleen deze code bewaard. De rest van OpenSEO is verwijderd en blijft terug te halen uit commit 3c11373.

## Status: alleen bron, draait niet
- Dit is TypeScript uit een Cloudflare Workers-app. De kern (`rankcomet-core/`) laadt hier niets van.
- `@/` in de imports verwijst naar `vendor-openseo/src/`.
- Een deel van de imports wijst naar code die weg is (billing, database, R2-cache, Every App, `cloudflare:workers`). Die stukken vervangt de adapter door eigen kerncode. Zie "Losse eindjes".
- De `*.test.ts`-bestanden zijn Vitest-tests van OpenSEO. Ze draaien hier niet, maar laten zien wat de code hoort te doen. Gebruik ze als voorbeeld bij het overzetten.
- Externe pakketten die deze code gebruikt: `zod`, `remeda`, `tldts`, `drizzle-orm`. Die staan niet in `rankcomet-core/vendor/`. Besloten door Erwin: de adapter zet de code zelf om naar gewoon JavaScript, zonder nieuwe pakketten.

## Houden: zoekwoordonderzoek
Wordt later via een adapter aan `rankcomet-core` gekoppeld (eigen map, bijvoorbeeld `rankcomet-core/src/zoekwoorden/`).

| Pad (onder `src/`) | Wat |
|---|---|
| `server/lib/dataforseo/core.ts`, `envelope.ts` | POST naar DataForSEO, controle van het antwoord en foutcodes |
| `server/lib/dataforseo/labs.ts`, `google-ads.ts`, `keyword-metrics.ts` | Zoekwoordideeën, zoekvolumes en maandcijfers |
| `server/lib/dataforseo/serp.ts`, `serp-locations.ts`, `serp-location-validate.ts` | SERP-resultaten en locaties |
| `server/lib/dataforseo/filters.ts`, `researchScopeFilters.ts` | Filters voor DataForSEO-aanvragen |
| `server/lib/dataforseo/request-slots.ts`, `pricing.ts`, `shared.ts` | Rem op gelijktijdige aanvragen en kosten per aanroep |
| `server/features/keywords/services/research/` | Onderzoeksflow: ideeën ophalen, verrijken, selecteren, lokaal volume, SERP-analyse |
| `types/keywords.ts`, `types/schemas/keywords.ts` | Vormen van zoekwoord- en SERP-data |
| `shared/keyword-locations.ts`, `serp-location-search.ts`, `google-serp-url.ts`, `researchScope.ts` | Landen, talen en locaties; SERP-URL; onderzoeksbereik |
| `server/lib/errors.ts`, `shared/error-codes.ts` | Fouttypes die de code hierboven gebruikt |

## Later: blijft staan
Bewaard omdat een later blok iets vergelijkbaars nodig heeft (besloten door Erwin: blijft staan).

| Pad (onder `src/`) | Voor welk blok |
|---|---|
| `server/lib/gscClient.ts`, `gscErrors.ts`, `server/features/gsc/`, `shared/gsc.ts` | Blok 4: Search Console |
| `server/features/google/googleOAuth*.ts`, `oauth-config.ts` | Blok 4: Google-koppeling |
| `server/features/rank-tracking/services/rankTrackingResults.ts`, `shared/rank-tracking.ts` | Blok 4: rank tracking |
| `shared/safe-url.ts`, `server/lib/public-fetch.ts` | Stap 2: veilige fetcher (SSRF) |
| `docs/DATAFORSEO_API_KEY.md`, `docs/SELF_HOSTING_GOOGLE_SEARCH_CONSOLE.md` | Uitleg over de sleutels (Engels, OpenSEO-opzet) |

## Losse eindjes
Imports naar verwijderde OpenSEO-code. De adapter vervangt ze:
- Facturatie en credits: `server/billing/subscription`, `shared/billing`, `shared/billing-credit-features`. Rankcomet rekent met pakketten en limieten in de kern.
- Opslag: `db`, `db/schema`, de repositories en `server/lib/r2-cache`. Rankcomet gebruikt `rankcomet-core/src/db.js`.
- Cloudflare en Every App: `cloudflare:workers` (`waitUntil`), `@every-app/sdk`, `server/lib/provider-access`, `server/lib/runtime-env`, `shared/gateway-setup-messages`.
- De DataForSEO-client (`server/lib/dataforseo/client.ts`, `index.ts`) is weg omdat hij aan billing en Workers vastzit. De adapter maakt een eigen kleine client bovenop `core.ts`.
