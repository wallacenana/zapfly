<?php

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('dzhome2_render_home_shortcode')) {
    function dzhome2_render_home_shortcode($atts = [])
    {
        $atts = shortcode_atts([
            'title' => 'Tudo pra facilitar seu dia a dia',
            'description' => 'Digite seu endereço para começar.',
            'limit' => 18,
            'key' => 'home2',
            'maps_key' => ''
        ], $atts, 'digizap_home_2');

        dzhome2_enqueue_assets();

        $limit = min(max(absint($atts['limit']), 1), 48);
        $mapsKey = dzhome2_maps_key($atts['maps_key']);

        ob_start();
        ?>
        <div
            class="dz-home2"
            data-dz-home2-root
            data-mode="landing"
            data-api-base="<?php echo esc_attr(dzhome2_api_base()); ?>"
            data-home-url="<?php echo esc_attr(home_url('/')); ?>"
            data-login-url="<?php echo esc_attr(wp_login_url(home_url('/'))); ?>"
            data-register-url="<?php echo esc_attr(wp_registration_url()); ?>"
            data-blog-url="<?php echo esc_attr(dzhome2_blog_url()); ?>"
            data-storage-key="dz_home2_address"
            data-limit="<?php echo esc_attr($limit); ?>"
            data-maps-key="<?php echo esc_attr($mapsKey); ?>"
        >
            <header class="dz-home2-header">
                <div class="dz-home2-brand">
                    <a class="dz-home2-brand-link" href="<?php echo esc_url(home_url('/')); ?>">
                        <?php if (has_custom_logo()) : ?>
                            <?php
                                $logo_id = (int) get_theme_mod('custom_logo');
                                echo $logo_id
                                    ? wp_get_attachment_image($logo_id, 'full', false, ['class' => 'dz-home2-brand-logo', 'alt' => get_bloginfo('name') ?: 'DigiZap'])
                                    : '';
                            ?>
                        <?php else : ?>
                            <span class="dz-home2-brand-mark">DZ</span>
                            <span class="dz-home2-brand-name"><?php echo esc_html(get_bloginfo('name') ?: 'DigiZap'); ?></span>
                        <?php endif; ?>
                    </a>
                </div>

                <nav class="dz-home2-nav" aria-label="Menu principal">
                    <a href="#inicio">Home</a>
                    <a href="#restaurantes">Restaurantes</a>
                    <a href="<?php echo esc_url(dzhome2_blog_url()); ?>">Ajuda</a>
                </nav>

                <div class="dz-home2-header-actions dz-home2-header-actions-guest" data-guest-actions>
                    <a class="dz-home2-button dz-home2-button-ghost" href="<?php echo esc_url(wp_login_url(home_url('/'))); ?>">Acessar</a>
                    <a class="dz-home2-button dz-home2-button-primary" href="<?php echo esc_url(wp_registration_url()); ?>">Criar conta</a>
                </div>

                <div class="dz-home2-header-actions dz-home2-header-actions-app" data-app-actions hidden>
                    <div class="dz-home2-search">
                        <span class="dz-home2-search-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="11" cy="11" r="7"></circle>
                                <path d="M20 20l-3.5-3.5"></path>
                            </svg>
                        </span>
                    <input type="search" data-search-input placeholder="Buscar loja ou item" autocomplete="off">
                    </div>

                    <button type="button" class="dz-home2-location-pill" data-edit-address>
                        <span class="dz-home2-location-label">Endereço</span>
                        <strong data-address-line1>Digite seu endereço</strong>
                        <small data-address-line2>para ver os restaurantes</small>
                    </button>

                    <a class="dz-home2-button dz-home2-button-ghost" href="<?php echo esc_url(wp_login_url(home_url('/'))); ?>">Acessar</a>
                </div>
            </header>

            <main class="dz-home2-main">
                <section class="dz-home2-landing" id="inicio" data-landing>
                    <div class="dz-home2-landing-grid">
                        <div class="dz-home2-landing-copy">
                            <h1><?php echo esc_html($atts['title']); ?></h1>
                            <p><?php echo esc_html($atts['description']); ?></p>

                            <form class="dz-home2-address-form" data-address-form>
                                <input
                                    type="text"
                                    data-address-input
                                    placeholder="<?php echo esc_attr('Digite seu endereço completo'); ?>"
                                    autocomplete="off"
                                    spellcheck="false"
                                    inputmode="text"
                                >
                                <button type="submit" class="dz-home2-button dz-home2-button-primary" data-address-continue disabled>
                                    Continuar
                                </button>
                            </form>
                            <p class="dz-home2-address-hint" data-address-hint hidden></p>
                        </div>

                        <div class="dz-home2-landing-visual" aria-hidden="true">
                            <span class="dz-home2-visual-card dz-home2-visual-card-a"></span>
                            <span class="dz-home2-visual-card dz-home2-visual-card-b"></span>
                            <span class="dz-home2-visual-card dz-home2-visual-card-c"></span>
                            <span class="dz-home2-visual-badge"></span>
                            <span class="dz-home2-visual-ring"></span>
                        </div>
                    </div>
                </section>

                <section class="dz-home2-catalog" id="restaurantes" data-catalog hidden>
                    <div class="dz-home2-catalog-head">
                        <div>
                            <h2>Restaurantes</h2>
                            <p data-catalog-summary>Digite o endereço para ver os restaurantes.</p>
                        </div>
                        <span class="dz-home2-catalog-count" data-catalog-count>0</span>
                    </div>

                    <div class="dz-home2-featured-track" data-featured-track>
                    </div>

                    <div class="dz-home2-restaurants-grid" data-restaurants-grid>
                    </div>

                    <div class="dz-home2-empty-results" data-empty-results hidden>
                        Nenhum restaurante encontrado.
                    </div>
                </section>
            </main>
        </div>
        <?php
        return trim(ob_get_clean());
    }
}

add_shortcode('digizap_home_2', 'dzhome2_render_home_shortcode');
