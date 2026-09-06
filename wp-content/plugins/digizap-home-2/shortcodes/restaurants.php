<?php

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('dzhome2_render_restaurants_shortcode')) {
    function dzhome2_render_restaurants_shortcode($atts = [])
    {
        $atts = shortcode_atts([
            'title' => 'Restaurantes perto de voce',
            'description' => 'Digite seu endereco para ver as lojas disponiveis.',
            'search' => '',
            'location' => '',
            'category' => '',
            'limit' => 18
        ], $atts, 'digizap_home_2_restaurants');

        dzhome2_enqueue_assets();

        $limit = min(max(absint($atts['limit']), 1), 48);
        $queryCategory = '';
        if (isset($_GET['cat'])) {
            $queryCategory = function_exists('dzhome2_category_slug') ? dzhome2_category_slug((string) wp_unslash($_GET['cat'])) : sanitize_text_field((string) wp_unslash($_GET['cat']));
        } elseif (!empty($atts['category'])) {
            $queryCategory = function_exists('dzhome2_category_slug') ? dzhome2_category_slug((string) $atts['category']) : sanitize_text_field((string) $atts['category']);
        }

        $mapsKey = dzhome2_maps_key();
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
            $initialData = dzhome2_fetch_directory_data('', $queryCategory, $initialLocation, $limit, $initialLocationLat, $initialLocationLng);
        }

        $categoryLabel = '';
        if ($queryCategory !== '' && !empty($initialData['categories']) && is_array($initialData['categories'])) {
            foreach ($initialData['categories'] as $category) {
                $slug = function_exists('dzhome2_category_slug') ? dzhome2_category_slug((string) ($category['name'] ?? '')) : '';
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
            class="dz-home2"
            data-dz-home2-root
            data-page="restaurants"
            data-mode="<?php echo esc_attr($hasSelectedAddress ? 'app' : 'landing'); ?>"
            data-category-slug="<?php echo esc_attr($queryCategory); ?>"
            data-api-base="<?php echo esc_attr(dzhome2_api_base()); ?>"
            data-home-url="<?php echo esc_attr(home_url('/')); ?>"
            data-restaurants-url="<?php echo esc_attr(dzhome2_restaurants_url()); ?>"
            data-login-url="<?php echo esc_attr(dzhome2_login_url()); ?>"
            data-register-url="<?php echo esc_attr(home_url('/comprar/')); ?>"
            data-blog-url="<?php echo esc_attr(dzhome2_blog_url()); ?>"
            data-storage-key="menzzu_home_address"
            data-limit="<?php echo esc_attr($limit); ?>"
            data-maps-key="<?php echo esc_attr($mapsKey); ?>">
            <?php echo dzhome2_render_directory_header([
                'active' => 'restaurants',
                'homeUrl' => home_url('/'),
                'restaurantsUrl' => dzhome2_restaurants_url(),
                'blogUrl' => dzhome2_blog_url(),
                'loginUrl' => dzhome2_login_url(),
                'registerUrl' => home_url('/comprar/'),
                'hasSelectedAddress' => $hasSelectedAddress,
                'initialAddressLabel' => $initialAddressLabel,
                'showBack' => true,
                'backUrl' => home_url('/'),
                'backLabel' => 'Voltar'
            ]); ?>

            <main class="dz-home2-main">
                <?php echo dzhome2_render_directory_skeleton('restaurants'); ?>

                <section class="dz-home2-landing" id="inicio" data-landing <?php echo $hasSelectedAddress ? 'hidden' : ''; ?>>
                    <div class="dz-home2-landing-grid">
                        <div class="dz-home2-landing-copy">
                            <span class="dz-home2-landing-badge">
                                <span aria-hidden="true">âš¡</span>
                                <span>Cardapio digital inteligente</span>
                            </span>
                            <h1><?php echo esc_html($pageTitle); ?></h1>

                            <form class="dz-home2-address-form" data-address-form>
                                <input
                                    type="text"
                                    data-address-input
                                    placeholder="<?php echo esc_attr('Digite seu endereco completo'); ?>"
                                    autocomplete="off"
                                    spellcheck="false"
                                    inputmode="text">
                                <button type="submit" class="dz-home2-button dz-home2-button-primary" data-address-continue disabled>
                                    Continuar
                                </button>
                            </form>
                        </div>

                        <div class="dz-home2-landing-visual dz-home2-landing-visual--restaurants" aria-hidden="true">
                            <div class="dz-home2-landing-art dz-home2-landing-art--restaurants">
                                <img
                                    class="dz-home2-landing-art-img dz-home2-landing-art-img--restaurants"
                                    src="<?php echo esc_url(dzhome2_restaurants_hero_artwork_url()); ?>"
                                    alt=""
                                    loading="eager"
                                    fetchpriority="high"
                                    decoding="async">
                            </div>
                        </div>
                    </div>
                </section>

                <section class="dz-home2-catalog" id="restaurantes" data-catalog <?php echo $hasSelectedAddress ? '' : 'hidden'; ?>>
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
                    <?php echo dzhome2_render_store_rail_section('Destaques', $initialData['featuredStores'] ?? [], dzhome2_restaurants_url($queryCategory), 'featured', empty($initialData['featuredStores'])); ?>
                    <?php echo dzhome2_render_store_rail_section('Frete grÃ¡tis', $initialData['freeDeliveryStores'] ?? [], dzhome2_restaurants_url($queryCategory), 'freeDelivery', empty($initialData['freeDeliveryStores'])); ?>
                    <?php echo dzhome2_render_store_rail_section('Em promoÃ§Ã£o', $initialData['promoStores'] ?? [], dzhome2_restaurants_url($queryCategory), 'promo', empty($initialData['promoStores'])); ?>

                    <div class="dz-home2-restaurants-grid" data-restaurants-grid>
                        <?php echo $hasSelectedAddress ? dzhome2_render_restaurant_cards($initialData['restaurants'] ?? []) : ''; ?>
                    </div>

                    <div class="dz-home2-empty-results" data-empty-results hidden>
                        Nenhum restaurante encontrado.
                    </div>
                </section>
            </main>

            <?php echo dzhome2_render_search_modal(); ?>

            <?php echo dzhome2_render_directory_footer_nav([
                'active' => 'restaurants',
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

add_shortcode('digizap_home_2_restaurants', 'dzhome2_render_restaurants_shortcode');
add_shortcode('menzzu_restaurants', 'dzhome2_render_restaurants_shortcode');

