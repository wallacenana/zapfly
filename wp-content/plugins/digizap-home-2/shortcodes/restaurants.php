<?php

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('dzhome2_render_restaurants_shortcode')) {
    function dzhome2_render_restaurants_shortcode($atts = [])
    {
        $atts = shortcode_atts([
            'title' => 'Restaurantes',
            'description' => 'Veja as lojas disponíveis para o endereço informado.',
            'search' => '',
            'location' => '',
            'category' => '',
            'limit' => 18,
            'show_header' => '1'
        ], $atts, 'digizap_home_2_restaurants');

        dzhome2_enqueue_assets();

        $limit = min(max(absint($atts['limit']), 1), 48);
        $location = trim((string) $atts['location']);
        $locationLat = null;
        $locationLng = null;
        if ($location === '' && function_exists('dzhome2_read_address_cookie')) {
            $cookieAddress = dzhome2_read_address_cookie();
            $location = trim((string) ($cookieAddress['address'] ?? ''));
            $locationLat = isset($cookieAddress['lat']) ? (float) $cookieAddress['lat'] : null;
            $locationLng = isset($cookieAddress['lng']) ? (float) $cookieAddress['lng'] : null;
        }

        $data = dzhome2_fetch_directory_data(
            (string) $atts['search'],
            (string) $atts['category'],
            $location,
            $limit,
            $locationLat,
            $locationLng
        );

        ob_start();
        ?>
        <section class="dz-home2-catalog dz-home2-catalog-standalone" data-dz-home2-restaurants>
            <?php if ($atts['show_header'] !== '0') : ?>
                <div class="dz-home2-catalog-head">
                    <div>
                        <h2><?php echo esc_html($atts['title']); ?></h2>
                        <p><?php echo esc_html($atts['description']); ?></p>
                    </div>
                    <span class="dz-home2-catalog-count"><?php echo esc_html((string) absint($data['total'] ?? 0)); ?></span>
                </div>
            <?php endif; ?>

            <div class="dz-home2-featured-track">
                <?php echo dzhome2_render_featured_cards($data['featuredStores'] ?? []); ?>
            </div>

            <div class="dz-home2-restaurants-grid">
                <?php echo dzhome2_render_restaurant_cards($data['restaurants'] ?? []); ?>
            </div>
        </section>
        <?php
        return trim(ob_get_clean());
    }
}

add_shortcode('digizap_home_2_restaurants', 'dzhome2_render_restaurants_shortcode');
