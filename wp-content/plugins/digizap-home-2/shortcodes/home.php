<?php

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('dzhome2_render_home_shortcode')) {
    function dzhome2_render_home_shortcode($atts = [])
    {
        $atts = shortcode_atts([
            'title' => 'Tudo pra facilitar seu dia a dia',
            'description' => 'Digite seu endereÃ§o para comeÃ§ar.',
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
        $hasSelectedAddress = $initialLocation !== '';
        $initialAddressLabel = '';
        if ($hasSelectedAddress && function_exists('dzhome2_short_address')) {
            $initialAddressLabel = (string) (dzhome2_short_address($initialLocation)[0] ?? '');
        }
        $initialData = [
            'total' => 0,
            'categories' => [],
            'stores' => [],
            'featuredStores' => [],
            'freeDeliveryStores' => [],
            'promoStores' => [],
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
            data-restaurants-url="<?php echo esc_attr(dzhome2_restaurants_url()); ?>"
            data-login-url="<?php echo esc_attr(dzhome2_login_url()); ?>"
            data-register-url="<?php echo esc_attr(home_url('/comprar/')); ?>"
            data-blog-url="<?php echo esc_attr(dzhome2_blog_url()); ?>"
            data-storage-key="dz_home2_address"
            data-limit="<?php echo esc_attr($limit); ?>"
            data-maps-key="<?php echo esc_attr($mapsKey); ?>">
            <?php echo dzhome2_render_directory_header([
                'active' => 'home',
                'homeUrl' => home_url('/'),
                'restaurantsUrl' => dzhome2_restaurants_url(),
                'blogUrl' => dzhome2_blog_url(),
                'loginUrl' => dzhome2_login_url(),
                'registerUrl' => home_url('/comprar/'),
                'hasSelectedAddress' => $hasSelectedAddress,
                'initialAddressLabel' => $initialAddressLabel,
            ]); ?>

            <main class="dz-home2-main">
                <?php echo dzhome2_render_directory_skeleton('home'); ?>

                <section class="dz-home2-landing" id="inicio" data-landing <?php echo $hasSelectedAddress ? 'hidden' : ''; ?>>
                    <div class="dz-home2-landing-grid">
                        <div class="dz-home2-landing-copy">
                            <span class="dz-home2-landing-badge">
                                <span aria-hidden="true">âš¡</span>
                                <span>CardÃ¡pio digital inteligente</span>
                            </span>
                            <h1><?php echo esc_html($atts['title']); ?></h1>
                            <p><?php echo esc_html($atts['description']); ?></p>

                            <form class="dz-home2-address-form" data-address-form>
                                <input
                                    type="text"
                                    data-address-input
                                    placeholder="<?php echo esc_attr('Digite seu endereÃ§o completo'); ?>"
                                    autocomplete="off"
                                    spellcheck="false"
                                    inputmode="text">
                                <button type="submit" class="dz-home2-button dz-home2-button-primary" data-address-continue disabled>
                                    Continuar
                                </button>
                            </form>
                        </div>

                        <div class="dz-home2-landing-visual" aria-hidden="true">
                            <span class="dz-home2-visual-badge"></span>
                            <span class="dz-home2-visual-ring"></span>
                            <div class="dz-home2-landing-art">
                                <img
                                    class="dz-home2-landing-art-img"
                                    src="<?php echo esc_url(dzhome2_hero_artwork_url()); ?>"
                                    alt=""
                                    loading="eager"
                                    fetchpriority="high"
                                    decoding="async">
                            </div>
                        </div>
                    </div>
                </section>

                <section class="dz-home2-catalog" id="restaurantes" data-catalog <?php echo $hasSelectedAddress ? '' : 'hidden'; ?>>
                    <div class="dz-home2-categories" data-categories>
                        <div class="dz-home2-categories-track" data-categories-track>
                            <?php foreach (($initialData['categories'] ?? []) as $category) :
                                $categoryName = (string) ($category['name'] ?? 'Categoria');
                                $categoryCount = absint($category['count'] ?? 0);
                                $categorySlug = function_exists('dzhome2_category_slug') ? dzhome2_category_slug($categoryName) : '';
                                $categoryLogo = function_exists('dzhome2_category_image_url') ? dzhome2_category_image_url($categoryName) : '';
                                if ($categoryLogo === '' && function_exists('dzhome2_placeholder_logo')) {
                                    $categoryLogo = dzhome2_placeholder_logo($categoryName, $category['accentColor'] ?? '#2dbd30');
                                }
                            ?>
                                <a class="dz-home2-category-card" href="<?php echo esc_url(dzhome2_restaurants_url($categorySlug)); ?>" data-category="<?php echo esc_attr($categorySlug); ?>">
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

                    <div class="dz-home2-directory-toolbar" data-directory-controls>
                        <div class="dz-home2-directory-filters" role="tablist" aria-label="Filtros do diretÃ³rio">
                            <button class="dz-home2-directory-filter is-active" type="button" data-filter-pill="all">Todos</button>
                            <button class="dz-home2-directory-filter" type="button" data-filter-pill="featured">Destaques</button>
                            <button class="dz-home2-directory-filter" type="button" data-filter-pill="freeDelivery">Frete grÃ¡tis</button>
                            <button class="dz-home2-directory-filter" type="button" data-filter-pill="promo">Em promoÃ§Ã£o</button>
                            <button class="dz-home2-directory-filter" type="button" data-filter-pill="open">Aberto agora</button>
                        </div>
                        <label class="dz-home2-directory-sort">
                            <span>Ordenar</span>
                            <select data-sort-select>
                                <option value="recommended">RelevÃ¢ncia</option>
                                <option value="orders">Mais pedidos</option>
                                <option value="rating">Melhor avaliados</option>
                                <option value="az">A-Z</option>
                            </select>
                        </label>
                    </div>

                    <?php echo dzhome2_render_store_rail_section('Destaques', $initialData['featuredStores'] ?? [], dzhome2_restaurants_url(), 'featured', empty($initialData['featuredStores'])); ?>
                    <?php echo dzhome2_render_store_rail_section('Frete grÃ¡tis', $initialData['freeDeliveryStores'] ?? [], dzhome2_restaurants_url(), 'freeDelivery', empty($initialData['freeDeliveryStores'])); ?>
                    <?php echo dzhome2_render_store_rail_section('Em promoÃ§Ã£o', $initialData['promoStores'] ?? [], dzhome2_restaurants_url(), 'promo', empty($initialData['promoStores'])); ?>

                    <div class="dz-home2-catalog-head">
                        <div>
                            <h2>Restaurantes perto de vocÃª</h2>
                        </div>
                        <a class="dz-home2-catalog-action" href="<?php echo esc_url(dzhome2_restaurants_url()); ?>">Ver mais</a>
                    </div>

                    <div class="dz-home2-restaurants-grid" data-restaurants-grid>
                        <?php echo $hasSelectedAddress ? dzhome2_render_restaurant_cards($initialData['restaurants'] ?? []) : ''; ?>
                    </div>

                    <!-- <div class="dz-home2-featured-track" data-featured-track>
                        <?php //echo $hasSelectedAddress ? dzhome2_render_featured_cards($initialData['featuredStores'] ?? []) : ''; ?>
                    </div> -->

                    <div class="dz-home2-empty-results" data-empty-results hidden>
                        Nenhum restaurante encontrado.
                    </div>
                </section>
            </main>

            <?php echo dzhome2_render_search_modal(); ?>

            <?php echo dzhome2_render_directory_footer_nav([
                'active' => 'home',
                'homeUrl' => home_url('/'),
                'restaurantsUrl' => dzhome2_restaurants_url(),
                'blogUrl' => dzhome2_blog_url(),
                'loginUrl' => dzhome2_login_url(),
                'registerUrl' => home_url('/comprar/'),
            ]); ?>
        </div>
<?php
        return trim(ob_get_clean());
    }
}

add_shortcode('digizap_home_2', 'dzhome2_render_home_shortcode');

