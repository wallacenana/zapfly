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
        wp_add_inline_style('digizap-home-2', dzhome2_critical_css());

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

if (!function_exists('dzhome2_critical_css')) {
    function dzhome2_critical_css()
    {
        return <<<CSS
.dz-home2{width:100%;color:#20181a;font-family:inherit}
.dz-home2-header{position:sticky;top:0;z-index:50;width:100%;display:grid;grid-template-columns:auto 1fr auto;gap:18px;align-items:center;padding:18px 24px;background:rgba(255,255,255,.92);backdrop-filter:blur(16px);border-bottom:1px solid rgba(32,24,26,.08)}
.dz-home2-brand-link{display:inline-flex;align-items:center;gap:12px;text-decoration:none;color:inherit}
.dz-home2-brand-mark{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;background:linear-gradient(135deg,#e21b3c,#ff6d8a);color:#fff;font-weight:900;box-shadow:0 10px 24px rgba(226,27,60,.22)}
.dz-home2-brand-logo{width:auto;height:44px;display:block;object-fit:contain}
.dz-home2-brand-name{font-weight:900;font-size:1rem;white-space:nowrap}
.dz-home2-nav{display:flex;align-items:center;gap:18px;justify-content:center;min-width:0;overflow-x:auto;scrollbar-width:none}
.dz-home2-nav::-webkit-scrollbar{display:none}
.dz-home2-nav a{display:inline-flex;text-decoration:none;color:#6f6567;font-weight:800;padding:8px 10px;border-radius:999px;white-space:nowrap}
.dz-home2-header-actions{display:inline-flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}
.dz-home2-main{width:min(1240px,calc(100% - 32px));margin:0 auto;padding:22px 0 28px}
.dz-home2-landing-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:24px;align-items:stretch;min-height:430px}
.dz-home2-landing-copy{display:grid;align-content:center;gap:18px;padding:12px 0}
.dz-home2-landing-copy h1{margin:0;font-size:clamp(2.2rem,4vw,4.2rem);line-height:.98;letter-spacing:-.04em}
.dz-home2-landing-copy p{margin:0;max-width:54ch;color:#6f6567;font-size:1.02rem;line-height:1.55}
.dz-home2-address-form{display:flex;align-items:center;gap:10px;max-width:680px;margin-top:8px}
.dz-home2-address-form input{flex:1 1 auto;width:100%;min-height:56px;border-radius:18px;border:1px solid rgba(32,24,26,.12);padding:0 18px;background:#fff;font:inherit;outline:none;box-shadow:0 10px 24px rgba(23,15,17,.05)}
.dz-home2-address-form input:focus{border-color:rgba(226,27,60,.35);box-shadow:0 0 0 4px rgba(226,27,60,.1)}
.dz-home2-landing-visual{position:relative;border-radius:32px;overflow:hidden;background:radial-gradient(circle at 20% 20%,rgba(255,255,255,.26),transparent 18%),radial-gradient(circle at 80% 20%,rgba(255,255,255,.14),transparent 16%),linear-gradient(160deg,#111 0%,#1b1b1b 40%,#e21b3c 100%);box-shadow:0 22px 52px rgba(18,18,18,.12);min-height:430px}
.dz-home2-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:.78rem 1rem;border-radius:999px;border:0;cursor:pointer;font-weight:900;text-decoration:none;white-space:nowrap}
.dz-home2-button-primary{background:#e21b3c;color:#fff;box-shadow:0 10px 24px rgba(226,27,60,.22)}
.dz-home2-button-ghost{background:#fff;color:#20181a;border:1px solid rgba(32,24,26,.1)}
.dz-home2-button:disabled{opacity:.42;cursor:not-allowed;transform:none;box-shadow:none;background:#f5f5f5;color:#a3a3a3;border:1px solid rgba(32,24,26,.08)}
.dz-home2-search,.dz-home2-location-pill{display:flex;align-items:center;border:1px solid rgba(32,24,26,.1);background:#fff}
.dz-home2-search{gap:10px;min-height:46px;min-width:min(420px,42vw);padding:0 14px;border-radius:16px}
.dz-home2-location-pill{display:grid;gap:2px;min-height:46px;min-width:220px;padding:8px 14px;border-radius:16px;text-align:left;cursor:pointer;color:#20181a}
.dz-home2-address-hint{margin:-2px 0 0;min-height:1.1em;color:#6f6567;font-size:.84rem;line-height:1.35}
.pac-container{margin-top:10px!important;border:1px solid rgba(32,24,26,.08)!important;border-radius:22px!important;box-shadow:0 24px 60px rgba(18,18,18,.12)!important;overflow:hidden!important;font-family:inherit!important;z-index:99999!important;background:#fff}
.pac-item{position:relative;display:flex!important;align-items:flex-start!important;gap:12px;padding:14px 16px 14px 14px!important;border-top:0!important;border-bottom:1px solid rgba(32,24,26,.06);line-height:1.35!important;cursor:pointer;background:#fff}
.pac-item:last-child{border-bottom:0!important}
.pac-item:hover,.pac-item.pac-item-selected{background:rgba(226,27,60,.05)!important;box-shadow:inset 3px 0 0 #e21b3c}
.pac-item-query{display:block;margin-bottom:1px;color:#20181a!important;font-size:.95rem!important;font-weight:700!important}
.pac-item>span:last-child{display:block;color:#8b8b8b!important;font-size:.82rem!important;line-height:1.2!important;font-weight:500!important}
.pac-matched{color:#e21b3c!important;font-weight:800!important}
.pac-icon{flex:0 0 18px;width:18px;height:18px;margin:2px 0 0!important;opacity:.72!important;background-size:18px 18px!important}
.pac-logo{margin:10px 14px 12px auto!important;opacity:.7!important}
.dz-home2[data-mode="landing"] [data-app-actions],.dz-home2[data-mode="app"] [data-guest-actions],.dz-home2[data-mode="landing"] [data-catalog],.dz-home2[data-mode="app"] [data-landing]{display:none!important}
@media (max-width:1024px){.dz-home2-header{grid-template-columns:1fr;justify-items:stretch}.dz-home2-nav,.dz-home2-header-actions{justify-content:flex-start}.dz-home2-landing-grid{grid-template-columns:1fr}.dz-home2-landing-visual{min-height:260px}}
@media (max-width:720px){.dz-home2-main{width:min(100%,calc(100% - 18px))}.dz-home2-header{padding:14px 12px}.dz-home2-address-form{flex-direction:column;align-items:stretch}.dz-home2-address-form .dz-home2-button{width:100%}.dz-home2-search{min-width:100%;width:100%}.dz-home2-location-pill{width:100%;min-width:0}.dz-home2-catalog-head{align-items:flex-start;flex-direction:column}.dz-home2-restaurants-grid{grid-template-columns:1fr}.dz-home2-featured-card{flex-basis:min(320px,86vw)}}
CSS;
    }
}

if (!function_exists('dzhome2_style_loader_tag')) {
    function dzhome2_style_loader_tag($html, $handle, $href, $media)
    {
        if ($handle !== 'digizap-home-2') {
            return $html;
        }

        $href = esc_url($href);
        return "<link rel=\"preload\" as=\"style\" href=\"{$href}\" onload=\"this.onload=null;this.rel='stylesheet'\" media=\"print\" />\n<noscript><link rel=\"stylesheet\" href=\"{$href}\" media=\"all\" /></noscript>";
    }
    add_filter('style_loader_tag', 'dzhome2_style_loader_tag', 10, 4);
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

if (!function_exists('dzhome2_fetch_directory_data')) {
    function dzhome2_fetch_directory_data($search = '', $limit = 18)
    {
        $args = [
            'search' => sanitize_text_field((string) $search),
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

        $parts = array_values(array_filter(array_map('trim', preg_split('/[,|\\-]/', $address) ?: [])));
        $first = $parts[0] ?? $address;
        $second = $parts[1] ?? '';

        if ($second === '') {
            if (preg_match('/\\b\\d+[A-Za-z]?\\b/', $address, $match)) {
                $second = 'Nº ' . $match[0];
            }
        }

        return [$first, $second];
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
