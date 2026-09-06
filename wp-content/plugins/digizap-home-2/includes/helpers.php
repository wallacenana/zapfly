<?php

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('dzhome2_asset_path')) {
    function dzhome2_asset_path($relative)
    {
        return trailingslashit(DIGIZAP_HOME2_DIR) . ltrim($relative, '/');
    }
}

if (!function_exists('dzhome2_asset_url')) {
    function dzhome2_asset_url($relative)
    {
        return trailingslashit(DIGIZAP_HOME2_URL) . ltrim($relative, '/');
    }
}

if (!function_exists('dzhome2_asset_version')) {
    function dzhome2_asset_version($relative)
    {
        $path = dzhome2_asset_path($relative);
        return file_exists($path) ? filemtime($path) : DIGIZAP_HOME2_VERSION;
    }
}

if (!function_exists('dzhome2_api_base')) {
    function dzhome2_api_base()
    {
        return untrailingslashit((string) apply_filters('digizap_home2_api_base', 'https://api.menzzu.com'));
    }
}

if (!function_exists('dzhome2_login_url')) {
    function dzhome2_login_url()
    {
        return untrailingslashit((string) apply_filters('digizap_home2_login_url', home_url('/login/')));
    }
}

if (!function_exists('dzhome2_brand_logo_url')) {
    function dzhome2_brand_logo_url()
    {
        $logo_id = (int) get_theme_mod('custom_logo');
        if ($logo_id > 0) {
            $logo_url = wp_get_attachment_image_url($logo_id, 'full');
            if (!empty($logo_url)) {
                return $logo_url;
            }
        }

        return dzhome2_placeholder_logo(get_bloginfo('name') ?: 'Menzzu');
    }
}

if (!function_exists('dzhome2_enqueue_assets')) {
    function dzhome2_enqueue_assets()
    {
        static $loaded = false;
        if ($loaded) {
            return;
        }

        $style_rel = 'assets/home.css';
        $script_rel = 'assets/home.js';

        wp_enqueue_style('menzzu-marketplace', dzhome2_asset_url($style_rel), [], dzhome2_asset_version($style_rel));
        wp_enqueue_script('menzzu-marketplace', dzhome2_asset_url($script_rel), [], dzhome2_asset_version($script_rel), true);

        $config = [
            'apiBase' => dzhome2_api_base(),
            'homeUrl' => home_url('/'),
            'restaurantsUrl' => dzhome2_restaurants_url(),
            'loginUrl' => dzhome2_login_url(),
            'registerUrl' => home_url('/comprar/'),
            'blogUrl' => dzhome2_blog_url(),
            'categoryImageBaseUrl' => dzhome2_asset_url('assets/img/'),
            'categoryImageRules' => dzhome2_category_image_rules(),
            'storageKey' => 'menzzu_home_address',
            'legacyStorageKey' => 'dz_home2_address',
            'searchLabel' => 'Buscar loja ou item',
            'continueLabel' => 'Continuar',
            'editLabel' => 'Alterar endereÃ§o',
            'addressPlaceholder' => 'Digite seu endereÃ§o completo',
        ];

        wp_localize_script('menzzu-marketplace', 'menzzuMarketplaceConfig', $config);
        wp_localize_script('menzzu-marketplace', 'dzHome2Config', $config);

        $loaded = true;
    }
}

if (!function_exists('dzhome2_normalize_text')) {
    function dzhome2_normalize_text($value)
    {
        $value = (string) $value;
        if ($value === '') {
            return '';
        }

        $normalized = function_exists('remove_accents') ? remove_accents($value) : $value;
        $normalized = strtolower($normalized);
        $normalized = preg_replace('/[^\p{L}\p{N}\s-]+/u', ' ', $normalized);
        $normalized = preg_replace('/\s+/', ' ', $normalized);

        return trim($normalized);
    }
}

if (!function_exists('dzhome2_slugify_text')) {
    function dzhome2_slugify_text($value)
    {
        $value = (string) $value;
        if ($value === '') {
            return '';
        }

        $normalized = function_exists('remove_accents') ? remove_accents($value) : $value;
        $normalized = strtolower($normalized);
        $normalized = preg_replace('/[^a-z0-9]+/i', '-', $normalized);
        $normalized = preg_replace('/-+/', '-', $normalized);

        return trim((string) $normalized, '-');
    }
}

if (!function_exists('dzhome2_category_slug')) {
    function dzhome2_category_slug($value)
    {
        return dzhome2_slugify_text($value);
    }
}

if (!function_exists('dzhome2_placeholder_logo')) {
    function dzhome2_placeholder_logo($name, $accent = '#e11d48')
    {
        $words = preg_split('/\s+/', trim((string) $name)) ?: [];
        $words = array_values(array_filter($words, static fn($word) => $word !== ''));
        if (count($words) === 0) {
            $initials = 'MZ';
        } elseif (count($words) === 1) {
            $initials = mb_strtoupper(mb_substr($words[0], 0, 2));
        } else {
            $initials = mb_strtoupper(mb_substr($words[0], 0, 1) . mb_substr($words[1], 0, 1));
        }

        $accent = preg_match('/^#[0-9a-fA-F]{3,8}$/', (string) $accent) ? $accent : '#e11d48';
        $svg = '
            <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
                <defs>
                    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stop-color="' . esc_attr($accent) . '"/>
                        <stop offset="100%" stop-color="#111827"/>
                    </linearGradient>
                </defs>
                <rect width="256" height="256" rx="64" fill="url(#g)"/>
                <circle cx="128" cy="128" r="92" fill="rgba(255,255,255,0.12)"/>
                <text x="128" y="146" text-anchor="middle" font-family="Arial, sans-serif" font-size="78" font-weight="800" fill="#fff">' . esc_html($initials) . '</text>
            </svg>
        ';

        return 'data:image/svg+xml;charset=UTF-8,' . rawurlencode(trim($svg));
    }
}

if (!function_exists('dzhome2_category_image_rules')) {
    function dzhome2_category_image_rules()
    {
        return [
            ['match' => 'doces bolos', 'file' => 'bolos.png'],
            ['match' => 'doces e bolos', 'file' => 'bolos.png'],
            ['match' => 'acai', 'file' => 'aÃ§ai.png'],
            ['match' => 'bebidas', 'file' => 'bebidas.png'],
            ['match' => 'bolos', 'file' => 'bolos.png'],
            ['match' => 'doces', 'file' => 'doces.png'],
            ['match' => 'japonesa', 'file' => 'japonesa.png'],
            ['match' => 'massas', 'file' => 'massas.png'],
            ['match' => 'pizzas', 'file' => 'pizzas.png'],
            ['match' => 'saladas', 'file' => 'saladas.png'],
            ['match' => 'hamburguer', 'file' => 'burgers.png'],
            ['match' => 'hamburger', 'file' => 'burgers.png'],
            ['match' => 'burguer', 'file' => 'burgers.png'],
            ['match' => 'burger', 'file' => 'burgers.png'],
            ['match' => 'burgers', 'file' => 'burgers.png'],
            ['match' => 'lanches', 'file' => 'burgers.png'],
            ['match' => 'lanche', 'file' => 'burgers.png'],
            ['match' => 'hamburguers', 'file' => 'burgers.png']
        ];
    }
}

if (!function_exists('dzhome2_category_image_key')) {
    function dzhome2_category_image_key($name)
    {
        $normalized = dzhome2_normalize_text($name);
        $normalized = str_replace(['&', '/', '-', '_'], ' ', $normalized);
        $normalized = preg_replace('/\s+/', ' ', $normalized);

        return trim((string) $normalized);
    }
}

if (!function_exists('dzhome2_category_image_filename')) {
    function dzhome2_category_image_filename($name)
    {
        $key = dzhome2_category_image_key($name);
        if ($key === '') {
            return '';
        }

        foreach (dzhome2_category_image_rules() as $rule) {
            $match = isset($rule['match']) ? trim((string) $rule['match']) : '';
            $file = isset($rule['file']) ? trim((string) $rule['file']) : '';
            if ($match === '' || $file === '') {
                continue;
            }
            if (strpos($key, $match) !== false) {
                return $file;
            }
        }

        return '';
    }
}

if (!function_exists('dzhome2_category_image_url')) {
    function dzhome2_category_image_url($name)
    {
        $file = dzhome2_category_image_filename($name);
        return $file !== '' ? dzhome2_asset_url('assets/img/' . rawurlencode($file)) : '';
    }
}

if (!function_exists('dzhome2_store_url')) {
    function dzhome2_store_url($slug)
    {
        $slug = sanitize_title((string) $slug);
        return $slug !== '' ? home_url('/' . $slug . '/') : home_url('/');
    }
}

if (!function_exists('dzhome2_restaurants_url')) {
    function dzhome2_restaurants_url($category = '')
    {
        $url = home_url('/restaurantes/');
        $category = dzhome2_category_slug($category);

        if ($category !== '') {
            $url = add_query_arg('cat', $category, $url);
        }

        return $url;
    }
}

if (!function_exists('dzhome2_escape_attr')) {
    function dzhome2_escape_attr($value)
    {
        return esc_attr((string) $value);
    }
}

if (!function_exists('dzhome2_store_schedule_state')) {
    function dzhome2_store_schedule_state($store)
    {
        $isOpen = array_key_exists('isOpenNow', $store)
            ? filter_var($store['isOpenNow'], FILTER_VALIDATE_BOOLEAN)
            : !empty($store['acceptOrders']);

        return [
            'isOpenNow' => (bool) $isOpen,
            'statusLabel' => (bool) $isOpen ? 'Aberto' : 'Apenas encomendas',
            'statusClass' => (bool) $isOpen ? 'open' : 'closed'
        ];
    }
}

if (!function_exists('dzhome2_read_address_cookie')) {
    function dzhome2_read_address_cookie($key = 'menzzu_home_address')
    {
        $keys = [$key];
        if ($key !== 'dz_home2_address') {
            $keys[] = 'dz_home2_address';
        }
        $raw = '';
        foreach ($keys as $cookieKey) {
            if (isset($_COOKIE[$cookieKey]) && (string) $_COOKIE[$cookieKey] !== '') {
                $raw = wp_unslash((string) $_COOKIE[$cookieKey]);
                break;
            }
        }

        if ($raw === '') {
            return [
                'address' => '',
                'placeId' => '',
                'lat' => null,
                'lng' => null
            ];
        }

        $decoded = rawurldecode($raw);
        $parsed = json_decode($decoded, true);

        if (is_array($parsed)) {
            return [
                'address' => sanitize_text_field((string) ($parsed['address'] ?? $parsed['formatted_address'] ?? '')),
                'placeId' => sanitize_text_field((string) ($parsed['placeId'] ?? $parsed['place_id'] ?? '')),
                'lat' => isset($parsed['lat']) ? (float) $parsed['lat'] : null,
                'lng' => isset($parsed['lng']) ? (float) $parsed['lng'] : null
            ];
        }

        return [
            'address' => sanitize_text_field($decoded),
            'placeId' => '',
            'lat' => null,
            'lng' => null
        ];
    }
}

if (!function_exists('dzhome2_fetch_directory_data')) {
    function dzhome2_fetch_directory_data($search = '', $category = '', $location = '', $limit = 18, $locationLat = null, $locationLng = null)
    {
        $args = [
            'search' => sanitize_text_field((string) $search),
            'category' => sanitize_text_field((string) $category),
            'location' => sanitize_text_field((string) $location),
            'locationLat' => $locationLat !== null && $locationLat !== '' ? (float) $locationLat : '',
            'locationLng' => $locationLng !== null && $locationLng !== '' ? (float) $locationLng : '',
            'limit' => min(max(absint($limit), 1), 48)
        ];

        $cache_key = 'dzhome2_v3_' . md5(wp_json_encode($args));
        $cached = get_transient($cache_key);
        if ($cached !== false) {
            return $cached;
        }

        $url = add_query_arg($args, dzhome2_api_base() . '/public/restaurants');
        $response = wp_remote_get($url, [
            'timeout' => 12,
            'headers' => [
                'Accept' => 'application/json'
            ]
        ]);

        if (is_wp_error($response)) {
            return [
                'search' => $args['search'],
                'category' => $args['category'],
                'location' => $args['location'],
                'locationLat' => $args['locationLat'],
                'locationLng' => $args['locationLng'],
                'total' => 0,
                'featuredStores' => [],
                'freeDeliveryStores' => [],
                'promoStores' => [],
                'stores' => [],
                'restaurants' => []
            ];
        }

        $body = wp_remote_retrieve_body($response);
        $data = json_decode($body, true);
        $status = wp_remote_retrieve_response_code($response);

        if ($status < 200 || $status >= 300 || !is_array($data)) {
            return [
                'search' => $args['search'],
                'category' => $args['category'],
                'location' => $args['location'],
                'locationLat' => $args['locationLat'],
                'locationLng' => $args['locationLng'],
                'total' => 0,
                'featuredStores' => [],
                'freeDeliveryStores' => [],
                'promoStores' => [],
                'stores' => [],
                'restaurants' => []
            ];
        }

        set_transient($cache_key, $data, MINUTE_IN_SECONDS);
        return $data;
    }
}

if (!function_exists('dzhome2_render_featured_cards')) {
    function dzhome2_render_featured_cards($restaurants = [])
    {
        if (empty($restaurants) || !is_array($restaurants)) {
            return '<div class="dz-home2-empty">Sem destaques por enquanto.</div>';
        }

        $html = [];
        foreach (array_slice($restaurants, 0, 10) as $store) {
            $name = isset($store['name']) ? (string) $store['name'] : 'Restaurante';
            $slug = isset($store['slug']) ? (string) $store['slug'] : '';
            $category = isset($store['category']) ? (string) $store['category'] : '';
            $logoUrl = !empty($store['logoUrl']) ? (string) $store['logoUrl'] : dzhome2_placeholder_logo($name, $store['accentColor'] ?? '#e11d48');
            $schedule = dzhome2_store_schedule_state($store);
            $ratingVisible = isset($store['orderCount']) ? absint($store['orderCount']) > 0 : false;
            $ratingCount = isset($store['ratingCount']) ? absint($store['ratingCount']) : 0;
            $ratingLabel = isset($store['ratingLabel']) && (string) $store['ratingLabel'] !== '' ? (string) $store['ratingLabel'] : '5,0';
            $ratingText = $ratingVisible ? $ratingLabel . ($ratingCount > 0 ? ' (' . $ratingCount . ')' : '') : '';
            $ratingMarkup = $ratingVisible ? '<svg class="dz-home2-rating-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9L12 2.5z" fill="currentColor"></path></svg>' : '';
            $promoBadge = !empty($store['hasPromotion']) ? '<span class="dz-home2-store-badge dz-home2-store-badge-promo">Promo</span>' : '';
            $freeBadge = !empty($store['freeDeliveryEnabled']) ? '<span class="dz-home2-store-badge dz-home2-store-badge-free">Frete gratis</span>' : '';

            $html[] = sprintf(
                '<a class="dz-home2-featured-card %s" href="%s">
                    <span class="dz-home2-featured-media"><img src="%s" alt="%s" loading="lazy" decoding="async"></span>
                        <span class="dz-home2-featured-copy">
                            %s
                            <strong>%s</strong>
                            <small>%s</small>
                            %s
                            %s
                        </span>
                </a>',
                $schedule['isOpenNow'] ? '' : 'is-closed',
                esc_url(dzhome2_store_url($slug)),
                esc_url($logoUrl),
                esc_attr($name),
                $promoBadge . $freeBadge,
                esc_html($name),
                esc_html($category),
                $ratingVisible ? '<span class="dz-home2-hero-rating">' . $ratingMarkup . '<span class="dz-home2-rating-text">' . esc_html($ratingText) . '</span></span>' : '',
                $schedule['isOpenNow'] ? '' : sprintf(
                    '<span class="dz-home2-restaurant-status %s dz-home2-featured-status">%s</span>',
                    esc_attr($schedule['statusClass']),
                    esc_html($schedule['statusLabel'])
                )
            );
        }

        return implode('', $html);
    }
}

if (!function_exists('dzhome2_render_store_rail_section')) {
    function dzhome2_render_store_rail_section($title, $stores = [], $actionUrl = '', $railKey = 'featured', $isHidden = false)
    {
        $stores = is_array($stores) ? $stores : [];
        if (empty($stores) && !$isHidden) {
            return '';
        }

        ob_start();
?>
        <section class="dz-home2-store-rail" data-store-rail data-rail-key="<?php echo esc_attr($railKey); ?>" <?php echo $isHidden ? 'hidden' : ''; ?>>
            <div class="dz-home2-catalog-head dz-home2-store-rail-head">
                <div>
                    <h2><?php echo esc_html($title); ?></h2>
                    <p data-rail-summary><?php echo esc_html(count($stores) === 1 ? '1 restaurante encontrado' : sprintf('%d restaurantes encontrados', count($stores))); ?></p>
                </div>
                <?php if ($actionUrl !== '') : ?>
                    <a class="dz-home2-catalog-action" href="<?php echo esc_url($actionUrl); ?>">Ver mais</a>
                <?php endif; ?>
            </div>
            <div class="dz-home2-featured-track dz-home2-store-rail-track" data-rail-track>
                <?php echo dzhome2_render_featured_cards($stores); ?>
            </div>
        </section>
    <?php
        return trim(ob_get_clean());
    }
}

if (!function_exists('dzhome2_render_restaurant_cards')) {
    function dzhome2_render_restaurant_cards($restaurants = [])
    {
        if (empty($restaurants) || !is_array($restaurants)) {
            return '<div class="dz-home2-empty-results">Nenhum restaurante encontrado.</div>';
        }

        $html = [];
        foreach ($restaurants as $store) {
            $name = isset($store['name']) ? (string) $store['name'] : 'Restaurante';
            $slug = isset($store['slug']) ? (string) $store['slug'] : '';
            $category = isset($store['category']) ? (string) $store['category'] : '';
            $address = !empty($store['address']) ? (string) $store['address'] : 'EndereÃ§o nÃ£o informado';
            $logoUrl = !empty($store['logoUrl']) ? (string) $store['logoUrl'] : dzhome2_placeholder_logo($name, $store['accentColor'] ?? '#e11d48');
            $featuredLine = !empty($store['featuredProducts'])
                ? implode(' Â· ', array_map(static fn($item) => isset($item['name']) ? (string) $item['name'] : '', $store['featuredProducts']))
                : 'Sem destaques cadastrados';
            $schedule = dzhome2_store_schedule_state($store);
            $count = isset($store['productsCount']) ? absint($store['productsCount']) : 0;
            $ratingVisible = isset($store['orderCount']) ? absint($store['orderCount']) > 0 : false;
            $ratingCount = isset($store['ratingCount']) ? absint($store['ratingCount']) : 0;
            $ratingLabel = isset($store['ratingLabel']) && (string) $store['ratingLabel'] !== '' ? (string) $store['ratingLabel'] : '5,0';
            $ratingText = $ratingVisible ? $ratingLabel . ($ratingCount > 0 ? ' (' . $ratingCount . ')' : '') : '';
            $ratingMarkup = $ratingVisible ? '<svg class="dz-home2-rating-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9L12 2.5z" fill="currentColor"></path></svg>' : '';

            $html[] = sprintf(
                '<article class="dz-home2-restaurant-card %s">
                    <a class="dz-home2-restaurant-link %s" href="%s">
                        <span class="dz-home2-restaurant-media"><img src="%s" alt="%s" loading="lazy" decoding="async"></span>
                        <span class="dz-home2-restaurant-body">
                            <span class="dz-home2-restaurant-head">
                                <strong>%s</strong>
                                <span class="dz-home2-restaurant-status %s">%s</span>
                            </span>
                            <span class="dz-home2-restaurant-category">%s</span>
                            <span class="dz-home2-restaurant-address" style="display:none">%s</span>
                            <span class="dz-home2-restaurant-meta">
                                <span>%d item%s</span>
                                %s
                                <span style="display:none">%s</span>
                            </span>
                        </span>
                    </a>
                </article>',
                $schedule['isOpenNow'] ? '' : 'is-closed',
                $schedule['isOpenNow'] ? '' : 'is-closed',
                esc_url(dzhome2_store_url($slug)),
                esc_url($logoUrl),
                esc_attr($name),
                esc_html($name),
                esc_attr($schedule['statusClass']),
                esc_html($schedule['statusLabel']),
                esc_html($category),
                esc_html($address),
                $count,
                $count === 1 ? '' : 's',
                $ratingVisible ? '<span class="dz-home2-rating-chip">' . $ratingMarkup . '<span class="dz-home2-rating-text">' . esc_html($ratingText) . '</span></span>' : '',
                esc_html($featuredLine)
            );
        }

        return implode('', $html);
    }
}

if (!function_exists('dzhome2_render_restaurants_block')) {
    function dzhome2_render_restaurants_block($data = [])
    {
        $featured = isset($data['featuredStores']) && is_array($data['featuredStores']) ? $data['featuredStores'] : [];
        $freeDelivery = isset($data['freeDeliveryStores']) && is_array($data['freeDeliveryStores']) ? $data['freeDeliveryStores'] : [];
        $promo = isset($data['promoStores']) && is_array($data['promoStores']) ? $data['promoStores'] : [];
        $restaurants = isset($data['restaurants']) && is_array($data['restaurants']) ? $data['restaurants'] : [];
        $total = isset($data['total']) ? absint($data['total']) : count($restaurants);

        ob_start();
    ?>
        <section class="dz-home2-catalog dz-home2-catalog-standalone" data-dz-home2-restaurants>
            <div class="dz-home2-catalog-head">
                <div>
                    <h2>Restaurantes</h2>
                    <p><?php echo esc_html($total > 0 ? ($total === 1 ? '1 restaurante disponÃ­vel' : sprintf('%d restaurantes disponÃ­veis', $total)) : 'Nenhum restaurante encontrado.'); ?></p>
                </div>
                <span class="dz-home2-catalog-count"><?php echo esc_html((string) $total); ?></span>
            </div>

            <?php echo dzhome2_render_store_rail_section('Destaques', $featured, '', 'featured', empty($featured)); ?>
            <?php echo dzhome2_render_store_rail_section('Frete grÃ¡tis', $freeDelivery, '', 'freeDelivery', empty($freeDelivery)); ?>
            <?php echo dzhome2_render_store_rail_section('Em promoÃ§Ã£o', $promo, '', 'promo', empty($promo)); ?>

            <div class="dz-home2-restaurants-grid">
                <?php echo dzhome2_render_restaurant_cards($restaurants); ?>
            </div>
        </section>
    <?php
        return trim(ob_get_clean());
    }
}

if (!function_exists('dzhome2_render_item_list_schema')) {
    function dzhome2_render_item_list_schema($restaurants = [])
    {
        if (empty($restaurants) || !is_array($restaurants)) {
            return '';
        }

        $items = [];
        foreach (array_values($restaurants) as $index => $store) {
            $name = isset($store['name']) ? (string) $store['name'] : 'Restaurante';
            $slug = isset($store['slug']) ? (string) $store['slug'] : '';
            $image = !empty($store['logoUrl']) ? (string) $store['logoUrl'] : '';
            $category = isset($store['category']) ? (string) $store['category'] : '';
            $address = !empty($store['address']) ? (string) $store['address'] : '';

            $restaurant = [
                '@type' => 'Restaurant',
                'name' => $name,
                'url' => dzhome2_store_url($slug)
            ];

            if ($image !== '') {
                $restaurant['image'] = $image;
            }
            if ($category !== '') {
                $restaurant['servesCuisine'] = $category;
            }
            if ($address !== '') {
                $restaurant['address'] = [
                    '@type' => 'PostalAddress',
                    'streetAddress' => $address
                ];
            }

            $items[] = [
                '@type' => 'ListItem',
                'position' => $index + 1,
                'name' => $name,
                'url' => dzhome2_store_url($slug),
                'item' => $restaurant
            ];
        }

        return wp_json_encode([
            '@context' => 'https://schema.org',
            '@type' => 'ItemList',
            'itemListElement' => $items
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
}

if (!function_exists('dzhome2_render_directory_skeleton')) {
    function dzhome2_render_directory_skeleton($context = 'home')
    {
        $context = in_array($context, ['home', 'restaurants'], true) ? $context : 'home';

        ob_start();
    ?>
        <div class="dz-home2-skeleton" data-home2-skeleton aria-hidden="true">
            <div class="dz-home2-skeleton-inner">
                <div class="dz-home2-skeleton-hero">
                    <?php if ($context === 'restaurants') : ?>
                        <div class="dz-home2-skeleton-back"></div>
                        <div class="dz-home2-skeleton-title"></div>
                        <div class="dz-home2-skeleton-line dz-home2-skeleton-line-sm"></div>
                    <?php else : ?>
                        <div class="dz-home2-skeleton-pill"></div>
                        <div class="dz-home2-skeleton-title dz-home2-skeleton-title-lg"></div>
                        <div class="dz-home2-skeleton-line"></div>
                    <?php endif; ?>

                    <div class="dz-home2-skeleton-search">
                        <div class="dz-home2-skeleton-search-input"></div>
                        <div class="dz-home2-skeleton-search-button"></div>
                    </div>
                </div>

                <?php if ($context === 'home') : ?>
                    <div class="dz-home2-skeleton-row dz-home2-skeleton-chips">
                        <?php for ($i = 0; $i < 4; $i++) : ?>
                            <div class="dz-home2-skeleton-chip"></div>
                        <?php endfor; ?>
                    </div>
                <?php endif; ?>

                <div class="dz-home2-skeleton-section">
                    <div class="dz-home2-skeleton-section-head"></div>
                    <div class="dz-home2-skeleton-cards">
                        <?php for ($i = 0; $i < ($context === 'restaurants' ? 3 : 4); $i++) : ?>
                            <div class="dz-home2-skeleton-card">
                                <div class="dz-home2-skeleton-card-media"></div>
                                <div class="dz-home2-skeleton-card-copy">
                                    <div class="dz-home2-skeleton-line dz-home2-skeleton-line-md"></div>
                                    <div class="dz-home2-skeleton-line dz-home2-skeleton-line-sm"></div>
                                    <div class="dz-home2-skeleton-line dz-home2-skeleton-line-xs"></div>
                                </div>
                            </div>
                        <?php endfor; ?>
                    </div>
                </div>
            </div>
        </div>
<?php
        return trim((string) ob_get_clean());
    }
}

if (!function_exists('dzhome2_hero_artwork_url')) {
    function dzhome2_hero_artwork_url()
    {
        $svg = <<<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720" viewBox="0 0 960 720" fill="none">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ecfdf5"/>
      <stop offset="100%" stop-color="#f8fafc"/>
    </linearGradient>
    <linearGradient id="device" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#e2e8f0"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#22c55e"/>
      <stop offset="100%" stop-color="#16a34a"/>
    </linearGradient>
  </defs>
  <rect width="960" height="720" rx="56" fill="url(#bg)"/>
  <circle cx="760" cy="130" r="110" fill="rgba(34,197,94,0.12)"/>
  <circle cx="170" cy="560" r="140" fill="rgba(34,197,94,0.08)"/>
  <rect x="284" y="108" width="392" height="504" rx="42" fill="url(#device)" stroke="rgba(15,23,42,0.08)" stroke-width="2"/>
  <rect x="318" y="144" width="324" height="22" rx="11" fill="rgba(15,23,42,0.10)"/>
  <rect x="318" y="186" width="210" height="18" rx="9" fill="rgba(15,23,42,0.07)"/>
  <rect x="318" y="240" width="324" height="124" rx="28" fill="url(#accent)"/>
  <circle cx="394" cy="302" r="42" fill="rgba(255,255,255,0.18)"/>
  <rect x="470" y="270" width="128" height="20" rx="10" fill="rgba(255,255,255,0.92)"/>
  <rect x="470" y="304" width="84" height="14" rx="7" fill="rgba(255,255,255,0.72)"/>
  <rect x="318" y="388" width="324" height="26" rx="13" fill="rgba(15,23,42,0.08)"/>
  <rect x="318" y="430" width="236" height="18" rx="9" fill="rgba(15,23,42,0.06)"/>
  <rect x="318" y="462" width="268" height="18" rx="9" fill="rgba(15,23,42,0.06)"/>
  <rect x="318" y="504" width="152" height="46" rx="23" fill="#22c55e"/>
  <rect x="486" y="504" width="156" height="46" rx="23" fill="rgba(15,23,42,0.06)"/>
</svg>
SVG;

        return 'data:image/svg+xml;charset=UTF-8,' . rawurlencode(trim($svg));
    }
}

if (!function_exists('dzhome2_restaurants_hero_artwork_url')) {
    function dzhome2_restaurants_hero_artwork_url()
    {
        $svg = <<<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720" viewBox="0 0 960 720" fill="none">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f0fdf4"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>
    <linearGradient id="plate" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#f1f5f9"/>
    </linearGradient>
    <linearGradient id="green" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#86efac"/>
      <stop offset="100%" stop-color="#16a34a"/>
    </linearGradient>
  </defs>
  <rect width="960" height="720" rx="56" fill="url(#bg)"/>
  <circle cx="770" cy="160" r="120" fill="rgba(34,197,94,0.10)"/>
  <circle cx="160" cy="540" r="150" fill="rgba(34,197,94,0.08)"/>
  <rect x="154" y="172" width="652" height="388" rx="44" fill="url(#plate)" stroke="rgba(15,23,42,0.08)" stroke-width="2"/>
  <rect x="206" y="224" width="180" height="20" rx="10" fill="rgba(15,23,42,0.08)"/>
  <rect x="206" y="260" width="300" height="18" rx="9" fill="rgba(15,23,42,0.06)"/>
  <rect x="206" y="314" width="548" height="186" rx="32" fill="url(#green)"/>
  <circle cx="356" cy="408" r="72" fill="rgba(255,255,255,0.20)"/>
  <circle cx="520" cy="382" r="48" fill="rgba(255,255,255,0.18)"/>
  <circle cx="610" cy="442" r="36" fill="rgba(255,255,255,0.22)"/>
  <rect x="206" y="530" width="180" height="18" rx="9" fill="rgba(15,23,42,0.08)"/>
  <rect x="402" y="530" width="210" height="18" rx="9" fill="rgba(15,23,42,0.06)"/>
</svg>
SVG;

        return 'data:image/svg+xml;charset=UTF-8,' . rawurlencode(trim($svg));
    }
}

if (!function_exists('dzhome2_short_address')) {
    function dzhome2_short_address($address)
    {
        $address = trim((string) $address);
        if ($address === '') {
            return ['', ''];
        }

        $parts = array_values(array_filter(array_map('trim', preg_split('/[,|\\-]/u', $address) ?: [])));
        $street = trim((string) ($parts[0] ?? $address));
        $street = trim(preg_replace('/\\b\\d+[A-Za-z]?\\b/u', '', $street));
        $street = preg_replace('/\\s+/', ' ', $street);

        $number = '';
        if (preg_match('/\\b\\d+[A-Za-z]?\\b/u', $address, $match)) {
            $number = $match[0];
        }

        $streetMap = [
            'travessa' => 'Tv.',
            'avenida' => 'Av.',
            'rua' => 'R.',
            'estrada' => 'Est.',
            'alameda' => 'Al.',
            'rodovia' => 'Rod.',
            'praÃ§a' => 'PÃ§.',
            'praca' => 'PÃ§.',
            'viela' => 'Vl.',
            'beco' => 'Bc.',
            'ladeira' => 'Ld.',
            'conjunto' => 'Cj.',
            'loteamento' => 'Lot.'
        ];

        $tokens = preg_split('/\\s+/u', trim($street)) ?: [];
        $tokens = array_values(array_filter($tokens, static fn($token) => $token !== ''));

        $prefix = '';
        if (!empty($tokens)) {
            $firstToken = mb_strtolower($tokens[0]);
            if (isset($streetMap[$firstToken])) {
                $prefix = $streetMap[$firstToken];
                array_shift($tokens);
            }
        }

        $labelParts = [];
        if ($prefix !== '') {
            $labelParts[] = $prefix;
        }

        if (!empty($tokens)) {
            $labelParts[] = mb_convert_case($tokens[0], MB_CASE_TITLE, 'UTF-8');
            if (isset($tokens[1]) && $tokens[1] !== '') {
                $labelParts[] = mb_strtoupper(mb_substr($tokens[1], 0, 1), 'UTF-8');
            }
        } elseif ($street !== '') {
            $labelParts[] = mb_convert_case($street, MB_CASE_TITLE, 'UTF-8');
        }

        $line1 = trim(implode(' ', $labelParts));
        if ($line1 === '') {
            $line1 = $address;
        }
        if ($number !== '') {
            $line1 .= ', ' . $number;
        }
        if (function_exists('mb_strlen')) {
            if (mb_strlen($line1) > 16) {
                $line1 = mb_substr($line1, 0, 16);
                $line1 = rtrim($line1, " ,.-");
            }
        } elseif (strlen($line1) > 16) {
            $line1 = substr($line1, 0, 16);
            $line1 = rtrim($line1, " ,.-");
        }

        $line2Parts = array_slice($parts, 1);
        $line2Parts = array_values(array_filter($line2Parts, static function ($part) {
            $normalized = strtolower(trim((string) $part));
            if ($normalized === '') {
                return false;
            }
            if ($normalized === 'brasil' || $normalized === 'brazil') {
                return false;
            }
            if (preg_match('/^\\d+$/', $normalized)) {
                return false;
            }
            if (preg_match('/^\\d{5,}$/', $normalized)) {
                return false;
            }
            return true;
        }));
        $second = implode(' - ', array_slice($line2Parts, 0, 3));

        return [$line1, $second];
    }
}

if (!function_exists('dzhome2_maps_key')) {
    function dzhome2_maps_key($fallback = '')
    {
        $option = trim((string) get_option('menzzu_maps_key', ''));
        if ($option === '') {
            $option = trim((string) get_option('hotwhats_home2_maps_key', ''));
        }
        if ($option !== '') {
            return $option;
        }

        return trim((string) $fallback);
    }
}

if (!function_exists('dzhome2_blog_url')) {
    function dzhome2_blog_url()
    {
        $page = get_option('page_for_posts');
        if ($page) {
            $url = get_permalink($page);
            if ($url) {
                return $url;
            }
        }

        return home_url('/blog/');
    }
}

add_action('elementor/query/jornada_vender_mais', function ($query) {

    $query->set('meta_query', [
        [
            'key'     => 'nivel_da_jornada',
            'value'   => 'Vender mais',
            'compare' => '=',
        ],
    ]);
});

add_action('elementor/query/jornada_automatizar_atendimento', function ($query) {

    $query->set('meta_query', [
        [
            'key'     => 'nivel_da_jornada',
            'value'   => 'Automatizar atendimento',
            'compare' => '=',
        ],
    ]);
});

add_action('elementor/query/jornada_conhecer_ferramentas', function ($query) {

    $query->set('meta_query', [
        [
            'key'     => 'nivel_da_jornada',
            'value'   => 'Conhecer ferramentas',
            'compare' => '=',
        ],
    ]);
});

