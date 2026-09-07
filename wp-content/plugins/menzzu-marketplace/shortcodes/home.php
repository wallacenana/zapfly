<?php

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('menzzu_marketplace_render_home_shortcode')) {
    function menzzu_marketplace_render_home_shortcode($atts = [])
    {
        $atts = shortcode_atts([
            'title' => 'Tudo pra facilitar seu dia a dia',
            'description' => 'Digite seu endereÃ§o para comeÃ§ar.',
            'limit' => 18,
            'key' => 'menzzu_marketplace',
            'maps_key' => ''
        ], $atts, 'menzzu_marketplace');

        menzzu_marketplace_enqueue_assets();

        $limit = min(max(absint($atts['limit']), 1), 48);
        $mapsKey = menzzu_marketplace_maps_key($atts['maps_key']);
        $savedAddress = function_exists('menzzu_marketplace_read_address_cookie') ? menzzu_marketplace_read_address_cookie() : [];
        $initialLocation = trim((string) ($savedAddress['address'] ?? ''));
        $initialLocationLat = isset($savedAddress['lat']) ? (float) $savedAddress['lat'] : null;
        $initialLocationLng = isset($savedAddress['lng']) ? (float) $savedAddress['lng'] : null;
        $hasSelectedAddress = $initialLocation !== '';
        $initialAddressLabel = '';
        if ($hasSelectedAddress && function_exists('menzzu_marketplace_short_address')) {
            $initialAddressLabel = (string) (menzzu_marketplace_short_address($initialLocation)[0] ?? '');
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
            $initialData = menzzu_marketplace_fetch_directory_data('', '', $initialLocation, $limit, $initialLocationLat, $initialLocationLng);
        }

        ob_start();
?>
        <div
            class="menzzu-marketplace"
            data-menzzu-marketplace-root
            data-mode="<?php echo esc_attr($hasSelectedAddress ? 'app' : 'landing'); ?>"
            data-api-base="<?php echo esc_attr(menzzu_marketplace_api_base()); ?>"
            data-home-url="<?php echo esc_attr(home_url('/')); ?>"
            data-restaurants-url="<?php echo esc_attr(menzzu_marketplace_restaurants_url()); ?>"
            data-login-url="<?php echo esc_attr(menzzu_marketplace_login_url()); ?>"
            data-register-url="<?php echo esc_attr(home_url('/comprar/')); ?>"
            data-blog-url="<?php echo esc_attr(menzzu_marketplace_blog_url()); ?>"
            data-storage-key="menzzu_home_address"
            data-limit="<?php echo esc_attr($limit); ?>"
            data-maps-key="<?php echo esc_attr($mapsKey); ?>">
            <?php echo menzzu_marketplace_render_directory_header([
                'active' => 'home',
                'homeUrl' => home_url('/'),
                'restaurantsUrl' => menzzu_marketplace_restaurants_url(),
                'blogUrl' => menzzu_marketplace_blog_url(),
                'loginUrl' => menzzu_marketplace_login_url(),
                'registerUrl' => home_url('/comprar/'),
                'hasSelectedAddress' => $hasSelectedAddress,
                'initialAddressLabel' => $initialAddressLabel,
            ]); ?>

            <main class="menzzu-marketplace-main">
                <?php echo menzzu_marketplace_render_directory_skeleton('home'); ?>

                <section class="menzzu-marketplace-landing" id="inicio" data-landing <?php echo $hasSelectedAddress ? 'hidden' : ''; ?>>
                    <div class="menzzu-marketplace-landing-grid">
                        <div class="menzzu-marketplace-landing-copy">
                            <span class="menzzu-marketplace-landing-badge">
                                <span aria-hidden="true">âš¡</span>
                                <span>CardÃ¡pio digital inteligente</span>
                            </span>
                            <h1><?php echo esc_html($atts['title']); ?></h1>
                            <p><?php echo esc_html($atts['description']); ?></p>

                            <form class="menzzu-marketplace-address-form" data-address-form>
                                <input
                                    type="text"
                                    data-address-input
                                    placeholder="<?php echo esc_attr('Digite seu endereÃ§o completo'); ?>"
                                    autocomplete="off"
                                    spellcheck="false"
                                    inputmode="text">
                                <button type="submit" class="menzzu-marketplace-button menzzu-marketplace-button-primary" data-address-continue disabled>
                                    Continuar
                                </button>
                            </form>
                        </div>

                        <div class="menzzu-marketplace-landing-visual" aria-hidden="true">
                            <span class="menzzu-marketplace-visual-badge"></span>
                            <span class="menzzu-marketplace-visual-ring"></span>
                            <div class="menzzu-marketplace-landing-art">
                                <img
                                    class="menzzu-marketplace-landing-art-img"
                                    src="<?php echo esc_url(menzzu_marketplace_hero_artwork_url()); ?>"
                                    alt=""
                                    loading="eager"
                                    fetchpriority="high"
                                    decoding="async">
                            </div>
                        </div>
                    </div>
                </section>

                <section class="menzzu-marketplace-catalog" id="restaurantes" data-catalog <?php echo $hasSelectedAddress ? '' : 'hidden'; ?>>
                    <div class="menzzu-marketplace-categories" data-categories>
                        <div class="menzzu-marketplace-categories-track" data-categories-track>
                            <?php foreach (($initialData['categories'] ?? []) as $category) :
                                $categoryName = (string) ($category['name'] ?? 'Categoria');
                                $categoryCount = absint($category['count'] ?? 0);
                                $categorySlug = function_exists('menzzu_marketplace_category_slug') ? menzzu_marketplace_category_slug($categoryName) : '';
                                $categoryLogo = function_exists('menzzu_marketplace_category_image_url') ? menzzu_marketplace_category_image_url($categoryName) : '';
                                if ($categoryLogo === '' && function_exists('menzzu_marketplace_placeholder_logo')) {
                                    $categoryLogo = menzzu_marketplace_placeholder_logo($categoryName, $category['accentColor'] ?? '#2dbd30');
                                }
                            ?>
                                <a class="menzzu-marketplace-category-card" href="<?php echo esc_url(menzzu_marketplace_restaurants_url($categorySlug)); ?>" data-category="<?php echo esc_attr($categorySlug); ?>">
                                    <span class="menzzu-marketplace-category-thumb">
                                        <img src="<?php echo esc_url($categoryLogo); ?>" alt="<?php echo esc_attr($categoryName); ?>" loading="lazy" decoding="async">
                                    </span>
                                    <span class="menzzu-marketplace-category-label">
                                        <strong><?php echo esc_html($categoryName); ?></strong>
                                        <small><?php echo esc_html($categoryCount . ' restaurante' . ($categoryCount === 1 ? '' : 's')); ?></small>
                                    </span>
                                </a>
                            <?php endforeach; ?>
                        </div>
                    </div>

                    <div class="menzzu-marketplace-directory-toolbar" data-directory-controls>
                        <div class="menzzu-marketplace-directory-filters" role="tablist" aria-label="Filtros do diretÃ³rio">
                            <button class="menzzu-marketplace-directory-filter is-active" type="button" data-filter-pill="all">Todos</button>
                            <button class="menzzu-marketplace-directory-filter" type="button" data-filter-pill="featured">Destaques</button>
                            <button class="menzzu-marketplace-directory-filter" type="button" data-filter-pill="freeDelivery">Frete grÃ¡tis</button>
                            <button class="menzzu-marketplace-directory-filter" type="button" data-filter-pill="promo">Em promoÃ§Ã£o</button>
                            <button class="menzzu-marketplace-directory-filter" type="button" data-filter-pill="open">Aberto agora</button>
                        </div>
                        <label class="menzzu-marketplace-directory-sort">
                            <span>Ordenar</span>
                            <select data-sort-select>
                                <option value="recommended">RelevÃ¢ncia</option>
                                <option value="orders">Mais pedidos</option>
                                <option value="rating">Melhor avaliados</option>
                                <option value="az">A-Z</option>
                            </select>
                        </label>
                    </div>

                    <?php echo menzzu_marketplace_render_store_rail_section('Destaques', $initialData['featuredStores'] ?? [], menzzu_marketplace_restaurants_url(), 'featured', empty($initialData['featuredStores'])); ?>
                    <?php echo menzzu_marketplace_render_store_rail_section('Frete grÃ¡tis', $initialData['freeDeliveryStores'] ?? [], menzzu_marketplace_restaurants_url(), 'freeDelivery', empty($initialData['freeDeliveryStores'])); ?>
                    <?php echo menzzu_marketplace_render_store_rail_section('Em promoÃ§Ã£o', $initialData['promoStores'] ?? [], menzzu_marketplace_restaurants_url(), 'promo', empty($initialData['promoStores'])); ?>

                    <div class="menzzu-marketplace-catalog-head">
                        <div>
                            <h2>Restaurantes perto de vocÃª</h2>
                        </div>
                        <a class="menzzu-marketplace-catalog-action" href="<?php echo esc_url(menzzu_marketplace_restaurants_url()); ?>">Ver mais</a>
                    </div>

                    <div class="menzzu-marketplace-restaurants-grid" data-restaurants-grid>
                        <?php echo $hasSelectedAddress ? menzzu_marketplace_render_restaurant_cards($initialData['restaurants'] ?? []) : ''; ?>
                    </div>

                    <!-- <div class="menzzu-marketplace-featured-track" data-featured-track>
                        <?php //echo $hasSelectedAddress ? menzzu_marketplace_render_featured_cards($initialData['featuredStores'] ?? []) : ''; ?>
                    </div> -->

                    <div class="menzzu-marketplace-empty-results" data-empty-results hidden>
                        Nenhum restaurante encontrado.
                    </div>
                </section>
            </main>

            <?php echo menzzu_marketplace_render_search_modal(); ?>

            <?php echo menzzu_marketplace_render_directory_footer_nav([
                'active' => 'home',
                'homeUrl' => home_url('/'),
                'restaurantsUrl' => menzzu_marketplace_restaurants_url(),
                'blogUrl' => menzzu_marketplace_blog_url(),
                'loginUrl' => menzzu_marketplace_login_url(),
                'registerUrl' => home_url('/comprar/'),
            ]); ?>
        </div>
<?php
        return trim(ob_get_clean());
    }
}

add_shortcode('menzzu_marketplace', 'menzzu_marketplace_render_home_shortcode');
add_shortcode('menzzu_home', 'menzzu_marketplace_render_home_shortcode');
add_shortcode('digizap_home_2', 'menzzu_marketplace_render_home_shortcode');

