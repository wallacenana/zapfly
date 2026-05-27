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
            'loginUrl' => 'https://dash.digizap.com.br/login',
            'registerUrl' => home_url('/comprar/'),
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
                'key' => 'search',
                'label' => 'Pesquisar',
                'url' => '#pesquisa',
                'icon' => '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="1.9"></circle><path d="M20 20l-3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"></path></svg>',
            ],
            [
                'key' => 'login',
                'label' => 'Entrar',
                'url' => $args['loginUrl'],
                'icon' => '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm-7 9a7 7 0 0 1 14 0" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
            ],
            [
                'key' => 'register',
                'label' => 'Cadastro',
                'url' => $args['registerUrl'],
                'icon' => '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"></path><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.9"></circle></svg>',
            ],
        ];

        ob_start();
?>
        <nav class="dz-home2-footer-nav" aria-label="Navegacao inferior">
            <div class="dz-home2-footer-nav-inner">
                <?php foreach ($items as $item) : ?>
                    <a
                        class="dz-home2-footer-nav-link <?php echo $item['key'] === 'search' ? ' dz-home2-footer-nav-search' : ''; ?>"
                        href="<?php echo esc_url($item['url']); ?>"
                        <?php echo $item['key'] === 'search' ? 'data-dz-home2-nav-search' : ''; ?>
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
