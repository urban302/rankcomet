// Pakketlimieten afdwingen op basis van config/pakketten.json.
import { laadPakketten } from './config.js';
import { Fout } from './accounts.js';

export function pakketVoor(id) {
  const p = laadPakketten().pakketten[id];
  if (!p) throw new Fout('Onbekend pakket.');
  return { id, ...p };
}

export function upgradeOptie(id) {
  const cfg = laadPakketten();
  const i = cfg.volgorde.indexOf(id);
  const volgende = cfg.volgorde[i + 1];
  return volgende ? { id: volgende, ...cfg.pakketten[volgende] } : null;
}

export function eerstePakketMet(voorwaarde) {
  const cfg = laadPakketten();
  const id = cfg.volgorde.find((i) => voorwaarde(cfg.pakketten[i]));
  return id ? { id, ...cfg.pakketten[id] } : null;
}

export function magArtikelMaken(pakketId, artikelenDezeMaand) {
  return artikelenDezeMaand < pakketVoor(pakketId).artikelen_per_maand;
}

export function magZoekwoordVolgen(pakketId, aantalGevolgd) {
  return aantalGevolgd < pakketVoor(pakketId).zoekwoorden_volgen;
}

export function prijsTekst(cent) { return `€${(cent / 100).toFixed(0)} per maand excl. btw`; }
