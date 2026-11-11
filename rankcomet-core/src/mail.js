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
