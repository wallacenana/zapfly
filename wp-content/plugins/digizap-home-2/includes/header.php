<?php

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('dzhome2_render_directory_header')) {
    function dzhome2_render_directory_header($args = [])
    {
        $args = array_merge([
            'active' => 'home',
            'homeUrl' => home_url('/'),
            'restaurantsUrl' => dzhome2_restaurants_url(),
            'blogUrl' => dzhome2_blog_url(),
            'loginUrl' => wp_login_url(home_url('/')),
            'registerUrl' => wp_registration_url(),
            'hasSelectedAddress' => false,
            'initialAddressLabel' => '',
            'showBack' => false,
            'backUrl' => home_url('/'),
            'backLabel' => 'Voltar'
        ], $args);

        $active = in_array($args['active'], ['home', 'restaurants'], true) ? (string) $args['active'] : 'home';
        $hasSelectedAddress = !empty($args['hasSelectedAddress']);
        $initialAddressLabel = trim((string) $args['initialAddressLabel']);
        $showBack = !empty($args['showBack']);

        ob_start();
?>
        <header class="dz-home2-header<?php echo $showBack ? ' has-back' : ''; ?>">
            <div class="dz-left">
                <div class="dz-home2-brand">
                    <a class="dz-home2-brand-link" href="<?php echo esc_url($args['homeUrl']); ?>">
                        <?php if (has_custom_logo()) : ?>
                            <?php
                            $logo_id = (int) get_theme_mod('custom_logo');
                            echo $logo_id
                                ? wp_get_attachment_image($logo_id, 'full', false, ['class' => 'dz-home2-brand-logo', 'alt' => get_bloginfo('name') ?: 'DigiZap'])
                                : '';
                            ?>
                        <?php else : ?>
                            <img decoding="async" width="300" height="78" src="https://digizap.com.br/wp-content/uploads/2026/05/DigiZap-Logo-300x78.png" class="attachment-medium size-medium" style="width: 160px; margin-top: 7px" alt="" srcset="https://digizap.com.br/wp-content/uploads/2026/05/DigiZap-Logo-300x78.png 300w, https://digizap.com.br/wp-content/uploads/2026/05/DigiZap-Logo.png 572w" sizes="(max-width: 300px) 100vw, 300px">
                            <span class="dz-home2-brand-name" style="display: none"><?php echo esc_html(get_bloginfo('name') ?: 'DigiZap'); ?></span>
                        <?php endif; ?>
                    </a>
                </div>

                <nav class="dz-home2-nav" aria-label="Menu principal">
                    <a href="<?php echo esc_url($args['homeUrl']); ?>" class="<?php echo $active === 'home' ? 'is-active' : ''; ?>" <?php echo $active === 'home' ? 'aria-current="page"' : ''; ?>>Home</a>
                    <a href="<?php echo esc_url($args['restaurantsUrl']); ?>" class="<?php echo $active === 'restaurants' ? 'is-active' : ''; ?>" <?php echo $active === 'restaurants' ? 'aria-current="page"' : ''; ?>>Restaurantes</a>
                    <a href="<?php echo esc_url('/blog'); ?>">Ajuda</a>
                </nav>
            </div>

            <div class="dz-center">
                <div class="dz-home2-header-actions dz-home2-header-actions-app" data-app-actions <?php echo $hasSelectedAddress ? '' : 'hidden'; ?>>
                    <div class="dz-home2-search">
                        <span class="dz-home2-search-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="11" cy="11" r="7"></circle>
                                <path d="M20 20l-3.5-3.5"></path>
                            </svg>
                        </span>
                        <input type="search" data-search-input placeholder="Buscar loja ou item" autocomplete="off">
                    </div>
                </div>
            </div>

            <div class="dz-right">
                <button type="button" class="dz-home2-location-pill" data-edit-address>
                    <span class="dz-home2-location-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 21s6-4.35 6-11a6 6 0 1 0-12 0c0 6.65 6 11 6 11Z"></path>
                            <circle cx="12" cy="10" r="2.2"></circle>
                        </svg>
                    </span>
                    <span class="dz-home2-location-copy">
                        <strong data-address-line1><?php echo esc_html($hasSelectedAddress ? ($initialAddressLabel ?: 'Digite seu endereco') : 'Digite seu endereco'); ?></strong>
                    </span>
                    <span class="dz-home2-location-arrow" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M6 9l6 6 6-6"></path>
                        </svg>
                    </span>
                </button>

                <div class="dz-home2-header-actions dz-home2-header-actions-guest" data-guest-actions>
                    <a class="dz-home2-button dz-home2-button-ghost" href="<?php echo esc_url($args['loginUrl']); ?>">Entrar</a>
                    <a class="dz-home2-button dz-home2-button-primary" href="<?php echo esc_url($args['registerUrl']); ?>">Criar conta</a>
                </div>
            </div>
        </header>
<?php
        return trim(ob_get_clean());
    }
}
