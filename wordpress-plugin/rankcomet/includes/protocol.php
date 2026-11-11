<?php
// Het protocol tussen Rankcomet en de plugin, zonder WordPress-afhankelijkheden, zodat het los te testen is.
// Houd dit gelijk aan rankcomet-core/src/wordpress.js (handtekening) en rankcomet-core/src/velden.js (witte lijst).

if (!defined('RANKCOMET_VELDEN')) {
    define('RANKCOMET_VELDEN', [
        'post' => ['titel', 'inhoud', 'meta_titel', 'meta_beschrijving', 'focus_zoekwoord', 'canonical'],
        'pagina' => ['titel', 'inhoud', 'meta_titel', 'meta_beschrijving', 'focus_zoekwoord', 'canonical'],
        'product' => ['titel', 'beschrijving', 'korte_beschrijving', 'afbeelding_alt', 'meta_titel', 'meta_beschrijving', 'focus_zoekwoord', 'canonical'],
        'productcategorie' => ['naam', 'beschrijving', 'meta_titel', 'meta_beschrijving'],
    ]);
}

const RANKCOMET_TIJD_SPELING = 300; // seconden

function rankcomet_handtekening(string $sleutel, string $methode, string $pad, string $tijd, string $nonce, string $body): string {
    $tekst = implode("\n", [strtoupper($methode), $pad, $tijd, $nonce, hash('sha256', $body)]);
    return hash_hmac('sha256', $tekst, $sleutel);
}

/**
 * Controleert een ondertekend verzoek. Geeft true, of een korte reden (string) waarom niet.
 * $nonceGezien(nonce): bool en $nonceOnthoud(nonce): void komen van de aanroeper (WordPress: transients).
 */
function rankcomet_controleer_handtekening(string $sleutel, string $methode, string $pad, $tijd, $nonce, $handtekening, string $body, int $nu, callable $nonceGezien, callable $nonceOnthoud) {
    if ($sleutel === '') { return 'geen_sleutel'; }
    if (!is_string($tijd) || !ctype_digit($tijd) || !is_string($nonce) || !preg_match('/^[0-9a-f]{32}$/', $nonce) || !is_string($handtekening)) { return 'koppen'; }
    if (abs($nu - (int) $tijd) > RANKCOMET_TIJD_SPELING) { return 'tijd'; }
    if (!hash_equals(rankcomet_handtekening($sleutel, $methode, $pad, $tijd, $nonce, $body), strtolower($handtekening))) { return 'handtekening'; }
    if ($nonceGezien($nonce)) { return 'herhaald'; }
    $nonceOnthoud($nonce);
    return true;
}

/**
 * Controleert een wijziging uit de body: doeltype bekend, velden alleen uit de witte lijst, waarden tekst.
 * Geeft true of ['fout' => ..., 'bericht' => ..., 'veld' => ...].
 */
function rankcomet_controleer_wijziging($w) {
    if (!is_array($w)) { return ['fout' => 'body', 'bericht' => 'Geen geldige wijziging.']; }
    $type = $w['doel_type'] ?? null;
    if (!is_string($type) || !isset(RANKCOMET_VELDEN[$type])) { return ['fout' => 'doel_type', 'bericht' => 'Onbekend doeltype.']; }
    if (isset($w['doel_id']) && !preg_match('/^[0-9]{1,12}$/', (string) $w['doel_id'])) { return ['fout' => 'doel_id', 'bericht' => 'Ongeldig doel.']; }
    if (!in_array($w['modus'] ?? 'concept', ['concept', 'publiceren'], true)) { return ['fout' => 'modus', 'bericht' => 'Onbekende modus.']; }
    $velden = $w['velden'] ?? null;
    if (!is_array($velden) || !$velden) { return ['fout' => 'velden', 'bericht' => 'Geen velden.']; }
    foreach ($velden as $veld => $waarde) {
        if (!is_string($veld) || !in_array($veld, RANKCOMET_VELDEN[$type], true)) { return ['fout' => 'veld_niet_toegestaan', 'bericht' => 'Dit veld mag Rankcomet niet aanpassen.', 'veld' => (string) $veld]; }
        if (!is_string($waarde)) { return ['fout' => 'veld_tekst', 'bericht' => 'Een veld moet tekst zijn.', 'veld' => $veld]; }
    }
    return true;
}
