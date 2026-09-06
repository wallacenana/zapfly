<?php

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('dzhome2_blog_render_post_card')) {
    function dzhome2_blog_render_post_card($card, $viewsLabel = '')
    {
        if (empty($card) || empty($card['url'])) {
            return '';
        }

        $title = (string) ($card['title'] ?? '');
        $excerpt = (string) ($card['excerpt'] ?? '');
        $image = (string) ($card['image'] ?? '');
        $dateHuman = (string) ($card['dateHuman'] ?? '');
        $views = absint($card['views'] ?? 0);
        $viewsLabel = $viewsLabel !== '' ? $viewsLabel : ($views > 0 ? number_format_i18n($views) . ' visualizacoes' : '');

        ob_start();
?>
        <article class="dz-blog-card">
            <a class="dz-blog-card-link" href="<?php echo esc_url($card['url']); ?>">
                <span class="dz-blog-card-media">
                    <img src="<?php echo esc_url($image); ?>" alt="<?php echo esc_attr($title); ?>" loading="lazy" decoding="async">
                </span>
                <span class="dz-blog-card-copy">
                    <span class="dz-blog-card-meta">
                        <?php if ($viewsLabel !== '') : ?>
                            <small><?php echo esc_html($viewsLabel); ?></small>
                        <?php endif; ?>
                        <?php if ($dateHuman !== '') : ?>
                            <small><?php echo esc_html($dateHuman); ?></small>
                        <?php endif; ?>
                    </span>
                    <strong><?php echo esc_html($title); ?></strong>
                    <?php if ($excerpt !== '') : ?>
                        <p><?php echo esc_html($excerpt); ?></p>
                    <?php endif; ?>
                </span>
            </a>
        </article>
    <?php
        return trim((string) ob_get_clean());
    }
}

if (!function_exists('dzhome2_blog_render_popular_item')) {
    function dzhome2_blog_render_popular_item($card, $rank)
    {
        if (empty($card) || empty($card['url'])) {
            return '';
        }

        $title = (string) ($card['title'] ?? '');
        $readingTime = (string) ($card['readingTimeLabel'] ?? '');
        $rankLabel = str_pad((string) max(1, absint($rank)), 2, '0', STR_PAD_LEFT);

        ob_start();
    ?>
        <article class="dz-blog-popular-item">
            <a class="dz-blog-popular-link" href="<?php echo esc_url($card['url']); ?>">
                <span class="dz-blog-popular-rank"><?php echo esc_html($rankLabel); ?></span>
                <span class="dz-blog-popular-copy">
                    <strong><?php echo esc_html($title); ?></strong>
                    <?php if ($readingTime !== '') : ?>
                        <span class="dz-blog-popular-meta"><?php echo esc_html($readingTime); ?></span>
                    <?php endif; ?>
                </span>
            </a>
        </article>
    <?php
        return trim((string) ob_get_clean());
    }
}

if (!function_exists('dzhome2_render_popular_posts_shortcode')) {
    function dzhome2_render_popular_posts_shortcode($atts = [])
    {
        $atts = shortcode_atts([
            'title' => 'Mais lidos da semana',
            'description' => 'Os conteudos mais lidos dos ultimos dias.',
            'days' => 30,
            'limit' => 6,
            'dias' => '',
            'itens' => '',
            'titulo' => '',
            'descricao' => '',
        ], $atts, 'digizap_home_2_popular_posts');

        dzhome2_enqueue_blog_assets();

        $daysSource = $atts['dias'] !== '' ? $atts['dias'] : $atts['days'];
        $limitSource = $atts['itens'] !== '' ? $atts['itens'] : $atts['limit'];
        $title = $atts['titulo'] !== '' ? $atts['titulo'] : $atts['title'];
        $description = $atts['descricao'] !== '' ? $atts['descricao'] : $atts['description'];

        $days = min(max(absint($daysSource), 1), 365);
        $limit = min(max(absint($limitSource), 1), 24);
        $posts = function_exists('dzhome2_blog_get_popular_posts') ? dzhome2_blog_get_popular_posts($days, $limit) : [];

        ob_start();
    ?>
        <section class="dz-blog-section dz-blog-popular" data-dz-home2-popular data-days="<?php echo esc_attr($days); ?>" data-limit="<?php echo esc_attr($limit); ?>">
            <!-- <header class="dz-blog-section-head">
                <div>
                    <span class="dz-blog-kicker">Blog</span>
                    <h3><?php // echo esc_html($title); 
                        ?></h3>
                    <p><?php // echo esc_html($description); 
                        ?></p>
                </div>
                <span class="dz-blog-section-pill">Ultimos <?php //echo esc_html((string) $days); 
                                                            ?> dias</span>
            </header> -->

            <?php if (empty($posts)) : ?>
                <div class="dz-blog-empty">Nenhum post encontrado.</div>
            <?php else : ?>
                <div class="dz-blog-popular-list">
                    <?php foreach ($posts as $index => $card) : ?>
                        <?php echo dzhome2_blog_render_popular_item($card, $index + 1); ?>
                    <?php endforeach; ?>
                </div>
            <?php endif; ?>
        </section>
    <?php
        return trim((string) ob_get_clean());
    }
}

if (!function_exists('dzhome2_render_continue_reading_shortcode')) {
    function dzhome2_render_continue_reading_shortcode($atts = [])
    {
        $atts = shortcode_atts([
            'title' => 'Continue lendo',
            'empty_title' => 'Nenhuma leitura salva ainda.',
            'empty_description' => 'Abra um post para retomar de onde parou.',
            'titulo' => '',
            'descricao' => '',
        ], $atts, 'digizap_home_2_continue_reading');

        dzhome2_enqueue_blog_assets();

        $title = $atts['titulo'] !== '' ? $atts['titulo'] : $atts['title'];

        ob_start();
    ?>
        <section
            class="dz-blog-section dz-blog-continue"
            data-dz-home2-continue-reading
            data-empty-title="<?php echo esc_attr($atts['empty_title']); ?>"
            data-empty-description="<?php echo esc_attr($atts['empty_description']); ?>">
            <header class="dz-blog-section-head">
                <div>
                    <h2><?php echo esc_html($title); ?></h2>
                </div>
            </header>

            <div class="dz-blog-continue-body" data-dz-home2-continue-body aria-live="polite">
                <div class="dz-blog-empty-state">
                    <strong><?php echo esc_html($atts['empty_title']); ?></strong>
                    <p><?php echo esc_html($atts['empty_description']); ?></p>
                </div>
            </div>
        </section>
<?php
        return trim((string) ob_get_clean());
    }
}

add_shortcode('digizap_home_2_popular_posts', 'dzhome2_render_popular_posts_shortcode');
add_shortcode('digizap_home_2_continue_reading', 'dzhome2_render_continue_reading_shortcode');
add_shortcode('menzzu_popular_posts', 'dzhome2_render_popular_posts_shortcode');
add_shortcode('menzzu_continue_reading', 'dzhome2_render_continue_reading_shortcode');
