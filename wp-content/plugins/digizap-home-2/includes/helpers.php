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
        return untrailingslashit((string) apply_filters('digizap_home2_api_base', 'https://api.digizap.com.br'));
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

        wp_enqueue_style('digizap-home-2', dzhome2_asset_url($style_rel), [], dzhome2_asset_version($style_rel));
        wp_enqueue_script('digizap-home-2', dzhome2_asset_url($script_rel), [], dzhome2_asset_version($script_rel), true);

        wp_localize_script('digizap-home-2', 'dzHome2Config', [
            'apiBase' => dzhome2_api_base(),
            'homeUrl' => home_url('/'),
            'loginUrl' => wp_login_url(home_url('/')),
            'registerUrl' => wp_registration_url(),
            'blogUrl' => dzhome2_blog_url(),
            'storageKey' => 'dz_home2_address',
            'searchLabel' => 'Buscar loja ou item',
            'continueLabel' => 'Continuar',
            'editLabel' => 'Alterar endereço',
            'addressPlaceholder' => 'Digite seu endereço completo',
        ]);

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

if (!function_exists('dzhome2_placeholder_logo')) {
    function dzhome2_placeholder_logo($name, $accent = '#e11d48')
    {
        $words = preg_split('/\s+/', trim((string) $name)) ?: [];
        $words = array_values(array_filter($words, static fn($word) => $word !== ''));
        if (count($words) === 0) {
            $initials = 'DZ';
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

if (!function_exists('dzhome2_store_url')) {
    function dzhome2_store_url($slug)
    {
        $slug = sanitize_title((string) $slug);
        return $slug !== '' ? home_url('/' . $slug . '/') : home_url('/');
    }
}

if (!function_exists('dzhome2_escape_attr')) {
    function dzhome2_escape_attr($value)
    {
        return esc_attr((string) $value);
    }
}

if (!function_exists('dzhome2_read_address_cookie')) {
    function dzhome2_read_address_cookie($key = 'dz_home2_address')
    {
        $raw = isset($_COOKIE[$key]) ? wp_unslash((string) $_COOKIE[$key]) : '';

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

        $cache_key = 'dzhome2_' . md5(wp_json_encode($args));
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
        foreach (array_slice($restaurants, 0, 8) as $store) {
            $name = isset($store['name']) ? (string) $store['name'] : 'Restaurante';
            $slug = isset($store['slug']) ? (string) $store['slug'] : '';
            $category = isset($store['category']) ? (string) $store['category'] : '';
            $logoUrl = !empty($store['logoUrl']) ? (string) $store['logoUrl'] : dzhome2_placeholder_logo($name, $store['accentColor'] ?? '#e11d48');

            $html[] = sprintf(
                '<a class="dz-home2-featured-card" href="%s">
                    <span class="dz-home2-featured-media"><img src="%s" alt="%s" loading="lazy" decoding="async"></span>
                    <span class="dz-home2-featured-copy">
                        <strong>%s</strong>
                        <small>%s</small>
                    </span>
                </a>',
                esc_url(dzhome2_store_url($slug)),
                esc_url($logoUrl),
                esc_attr($name),
                esc_html($name),
                esc_html($category)
            );
        }

        return implode('', $html);
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
            $address = !empty($store['address']) ? (string) $store['address'] : 'Endereco nao informado';
            $logoUrl = !empty($store['logoUrl']) ? (string) $store['logoUrl'] : dzhome2_placeholder_logo($name, $store['accentColor'] ?? '#e11d48');
            $featuredLine = !empty($store['featuredProducts'])
                ? implode(' · ', array_map(static fn($item) => isset($item['name']) ? (string) $item['name'] : '', $store['featuredProducts']))
                : 'Sem destaques cadastrados';
            $isOpen = !empty($store['acceptOrders']);
            $count = isset($store['productsCount']) ? absint($store['productsCount']) : 0;

            $html[] = sprintf(
                '<article class="dz-home2-restaurant-card">
                    <a class="dz-home2-restaurant-link" href="%s">
                        <span class="dz-home2-restaurant-media"><img src="%s" alt="%s" loading="lazy" decoding="async"></span>
                        <span class="dz-home2-restaurant-body">
                            <span class="dz-home2-restaurant-head">
                                <strong>%s</strong>
                                <span class="dz-home2-restaurant-status %s">%s</span>
                            </span>
                            <span class="dz-home2-restaurant-category">%s</span>
                            <span class="dz-home2-restaurant-address">%s</span>
                            <span class="dz-home2-restaurant-meta">%d item%s · %s</span>
                        </span>
                    </a>
                </article>',
                esc_url(dzhome2_store_url($slug)),
                esc_url($logoUrl),
                esc_attr($name),
                esc_html($name),
                $isOpen ? 'open' : 'closed',
                $isOpen ? 'Aberto' : 'Fechado',
                esc_html($category),
                esc_html($address),
                $count,
                $count === 1 ? '' : 's',
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
        $restaurants = isset($data['restaurants']) && is_array($data['restaurants']) ? $data['restaurants'] : [];
        $total = isset($data['total']) ? absint($data['total']) : count($restaurants);

        ob_start();
        ?>
        <section class="dz-home2-catalog dz-home2-catalog-standalone" data-dz-home2-restaurants>
            <div class="dz-home2-catalog-head">
                <div>
                    <h2>Restaurantes</h2>
                    <p><?php echo esc_html($total > 0 ? ($total === 1 ? '1 restaurante disponível' : sprintf('%d restaurantes disponíveis', $total)) : 'Nenhum restaurante encontrado.'); ?></p>
                </div>
                <span class="dz-home2-catalog-count"><?php echo esc_html((string) $total); ?></span>
            </div>

            <div class="dz-home2-featured-track">
                <?php echo dzhome2_render_featured_cards($featured); ?>
            </div>

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
            'praça' => 'Pç.',
            'praca' => 'Pç.',
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
        $option = trim((string) get_option('digizap_home2_maps_key', ''));
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
