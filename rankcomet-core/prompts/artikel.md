Schrijf het artikel voor het zoekwoord "{{zoekwoord}}" volgens deze opzet:
{{brief}}

Bestaande pagina's waar je naar mag linken (titel, adres). Andere links zijn niet toegestaan:
{{paginas}}

Eisen:
- Minstens 700 woorden, hooguit 1500. Gebruik tussenkoppen (h2, h3), korte alinea's en waar het past een lijstje.
- Het zoekwoord staat in de titel, in de eerste alinea en in minstens één tussenkop, op een natuurlijke manier.
- Noem het bedrijf, de plaats en minstens één dienst uit de bedrijfsinformatie, zodat het artikel niet voor elk bedrijf kan gelden.
- Interne links schrijf je in de tekst als <a href="adres">ankertekst</a>, alleen naar adressen uit de lijst hierboven.
- Geen prijzen, geen beloftes, geen claims, geen verzonnen cijfers of ervaringen.
{{feedback}}

Antwoord met dit JSON-object:
{
  "titel": "de titel van het artikel",
  "inhoud": "het hele artikel als HTML met <h2>, <h3>, <p>, <ul>, <li> en <a>",
  "meta_titel": "titel voor Google, hooguit 60 tekens, met het zoekwoord",
  "meta_beschrijving": "samenvatting voor Google, 120 tot 155 tekens, met het zoekwoord",
  "focus_zoekwoord": "{{zoekwoord}}"
}
