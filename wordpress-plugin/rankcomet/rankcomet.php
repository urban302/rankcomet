<?php
/**
 * Plugin Name: Rankcomet
 * Plugin URI: https://rankcomet.ai
 * Description: Koppelt je WordPress- of WooCommerce-site aan Rankcomet. Rankcomet zet teksten als concept klaar; publiceren gebeurt pas na jouw akkoord in de Rankcomet-app.
 * Version: 0.1.0
 * Requires at least: 6.0
 * Requires PHP: 8.0
 * Author: Rankcomet
 * License: MIT
 * Text Domain: rankcomet
 */

// Hoe het werkt:
// - Rankcomet praat met deze plugin via /wp-json/rankcomet/v1/, altijd ondertekend met de sleutel van deze site
//   (HMAC-SHA256 over methode, pad, tijd, nonce en de hash van de body). Zie includes/protocol.php.
// - De plugin schrijft alleen velden uit de witte lijst: titels, teksten, SEO-meta en alt-teksten.
//   Prijs, voorraad, SKU en bestellingen staan niet in die lijst en zijn dus nooit schrijfbaar.
// - Elke wijziging heeft een id. Een id dat al is toegepast, wordt niet nog een keer toegepast.
// - Wat Rankcomet aanpast, komt standaard als concept. Publiceren doet de plugin alleen als de klant dat in
//   de Rankcomet-app heeft gekozen (modus 'publiceren').

if (!defined('ABSPATH')) { exit; }

require_once __DIR__ . '/includes/protocol.php';

const RANKCOMET_OPTIE = 'rankcomet_instellingen';

function rankcomet_instellingen(): array {
    $o = get_option(RANKCOMET_OPTIE, []);
    return ['koppelcode' => $o['koppelcode'] ?? '', 'sleutel' => $o['sleutel'] ?? ''];
}

// --- Instellingenpagina ---

add_action('admin_menu', function () {
    add_options_page('Rankcomet', 'Rankcomet', 'manage_options', 'rankcomet', 'rankcomet_instellingen_pagina');
});

add_action('admin_init', function () {
    register_setting('rankcomet', RANKCOMET_OPTIE, ['sanitize_callback' => function ($invoer) {
        return [
            'koppelcode' => preg_match('/^rc-[0-9a-f]{32}$/', trim($invoer['koppelcode'] ?? '')) ? trim($invoer['koppelcode']) : '',
            'sleutel' => preg_replace('/[^A-Za-z0-9_-]/', '', $invoer['sleutel'] ?? ''),
        ];
    }]);
});

function rankcomet_instellingen_pagina(): void {
    if (!current_user_can('manage_options')) { return; }
    $o = rankcomet_instellingen();
    echo '<div class="wrap"><h1>Rankcomet</h1>';
    echo '<p>Vul hier de koppelcode en de sleutel in die je in de Rankcomet-app bij je site ziet. Rankcomet zet daarna teksten als concept klaar. Publiceren gebeurt pas na jouw akkoord in de Rankcomet-app.</p>';
    echo '<form method="post" action="options.php">';
    settings_fields('rankcomet');
    echo '<table class="form-table"><tr><th><label for="rc-koppelcode">Koppelcode</label></th><td><input id="rc-koppelcode" name="' . RANKCOMET_OPTIE . '[koppelcode]" value="' . esc_attr($o['koppelcode']) . '" class="regular-text" placeholder="rc-..."></td></tr>';
    echo '<tr><th><label for="rc-sleutel">Sleutel</label></th><td><input id="rc-sleutel" type="password" name="' . RANKCOMET_OPTIE . '[sleutel]" value="' . esc_attr($o['sleutel']) . '" class="regular-text" autocomplete="off"><p class="description">De sleutel zie je in de Rankcomet-app maar één keer. Kwijt? Maak daar een nieuwe.</p></td></tr></table>';
    submit_button('Opslaan');
    echo '</form></div>';
}

// --- Koppelcode in de head, zodat Rankcomet het eigendom van het domein kan controleren ---

add_action('wp_head', function () {
    $code = rankcomet_instellingen()['koppelcode'];
    if ($code !== '') { echo '<meta name="rankcomet-koppelcode" content="' . esc_attr($code) . '">' . "\n"; }
}, 1);

// --- REST-routes ---

add_action('rest_api_init', function () {
    $controle = 'rankcomet_rest_controle';
    register_rest_route('rankcomet/v1', '/status', ['methods' => 'GET', 'callback' => 'rankcomet_rest_status', 'permission_callback' => $controle]);
    register_rest_route('rankcomet/v1', '/doel/(?P<type>[a-z]+)/(?P<id>[0-9]+)', ['methods' => 'GET', 'callback' => 'rankcomet_rest_doel', 'permission_callback' => $controle]);
    register_rest_route('rankcomet/v1', '/wijzigingen', ['methods' => 'POST', 'callback' => 'rankcomet_rest_wijziging', 'permission_callback' => $controle]);
    register_rest_route('rankcomet/v1', '/paginas', ['methods' => 'GET', 'callback' => 'rankcomet_rest_paginas', 'permission_callback' => $controle]);
});

// Handtekening controleren. Nonces bewaren we 10 minuten; een tijd die meer dan 5 minuten afwijkt is ongeldig.
function rankcomet_rest_controle(WP_REST_Request $req) {
    $sleutel = rankcomet_instellingen()['sleutel'];
    $pad = '/wp-json' . $req->get_route();
    $uitslag = rankcomet_controleer_handtekening(
        $sleutel, $req->get_method(), $pad,
        $req->get_header('x-rankcomet-tijd'), $req->get_header('x-rankcomet-nonce'), $req->get_header('x-rankcomet-handtekening'),
        (string) $req->get_body(), time(),
        fn($nonce) => get_transient('rankcomet_nonce_' . $nonce) !== false,
        fn($nonce) => set_transient('rankcomet_nonce_' . $nonce, 1, 600)
    );
    if ($uitslag !== true) { return new WP_Error('rankcomet_handtekening', 'Handtekening ongeldig.', ['status' => 401]); }
    return true;
}

function rankcomet_rest_status(): array {
    return [
        'plugin' => '0.1.0', 'wordpress' => get_bloginfo('version'),
        'woocommerce' => class_exists('WooCommerce'),
        'seo' => rankcomet_seo_plugin(),
    ];
}

// Gepubliceerde pagina's, berichten en producten: voor interne links en de duplicaatcheck (hooguit 200).
function rankcomet_rest_paginas(): array {
    $types = ['post', 'page'];
    if (class_exists('WooCommerce')) { $types[] = 'product'; }
    $lijst = [];
    foreach (get_posts(['post_type' => $types, 'post_status' => 'publish', 'numberposts' => 200, 'orderby' => 'modified', 'order' => 'DESC']) as $p) {
        $lijst[] = ['id' => (string) $p->ID, 'type' => $p->post_type, 'titel' => $p->post_title, 'url' => get_permalink($p), 'gewijzigd' => get_post_modified_time('c', true, $p) ?: null];
    }
    return ['paginas' => $lijst];
}

function rankcomet_rest_doel(WP_REST_Request $req) {
    $type = $req['type']; $id = (int) $req['id'];
    if (!isset(RANKCOMET_VELDEN[$type])) { return new WP_Error('rankcomet_doel_type', 'Onbekend doeltype.', ['status' => 400]); }
    $velden = rankcomet_lees_doel($type, $id);
    if ($velden === null) { return new WP_Error('rankcomet_doel_onbekend', 'Onderdeel niet gevonden.', ['status' => 404]); }
    return ['velden' => $velden];
}

function rankcomet_rest_wijziging(WP_REST_Request $req) {
    $w = $req->get_json_params();
    $id = is_string($w['id'] ?? null) ? $w['id'] : '';
    if (!preg_match('/^[A-Za-z0-9-]{8,80}$/', $id)) { return new WP_Error('rankcomet_id', 'Ongeldig id.', ['status' => 400]); }
    // Idempotentie: al toegepast? Dan hetzelfde antwoord, zonder iets te doen.
    $eerder = get_option('rankcomet_toegepast_' . $id);
    if (is_array($eerder)) { return $eerder + ['al_eerder' => true]; }
    $controle = rankcomet_controleer_wijziging($w);
    if ($controle !== true) { return new WP_Error('rankcomet_' . $controle['fout'], $controle['bericht'], ['status' => 400] + $controle); }
    $doelId = rankcomet_schrijf_doel($w['doel_type'], $w['doel_id'] ?? null, $w['velden'], $w['modus'] ?? 'concept');
    if ($doelId instanceof WP_Error) { return $doelId; }
    $antwoord = ['toegepast' => true, 'doel_id' => (string) $doelId, 'al_eerder' => false];
    add_option('rankcomet_toegepast_' . $id, $antwoord, '', false);
    return $antwoord;
}

// --- Lezen en schrijven in WordPress en WooCommerce ---

function rankcomet_seo_plugin(): string {
    if (defined('WPSEO_VERSION')) { return 'yoast'; }
    if (class_exists('RankMath')) { return 'rankmath'; }
    return 'geen';
}

// Metavelden per SEO-plugin. Zonder SEO-plugin slaan we de meta over (Rankcomet meldt dat in het voorstel).
function rankcomet_meta_sleutels(): array {
    $seo = rankcomet_seo_plugin();
    if ($seo === 'yoast') { return ['meta_titel' => '_yoast_wpseo_title', 'meta_beschrijving' => '_yoast_wpseo_metadesc', 'focus_zoekwoord' => '_yoast_wpseo_focuskw', 'canonical' => '_yoast_wpseo_canonical']; }
    if ($seo === 'rankmath') { return ['meta_titel' => 'rank_math_title', 'meta_beschrijving' => 'rank_math_description', 'focus_zoekwoord' => 'rank_math_focus_keyword', 'canonical' => 'rank_math_canonical_url']; }
    return [];
}

function rankcomet_lees_doel(string $type, int $id): ?array {
    $meta = rankcomet_meta_sleutels();
    if ($type === 'productcategorie') {
        $term = get_term($id, 'product_cat');
        if (!$term || is_wp_error($term)) { return null; }
        $v = ['naam' => $term->name, 'beschrijving' => $term->description];
        foreach (['meta_titel', 'meta_beschrijving'] as $k) { if (isset($meta[$k])) { $v[$k] = (string) get_term_meta($id, $meta[$k], true); } }
        return $v;
    }
    $post = get_post($id);
    if (!$post || !in_array($post->post_type, rankcomet_post_types($type), true)) { return null; }
    if ($type === 'product') {
        $v = ['titel' => $post->post_title, 'beschrijving' => $post->post_content, 'korte_beschrijving' => $post->post_excerpt];
        $thumb = get_post_thumbnail_id($id);
        $v['afbeelding_alt'] = $thumb ? (string) get_post_meta($thumb, '_wp_attachment_image_alt', true) : '';
    } else {
        $v = ['titel' => $post->post_title, 'inhoud' => $post->post_content];
    }
    foreach ($meta as $k => $sleutel) { $v[$k] = (string) get_post_meta($id, $sleutel, true); }
    return $v;
}

function rankcomet_post_types(string $type): array {
    return ['post' => ['post'], 'pagina' => ['page'], 'product' => ['product']][$type] ?? [];
}

// Schrijft alleen de velden uit de witte lijst. Alles buiten die lijst (prijs, voorraad, SKU, bestellingen)
// komt hier niet eens aan: rankcomet_controleer_wijziging heeft het al geweigerd.
function rankcomet_schrijf_doel(string $type, $doelId, array $velden, string $modus) {
    $meta = rankcomet_meta_sleutels();
    if ($type === 'productcategorie') {
        if ($doelId === null) { return new WP_Error('rankcomet_nieuw', 'Een nieuwe productcategorie maakt Rankcomet niet aan.', ['status' => 400]); }
        $args = [];
        if (isset($velden['naam'])) { $args['name'] = $velden['naam']; }
        if (isset($velden['beschrijving'])) { $args['description'] = $velden['beschrijving']; }
        if ($args) { $r = wp_update_term((int) $doelId, 'product_cat', $args); if (is_wp_error($r)) { return $r; } }
        foreach (['meta_titel', 'meta_beschrijving'] as $k) { if (isset($velden[$k], $meta[$k])) { update_term_meta((int) $doelId, $meta[$k], $velden[$k]); } }
        return (int) $doelId;
    }
    $post = ['post_type' => rankcomet_post_types($type)[0]];
    if (isset($velden['titel'])) { $post['post_title'] = $velden['titel']; }
    if (isset($velden['inhoud'])) { $post['post_content'] = $velden['inhoud']; }
    if (isset($velden['beschrijving'])) { $post['post_content'] = $velden['beschrijving']; }
    if (isset($velden['korte_beschrijving'])) { $post['post_excerpt'] = $velden['korte_beschrijving']; }
    if ($doelId === null) {
        // Nieuw onderdeel: altijd als concept, tenzij de klant in de app koos voor publiceren.
        $post['post_status'] = $modus === 'publiceren' ? 'publish' : 'draft';
        $doelId = wp_insert_post($post, true);
        if (is_wp_error($doelId)) { return $doelId; }
    } else {
        $bestaand = get_post((int) $doelId);
        if (!$bestaand || $bestaand->post_type !== $post['post_type']) { return new WP_Error('rankcomet_doel_onbekend', 'Onderdeel niet gevonden.', ['status' => 404]); }
        $post['ID'] = (int) $doelId;
        // Bestaand onderdeel: concept = een revisie als concept bewaren is in WordPress niet los mogelijk,
        // dus bij modus concept zetten we het onderdeel zelf op concept; bij publiceren blijft de status.
        if ($modus !== 'publiceren') { $post['post_status'] = 'draft'; }
        $r = wp_update_post($post, true);
        if (is_wp_error($r)) { return $r; }
    }
    foreach ($meta as $k => $sleutel) { if (isset($velden[$k])) { update_post_meta((int) $doelId, $sleutel, $velden[$k]); } }
    if (isset($velden['afbeelding_alt'])) {
        $thumb = get_post_thumbnail_id((int) $doelId);
        if ($thumb) { update_post_meta($thumb, '_wp_attachment_image_alt', $velden['afbeelding_alt']); }
    }
    return (int) $doelId;
}
