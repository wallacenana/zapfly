<?php

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('menzzu_marketplace_render_home_shortcode')) {
    function menzzu_marketplace_render_home_shortcode($atts = [])
    {
        $atts = shortcode_atts([
            'title' => 'Tudo pra facilitar seu dia a dia',
            'description' => 'Digite seu endereço para começar.',
            'limit' => 18,
            'key' => 'menzzu_marketplace',
            'maps_key' => ''
        ], $atts, 'menzzu_home');

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
            data-maps-key="<?php echo esc_attr($mapsKey); ?>"
            data-home-shell="1">
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

                <section class="menzzu-marketplace-landing" id="inicio" data-landing>
                    <div class="menzzu-marketplace-home-hero">
                        <span class="menzzu-marketplace-home-eyebrow">O marketplace local da sua cidade</span>
                        <h1>O cardápio do seu<br><em>próximo pedido</em>, está aqui.</h1>
                        <p>Encontre restaurantes na sua região, explore os cardápios e faça seu pedido diretamente pelo Menzzu.</p>
                        <form class="menzzu-marketplace-address-form menzzu-marketplace-home-search" data-address-form>
                            <span class="menzzu-marketplace-home-search-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg></span>
                            <input type="text" data-address-input placeholder="Buscar restaurante, prato ou cozinha..." autocomplete="off" spellcheck="false" inputmode="text">
                            <span class="menzzu-marketplace-home-search-location" aria-hidden="true">⌖ <strong>São Luís - MA</strong></span>
                            <button type="submit" class="menzzu-marketplace-button menzzu-marketplace-button-primary" data-address-continue disabled>Buscar</button>
                        </form>
                    </div>

                    <div class="menzzu-marketplace-home-categories" data-categories>
                        <div class="menzzu-marketplace-categories-track" data-categories-track>
                            <?php
                            $homeCategories = is_array($initialData['categories'] ?? null) ? $initialData['categories'] : [];
                            if (!$homeCategories) {
                                $homeCategories = array_map(static function ($name) {
                                    return ['name' => $name, 'count' => 0];
                                }, ['Lanches', 'Pizzas', 'Brasileira', 'Japonesa', 'Doces & Bolos', 'Bebidas', 'Saudável', 'Mexicana', 'Marmitas']);
                            }
                            foreach ($homeCategories as $category) :
                                $categoryName = (string) ($category['name'] ?? 'Categoria');
                                $categorySlug = function_exists('menzzu_marketplace_category_slug') ? menzzu_marketplace_category_slug($categoryName) : '';
                                $categoryLogo = function_exists('menzzu_marketplace_category_image_url') ? menzzu_marketplace_category_image_url($categoryName) : '';
                                if ($categoryLogo === '' && function_exists('menzzu_marketplace_placeholder_logo')) {
                                    $categoryLogo = menzzu_marketplace_placeholder_logo($categoryName, '#82f026');
                                }
                            ?>
                                <a class="menzzu-marketplace-category-card" href="<?php echo esc_url(menzzu_marketplace_restaurants_url($categorySlug)); ?>" data-category="<?php echo esc_attr($categorySlug); ?>">
                                    <span class="menzzu-marketplace-category-thumb"><img src="<?php echo esc_url($categoryLogo); ?>" alt="" loading="lazy" decoding="async"></span>
                                    <span class="menzzu-marketplace-category-label"><strong><?php echo esc_html($categoryName); ?></strong></span>
                                </a>
                            <?php endforeach; ?>
                            <a class="menzzu-marketplace-category-card menzzu-marketplace-category-more" href="<?php echo esc_url(menzzu_marketplace_restaurants_url()); ?>"><span class="menzzu-marketplace-category-thumb">+</span><span class="menzzu-marketplace-category-label"><strong>Ver mais</strong></span></a>
                        </div>
                    </div>

                    <section class="menzzu-marketplace-home-banner">
                        <div><span>Descubra novos sabores</span><p>Restaurantes parceiros com cardápios incríveis à sua espera.</p><a href="<?php echo esc_url(menzzu_marketplace_restaurants_url()); ?>">Explorar restaurantes <b aria-hidden="true">→</b></a></div>
                        <div class="menzzu-marketplace-home-banner-art" aria-hidden="true"><span>Boa comida<br>mais perto<br>de você.</span></div>
                    </section>

                    <section class="menzzu-marketplace-home-benefits" aria-label="Vantagens do Menzzu">
                        <div><span>▣</span><strong>Peça direto pelo cardápio</strong><small>Sem intermediários desnecessários.</small></div>
                        <div><span>%</span><strong>Preços mais justos</strong><small>Apoie os restaurantes locais e economize.</small></div>
                        <div><span>♡</span><strong>Mais variedade</strong><small>Descubra novos sabores na sua região.</small></div>
                        <div><span>♥</span><strong>Comer bem fica mais fácil</strong><small>Tudo em um só lugar.</small></div>
                    </section>

                    <div class="menzzu-marketplace-landing-grid">
                        <div class="menzzu-marketplace-landing-copy">
                            <span class="menzzu-marketplace-landing-badge">
                                <span aria-hidden="true">⚡</span>
                                <span>Cardápio digital inteligente</span>
                            </span>
                            <h1><?php echo esc_html($atts['title']); ?></h1>
                            <p><?php echo esc_html($atts['description']); ?></p>

                            <form class="menzzu-marketplace-address-form" data-address-form>
                                <input
                                    type="text"
                                    data-address-input
                                    placeholder="<?php echo esc_attr('Digite seu endereço completo'); ?>"
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

                    <?php echo menzzu_marketplace_render_store_rail_section('Restaurantes em destaque', $initialData['featuredStores'] ?? [], menzzu_marketplace_restaurants_url(), 'featured', empty($initialData['featuredStores'])); ?>
                    <?php echo menzzu_marketplace_render_store_rail_section('Frete grátis', $initialData['freeDeliveryStores'] ?? [], menzzu_marketplace_restaurants_url(), 'freeDelivery', empty($initialData['freeDeliveryStores'])); ?>
                    <?php echo menzzu_marketplace_render_store_rail_section('Em promoção', $initialData['promoStores'] ?? [], menzzu_marketplace_restaurants_url(), 'promo', empty($initialData['promoStores'])); ?>

                    <div class="menzzu-marketplace-catalog-head">
                        <div>
                            <h2>Restaurantes perto de você</h2>
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

            <footer class="menzzu-marketplace-site-footer">
                <div class="menzzu-marketplace-site-footer-brand">
                    <strong>men<span>zzu</span></strong>
                    <p>O cardápio do restaurante.<br>A praticidade do marketplace.</p>
                </div>
                <div><strong>Para você</strong><a href="<?php echo esc_url(menzzu_marketplace_restaurants_url()); ?>">Restaurantes</a><a href="<?php echo esc_url(menzzu_marketplace_restaurants_url()); ?>">Categorias</a><a href="#">Ajuda</a></div>
                <div><strong>Para restaurantes</strong><a href="<?php echo esc_url($atts['register_url'] ?? home_url('/comprar/')); ?>">Cadastrar restaurante</a><a href="#">Planos e taxas</a><a href="#">Central de ajuda</a></div>
                <div><strong>Institucional</strong><a href="#">Sobre o Menzzu</a><a href="#">Termos de uso</a><a href="#">Privacidade</a><a href="#">Contato</a></div>
                <div><strong>Siga a gente</strong><div class="menzzu-marketplace-social-links"><a href="#" aria-label="Instagram">◎</a><a href="#" aria-label="Facebook">f</a><a href="#" aria-label="TikTok">♪</a><a href="#" aria-label="YouTube">▶</a></div></div>
                <div class="menzzu-marketplace-site-footer-bottom"><span>© <?php echo esc_html(date('Y')); ?> Menzzu. Todos os direitos reservados.</span><span>Feito com <b>♥</b> no Brasil.</span></div>
            </footer>

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

add_shortcode('menzzu_home', 'menzzu_marketplace_render_home_shortcode');
add_shortcode('menzzu_marketplace', 'menzzu_marketplace_render_home_shortcode');
// Compatibility alias for pages that still contain the original shortcode.
add_shortcode('digizap_home_2', 'menzzu_marketplace_render_home_shortcode');

