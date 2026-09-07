<?php
/**
 * Plugin Name: Menzzu Marketplace
 * Description: Marketplace Menzzu com descoberta de lojas, busca e catalogo.
 * Version: 3.1.3
 * Author: Menzzu
 */

if (!defined('ABSPATH')) {
    exit;
}

define('MENZZU_MARKETPLACE_VERSION', '3.1.3');
define('MENZZU_MARKETPLACE_FILE', __FILE__);
define('MENZZU_MARKETPLACE_DIR', plugin_dir_path(__FILE__));
define('MENZZU_MARKETPLACE_URL', plugin_dir_url(__FILE__));

register_activation_hook(MENZZU_MARKETPLACE_FILE, function () {
    $legacyPlugin = 'digizap-home-2/digizap-home-2.php';
    $legacyPluginFile = WP_PLUGIN_DIR . '/' . $legacyPlugin;
    if (file_exists($legacyPluginFile)) {
        deactivate_plugins('digizap-home-2/digizap-home-2.php', true);
    }

    $activePlugins = (array) get_option('active_plugins', []);
    $activePlugins = array_values(array_diff($activePlugins, [$legacyPlugin]));
    update_option('active_plugins', $activePlugins);
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

add_action('admin_menu', function () {
    add_options_page(
        'Menzzu Marketplace',
        'Menzzu Marketplace',
        'manage_options',
        'menzzu-marketplace',
        'menzzu_marketplace_render_settings_page'
    );
});

add_action('admin_init', function () {
    register_setting('menzzu_marketplace', 'menzzu_maps_key', [
        'type' => 'string',
        'sanitize_callback' => static function ($value) {
            return sanitize_text_field((string) $value);
        },
        'default' => '',
    ]);
});

if (!function_exists('menzzu_marketplace_render_settings_page')) {
    function menzzu_marketplace_render_settings_page()
    {
        if (!current_user_can('manage_options')) {
            return;
        }
        ?>
        <div class="wrap">
            <h1>Menzzu Marketplace</h1>
            <p>Configure a integração usada para sugerir endereços no marketplace.</p>
            <form action="options.php" method="post">
                <?php
                settings_fields('menzzu_marketplace');
                do_settings_sections('menzzu_marketplace');
                ?>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row"><label for="menzzu_maps_key">Chave da API do Google Maps</label></th>
                        <td>
                            <input
                                type="password"
                                class="regular-text"
                                id="menzzu_maps_key"
                                name="menzzu_maps_key"
                                value="<?php echo esc_attr((string) get_option('menzzu_maps_key', '')); ?>"
                                autocomplete="off">
                            <p class="description">Ative Maps JavaScript API e Places API para esta chave e restrinja-a ao domínio do site.</p>
                        </td>
                    </tr>
                </table>
                <?php submit_button('Salvar configuração'); ?>
            </form>
        </div>
        <?php
    }
}

require_once MENZZU_MARKETPLACE_DIR . 'includes/helpers.php';
require_once MENZZU_MARKETPLACE_DIR . 'includes/blog.php';
require_once MENZZU_MARKETPLACE_DIR . 'includes/header.php';
require_once MENZZU_MARKETPLACE_DIR . 'includes/footer-nav.php';
require_once MENZZU_MARKETPLACE_DIR . 'includes/search-modal.php';
require_once MENZZU_MARKETPLACE_DIR . 'shortcodes/home.php';
require_once MENZZU_MARKETPLACE_DIR . 'shortcodes/restaurants.php';
require_once MENZZU_MARKETPLACE_DIR . 'shortcodes/blog.php';
