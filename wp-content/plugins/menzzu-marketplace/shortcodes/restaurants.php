<?php

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('menzzu_marketplace_render_restaurants_shortcode')) {
    function menzzu_marketplace_render_restaurants_shortcode($atts = [])
    {
        $atts = shortcode_atts([
            'title' => 'Restaurantes perto de voce',
            'description' => 'Digite seu endereco para ver as lojas disponiveis.',
            'search' => '',
            'location' => '',
            'category' => '',
            'limit' => 18
        ], $atts, 'menzzu_marketplace_restaurants');

        menzzu_marketplace_enqueue_assets();

        $limit = min(max(absint($atts['limit']), 1), 48);
        $queryCategory = '';
        if (isset($_GET['cat'])) {
            $queryCategory = function_exists('menzzu_marketplace_category_slug') ? menzzu_marketplace_category_slug((string) wp_unslash($_GET['cat'])) : sanitize_text_field((string) wp_unslash($_GET['cat']));
        } elseif (!empty($atts['category'])) {
            $queryCategory = function_exists('menzzu_marketplace_category_slug') ? menzzu_marketplace_category_slug((string) $atts['category']) : sanitize_text_field((string) $atts['category']);
        }

        $mapsKey = menzzu_marketplace_maps_key();
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
            $initialData = menzzu_marketplace_fetch_directory_data('', $queryCategory, $initialLocation, $limit, $initialLocationLat, $initialLocationLng);
        }

        $categoryLabel = '';
        if ($queryCategory !== '' && !empty($initialData['categories']) && is_array($initialData['categories'])) {
            foreach ($initialData['categories'] as $category) {
                $slug = function_exists('menzzu_marketplace_category_slug') ? menzzu_marketplace_category_slug((string) ($category['name'] ?? '')) : '';
                if ($slug === $queryCategory) {
                    $categoryLabel = (string) ($category['name'] ?? '');
                    break;
                }
            }
        }
        if ($categoryLabel === '' && $queryCategory !== '') {
            $categoryLabel = ucwords(str_replace('-', ' ', $queryCategory));
        }

        $pageTitle = $categoryLabel !== '' ? $categoryLabel : (string) $atts['title'];


        ob_start();
?>
        <div
            class="menzzu-marketplace"
            data-menzzu-marketplace-root
            data-page="restaurants"
            data-mode="<?php echo esc_attr($hasSelectedAddress ? 'app' : 'landing'); ?>"
            data-category-slug="<?php echo esc_attr($queryCategory); ?>"
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
                'active' => 'restaurants',
                'homeUrl' => home_url('/'),
                'restaurantsUrl' => menzzu_marketplace_restaurants_url(),
                'blogUrl' => menzzu_marketplace_blog_url(),
                'loginUrl' => menzzu_marketplace_login_url(),
                'registerUrl' => home_url('/comprar/'),
                'hasSelectedAddress' => $hasSelectedAddress,
                'initialAddressLabel' => $initialAddressLabel,
                'showBack' => true,
                'backUrl' => home_url('/'),
                'backLabel' => 'Voltar'
            ]); ?>

            <main class="menzzu-marketplace-main">
                <section class="menzzu-marketplace-landing" id="inicio" data-landing <?php echo $hasSelectedAddress ? 'hidden' : ''; ?>>
                    <div class="menzzu-marketplace-landing-grid">
                        <div class="menzzu-marketplace-landing-copy">
                            <span class="menzzu-marketplace-landing-badge">
                                <span aria-hidden="true">⚡</span>
                                <span>Cardapio digital inteligente</span>
                            </span>
                            <h1><?php echo esc_html($pageTitle); ?></h1>

                            <form class="menzzu-marketplace-address-form" data-address-form>
                                <input
                                    type="text"
                                    data-address-input
                                    placeholder="<?php echo esc_attr('Digite seu endereco completo'); ?>"
                                    autocomplete="off"
                                    spellcheck="false"
                                    inputmode="text">
                                <button type="submit" class="menzzu-marketplace-button menzzu-marketplace-button-primary" data-address-continue disabled>
                                    Continuar
                                </button>
                            </form>
                        </div>

                        <div class="menzzu-marketplace-landing-visual menzzu-marketplace-landing-visual--restaurants" aria-hidden="true">
                            <div class="menzzu-marketplace-landing-art menzzu-marketplace-landing-art--restaurants">
                                <img
                                    class="menzzu-marketplace-landing-art-img menzzu-marketplace-landing-art-img--restaurants"
                                    src="<?php echo esc_url(menzzu_marketplace_restaurants_hero_artwork_url()); ?>"
                                    alt=""
                                    loading="eager"
                                    fetchpriority="high"
                                    decoding="async">
                            </div>
                        </div>
                    </div>
                </section>

                <section class="menzzu-marketplace-catalog" id="restaurantes" data-catalog <?php echo $hasSelectedAddress ? '' : 'hidden'; ?>>
                    <div class="menzzu-marketplace-directory-toolbar" data-directory-controls>
                        <div class="menzzu-marketplace-directory-filters" role="tablist" aria-label="Filtros do diretório">
                            <button class="menzzu-marketplace-directory-filter is-active" type="button" data-filter-pill="all">Todos</button>
                            <button class="menzzu-marketplace-directory-filter" type="button" data-filter-pill="featured">Destaques</button>
                            <button class="menzzu-marketplace-directory-filter" type="button" data-filter-pill="freeDelivery">Frete grátis</button>
                            <button class="menzzu-marketplace-directory-filter" type="button" data-filter-pill="promo">Em promoção</button>
                            <button class="menzzu-marketplace-directory-filter" type="button" data-filter-pill="open">Aberto agora</button>
                        </div>
                        <label class="menzzu-marketplace-directory-sort">
                            <span>Ordenar</span>
                            <select data-sort-select>
                                <option value="recommended">Relevância</option>
                                <option value="orders">Mais pedidos</option>
                                <option value="rating">Melhor avaliados</option>
                                <option value="az">A-Z</option>
                            </select>
                        </label>
                    </div>
                    <div class="menzzu-marketplace-restaurants-grid" data-restaurants-grid>
                        <?php echo $hasSelectedAddress ? menzzu_marketplace_render_restaurant_cards(!empty($initialData['stores']) ? $initialData['stores'] : ($initialData['restaurants'] ?? [])) : ''; ?>
                    </div>

                    <nav class="menzzu-marketplace-pagination" data-pagination aria-label="Paginação dos restaurantes" hidden></nav>

                    <div class="menzzu-marketplace-empty-results" data-empty-results hidden>
                        Nenhum restaurante encontrado.
                    </div>
                </section>
            </main>

            <?php echo menzzu_marketplace_render_search_modal(); ?>

            <?php echo menzzu_marketplace_render_directory_footer_nav([
                'active' => 'restaurants',
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

add_shortcode('menzzu_marketplace_restaurants', 'menzzu_marketplace_render_restaurants_shortcode');
add_shortcode('menzzu_restaurants', 'menzzu_marketplace_render_restaurants_shortcode');
add_shortcode('digizap_home_2_restaurants', 'menzzu_marketplace_render_restaurants_shortcode');

