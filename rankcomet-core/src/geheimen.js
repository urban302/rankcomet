// Versleutelde opslag van geheimen (later CMS- en OAuth-tokens) met AES-256-GCM.
// Zelfde opzet als billr2 [A]: sleutel (32 bytes, base64) uit env RC_GEHEIMEN_SLEUTEL,
// 12-byte nonce per bericht, account-id als AAD zodat een geheim niet naar een ander account kan worden verplaatst.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function laadSleutel(env = process.env) {
  const b = env.RC_GEHEIMEN_SLEUTEL;
  if (!b) throw new Error('RC_GEHEIMEN_SLEUTEL ontbreekt');
  const k = Buffer.from(b, 'base64');
  if (k.length !== 32) throw new Error('RC_GEHEIMEN_SLEUTEL moet 32 bytes (base64) zijn');
  return k;
}

export function versleutel(sleutel, tekst, aad) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', sleutel, iv);
  c.setAAD(Buffer.from(String(aad)));
  const ct = Buffer.concat([c.update(String(tekst), 'utf8'), c.final()]);
  return `v1.${iv.toString('base64')}.${ct.toString('base64')}.${c.getAuthTag().toString('base64')}`;
}

export function ontsleutel(sleutel, blob, aad) {
  const [v, iv, ct, tag] = String(blob).split('.');
  if (v !== 'v1') throw new Error('Onbekende versie van geheim');
  const d = createDecipheriv('aes-256-gcm', sleutel, Buffer.from(iv, 'base64'));
  d.setAAD(Buffer.from(String(aad)));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}
