<?php
/**
 * Plugin Name: Menzzu Marketplace
 * Description: Marketplace Menzzu com descoberta de lojas, busca e catalogo.
 * Version: 2.0.0
 * Author: Menzzu
 */

if (!defined('ABSPATH')) {
    exit;
}

define('MENZZU_HOME_VERSION', '2.0.0');
define('MENZZU_HOME_FILE', __FILE__);
define('MENZZU_HOME_DIR', plugin_dir_path(__FILE__));
define('MENZZU_HOME_URL', plugin_dir_url(__FILE__));

// Aliases legados mantidos para instalações que ainda carregam integrações antigas.
define('DIGIZAP_HOME2_VERSION', MENZZU_HOME_VERSION);
define('DIGIZAP_HOME2_FILE', __FILE__);
define('DIGIZAP_HOME2_DIR', plugin_dir_path(__FILE__));
define('DIGIZAP_HOME2_URL', plugin_dir_url(__FILE__));

function menzzu_home_migrate_legacy_options()
{
    if (get_option('menzzu_home_migrated_v2', false)) {
        return;
    }

    $legacyMapsKey = get_option('hotwhats_home2_maps_key', '');
    if (!get_option('menzzu_maps_key', '') && $legacyMapsKey !== '') {
        update_option('menzzu_maps_key', $legacyMapsKey, false);
    }

    update_option('menzzu_home_migrated_v2', current_time('mysql'), false);
}

add_action('plugins_loaded', 'menzzu_home_migrate_legacy_options', 5);

require_once DIGIZAP_HOME2_DIR . 'includes/helpers.php';
require_once DIGIZAP_HOME2_DIR . 'includes/blog.php';
require_once DIGIZAP_HOME2_DIR . 'includes/header.php';
require_once DIGIZAP_HOME2_DIR . 'includes/footer-nav.php';
require_once DIGIZAP_HOME2_DIR . 'includes/search-modal.php';
require_once DIGIZAP_HOME2_DIR . 'shortcodes/home.php';
require_once DIGIZAP_HOME2_DIR . 'shortcodes/restaurants.php';
require_once DIGIZAP_HOME2_DIR . 'shortcodes/blog.php';
