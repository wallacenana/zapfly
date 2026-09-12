<?php

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('menzzu_marketplace_render_directory_header')) {
    function menzzu_marketplace_render_directory_header($args = [])
    {
        $args = array_merge([
            'active' => 'home',
            'homeUrl' => home_url('/'),
            'restaurantsUrl' => menzzu_marketplace_restaurants_url(),
            'blogUrl' => menzzu_marketplace_blog_url(),
            'loginUrl' => menzzu_marketplace_login_url(),
            'registerUrl' => home_url('/comprar/'),
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
        <header class="menzzu-marketplace-header<?php echo $showBack ? ' has-back' : ''; ?>">
            <div class="menzzu-left">
                <div class="menzzu-marketplace-brand">
                    <a class="menzzu-marketplace-brand-link" href="<?php echo esc_url($args['homeUrl']); ?>">
                        <?php if (has_custom_logo()) : ?>
                            <?php
                            $logo_id = (int) get_theme_mod('custom_logo');
                            echo $logo_id
                                ? wp_get_attachment_image($logo_id, 'full', false, ['class' => 'menzzu-marketplace-brand-logo menzzu-marketplace-brand-logo-light', 'alt' => 'Menzzu'])
                                : '';
                            ?>
                            <img class="menzzu-marketplace-brand-logo menzzu-marketplace-brand-logo-dark" src="https://menzzu.com/wp-content/uploads/2026/09/Logo-Menzzu-Branca.png" alt="Menzzu" loading="eager" decoding="async">
                        <?php else : ?>
                            <span class="menzzu-marketplace-wordmark" aria-label="Menzzu">men<span>zzu</span></span>
                        <?php endif; ?>
                    </a>
                </div>

                <nav class="menzzu-marketplace-nav" aria-label="Menu principal">
                    <a href="<?php echo esc_url($args['homeUrl']); ?>" class="<?php echo $active === 'home' ? 'is-active' : ''; ?>" <?php echo $active === 'home' ? 'aria-current="page"' : ''; ?>>Home</a>
                    <a href="<?php echo esc_url($args['restaurantsUrl']); ?>" class="<?php echo $active === 'restaurants' ? 'is-active' : ''; ?>" <?php echo $active === 'restaurants' ? 'aria-current="page"' : ''; ?>>Restaurantes</a>
                    <a href="<?php echo esc_url('/blog'); ?>">Ajuda</a>
                </nav>
            </div>

            <div class="menzzu-center">
                <div class="menzzu-marketplace-header-actions menzzu-marketplace-header-actions-app" data-app-actions <?php echo $hasSelectedAddress ? '' : 'hidden'; ?>>
                    <div class="menzzu-marketplace-search">
                        <span class="menzzu-marketplace-search-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="11" cy="11" r="7"></circle>
                                <path d="M20 20l-3.5-3.5"></path>
                            </svg>
                        </span>
                        <input type="search" data-search-input placeholder="Buscar loja ou item" autocomplete="off">
                    </div>
                </div>
            </div>

            <div class="menzzu-right">
                <button type="button" class="menzzu-marketplace-location-pill" data-edit-address <?php echo $hasSelectedAddress ? '' : 'hidden'; ?>>
                    <span class="menzzu-marketplace-location-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 21s6-4.35 6-11a6 6 0 1 0-12 0c0 6.65 6 11 6 11Z"></path>
                            <circle cx="12" cy="10" r="2.2"></circle>
                        </svg>
                    </span>
                    <span class="menzzu-marketplace-location-copy">
                        <strong data-address-line1><?php echo esc_html($hasSelectedAddress ? ($initialAddressLabel ?: 'Digite seu endereco') : 'Digite seu endereco'); ?></strong>
                    </span>
                    <span class="menzzu-marketplace-location-arrow" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M6 9l6 6 6-6"></path>
                        </svg>
                    </span>
                </button>

                <button type="button" class="menzzu-marketplace-theme-toggle" data-theme-toggle aria-label="Ativar modo escuro" aria-pressed="false">
                    <span class="menzzu-marketplace-theme-toggle-icon" aria-hidden="true">
                        <svg class="menzzu-theme-icon-moon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
                            <path d="M3.32031 11.6835C3.32031 16.6541 7.34975 20.6835 12.3203 20.6835C16.1075 20.6835 19.3483 18.3443 20.6768 15.032C19.6402 15.4486 18.5059 15.6834 17.3203 15.6834C12.3497 15.6834 8.32031 11.654 8.32031 6.68342C8.32031 5.50338 8.55165 4.36259 8.96453 3.32996C5.65605 4.66028 3.32031 7.89912 3.32031 11.6835Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                        </svg>
                        <svg class="menzzu-theme-icon-sun" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
                            <path d="M12 3V4M12 20V21M4 12H3M6.31412 6.31412L5.5 5.5M17.6859 6.31412L18.5 5.5M6.31412 17.69L5.5 18.5001M17.6859 17.69L18.5 18.5001M21 12H20M16 12C16 14.2091 14.2091 16 12 16C9.79086 16 8 14.2091 8 12C8 9.79086 9.79086 8 12 8C14.2091 8 16 9.79086 16 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                        </svg>
                    </span>
                    <span class="menzzu-marketplace-theme-toggle-label">Tema</span>
                </button>

                <div class="menzzu-marketplace-header-actions menzzu-marketplace-header-actions-guest" data-guest-actions>
                    <a class="menzzu-marketplace-button menzzu-marketplace-button-ghost" href="<?php echo esc_url($args['loginUrl']); ?>">Entrar</a>
                    <a class="menzzu-marketplace-button menzzu-marketplace-button-primary" href="<?php echo esc_url($args['registerUrl']); ?>">Criar conta</a>
                </div>
            </div>
        </header>
<?php
        return trim(ob_get_clean());
    }
}

