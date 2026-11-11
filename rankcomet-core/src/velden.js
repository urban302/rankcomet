// Welke velden Rankcomet op een klantsite mag schrijven (stap 3). Dit is de enige lijst; de
// WordPress-plugin heeft dezelfde lijst. Wat hier niet in staat, bestaat voor Rankcomet niet:
// prijs, voorraad, SKU, bestellingen, gebruikers en instellingen zijn dus nooit schrijfbaar.
import { Fout } from './accounts.js';

const SEO = ['meta_titel', 'meta_beschrijving', 'focus_zoekwoord', 'canonical'];

export const VELDEN = {
  post: ['titel', 'inhoud', ...SEO],
  pagina: ['titel', 'inhoud', ...SEO],
  product: ['titel', 'beschrijving', 'korte_beschrijving', 'afbeelding_alt', ...SEO],
  productcategorie: ['naam', 'beschrijving', 'meta_titel', 'meta_beschrijving'],
};

export const WOOCOMMERCE_TYPES = ['product', 'productcategorie'];

// [A41] Maximale lengte per veld: een artikel past ruim in 200.000 tekens; meta's zijn kort.
const MAX = { inhoud: 200000, beschrijving: 200000, korte_beschrijving: 5000, titel: 300, naam: 300, meta_titel: 300, meta_beschrijving: 600, focus_zoekwoord: 200, canonical: 2000, afbeelding_alt: 500 };

// Controleert doeltype en velden. Geeft de velden terug als { veld: tekst }; gooit een Fout bij
// een onbekend type, een veld buiten de lijst, een lege set of een te lange waarde.
export function controleerVelden(doelType, velden) {
  const toegestaan = VELDEN[doelType];
  if (!toegestaan) throw new Fout('Dit soort onderdeel kent Rankcomet niet.', 400);
  if (!velden || typeof velden !== 'object' || Array.isArray(velden)) throw new Fout('Er zijn geen velden opgegeven.', 400);
  const schoon = {};
  for (const [veld, waarde] of Object.entries(velden)) {
    if (!toegestaan.includes(veld)) throw new Fout(`Het veld "${veld}" mag Rankcomet niet aanpassen.`, 400, { veld });
    if (typeof waarde !== 'string') throw new Fout(`Het veld "${veld}" moet tekst zijn.`, 400, { veld });
    if (waarde.length > MAX[veld]) throw new Fout(`Het veld "${veld}" is te lang (maximaal ${MAX[veld]} tekens).`, 400, { veld });
    schoon[veld] = waarde;
  }
  if (!Object.keys(schoon).length) throw new Fout('Er zijn geen velden opgegeven.', 400);
  return schoon;
}
