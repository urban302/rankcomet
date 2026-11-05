// Logger zonder persoonsgegevens: e-mailadressen, IP-adressen, tokens en sleutels worden gemaskeerd.
// Logregels gaan naar de database met een instelbare bewaartermijn (standaard 90 dagen).
import { randomUUID } from 'node:crypto';

const PATRONEN = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[e-mail]'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]'],
  [/\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b/gi, '[ip]'],
  [/\b(sk|pk|rk|whsec)_(test|live)?_?[A-Za-z0-9]+/g, '[sleutel]'],
  [/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/g, 'Bearer [token]'],
  [/\b(wachtwoord|password|token|secret|api[-_]?key)\s*[=:]\s*\S+/gi, '$1=[verborgen]'],
];

export function maskeer(tekst) {
  let t = String(tekst);
  for (const [re, vervang] of PATRONEN) t = t.replace(re, vervang);
  return t;
}

export function maakLogger(db, { stil = true } = {}) {
  return {
    async log(niveau, bericht) {
      const schoon = maskeer(bericht);
      if (!stil) process.stdout.write(`[${niveau}] ${schoon}\n`);
      await db.query('INSERT INTO logregels (id, tijd, niveau, bericht) VALUES ($1, $2, $3, $4)',
        [randomUUID(), new Date().toISOString(), niveau, schoon]);
    },
    async ruimOp(dagen, nu = new Date()) {
      const grens = new Date(nu.getTime() - dagen * 86400000).toISOString();
      const r = await db.query('DELETE FROM logregels WHERE tijd < $1', [grens]);
      return r.rowCount;
    },
  };
}
