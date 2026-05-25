<?php

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('dzhome2_render_home_shortcode')) {
    function dzhome2_render_home_shortcode($atts = [])
    {
        $atts = shortcode_atts([
            'title' => 'Tudo pra facilitar seu dia a dia',
            'description' => 'Digite seu endereço para começar.',
            'limit' => 18,
            'key' => 'home2',
            'maps_key' => ''
        ], $atts, 'digizap_home_2');

        dzhome2_enqueue_assets();

        $limit = min(max(absint($atts['limit']), 1), 48);
        $mapsKey = dzhome2_maps_key($atts['maps_key']);
        $savedAddress = function_exists('dzhome2_read_address_cookie') ? dzhome2_read_address_cookie() : [];
        $initialLocation = trim((string) ($savedAddress['address'] ?? ''));
        $initialLocationLat = isset($savedAddress['lat']) ? (float) $savedAddress['lat'] : null;
        $initialLocationLng = isset($savedAddress['lng']) ? (float) $savedAddress['lng'] : null;
        $hasSelectedAddress = $initialLocation !== '' && (
            !empty($savedAddress['placeId']) || !empty($savedAddress['lat']) || !empty($savedAddress['lng'])
        );
        $initialAddressLabel = '';
        if ($hasSelectedAddress && function_exists('dzhome2_short_address')) {
            $initialAddressLabel = (string) (dzhome2_short_address($initialLocation)[0] ?? '');
        }
        $initialData = [
            'total' => 0,
            'categories' => [],
            'featuredStores' => [],
            'restaurants' => []
        ];

        if ($hasSelectedAddress) {
            $initialData = dzhome2_fetch_directory_data('', '', $initialLocation, $limit, $initialLocationLat, $initialLocationLng);
        }

        ob_start();
?>
        <div
            class="dz-home2"
            data-dz-home2-root
            data-mode="<?php echo esc_attr($hasSelectedAddress ? 'app' : 'landing'); ?>"
            data-api-base="<?php echo esc_attr(dzhome2_api_base()); ?>"
            data-home-url="<?php echo esc_attr(home_url('/')); ?>"
            data-login-url="<?php echo esc_attr(wp_login_url(home_url('/'))); ?>"
            data-register-url="<?php echo esc_attr(wp_registration_url()); ?>"
            data-blog-url="<?php echo esc_attr(dzhome2_blog_url()); ?>"
            data-storage-key="dz_home2_address"
            data-limit="<?php echo esc_attr($limit); ?>"
            data-maps-key="<?php echo esc_attr($mapsKey); ?>">
            <header class="dz-home2-header">
                <div class="dz-left">
                    <div class="dz-home2-brand">
                        <a class="dz-home2-brand-link" href="<?php echo esc_url(home_url('/')); ?>">
                            <?php if (has_custom_logo()) : ?>
                                <?php
                                $logo_id = (int) get_theme_mod('custom_logo');
                                echo $logo_id
                                    ? wp_get_attachment_image($logo_id, 'full', false, ['class' => 'dz-home2-brand-logo', 'alt' => get_bloginfo('name') ?: 'DigiZap'])
                                    : '';
                                ?>
                            <?php else : ?>
                                <img decoding="async" width="300" height="78" src="https://digizap.com.br/wp-content/uploads/2026/05/DigiZap-Logo-300x78.png" class="attachment-medium size-medium" style="width: 160px; margin-top: 7px" alt="" srcset="https://digizap.com.br/wp-content/uploads/2026/05/DigiZap-Logo-300x78.png 300w, https://digizap.com.br/wp-content/uploads/2026/05/DigiZap-Logo.png 572w" sizes="(max-width: 300px) 100vw, 300px">
                                <span class="dz-home2-brand-name" style="display: none"><?php echo esc_html(get_bloginfo('name') ?: 'DigiZap'); ?></span>
                            <?php endif; ?>
                        </a>
                    </div>

                    <nav class="dz-home2-nav" aria-label="Menu principal">
                        <a href="/" class="is-active" aria-current="page">Home</a>
                        <a href="/restaurantes">Restaurantes</a>
                        <a href="<?php echo esc_url(dzhome2_blog_url()); ?>">Ajuda</a>
                    </nav>
                </div>
                <div class="dz-center">
                    <div class="dz-home2-header-actions dz-home2-header-actions-app" data-app-actions <?php echo $hasSelectedAddress ? '' : 'hidden'; ?>>
                        <div class="dz-home2-search">
                            <span class="dz-home2-search-icon" aria-hidden="true">
                                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="11" cy="11" r="7"></circle>
                                    <path d="M20 20l-3.5-3.5"></path>
                                </svg>
                            </span>
                            <input type="search" data-search-input placeholder="Buscar loja ou item" autocomplete="off">
                        </div>
                    </div>
                </div>
                <div class="dz-right">
                    <button type="button" class="dz-home2-location-pill" data-edit-address>
                        <span class="dz-home2-location-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12 21s6-4.35 6-11a6 6 0 1 0-12 0c0 6.65 6 11 6 11Z"></path>
                                <circle cx="12" cy="10" r="2.2"></circle>
                            </svg>
                        </span>
                        <strong data-address-line1><?php echo esc_html($hasSelectedAddress ? ($initialAddressLabel ?: 'Digite seu endereço') : 'Digite seu endereço'); ?></strong>
                        <span class="dz-home2-location-arrow" aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M6 9l6 6 6-6"></path>
                            </svg>
                        </span>
                    </button>

                    <div class="dz-home2-header-actions dz-home2-header-actions-guest" data-guest-actions>
                        <a class="dz-home2-button dz-home2-button-ghost" href="<?php echo esc_url(wp_login_url(home_url('/'))); ?>">Entrar</a>
                        <a class="dz-home2-button dz-home2-button-primary" href="<?php echo esc_url(wp_registration_url()); ?>">Criar conta</a>
                    </div>
                </div>




            </header>

            <main class="dz-home2-main">
                <section class="dz-home2-landing" id="inicio" data-landing <?php echo $hasSelectedAddress ? 'hidden' : ''; ?>>
                    <div class="dz-home2-landing-grid">
                        <div class="dz-home2-landing-copy">
                            <span class="dz-home2-landing-badge">
                                <span aria-hidden="true">⚡</span>
                                <span>Cardápio digital inteligente</span>
                            </span>
                            <h1><?php echo esc_html($atts['title']); ?></h1>
                            <p><?php echo esc_html($atts['description']); ?></p>

                            <form class="dz-home2-address-form" data-address-form>
                                <input
                                    type="text"
                                    data-address-input
                                    placeholder="<?php echo esc_attr('Digite seu endereço completo'); ?>"
                                    autocomplete="off"
                                    spellcheck="false"
                                    inputmode="text">
                                <button type="submit" class="dz-home2-button dz-home2-button-primary" data-address-continue disabled>
                                    Continuar
                                </button>
                            </form>
                        </div>

                        <div class="dz-home2-landing-visual" aria-hidden="true">
                            <span class="dz-home2-visual-card dz-home2-visual-card-a"></span>
                            <span class="dz-home2-visual-card dz-home2-visual-card-b"></span>
                            <span class="dz-home2-visual-card dz-home2-visual-card-c"></span>
                            <span class="dz-home2-visual-badge"></span>
                            <span class="dz-home2-visual-ring"></span>
                        </div>
                    </div>
                </section>

                <section class="dz-home2-catalog" id="restaurantes" data-catalog <?php echo $hasSelectedAddress ? '' : 'hidden'; ?>>
                    <div class="dz-home2-catalog-head">
                        <div>
                            <h2>Restaurantes</h2>
                            <p data-catalog-summary><?php echo esc_html(($initialData['total'] ?? 0) > 0 ? ((int) ($initialData['total'] ?? 0) === 1 ? '1 restaurante encontrado' : sprintf('%d restaurantes encontrados', (int) ($initialData['total'] ?? 0))) : ($hasSelectedAddress ? 'Nenhum restaurante encontrado.' : 'Digite o endereço para ver os restaurantes.')); ?></p>
                        </div>
                    </div>

                    <div class="dz-home2-categories" data-categories>
                        <div class="dz-home2-categories-track" data-categories-track>
                            <?php foreach (($initialData['categories'] ?? []) as $category) :
                                $categoryName = (string) ($category['name'] ?? 'Categoria');
                                $categoryCount = absint($category['count'] ?? 0);
                                $categoryLogo = !empty($category['logoUrl']) ? (string) $category['logoUrl'] : '';
                                if ($categoryLogo === '' && function_exists('dzhome2_placeholder_logo')) {
                                    $categoryLogo = dzhome2_placeholder_logo($categoryName, $category['accentColor'] ?? '#2dbd30');
                                }
                                ?>
                                <a class="dz-home2-category-card" href="#restaurantes" data-category="<?php echo esc_attr($categoryName); ?>">
                                    <span class="dz-home2-category-thumb">
                                        <img src="<?php echo esc_url($categoryLogo); ?>" alt="<?php echo esc_attr($categoryName); ?>" loading="lazy" decoding="async">
                                    </span>
                                    <span class="dz-home2-category-label">
                                        <strong><?php echo esc_html($categoryName); ?></strong>
                                        <small><?php echo esc_html($categoryCount . ' restaurante' . ($categoryCount === 1 ? '' : 's')); ?></small>
                                    </span>
                                </a>
                            <?php endforeach; ?>
                        </div>
                    </div>

                    <div class="dz-home2-featured-track" data-featured-track>
                        <?php echo $hasSelectedAddress ? dzhome2_render_featured_cards($initialData['featuredStores'] ?? []) : ''; ?>
                    </div>

                    <div class="dz-home2-restaurants-grid" data-restaurants-grid>
                        <?php echo $hasSelectedAddress ? dzhome2_render_restaurant_cards($initialData['restaurants'] ?? []) : ''; ?>
                    </div>

                    <div class="dz-home2-empty-results" data-empty-results hidden>
                        Nenhum restaurante encontrado.
                    </div>
                </section>
            </main>
        </div>
<?php
        return trim(ob_get_clean());
    }
}

add_shortcode('digizap_home_2', 'dzhome2_render_home_shortcode');
