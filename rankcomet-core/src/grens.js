// Rate limiting op inloggen, aanmelden en wachtwoord vergeten (R3).
// Per soort een maximum aantal pogingen binnen een tijdvenster, per sleutel (IP-adres of e-mailadres).
// [A31] Bijgehouden in het geheugen van het app-proces: er draait één proces. Bij een herstart begint
// de telling opnieuw. Draaien er ooit meer processen, dan moet dit naar de database.
// Sleutels (IP, e-mail) komen nooit in een log.

const KWARTIER = 15 * 60000, UUR = 3600000;

// [A32] Standaardgrenzen.
export const STANDAARD_GRENZEN = {
  login_ip: { max: 30, ms: KWARTIER },       // mislukte inlogpogingen per IP
  login_email: { max: 10, ms: KWARTIER },    // mislukte inlogpogingen per e-mailadres
  registreren_ip: { max: 10, ms: UUR },
  registreren_email: { max: 5, ms: UUR },
  herstel_ip: { max: 10, ms: UUR },          // wachtwoord vergeten
  herstel_email: { max: 3, ms: UUR },
  opnieuw_account: { max: 3, ms: UUR },      // bevestigingsmail opnieuw sturen
  koppelcontrole_site: { max: 10, ms: UUR }, // koppelcode controleren op een klantsite (haalt die site op)
};

export function maakBegrenzer(grenzen = STANDAARD_GRENZEN, klok = Date.now) {
  const pogingen = new Map(); // `${soort}\n${sleutel}` -> tijden

  function recent(soort, sleutel) {
    const k = `${soort}\n${sleutel}`, grens = klok() - grenzen[soort].ms;
    const lijst = (pogingen.get(k) || []).filter((t) => t > grens);
    if (lijst.length) pogingen.set(k, lijst); else pogingen.delete(k);
    return lijst;
  }

  return {
    // Seconden tot er weer een poging mag (0 = mag nu). Kijkt naar alle opgegeven [soort, sleutel]-paren.
    wachttijd(paren) {
      let s = 0;
      for (const [soort, sleutel] of paren) {
        const lijst = recent(soort, sleutel);
        if (lijst.length >= grenzen[soort].max) s = Math.max(s, Math.ceil((lijst[0] + grenzen[soort].ms - klok()) / 1000));
      }
      return s;
    },
    tel(paren) {
      for (const [soort, sleutel] of paren) {
        const lijst = recent(soort, sleutel); lijst.push(klok()); pogingen.set(`${soort}\n${sleutel}`, lijst);
      }
      if (pogingen.size > 50000) for (const k of pogingen.keys()) { const [soort, ...r] = k.split('\n'); recent(soort, r.join('\n')); }
    },
  };
}
