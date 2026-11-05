// Wachtwoord-hash met scrypt (N=2^15, r=8, p=1), zout per gebruiker, vergelijking in constante tijd.
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';

const N = 32768, R = 8, P = 1, LEN = 64, MAXMEM = 64 * 1024 * 1024;

function scryptAsync(ww, zout, n, r, p) {
  return new Promise((ok, fout) => scrypt(ww, zout, LEN, { N: n, r, p, maxmem: MAXMEM }, (e, k) => e ? fout(e) : ok(k)));
}

export function controleerSterkte(ww) {
  if (typeof ww !== 'string' || ww.length < 12) return 'Kies een wachtwoord van minstens 12 tekens.';
  if (ww.length > 256) return 'Het wachtwoord is te lang (maximaal 256 tekens).';
  return null;
}

export async function hashWachtwoord(ww) {
  const zout = randomBytes(16);
  const k = await scryptAsync(ww, zout, N, R, P);
  return `scrypt$${N}$${R}$${P}$${zout.toString('base64')}$${k.toString('base64')}`;
}

export async function controleerWachtwoord(ww, opgeslagen) {
  const d = String(opgeslagen).split('$');
  if (d.length !== 6 || d[0] !== 'scrypt') return false;
  const k = await scryptAsync(ww, Buffer.from(d[4], 'base64'), Number(d[1]), Number(d[2]), Number(d[3]));
  const verwacht = Buffer.from(d[5], 'base64');
  return verwacht.length === k.length && timingSafeEqual(verwacht, k);
}
