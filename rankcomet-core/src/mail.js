// Teksten van de mails die Rankcomet stuurt. Versturen gebeurt via een geïnjecteerde mailer:
// mailer.stuur({ aan, onderwerp, tekst }). In tests is dat een nep-mailer.
// Links gebruiken altijd basis_url uit config/merk.json, nooit de Host-header van het verzoek:
// anders kan iemand een herstellink naar een eigen domein laten wijzen.
import { laadMerk } from './config.js';

const groet = () => `Groet,\n${laadMerk().merk}`;

export function verificatieMail(token) {
  const link = `${laadMerk().basis_url}/email-bevestigen?token=${encodeURIComponent(token)}`;
  return {
    onderwerp: `Bevestig je e-mailadres voor ${laadMerk().merk}`,
    tekst: `Hoi,\n\nKlik op de link hieronder om je e-mailadres te bevestigen. Daarna kun je je site koppelen.\n\n${link}\n\nDe link werkt 24 uur en maar één keer. Heb je geen account aangemaakt? Dan kun je deze mail negeren.\n\n${groet()}\n`,
  };
}

export function herstelMail(token) {
  const link = `${laadMerk().basis_url}/wachtwoord-herstellen?token=${encodeURIComponent(token)}`;
  return {
    onderwerp: `Nieuw wachtwoord voor ${laadMerk().merk}`,
    tekst: `Hoi,\n\nJe hebt gevraagd om een nieuw wachtwoord. Klik op de link hieronder en kies een nieuw wachtwoord.\n\n${link}\n\nDe link werkt een uur en maar één keer. Heb je dit niet gevraagd? Dan kun je deze mail negeren. Je wachtwoord blijft dan hetzelfde.\n\n${groet()}\n`,
  };
}

// Maandrapport (stap 10): korte samenvatting in de mail, de details staan in de app.
export function rapportMail(r) {
  const link = `${laadMerk().basis_url}/rapport/${r.maand}`;
  const regels = [`${r.artikelen} ${r.artikelen === 1 ? 'artikel' : 'artikelen'} geschreven`, `${r.voorstellen} ${r.voorstellen === 1 ? 'voorstel' : 'voorstellen'} gedaan, ${r.gepubliceerd} op je site gezet, ${r.afgewezen} afgewezen`];
  if (r.opfrissingen) regels.push(`${r.opfrissingen} ${r.opfrissingen === 1 ? 'pagina' : 'pagina\'s'} opgefrist`);
  for (const s of r.sites) {
    const delen = [];
    if (s.posities.gemeten) delen.push(`${s.posities.top10Eind} van ${s.posities.gevolgd} zoekwoorden in de top 10${s.posities.top10Begin !== s.posities.top10Eind ? ` (was ${s.posities.top10Begin})` : ''}`);
    if (s.searchConsole) delen.push(`${s.searchConsole.klikken} klikken uit Google${s.searchConsole.klikkenVorige != null ? ` (vorige periode ${s.searchConsole.klikkenVorige})` : ''}`);
    if (delen.length) regels.push(`${s.domein}: ${delen.join(', ')}`);
  }
  const open = r.openNu ? `\n\nEr ${r.openNu === 1 ? 'wacht nog 1 voorstel' : `wachten nog ${r.openNu} voorstellen`} op je akkoord.` : '';
  return {
    onderwerp: `Je maandrapport over ${r.naam}`,
    tekst: `Hoi,\n\nDit deed ${laadMerk().merk} in ${r.naam}:\n\n${regels.map((x) => `- ${x}`).join('\n')}${open}\n\nHet hele rapport: ${link}\n\n${groet()}\n`,
  };
}
