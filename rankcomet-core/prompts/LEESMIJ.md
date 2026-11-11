# Prompts

De prompts van de Conquer-pijplijn (stap 4). `rankcomet-core/src/pijplijn.js` leest ze en vult de `{{velden}}` in.

| Bestand | Stap | Velden |
|---|---|---|
| `systeem.md` | Vaste instructie bij elke aanroep | `{{bedrijf}}`, `{{diensten}}`, `{{plaats}}`, `{{ervaring}}`, `{{doelgroep}}`, `{{toon}}`, `{{uitgesloten}}` |
| `brief.md` | Onderwerp en opzet kiezen bij een zoekwoord | `{{zoekwoord}}`, `{{paginas}}` (bestaande pagina's) |
| `opfrissen.md` | Een bestaande pagina opfrissen (stap 9) | `{{zoekwoord}}`, `{{reden}}`, `{{oude_titel}}`, `{{oude_tekst}}`, `{{paginas}}`, `{{feedback}}` |
| `artikel.md` | Het artikel, met interne links en meta | `{{zoekwoord}}`, `{{brief}}`, `{{paginas}}`, `{{feedback}}` (leeg, of de bevindingen van de kwaliteitspoort bij de tweede poging) |

Harde regels staan in code (`src/kwaliteit.js`, `src/velden.js`, `src/artikelen.js`), nooit alleen hier: de kwaliteitspoort controleert elk artikel, wat de prompt ook zegt. Een prompt bevat nooit geheimen of persoonsgegevens buiten het siteprofiel dat de klant zelf invulde.
