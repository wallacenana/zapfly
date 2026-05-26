<?php

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('dzhome2_render_directory_footer_nav')) {
    function dzhome2_render_directory_footer_nav($args = [])
    {
        $args = array_merge([
            'active' => 'home',
            'homeUrl' => home_url('/'),
            'restaurantsUrl' => dzhome2_restaurants_url(),
            'blogUrl' => dzhome2_blog_url(),
        ], $args);

        $active = in_array($args['active'], ['home', 'restaurants', 'blog'], true) ? (string) $args['active'] : 'home';

        $items = [
            [
                'key' => 'home',
                'label' => 'Home',
                'url' => $args['homeUrl'],
                'icon' => '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 11.5L12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6.2H9.5V21H5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"></path></svg>',
            ],
            [
                'key' => 'restaurants',
                'label' => 'Restaurantes',
                'url' => $args['restaurantsUrl'],
                'icon' => '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 4v7M9 4v7M7.5 11v9M15 4v8c0 1.1.9 2 2 2v6M15 8h4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
            ],
            [
                'key' => 'blog',
                'label' => 'Ajuda',
                'url' => $args['blogUrl'],
                'icon' => '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 4h12a2 2 0 0 1 2 2v12l-4-3H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"></path><path d="M8 8h8M8 12h6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"></path></svg>',
            ],
        ];

        ob_start();
        ?>
        <nav class="dz-home2-footer-nav" aria-label="Navegacao inferior">
            <div class="dz-home2-footer-nav-inner">
                <?php foreach ($items as $item) : ?>
                    <a
                        class="dz-home2-footer-nav-link<?php echo $active === $item['key'] ? ' is-active' : ''; ?>"
                        href="<?php echo esc_url($item['url']); ?>"
                        <?php echo $active === $item['key'] ? 'aria-current="page"' : ''; ?>>
                        <span class="dz-home2-footer-nav-icon" aria-hidden="true"><?php echo $item['icon']; ?></span>
                        <span class="dz-home2-footer-nav-label"><?php echo esc_html($item['label']); ?></span>
                    </a>
                <?php endforeach; ?>
            </div>
        </nav>
        <?php
        return trim((string) ob_get_clean());
    }
}
