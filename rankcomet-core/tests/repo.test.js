// Stap 0 (opschonen OpenSEO-fork): bewaakt de afspraken over de repo zelf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const kern = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.join(kern, '..');
const lees = (p) => readFileSync(p, 'utf8');

test('MIT-licentie van OpenSEO en de herkomstregel in de README blijven staan', () => {
  const licentie = lees(path.join(repo, 'LICENSE'));
  assert.match(licentie, /^MIT License/);
  assert.match(licentie, /Copyright \(c\) 2026 Ben Senescu/);
  assert.match(lees(path.join(repo, 'README.md')), /Gebaseerd op \[OpenSEO\]\(https:\/\/github\.com\/every-app\/open-seo\) \(MIT\)/);
});

test('package-lock.json staat in de repo en wijst alleen naar vendor/ (npm ci --offline werkt)', () => {
  const lock = JSON.parse(lees(path.join(kern, 'package-lock.json')));
  const pakketten = Object.entries(lock.packages).filter(([naam]) => naam !== '');
  assert.ok(pakketten.length > 0);
  for (const [naam, info] of pakketten) {
    assert.match(info.resolved, /^file:vendor\/[^/]+\.tgz$/, naam);
    assert.ok(existsSync(path.join(kern, info.resolved.slice('file:'.length))), naam);
  }
});

test('geen Cloudflare- of Every App-uitrolconfig in de repo', () => {
  for (const f of ['wrangler.jsonc', 'wrangler.audit.jsonc', 'wrangler.standalone.json', 'everyapp.config.ts', 'cloudflare.config.ts']) {
    assert.equal(existsSync(path.join(repo, f)), false, f);
  }
});
