<?php
// Tests voor includes/protocol.php, zonder WordPress. Draait via rankcomet-core/tests/plugin-php.test.js.
// Argumenten: [1] de handtekening die rankcomet-core/src/wordpress.js voor de vaste invoer hieronder berekent.
declare(strict_types=1);
require __DIR__ . '/../rankcomet/includes/protocol.php';

$fouten = 0;
function controleer(bool $ok, string $naam): void { global $fouten; if (!$ok) { $fouten++; fwrite(STDERR, "FOUT: $naam\n"); } else { echo "ok $naam\n"; } }

$sleutel = 'testsleutel-niet-geheim';
$pad = '/wp-json/rankcomet/v1/wijzigingen';
$tijd = '1700000000';
$nonce = str_repeat('ab', 16);
$body = '{"id":"w-1","doel_type":"post","velden":{"titel":"x"}}';

// 1. Dezelfde handtekening als de Node-kant (doorgegeven als argument).
$verwacht = $argv[1] ?? '';
controleer($verwacht !== '' && rankcomet_handtekening($sleutel, 'POST', $pad, $tijd, $nonce, $body) === $verwacht, 'handtekening gelijk aan rankcomet-core');

// 2. Controle: goed, verkeerde sleutel, aangepaste body, verlopen tijd, herhaalde nonce, lege sleutel.
$gezien = [];
$kijk = function ($n) use (&$gezien) { return isset($gezien[$n]); };
$onthoud = function ($n) use (&$gezien) { $gezien[$n] = true; };
$h = rankcomet_handtekening($sleutel, 'POST', $pad, $tijd, $nonce, $body);
$nu = (int) $tijd + 10;
controleer(rankcomet_controleer_handtekening($sleutel, 'POST', $pad, $tijd, $nonce, $h, $body, $nu, $kijk, $onthoud) === true, 'geldig verzoek');
controleer(rankcomet_controleer_handtekening($sleutel, 'POST', $pad, $tijd, $nonce, $h, $body, $nu, $kijk, $onthoud) === 'herhaald', 'zelfde nonce nog een keer: herhaald');
$nonce2 = str_repeat('cd', 16);
$h2 = rankcomet_handtekening($sleutel, 'POST', $pad, $tijd, $nonce2, $body);
controleer(rankcomet_controleer_handtekening('andere-sleutel', 'POST', $pad, $tijd, $nonce2, $h2, $body, $nu, $kijk, $onthoud) === 'handtekening', 'verkeerde sleutel');
controleer(rankcomet_controleer_handtekening($sleutel, 'POST', $pad, $tijd, $nonce2, $h2, $body . ' ', $nu, $kijk, $onthoud) === 'handtekening', 'aangepaste body');
controleer(rankcomet_controleer_handtekening($sleutel, 'POST', '/wp-json/rankcomet/v1/status', $tijd, $nonce2, $h2, $body, $nu, $kijk, $onthoud) === 'handtekening', 'ander pad');
controleer(rankcomet_controleer_handtekening($sleutel, 'POST', $pad, $tijd, $nonce2, $h2, $body, $nu + 301, $kijk, $onthoud) === 'tijd', 'verlopen tijd');
controleer(rankcomet_controleer_handtekening('', 'POST', $pad, $tijd, $nonce2, $h2, $body, $nu, $kijk, $onthoud) === 'geen_sleutel', 'plugin zonder sleutel weigert alles');
controleer(rankcomet_controleer_handtekening($sleutel, 'POST', $pad, null, null, null, $body, $nu, $kijk, $onthoud) === 'koppen', 'zonder koppen');
controleer(!isset($gezien[$nonce2]), 'een geweigerd verzoek verbruikt de nonce niet');

// 3. Witte lijst: prijs, voorraad, SKU en bestellingen bestaan niet als veld.
foreach (['prijs', 'price', 'regular_price', 'sale_price', 'voorraad', 'stock', 'stock_quantity', 'stock_status', 'sku', 'order', 'bestelling', 'post_status', 'post_author', 'ID'] as $veld) {
    $r = rankcomet_controleer_wijziging(['doel_type' => 'product', 'doel_id' => '3', 'velden' => ['titel' => 'x', $veld => '1']]);
    controleer(is_array($r) && $r['fout'] === 'veld_niet_toegestaan' && $r['veld'] === $veld, "veld geweigerd: $veld");
}
controleer(rankcomet_controleer_wijziging(['doel_type' => 'product', 'doel_id' => '3', 'modus' => 'publiceren', 'velden' => ['beschrijving' => 'x', 'afbeelding_alt' => 'y']]) === true, 'toegestane productvelden');
controleer(rankcomet_controleer_wijziging(['doel_type' => 'post', 'velden' => ['titel' => 'x', 'inhoud' => 'y']]) === true, 'nieuw bericht zonder doel_id');
controleer(rankcomet_controleer_wijziging(['doel_type' => 'gebruiker', 'velden' => ['naam' => 'x']])['fout'] === 'doel_type', 'onbekend doeltype');
controleer(rankcomet_controleer_wijziging(['doel_type' => 'post', 'doel_id' => '1 OR 1=1', 'velden' => ['titel' => 'x']])['fout'] === 'doel_id', 'ongeldig doel_id');
controleer(rankcomet_controleer_wijziging(['doel_type' => 'post', 'velden' => ['titel' => ['geen' => 'tekst']]])['fout'] === 'veld_tekst', 'waarde moet tekst zijn');
controleer(rankcomet_controleer_wijziging(['doel_type' => 'post', 'velden' => []])['fout'] === 'velden', 'lege velden');

// 4. Witte lijst gelijk aan rankcomet-core/src/velden.js (doorgegeven als JSON in argument 2).
$nodeVelden = json_decode($argv[2] ?? 'null', true);
controleer($nodeVelden === RANKCOMET_VELDEN, 'witte lijst gelijk aan rankcomet-core');

exit($fouten === 0 ? 0 : 1);
