<?php

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('dzhome2_blog_views_table_name')) {
    function dzhome2_blog_views_table_name()
    {
        global $wpdb;

        return $wpdb->prefix . 'dz_home2_post_views';
    }
}

if (!function_exists('dzhome2_blog_schema_version')) {
    function dzhome2_blog_schema_version()
    {
        return '1.0.0';
    }
}

if (!function_exists('dzhome2_blog_install_schema')) {
    function dzhome2_blog_install_schema()
    {
        global $wpdb;

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';

        $table = dzhome2_blog_views_table_name();
        $charset = $wpdb->get_charset_collate();

        $sql = "CREATE TABLE {$table} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            post_id bigint(20) unsigned NOT NULL,
            view_date date NOT NULL,
            views bigint(20) unsigned NOT NULL DEFAULT 0,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY post_day (post_id, view_date),
            KEY view_date (view_date),
            KEY post_id (post_id)
        ) {$charset};";

        dbDelta($sql);
        update_option('dz_home2_blog_schema_version', dzhome2_blog_schema_version(), false);
    }
}

if (!function_exists('dzhome2_blog_maybe_install_schema')) {
    function dzhome2_blog_maybe_install_schema()
    {
        if (get_option('dz_home2_blog_schema_version') !== dzhome2_blog_schema_version()) {
            dzhome2_blog_install_schema();
        }
    }
}

if (!function_exists('dzhome2_blog_safe_cookie_path')) {
    function dzhome2_blog_safe_cookie_path()
    {
        if (defined('COOKIEPATH') && COOKIEPATH !== '') {
            return COOKIEPATH;
        }

        return '/';
    }
}

if (!function_exists('dzhome2_blog_safe_cookie_domain')) {
    function dzhome2_blog_safe_cookie_domain()
    {
        if (defined('COOKIE_DOMAIN')) {
            return COOKIE_DOMAIN;
        }

        return '';
    }
}

if (!function_exists('dzhome2_blog_record_view')) {
    function dzhome2_blog_record_view($post_id)
    {
        global $wpdb;

        $post_id = absint($post_id);
        if ($post_id < 1) {
            return false;
        }

        $table = dzhome2_blog_views_table_name();
        $today = current_time('Y-m-d');
        $now = current_time('mysql');

        return (bool) $wpdb->query(
            $wpdb->prepare(
                "INSERT INTO {$table} (post_id, view_date, views, updated_at)
                 VALUES (%d, %s, 1, %s)
                 ON DUPLICATE KEY UPDATE views = views + 1, updated_at = VALUES(updated_at)",
                $post_id,
                $today,
                $now
            )
        );
    }
}

if (!function_exists('dzhome2_blog_track_post_view')) {
    function dzhome2_blog_track_post_view()
    {
        if (is_admin() || wp_doing_ajax() || (function_exists('wp_is_json_request') && wp_is_json_request()) || is_feed() || is_preview()) {
            return;
        }

        if (!is_singular('post')) {
            return;
        }

        $post_id = get_queried_object_id();
        if (!$post_id) {
            return;
        }

        $cookie_name = 'dz_home2_post_view_' . $post_id;
        $today = current_time('Ymd');

        if (!empty($_COOKIE[$cookie_name]) && (string) $_COOKIE[$cookie_name] === $today) {
            return;
        }

        dzhome2_blog_record_view($post_id);

        if (!headers_sent()) {
            setcookie(
                $cookie_name,
                $today,
                time() + DAY_IN_SECONDS,
                dzhome2_blog_safe_cookie_path(),
                dzhome2_blog_safe_cookie_domain(),
                is_ssl(),
                true
            );
        }

        $_COOKIE[$cookie_name] = $today;
    }
}

if (!function_exists('dzhome2_blog_get_post_excerpt')) {
    function dzhome2_blog_get_post_excerpt($post_id, $length = 22)
    {
        $post_id = absint($post_id);
        $length = max(8, min(absint($length), 80));

        $excerpt = get_the_excerpt($post_id);
        if (trim((string) $excerpt) === '') {
            $content = get_post_field('post_content', $post_id);
            $excerpt = wp_trim_words(wp_strip_all_tags((string) $content), $length, '...');
        }

        return trim((string) $excerpt);
    }
}

if (!function_exists('dzhome2_blog_get_reading_time_minutes')) {
    function dzhome2_blog_get_reading_time_minutes($post_id, $words_per_minute = 200)
    {
        $post_id = absint($post_id);
        $words_per_minute = max(50, absint($words_per_minute));

        $content = (string) get_post_field('post_content', $post_id);
        $content = wp_strip_all_tags($content);
        $content = trim(preg_replace('/\s+/u', ' ', $content));

        if ($content === '') {
            return 1;
        }

        $words = preg_split('/\s+/u', $content, -1, PREG_SPLIT_NO_EMPTY);
        $count = is_array($words) ? count($words) : 0;

        return max(1, (int) ceil($count / $words_per_minute));
    }
}

if (!function_exists('dzhome2_blog_get_primary_category_label')) {
    function dzhome2_blog_get_primary_category_label($post_id)
    {
        $post_id = absint($post_id);
        if ($post_id < 1) {
            return '';
        }

        $categories = get_the_category($post_id);
        if (empty($categories) || !is_array($categories)) {
            return '';
        }

        $fallback = '';
        foreach ($categories as $category) {
            if (empty($category->name)) {
                continue;
            }

            $name = trim((string) $category->name);
            if ($name === '') {
                continue;
            }

            if (dzhome2_normalize_text($name) !== 'uncategorized') {
                return $name;
            }

            $fallback = $name;
        }

        return $fallback;
    }
}

if (!function_exists('dzhome2_blog_placeholder_image')) {
    function dzhome2_blog_placeholder_image($title)
    {
        $title = trim((string) $title);
        $words = preg_split('/\s+/', $title) ?: [];
        $words = array_values(array_filter($words, static function ($word) {
            return trim((string) $word) !== '';
        }));
        $initial = 'D';
        if (count($words) > 0) {
            $initial = mb_strtoupper(mb_substr($words[0], 0, 1));
        }

        $svg = '
            <svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">
                <defs>
                    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stop-color="#2dbd30"/>
                        <stop offset="100%" stop-color="#111827"/>
                    </linearGradient>
                </defs>
                <rect width="640" height="420" rx="36" fill="url(#g)"/>
                <circle cx="320" cy="210" r="108" fill="rgba(255,255,255,0.12)"/>
                <text x="320" y="242" text-anchor="middle" font-family="Arial, sans-serif" font-size="140" font-weight="800" fill="#fff">' . esc_html($initial) . '</text>
            </svg>
        ';

        return 'data:image/svg+xml;charset=UTF-8,' . rawurlencode(trim($svg));
    }
}

if (!function_exists('dzhome2_blog_get_post_card_data')) {
    function dzhome2_blog_get_post_card_data($post_id, $views = 0)
    {
        $post_id = absint($post_id);
        $post = get_post($post_id);

        if (!$post || $post->post_status !== 'publish' || $post->post_type !== 'post') {
            return null;
        }

        $title = get_the_title($post_id);
        $url = get_permalink($post_id);
        $image = get_the_post_thumbnail_url($post_id, 'medium_large');
        $reading_time = dzhome2_blog_get_reading_time_minutes($post_id);
        if (!$image) {
            $image = dzhome2_blog_placeholder_image($title);
        }

        return [
            'id' => $post_id,
            'title' => html_entity_decode(wp_strip_all_tags((string) $title), ENT_QUOTES, 'UTF-8'),
            'excerpt' => dzhome2_blog_get_post_excerpt($post_id, 22),
            'url' => $url,
            'image' => $image,
            'views' => absint($views),
            'readingTime' => $reading_time,
            'readingTimeLabel' => sprintf('%d min de leitura', $reading_time),
            'date' => get_the_date('', $post_id),
            'dateHuman' => get_the_date('j \d\e F \d\e Y', $post_id),
            'categoryLabel' => dzhome2_blog_get_primary_category_label($post_id),
        ];
    }
}

if (!function_exists('dzhome2_blog_get_popular_posts')) {
    function dzhome2_blog_get_popular_posts($days = 30, $limit = 6)
    {
        global $wpdb;

        $days = max(1, min(absint($days), 365));
        $limit = max(1, min(absint($limit), 24));
        $table = dzhome2_blog_views_table_name();
        $since = date('Y-m-d', strtotime('-' . max(0, $days - 1) . ' days', current_time('timestamp')));

        $rows = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT post_id, SUM(views) AS total_views
                 FROM {$table}
                 WHERE view_date >= %s
                 GROUP BY post_id
                 ORDER BY total_views DESC
                 LIMIT %d",
                $since,
                $limit
            ),
            ARRAY_A
        );

        $items = [];
        if (!empty($rows)) {
            foreach ($rows as $row) {
                $card = dzhome2_blog_get_post_card_data($row['post_id'] ?? 0, $row['total_views'] ?? 0);
                if ($card) {
                    $items[] = $card;
                }
            }
        }

        if (!empty($items)) {
            return $items;
        }

        $fallback = get_posts([
            'post_type' => 'post',
            'post_status' => 'publish',
            'posts_per_page' => $limit,
            'orderby' => 'date',
            'order' => 'DESC',
            'fields' => 'ids',
            'no_found_rows' => true,
            'ignore_sticky_posts' => true,
        ]);

        foreach ($fallback as $fallback_id) {
            $card = dzhome2_blog_get_post_card_data($fallback_id, 0);
            if ($card) {
                $items[] = $card;
            }
        }

        return array_slice($items, 0, $limit);
    }
}

if (!function_exists('dzhome2_blog_get_next_post_card')) {
    function dzhome2_blog_get_next_post_card($post_id)
    {
        global $wpdb;

        $post_id = absint($post_id);
        if ($post_id < 1) {
            return null;
        }

        $next_id = (int) $wpdb->get_var(
            $wpdb->prepare(
                "SELECT ID
                 FROM {$wpdb->posts}
                 WHERE post_type = %s
                   AND post_status = %s
                   AND ID > %d
                 ORDER BY ID ASC
                 LIMIT 1",
                'post',
                'publish',
                $post_id
            )
        );

        if ($next_id > 0) {
            return dzhome2_blog_get_post_card_data($next_id, 0);
        }

        return dzhome2_blog_get_post_card_data($post_id, 0);
    }
}

if (!function_exists('dzhome2_blog_get_continue_recommendation')) {
    function dzhome2_blog_get_continue_recommendation($post_id, $progress = 0)
    {
        $post_id = absint($post_id);
        $progress = max(0, min(100, absint($progress)));

        $mode = 'continue';
        $card = dzhome2_blog_get_post_card_data($post_id, 0);

        if ($progress >= 70) {
            $nextCard = dzhome2_blog_get_next_post_card($post_id);
            if ($nextCard) {
                $card = $nextCard;
                $mode = 'next';
            }
        }

        if (!$card) {
            $popular = dzhome2_blog_get_popular_posts(30, 1);
            $card = $popular[0] ?? null;
            $mode = 'popular';
        }

        $badgeLabel = '';
        if ($mode === 'next') {
            $badgeLabel = 'Destaque';
        } elseif ($progress > 0) {
            $badgeLabel = 'Continue lendo';
        } elseif (!empty($card['categoryLabel'])) {
            $badgeLabel = (string) $card['categoryLabel'];
        } else {
            $badgeLabel = 'Para comecar';
        }

        return [
            'mode' => $mode,
            'badgeLabel' => $badgeLabel,
            'ctaLabel' => 'Ler artigo completo',
            'progress' => $progress,
            'progressLabel' => $progress > 0 ? sprintf('%d%% lido', $progress) : 'Sugestao para voce',
            'post' => $card,
        ];
    }
}

if (!function_exists('dzhome2_blog_limit_search_to_posts')) {
    function dzhome2_blog_limit_search_to_posts($query)
    {
        if (is_admin() || !$query->is_main_query() || !$query->is_search()) {
            return;
        }

        $query->set('post_type', 'post');
    }
}

if (!function_exists('dzhome2_blog_rest_popular')) {
    function dzhome2_blog_rest_popular(WP_REST_Request $request)
    {
        $days = absint($request->get_param('days'));
        $limit = absint($request->get_param('limit'));

        return rest_ensure_response([
            'days' => $days ?: 30,
            'limit' => $limit ?: 6,
            'items' => dzhome2_blog_get_popular_posts($days ?: 30, $limit ?: 6),
        ]);
    }
}

if (!function_exists('dzhome2_blog_rest_continue')) {
    function dzhome2_blog_rest_continue(WP_REST_Request $request)
    {
        $post_id = absint($request->get_param('post_id'));
        $progress = absint($request->get_param('progress'));

        return rest_ensure_response(dzhome2_blog_get_continue_recommendation($post_id, $progress));
    }
}

if (!function_exists('dzhome2_blog_register_rest_routes')) {
    function dzhome2_blog_register_rest_routes()
    {
        register_rest_route('digizap-home-2/v1', '/blog/popular', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => 'dzhome2_blog_rest_popular',
            'permission_callback' => '__return_true',
        ]);

        register_rest_route('digizap-home-2/v1', '/blog/continue', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => 'dzhome2_blog_rest_continue',
            'permission_callback' => '__return_true',
        ]);
    }
}

if (!function_exists('dzhome2_enqueue_blog_assets')) {
    function dzhome2_enqueue_blog_assets($single_post = null)
    {
        static $loaded = false;

        $style_rel = 'assets/blog.css';
        $script_rel = 'assets/blog.js';

        if (!$loaded) {
            wp_enqueue_style('digizap-home-2-blog', dzhome2_asset_url($style_rel), [], dzhome2_asset_version($style_rel));
            wp_enqueue_script('digizap-home-2-blog', dzhome2_asset_url($script_rel), [], dzhome2_asset_version($script_rel), true);

            $blog_config = [
                'storageKey' => 'menzzu_reading_progress',
                'restBase' => esc_url_raw(rest_url('digizap-home-2/v1')),
                'singlePost' => $single_post,
            ];
            wp_localize_script('digizap-home-2-blog', 'menzzuBlogConfig', $blog_config);
            wp_localize_script('digizap-home-2-blog', 'dzHome2BlogConfig', $blog_config);

            $loaded = true;
        }
    }
}

add_action('init', 'dzhome2_blog_maybe_install_schema');
add_action('template_redirect', 'dzhome2_blog_track_post_view', 20);
add_action('pre_get_posts', 'dzhome2_blog_limit_search_to_posts', 20);
add_action('rest_api_init', 'dzhome2_blog_register_rest_routes');
add_action('wp_enqueue_scripts', function () {
    if (is_singular('post')) {
        $post_id = get_queried_object_id();
        dzhome2_enqueue_blog_assets([
            'id' => $post_id,
            'title' => get_the_title($post_id),
            'url' => get_permalink($post_id),
        ]);
    }
});
