// Stap 3: de WordPress-plugin (PHP). Controleert de syntaxis van de plugin en draait de protocoltests in PHP,
// met de handtekening en de witte lijst uit de Node-kant, zodat beide kanten gelijk blijven.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { handtekening } from '../src/wordpress.js';
import { VELDEN } from '../src/velden.js';

const plugin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'wordpress-plugin');
const php = spawnSync('php', ['-v']).status === 0;

test('plugin-PHP is geldige syntaxis', { skip: !php && 'php niet geïnstalleerd' }, () => {
  for (const f of ['rankcomet/rankcomet.php', 'rankcomet/includes/protocol.php']) execFileSync('php', ['-l', path.join(plugin, f)], { stdio: 'pipe' });
});

test('plugin en rankcomet-core berekenen dezelfde handtekening en gebruiken dezelfde witte lijst', { skip: !php && 'php niet geïnstalleerd' }, () => {
  const verwacht = handtekening('testsleutel-niet-geheim', 'POST', '/wp-json/rankcomet/v1/wijzigingen', '1700000000', 'ab'.repeat(16), '{"id":"w-1","doel_type":"post","velden":{"titel":"x"}}');
  const r = spawnSync('php', [path.join(plugin, 'tests', 'protocol.test.php'), verwacht, JSON.stringify(VELDEN)], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(r.stdout.split('\n').filter((l) => l.startsWith('ok ')).length >= 25, r.stdout);
});
