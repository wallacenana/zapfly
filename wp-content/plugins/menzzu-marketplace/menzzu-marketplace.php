<?php
/**
 * Plugin Name: Menzzu Marketplace
 * Description: Marketplace Menzzu com descoberta de lojas, busca e catalogo.
 * Version: 3.0.0
 * Author: Menzzu
 */

if (!defined('ABSPATH')) {
    exit;
}

define('MENZZU_MARKETPLACE_VERSION', '3.0.0');
define('MENZZU_MARKETPLACE_FILE', __FILE__);
define('MENZZU_MARKETPLACE_DIR', plugin_dir_path(__FILE__));
define('MENZZU_MARKETPLACE_URL', plugin_dir_url(__FILE__));

register_activation_hook(MENZZU_MARKETPLACE_FILE, function () {
    $legacyPlugin = WP_PLUGIN_DIR . '/digizap-home-2/digizap-home-2.php';
    if (file_exists($legacyPlugin)) {
        deactivate_plugins('digizap-home-2/digizap-home-2.php', true);
    }
});

// Aliases legados mantidos para instalações que ainda carregam integrações antigas.
function menzzu_marketplace_migrate_legacy_options()
{
    if (get_option('menzzu_marketplace_migrated_v3', false)) {
        return;
    }

    $legacyMapsKey = get_option('hotwhats_home2_maps_key', '');
    if (!get_option('menzzu_maps_key', '') && $legacyMapsKey !== '') {
        update_option('menzzu_maps_key', $legacyMapsKey, false);
    }

    update_option('menzzu_marketplace_migrated_v3', current_time('mysql'), false);
}

add_action('plugins_loaded', 'menzzu_marketplace_migrate_legacy_options', 5);

require_once MENZZU_MARKETPLACE_DIR . 'includes/helpers.php';
require_once MENZZU_MARKETPLACE_DIR . 'includes/blog.php';
require_once MENZZU_MARKETPLACE_DIR . 'includes/header.php';
require_once MENZZU_MARKETPLACE_DIR . 'includes/footer-nav.php';
require_once MENZZU_MARKETPLACE_DIR . 'includes/search-modal.php';
require_once MENZZU_MARKETPLACE_DIR . 'shortcodes/home.php';
require_once MENZZU_MARKETPLACE_DIR . 'shortcodes/restaurants.php';
require_once MENZZU_MARKETPLACE_DIR . 'shortcodes/blog.php';
