// Kwaliteitspoort voor artikelen (stap 4). Dit zijn harde regels in code; de prompt vraagt hetzelfde,
// maar wat de prompt ook zegt, een artikel komt hier niet voorbij als:
// - het de eigen klantinformatie niet gebruikt (bedrijf, plaats, een dienst);
// - het een prijs, belofte of claim bevat (woordfilter);
// - het te veel lijkt op een eerder artikel of een bestaande pagina (duplicaatcheck);
// - het te kort is of het zoekwoord mist.
// Links naar buiten de eigen lijst worden altijd weggehaald (geen linkruil, geen verzonnen links).

// [A50] Woordfilter. Elke treffer blokkeert. De lijst is bewust streng; liever een artikel opnieuw dan een
// verzonnen prijs of belofte op de site van een klant.
export const WOORDFILTER = [
  { code: 'prijs', re: /(€\s?\d|\d\s?€|\b\d+([.,]\d+)?\s?(euro|eur)\b|\b\d+,-|\bvanaf\s+\d|\bkorting|\bactieprijs|\baanbieding\b)/i, tekst: 'Er staat een prijs, bedrag of korting in. Rankcomet noemt nooit prijzen.' },
  { code: 'claim', re: /\b(de|het)\s+(aller)?(beste|goedkoopste|snelste|grootste|enige|meest betrouwbare)\b|\b(nummer|nr\.?)\s*(1|één|een)\b|\bmarktleider\b|\b100\s?%/i, tekst: 'Er staat een claim in zoals "de beste" of "nummer 1".' },
  { code: 'belofte', re: /\b(gegarandeerd|garanderen|garantie|altijd (goed|raak|op tijd)|nooit meer|binnen \d+ (uur|dagen|minuten)|zonder risico|bewezen|wetenschappelijk aangetoond)\b/i, tekst: 'Er staat een belofte of garantie in.' },
  { code: 'medisch', re: /\b(geneest|genezen|geneeskrachtig|voorkomt (kanker|ziekte)|medicijn tegen)\b/i, tekst: 'Er staat een medische claim in.' },
];

export const DREMPEL_SCORE = 70;        // [A51] onder deze score geen voorstel
export const MIN_WOORDEN = 600;         // [A51]
export const MAX_GELIJKENIS = 0.35;     // [A51] Jaccard op 5-woordreeksen

export const platteTekst = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const normaliseer = (t) => platteTekst(t).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const woorden = (t) => normaliseer(t).split(' ').filter(Boolean);

function reeksen(tekst, n = 5) {
  const w = woorden(tekst), s = new Set();
  for (let i = 0; i + n <= w.length; i++) s.add(w.slice(i, i + n).join(' '));
  return s;
}

export function gelijkenis(a, b) {
  const A = reeksen(a), B = reeksen(b);
  if (!A.size || !B.size) return 0;
  let gedeeld = 0; for (const r of A) if (B.has(r)) gedeeld++;
  return gedeeld / (A.size + B.size - gedeeld);
}

// Haalt elke link weg die niet naar een toegestaan adres wijst; de ankertekst blijft staan.
export function filterLinks(html, toegestaan) {
  const ok = new Set(toegestaan.map((u) => u.replace(/\/$/, '')));
  let verwijderd = 0;
  const schoon = String(html || '').replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (heel, attrs, binnen) => {
    const m = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const href = (m ? (m[1] ?? m[2]) : '').trim();
    if (href && ok.has(href.replace(/\/$/, ''))) return `<a href="${href.replace(/"/g, '&quot;')}">${binnen}</a>`;
    verwijderd++; return binnen;
  });
  return { html: schoon, verwijderd };
}

const bevat = (tekst, naald) => naald && normaliseer(tekst).includes(normaliseer(naald));

// Beoordeelt een artikel. Geeft { geslaagd, score, bevindingen, artikel } waarbij artikel de gefilterde versie is.
export function beoordeel({ artikel, zoekwoord, profiel, paginas = [], eerdereTeksten = [] }) {
  const bevindingen = [];
  const blok = (code, tekst) => bevindingen.push({ code, tekst, blokkeert: true });
  const punt = (code, tekst, min) => bevindingen.push({ code, tekst, blokkeert: false, min });

  const { html, verwijderd } = filterLinks(artikel.inhoud, paginas.map((p) => p.url));
  const schoon = { ...artikel, inhoud: html };
  const alles = `${schoon.titel}\n${platteTekst(schoon.inhoud)}\n${schoon.meta_titel}\n${schoon.meta_beschrijving}`;

  // 1. Klantinformatie: bedrijf, plaats en minstens één dienst moeten erin staan.
  const diensten = String(profiel.diensten).split(/[,;\n]/).map((d) => d.trim()).filter(Boolean);
  if (!bevat(alles, profiel.bedrijf)) blok('bedrijf', `De naam van het bedrijf (${profiel.bedrijf}) komt niet voor.`);
  if (!bevat(alles, String(profiel.plaats).split(/[,;]/)[0])) blok('plaats', `De plaats (${profiel.plaats}) komt niet voor.`);
  if (diensten.length && !diensten.some((d) => bevat(alles, d))) blok('dienst', 'Geen van de diensten uit het siteprofiel komt voor. Het artikel is te algemeen.');

  // 2. Woordfilter.
  for (const f of WOORDFILTER) { const m = alles.match(f.re); if (m) blok(f.code, `${f.tekst} Gevonden: "${m[0].trim()}".`); }

  // 3. Duplicaat: eerdere artikelen en bestaande pagina's.
  for (const eerder of eerdereTeksten) {
    const g = gelijkenis(schoon.inhoud, eerder);
    if (g > MAX_GELIJKENIS) { blok('duplicaat', `Het artikel lijkt te veel op een eerder artikel (${Math.round(g * 100)}% gelijk).`); break; }
  }
  const titelNorm = normaliseer(schoon.titel);
  const dubbel = paginas.find((p) => normaliseer(p.titel) === titelNorm);
  if (dubbel) blok('duplicaat_pagina', `Er bestaat al een pagina met deze titel: ${dubbel.titel}.`);

  // 4. Lengte en zoekwoord.
  const n = woorden(schoon.inhoud).length;
  if (n < MIN_WOORDEN) blok('lengte', `Het artikel is te kort (${n} woorden, minstens ${MIN_WOORDEN}).`);
  if (!bevat(schoon.titel, zoekwoord) && !bevat(schoon.inhoud, zoekwoord)) blok('zoekwoord', `Het zoekwoord "${zoekwoord}" komt niet voor.`);
  else if (!bevat(schoon.titel, zoekwoord)) punt('zoekwoord_titel', 'Het zoekwoord staat niet in de titel.', 10);

  // 5. Punten: structuur, meta, links.
  if (!/<h2\b/i.test(schoon.inhoud)) punt('koppen', 'Het artikel heeft geen tussenkoppen.', 10);
  if (!schoon.meta_titel || schoon.meta_titel.length > 65) punt('meta_titel', 'De meta-titel ontbreekt of is langer dan 65 tekens.', 10);
  if (!schoon.meta_beschrijving || schoon.meta_beschrijving.length < 80 || schoon.meta_beschrijving.length > 160) punt('meta_beschrijving', 'De meta-beschrijving ontbreekt of heeft niet de goede lengte (80 tot 160 tekens).', 10);
  if (paginas.length && !/<a\b/i.test(schoon.inhoud)) punt('links', 'Geen interne links, terwijl er pagina\'s zijn om naar te linken.', 10);
  if (verwijderd) punt('links_verwijderd', `${verwijderd} link(s) naar buiten de eigen lijst zijn weggehaald.`, 5 * verwijderd);

  const blokkerend = bevindingen.some((b) => b.blokkeert);
  const score = blokkerend ? 0 : Math.max(0, 100 - bevindingen.reduce((t, b) => t + (b.min || 0), 0));
  return { geslaagd: !blokkerend && score >= DREMPEL_SCORE, score, bevindingen, artikel: schoon, woorden: n };
}
