<?php

/**
 * Plugin Name: Menzzu Marketplace
 * Description: Marketplace Menzzu com descoberta de lojas, busca e catalogo.
 * Version: 3.1.73
 * Author: Menzzu
 */

if (!defined('ABSPATH')) {
    exit;
}

define('MENZZU_MARKETPLACE_VERSION', '3.1.73');
define('MENZZU_MARKETPLACE_FILE', __FILE__);
define('MENZZU_MARKETPLACE_DIR', plugin_dir_path(__FILE__));
define('MENZZU_MARKETPLACE_URL', plugin_dir_url(__FILE__));

function menzzu_marketplace_render_store_sitemap()
{
    $requestPath = (string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    if (untrailingslashit($requestPath) !== '/sitemap-lojas.xml') {
        return;
    }

    $cached = get_transient('menzzu_marketplace_store_sitemap_v3');
    if (is_string($cached) && $cached !== '') {
        status_header(200);
        header('Content-Type: application/xml; charset=UTF-8');
        header('Cache-Control: public, max-age=900, s-maxage=1800');
        echo $cached;
        exit;
    }

    $slugs = [];
    try {
        require_once MENZZU_MARKETPLACE_DIR . 'public-menu/config.php';
        $db = menzzu_marketplace_external_db_config();
        $pdo = new PDO(
            "mysql:host={$db['host']};dbname={$db['db']};charset=utf8mb4",
            $db['user'],
            $db['pass'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
        );
        $stmt = $pdo->query("SELECT u.slug FROM `user` u LEFT JOIN store_profile sp ON sp.userId = u.id WHERE COALESCE(sp.active, u.active) = 1 AND u.slug IS NOT NULL AND TRIM(u.slug) <> '' ORDER BY u.slug ASC");
        $slugs = $stmt->fetchAll(PDO::FETCH_COLUMN);
    } catch (Throwable $error) {
        $slugs = [];
    }

    $urls = [];
    foreach ($slugs as $slug) {
        $slug = sanitize_title((string) $slug);
        if ($slug === '') {
            continue;
        }
        $urls[] = '  <url><loc>' . esc_xml(home_url('/' . $slug . '/')) . '</loc></url>';
    }

    $xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
        . "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n"
        . implode("\n", $urls)
        . "\n</urlset>\n";

    set_transient('menzzu_marketplace_store_sitemap_v3', $xml, 15 * MINUTE_IN_SECONDS);
    status_header(200);
    header('Content-Type: application/xml; charset=UTF-8');
    header('Cache-Control: public, max-age=900, s-maxage=1800');
    echo $xml;
    exit;
}

add_action('template_redirect', 'menzzu_marketplace_render_store_sitemap', -1);

function menzzu_marketplace_render_public_menu_route()
{
    if (is_admin() || wp_doing_ajax() || (defined('REST_REQUEST') && REST_REQUEST) || !defined('ABSPATH')) {
        return;
    }

    $requestPath = trim((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH), '/');
    $segments = $requestPath === '' ? [] : explode('/', $requestPath);
    $legacyStoreSlug = sanitize_title((string) ($_GET['menzzu_store'] ?? ''));
    $host = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
    $platformHosts = ['menzzu.com', 'www.menzzu.com', 'cardapio.menzzu.com', 'origin.menzzu.com'];
    $isCustomDomain = $host !== '' && !in_array(preg_replace('/:\d+$/', '', $host), $platformHosts, true);
    $isCardapioPath = count($segments) === 2 && $segments[0] === 'cardapio' && $segments[1] !== '';
    $isLegacyStorePath = ($legacyStoreSlug !== '') || (is_404() && count($segments) === 1 && $segments[0] !== '');
    $isCustomDomainHome = $isCustomDomain && count($segments) === 0;

    if (!$isCardapioPath && !$isLegacyStorePath && !$isCustomDomainHome) {
        return;
    }

    $originalRequestUri = $_SERVER['REQUEST_URI'] ?? '/';
    if ($isLegacyStorePath) {
        $slug = $legacyStoreSlug !== '' ? $legacyStoreSlug : sanitize_title($segments[0]);
        $_SERVER['REQUEST_URI'] = '/cardapio/' . rawurlencode($slug) . '/';
    }

    require MENZZU_MARKETPLACE_DIR . 'public-menu/index.php';
    $_SERVER['REQUEST_URI'] = $originalRequestUri;
    exit;
}

add_action('template_redirect', 'menzzu_marketplace_render_public_menu_route', 0);

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
require_once MENZZU_MARKETPLACE_DIR . 'includes/address-modal.php';
require_once MENZZU_MARKETPLACE_DIR . 'includes/updater.php';
require_once MENZZU_MARKETPLACE_DIR . 'shortcodes/home.php';
require_once MENZZU_MARKETPLACE_DIR . 'shortcodes/restaurants.php';
require_once MENZZU_MARKETPLACE_DIR . 'shortcodes/blog.php';
