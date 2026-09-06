<?php

/**
 * Menzzu - Cardápio digital (Versão Checkout 2.0)
 */

if (php_sapi_name() === 'cli-server') {
    $path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
    if (file_exists(__DIR__ . $path) && !is_dir(__DIR__ . $path)) {
        return false;
    }
}

require_once __DIR__ . '/config.php';

if (!headers_sent()) {
    header('Content-Type: text/html; charset=UTF-8');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    header('Expires: 0');
}

try {
    $pdo = new PDO("mysql:host=$host;dbname=$db;charset=utf8", $user, $pass);

    $uri = $_SERVER['REQUEST_URI'];
    $path = parse_url($uri, PHP_URL_PATH);
    $parts = explode('/', trim($path, '/'));
    $slug = strtolower(end($parts));
    $hostName = strtolower(trim(explode(':', $_SERVER['HTTP_HOST'] ?? '')[0]));
    $platformHosts = ['menzzu.com', 'www.menzzu.com', 'cardapio.menzzu.com', 'origin.menzzu.com'];

    // Domínio personalizado acessa a raiz; convertemos o hostname para o slug interno.
    if (in_array($hostName, $platformHosts, true) === false && ($slug === '' || $slug === 'index.php' || $slug === 'cardapio')) {
        try {
            $domainStmt = $pdo->prepare("SELECT u.slug FROM store_profile sp INNER JOIN user u ON u.id = sp.userId WHERE LOWER(sp.customDomain) = ? LIMIT 1");
            $domainStmt->execute([$hostName]);
            $domainSlug = $domainStmt->fetchColumn();
            if ($domainSlug) {
                $slug = strtolower($domainSlug);
            }
        } catch (Exception $e) {
            // Compatibilidade durante a migração, antes da coluna existir no HostGator.
        }
    }

    $fallbackToWP = function () {
        $wp_index = __DIR__ . '/../index.php';
        if (file_exists($wp_index)) {
            chdir(dirname($wp_index));
            $_SERVER['SCRIPT_FILENAME'] = $wp_index;
            $_SERVER['SCRIPT_NAME'] = '/index.php';
            require $wp_index;
            exit;
        }
        header("Location: /");
        exit;
    };

    function formatPrepTimeLabel($value)
    {
        $raw = trim((string) $value);
        if ($raw === '') {
            return '';
        }
        $normalized = str_replace(['–', '—'], '-', $raw);
        $normalized = preg_replace('/\s*-\s*/', ' - ', $normalized);
        $normalized = preg_replace('/\s*(?:min(?:utos?)?\.?)$/iu', '', $normalized);
        $normalized = trim(preg_replace('/\s+/', ' ', $normalized));
        if ($normalized === '') {
            return '';
        }
        return 'Entrega ' . $normalized . 'min';
    }

    function parseDailyDeliveryItemsValue($value)
    {
        $default = [
            'orderTypes' => [
                'delivery' => true,
                'order' => true
            ],
            'fulfillmentMethods' => [
                'delivery' => true,
                'pickup' => true,
                'local' => true
            ]
        ];

        if (empty($value)) {
            return $default;
        }

        $parsed = $value;
        if (is_string($parsed)) {
            $decoded = json_decode($parsed, true);
            if (json_last_error() === JSON_ERROR_NONE && is_array($decoded)) {
                $parsed = $decoded;
            } else {
                return $default;
            }
        }

        if (!is_array($parsed)) {
            return $default;
        }

        $orderTypes = is_array($parsed['orderTypes'] ?? null) ? $parsed['orderTypes'] : [];
        $fulfillmentMethods = is_array($parsed['fulfillmentMethods'] ?? null) ? $parsed['fulfillmentMethods'] : [];

        return [
            'orderTypes' => [
                'delivery' => array_key_exists('delivery', $orderTypes) ? (bool) $orderTypes['delivery'] : true,
                'order' => array_key_exists('order', $orderTypes) ? (bool) $orderTypes['order'] : true,
            ],
            'fulfillmentMethods' => [
                'delivery' => array_key_exists('delivery', $fulfillmentMethods) ? (bool) $fulfillmentMethods['delivery'] : true,
                'pickup' => array_key_exists('pickup', $fulfillmentMethods) ? (bool) $fulfillmentMethods['pickup'] : true,
                'local' => array_key_exists('local', $fulfillmentMethods) ? (bool) $fulfillmentMethods['local'] : true,
            ]
        ];
    }

    if (empty($slug) || $slug === 'cardapio' || $slug === 'index.php') {
        $fallbackToWP();
    }

    // --- MINI CACHE ENGINE (LCP KILLER) ---
    $cacheAcceptOrders = true;
    $cacheVersionStamp = '';
    try {
        $cacheSettingsStmt = $pdo->prepare("
            SELECT
                COALESCE(sp.acceptOrders, s.acceptOrders, 1) AS acceptOrders,
                COALESCE(sp.menuTheme, s.menuTheme, 'light') AS menuTheme,
                COALESCE(sp.businessName, s.businessName) AS businessName,
                COALESCE(sp.businessCategory, s.businessCategory) AS businessCategory,
                COALESCE(sp.prepTime, '') AS prepTime,
                COALESCE(sp.logoUrl, s.logoUrl) AS logoUrl,
                COALESCE(sp.faviconUrl, s.faviconUrl) AS faviconUrl,
                COALESCE(sp.accentColor, s.accentColor) AS accentColor,
                COALESCE(sp.backgroundColor, s.backgroundColor) AS backgroundColor,
                COALESCE(sp.textColor, s.textColor) AS textColor,
                COALESCE(sp.buttonColor, s.buttonColor) AS buttonColor,
                COALESCE(sp.buttonTextColor, s.buttonTextColor) AS buttonTextColor,
                COALESCE(sp.accentColorOrders, s.accentColorOrders) AS accentColorOrders,
                COALESCE(sp.buttonColorOrders, s.buttonColorOrders) AS buttonColorOrders,
                COALESCE(sp.freeDeliveryEnabled, 0) AS freeDeliveryEnabled,
                COALESCE(sp.freeDeliveryKm, NULL) AS freeDeliveryKm,
                COALESCE(sp.deliveryMode, s.deliveryMode) AS deliveryMode,
                COALESCE(sp.maxDeliveryKm, s.maxDeliveryKm) AS maxDeliveryKm,
                COALESCE(sp.allowCashOnDelivery, s.allowCashOnDelivery) AS allowCashOnDelivery,
                COALESCE(s.dailyDeliveryItems, '{\"orderTypes\":{\"delivery\":true,\"order\":true},\"fulfillmentMethods\":{\"delivery\":true,\"pickup\":true,\"local\":true}}') AS dailyDeliveryItems
            FROM user u
            LEFT JOIN setting s ON u.id = s.userId
            LEFT JOIN store_profile sp ON u.id = sp.userId
            WHERE u.slug = ?
        ");
        $cacheSettingsStmt->execute([$slug]);
        $cacheSettings = $cacheSettingsStmt->fetch(PDO::FETCH_ASSOC);
        if ($cacheSettings) {
            $cacheAcceptOrders = (bool) $cacheSettings['acceptOrders'];
            $cacheVersionStamp = md5(json_encode($cacheSettings, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        }
    } catch (Exception $e) {
        $cacheAcceptOrders = true;
        $cacheVersionStamp = '';
    }

    $cacheDir = __DIR__ . '/cache';
    $cacheVersion = @filemtime(__FILE__) ?: time();
    $cacheFile = $cacheDir . '/store_' . md5($slug . '_ao_' . ($cacheAcceptOrders ? '1' : '0') . '_sv_' . $cacheVersionStamp . '_v_' . $cacheVersion) . '.html';
    $cacheTime = 60; // 60 segundos de cache

    $bypassCache = isset($_GET['nocache']);
    if (!$bypassCache && file_exists($cacheFile) && (time() - filemtime($cacheFile)) < $cacheTime) {
        echo file_get_contents($cacheFile);
        echo "\n<!-- Servido pelo Ultra Cache PHP em " . date('Y-m-d H:i:s', filemtime($cacheFile)) . " -->";
        exit;
    }

    ob_start();

    $stmt = $pdo->prepare("SELECT u.*, COALESCE(sp.businessName, s.businessName) AS businessName, COALESCE(sp.businessCategory, s.businessCategory) AS businessCategory, COALESCE(sp.prepTime, '') AS prepTime, COALESCE(sp.logoUrl, s.logoUrl) AS logoUrl, COALESCE(sp.faviconUrl, s.faviconUrl) AS faviconUrl, COALESCE(sp.accentColor, s.accentColor) AS accentColor, COALESCE(sp.backgroundColor, s.backgroundColor) AS backgroundColor, COALESCE(sp.textColor, s.textColor) AS textColor, COALESCE(sp.buttonColor, s.buttonColor) AS buttonColor, COALESCE(sp.buttonTextColor, s.buttonTextColor) AS buttonTextColor, COALESCE(sp.seoDescription, s.seoDescription) AS seoDescription, COALESCE(s.googleApiKey, '') AS googleApiKey, COALESCE(s.deliveryRules, '[]') AS deliveryRules, COALESCE(sp.maxDeliveryKm, s.maxDeliveryKm) AS maxDeliveryKm, COALESCE(sp.pixelId, s.pixelId) AS pixelId, COALESCE(sp.microsoftClarityId, s.microsoftClarityId) AS microsoftClarityId, COALESCE(sp.googleAnalyticsId, s.googleAnalyticsId) AS googleAnalyticsId, COALESCE(sp.acceptOrders, s.acceptOrders, 1) AS acceptOrders, COALESCE(sp.accentColorOrders, s.accentColorOrders) AS accentColorOrders, COALESCE(sp.buttonColorOrders, s.buttonColorOrders) AS buttonColorOrders, COALESCE(sp.freeDeliveryEnabled, 0) AS freeDeliveryEnabled, COALESCE(sp.freeDeliveryKm, NULL) AS freeDeliveryKm, COALESCE(sp.deliveryMode, s.deliveryMode) AS deliveryMode, COALESCE(sp.allowCashOnDelivery, s.allowCashOnDelivery) AS allowCashOnDelivery, COALESCE(sp.menuTheme, s.menuTheme, 'light') AS menuTheme, COALESCE(s.featuredCountDesktop, 4) AS featuredCountDesktop, COALESCE(s.featuredCountTablet, 2) AS featuredCountTablet, COALESCE(s.featuredCountMobile, 1) AS featuredCountMobile, COALESCE(s.dailyDeliveryItems, '{\"orderTypes\":{\"delivery\":true,\"order\":true},\"fulfillmentMethods\":{\"delivery\":true,\"pickup\":true,\"local\":true}}') AS dailyDeliveryItems FROM user u LEFT JOIN setting s ON u.id = s.userId LEFT JOIN store_profile sp ON u.id = sp.userId WHERE u.slug = ?");
    $stmt->execute([$slug]);
    $store = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$store) {
        $fallbackToWP();
    }

    $businessName = $store['businessName'] ?: $store['name'];
    $businessCategory = trim((string) ($store['businessCategory'] ?? ''));
    $logoUrl = $store['logoUrl'] ?: 'https://menzzu.com/wp-content/uploads/2026/09/fallback-image_1-100.jpg';
    $faviconUrl = $store['faviconUrl'] ?: '/favicon.ico';
    $menuTheme = strtolower(trim($store['menuTheme'] ?? 'light')) ?: 'light';
    $storedBackground = strtolower((string) ($store['backgroundColor'] ?? ''));
    $storedText = strtolower((string) ($store['textColor'] ?? ''));
    // Registros antigos com fundo claro e texto branco eram o default quebrado.
    $isDarkTheme = $menuTheme === 'dark';
    $legacyAccent = in_array(strtolower((string) ($store['accentColor'] ?? '')), ['#ff4d6d', '#6cb649', '#a2e403'], true) && !$isDarkTheme;
    $legacyButton = in_array(strtolower((string) ($store['buttonColor'] ?? '')), ['#ff4d6d', '#6cb649'], true);
    $legacyText = ($isDarkTheme && in_array($storedText, ['', '#031614', '#111111', '#333333', '#000000'], true))
        || (!$isDarkTheme && in_array($storedText, ['#333333', '#ffffff', '#fff'], true));
    $legacyBackground = strtolower((string) ($store['backgroundColor'] ?? '')) === '#07150d'
        || ($isDarkTheme && in_array($storedBackground, ['', '#ffffff', '#fff'], true));
    $accentColor = (!$store['accentColor'] || $legacyAccent) ? ($isDarkTheme ? '#a2e403' : '#82F026') : $store['accentColor'];
    $backgroundColor = (!$store['backgroundColor'] || $legacyBackground) ? ($isDarkTheme ? '#031614' : '#ffffff') : $store['backgroundColor'];
    $textColor = (!$store['textColor'] || $legacyText) ? ($isDarkTheme ? '#ffffff' : '#031614') : $store['textColor'];
    $buttonColor = (!$store['buttonColor'] || $legacyButton) ? $accentColor : $store['buttonColor'];
    $buttonTextColor = $store['buttonTextColor'] ?: '#031614';
    $legacyOrderAccent = in_array(strtolower((string) ($store['accentColorOrders'] ?? '')), ['', '#4a2c2a', '#a2e403'], true) && !$isDarkTheme;
    $orderAccentColor = $legacyOrderAccent ? ($isDarkTheme ? '#a2e403' : '#82F026') : $store['accentColorOrders'];
    $orderButtonColor = in_array(strtolower((string) ($store['buttonColorOrders'] ?? '')), ['', '#4a2c2a'], true)
        ? $orderAccentColor
        : $store['buttonColorOrders'];
    $surfaceColor = $isDarkTheme ? '#092b24' : 'color-mix(in srgb, var(--bg-color) 96%, #ffffff 4%)';
    $surfaceSoftColor = $isDarkTheme ? '#06231e' : 'color-mix(in srgb, var(--bg-color) 90%, #ffffff 10%)';
    $borderColor = $isDarkTheme ? 'color-mix(in srgb, ' . $accentColor . ' 16%, transparent)' : 'rgba(0, 0, 0, 0.08)';
    $textSecondary = $isDarkTheme ? 'rgba(255,255,255,0.72)' : ($textColor ? $textColor . '99' : 'rgba(102,102,102,0.6)');
    $acceptOrders = isset($store['acceptOrders']) ? (bool) $store['acceptOrders'] : true;
    $prepTimeLabel = formatPrepTimeLabel($store['prepTime'] ?? '');

    $stmt = $pdo->prepare("SELECT * FROM category WHERE userId = ? ORDER BY `order` ASC");
    $stmt->execute([$store['id']]);
    $categories = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $stmt = $pdo->prepare("SELECT * FROM product WHERE userId = ? ORDER BY displayOrder ASC");
    $stmt->execute([$store['id']]);
    $products = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $stmt = $pdo->prepare("SELECT id, dayOfWeek, startTime, endTime, maxOrders FROM available_slot WHERE userId = ? ORDER BY dayOfWeek ASC, startTime ASC");
    $stmt->execute([$store['id']]);
    $availableSlots = $stmt->fetchAll(PDO::FETCH_ASSOC);
    $hasVisibleProduct = count(array_filter($products, static function ($product) {
        return ($product['active'] ?? 1) && strtolower((string) ($product['type'] ?? '')) !== 'addon';
    })) > 0;
    $marketplaceReady = !empty($store['logoUrl'])
        && (float) ($store['maxDeliveryKm'] ?? 0) > 0
        && count($availableSlots) > 0
        && $hasVisibleProduct;

    $stmt = $pdo->prepare("SELECT * FROM addon_group WHERE userId = ?");
    $stmt->execute([$store['id']]);
    $addonGroups = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $stmt = $pdo->prepare("SELECT ROUND(AVG(rating), 1) AS avgRating, COUNT(*) AS reviewCount FROM store_review WHERE userId = ?");
    $stmt->execute([$store['id']]);
    $reviewSummary = $stmt->fetch(PDO::FETCH_ASSOC) ?: ['avgRating' => null, 'reviewCount' => 0];
    $reviewCount = (int) ($reviewSummary['reviewCount'] ?? 0);
    $reviewAverage = ($reviewCount > 0 && $reviewSummary['avgRating'] !== null)
        ? (float) $reviewSummary['avgRating']
        : 5.0;

    $stmt = $pdo->prepare("SELECT COUNT(*) AS orderCount FROM `order` WHERE userId = ? AND LOWER(COALESCE(status, '')) NOT IN ('cancelled', 'canceled')");
    $stmt->execute([$store['id']]);
    $orderSummary = $stmt->fetch(PDO::FETCH_ASSOC) ?: ['orderCount' => 0];
    $orderCount = (int) ($orderSummary['orderCount'] ?? 0);
    $deliveryMenuOptions = parseDailyDeliveryItemsValue($store['dailyDeliveryItems'] ?? null);
    $showDeliveryTab = !empty($deliveryMenuOptions['orderTypes']['delivery']);
    $showOrderTab = $acceptOrders && !empty($deliveryMenuOptions['orderTypes']['order']);
    $showOrderTabsNav = $showDeliveryTab && $showOrderTab;

    $stmt = $pdo->prepare("SELECT sr.id, sr.orderId, sr.clientName, sr.rating, sr.comment, sr.createdAt, o.product, o.variation FROM store_review sr LEFT JOIN `order` o ON o.id = sr.orderId WHERE sr.userId = ? ORDER BY sr.createdAt DESC LIMIT 6");
    $stmt->execute([$store['id']]);
    $recentReviews = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Build SSR payload
    $ssrData = [
        'businessName' => $businessName,
        'googleApiKey' => getenv('GOOGLE_MAPS_API_KEY') ?: getenv('GOOGLE_MAPS_KEY') ?: getenv('GOOGLE_API_KEY') ?: ($store['googleApiKey'] ?? ''),
        'deliveryRules' => $store['deliveryRules'] ?? '[]',
        'maxDeliveryKm' => (float) ($store['maxDeliveryKm'] ?? 15),
        'availableSlots' => $availableSlots,
        'pixelId' => $store['pixelId'] ?? '',
        'microsoftClarityId' => $store['microsoftClarityId'] ?? '',
        'googleAnalyticsId' => $store['googleAnalyticsId'] ?? '',
        'accentColor' => $accentColor,
        'accentColorOrders' => $orderAccentColor,
        'buttonColor' => $buttonColor,
        'buttonColorOrders' => $orderButtonColor,
        'buttonTextColor' => $buttonTextColor,
        'backgroundColor' => $backgroundColor,
        'textColor' => $textColor,
        'menuTheme' => $menuTheme,
        'acceptOrders' => $acceptOrders,
        'dailyDeliveryItems' => $deliveryMenuOptions,
        'businessCategory' => $businessCategory,
        'prepTime' => $store['prepTime'] ?? '',
        'featuredCountDesktop' => (int) ($store['featuredCountDesktop'] ?? 4),
        'featuredCountTablet' => (int) ($store['featuredCountTablet'] ?? 2),
        'featuredCountMobile' => (int) ($store['featuredCountMobile'] ?? 1),
        'logoUrl' => $logoUrl,
        'faviconUrl' => $faviconUrl,
        'seoDescription' => $store['seoDescription'] ?? '',
        'products' => $products,
        'categories' => $categories,
        'addonGroups' => $addonGroups,
        'reviewSummary' => [
            'averageRating' => $reviewAverage,
            'reviewCount' => $reviewCount,
            'orderCount' => $orderCount
        ],
        'recentReviews' => $recentReviews,
        'showDeliveryTab' => $showDeliveryTab,
        'showOrderTab' => $showOrderTab,
        'marketplaceReady' => $marketplaceReady,
        'hasLogo' => !empty($store['logoUrl'])
    ];

?>
    <!DOCTYPE html>
    <html lang="pt-BR">

    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <?php if (!empty($store['seoDescription'])): ?>
            <meta name="description" content="<?php echo htmlspecialchars($store['seoDescription']); ?>">
        <?php endif; ?>
        <title><?php echo $businessName; ?> | Cardápio Digital Menzzu</title>
        <link rel="icon" type="image/x-icon" href="<?php echo $faviconUrl; ?>">
        <link rel="preconnect" href="https://maps.googleapis.com" crossorigin>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
        <link rel="preconnect" href="https://files.menzzu.com" crossorigin>
        <!-- SSR Data Hydration: inject all data up front, zero API roundtrip -->
        <script>
            window.__STORE_SLUG__ = <?php echo json_encode($slug, JSON_HEX_TAG | JSON_HEX_AMP); ?>;
        </script>
        <script>
            window.__SSR__ = <?php echo json_encode($ssrData, JSON_HEX_TAG | JSON_HEX_AMP); ?>;
        </script>
        <link rel="stylesheet" href="https://menzzu.com/cardapio/style.css?v=3.48">
        <style>
            :root {
                --primary-color:
                    <?php echo $accentColor; ?>;
                --bg-color:
                    <?php echo $backgroundColor; ?>;
                --text-main:
                    <?php echo $textColor; ?>;
                --text-secondary:
                    <?php echo $textSecondary; ?>;
                --btn:
                    <?php echo $buttonColor; ?>;
                --btn-text:
                    <?php echo $buttonTextColor; ?>;
                --accent:
                    <?php echo $accentColor; ?>;
                --surface-color:
                    <?php echo $surfaceColor; ?>;
                --surface-soft:
                    <?php echo $surfaceSoftColor; ?>;
                --border-color:
                    <?php echo $borderColor; ?>;
                --bg-tertiary:
                    <?php echo $surfaceSoftColor; ?>;
                --text-primary:
                    <?php echo $textColor; ?>;
            }

            body {
                background-color: var(--bg-color);
                color: var(--text-main);
            }

            /* Ajuste de Contraste para Inputs (Legibilidade 100%) */
            .ifood-input {
                width: 100%;
                padding: 14px;
                border-radius: 12px;
                border: 1.5px solid #eee;
                background: #f9f9f9;
                color: #1a1a1a;
                /* Texto escuro para fundo claro */
                margin-bottom: 16px;
                font-family: inherit;
                font-size: 1rem;
                transition: border-color 0.2s;
            }

            .ifood-input:focus {
                border-color: var(--accent);
                outline: none;
                background: #fff;
            }

            .ifood-input:disabled,
            .ifood-input[disabled] {
                background: #f3f4f6;
                color: #9ca3af;
                cursor: not-allowed;
            }

            #schedule-time option:disabled {
                color: #9ca3af;
            }

            .checkout-step.hidden {
                display: none;
            }

            .modal {
                z-index: 1040 !important;
            }

            .modal-overlay {
                z-index: 1039 !important;
            }

            .modal-content {
                z-index: 1040 !important;
            }

            /* Garante que o SweetAlert fique ACIMA dos modais */
            .swal2-container {
                z-index: 1100 !important;
            }

            /* Estilo para labels internas */
            .field-label {
                display: block;
                margin-bottom: 8px;
                font-size: 0.85rem;
                font-weight: 600;
                color: #666;
            }

            /* Estilo do Resumo */
            .summary-row {
                display: flex;
                justify-content: space-between;
                margin-bottom: 10px;
                font-size: 0.95rem;
            }

            .summary-total-row {
                display: flex;
                justify-content: space-between;
                font-weight: 800;
                font-size: 1.2rem;
                border-top: 1px dashed #ddd;
                padding-top: 12px;
                margin-top: 12px;
                color: var(--text-main);
            }

            /* Google Autocomplete Fix */
            .pac-container {
                z-index: 1100 !important;
                border-radius: 8px;
                border: none;
                margin-top: 2px;
                box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
                font-family: inherit;
            }

            .pac-item {
                padding: 10px 12px;
                cursor: pointer;
            }

            .pac-item:hover {
                background: #f9f9f9;
            }

            .pac-item-query {
                font-size: 14px;
                color: #333;
            }

            .pac-icon {
                display: none;
            }

            /* SKELETON LOADER PREMIUM */
            .skeleton {
                background: linear-gradient(90deg, #f0f0f0 25%, #f7f7f7 50%, #f0f0f0 75%);
                background-size: 200% 100%;
                animation: shimmer 1.5s infinite linear;
                border-radius: 8px;
            }

            @keyframes shimmer {
                0% {
                    background-position: 200% 0;
                }

                100% {
                    background-position: -200% 0;
                }
            }

            .skeleton-card {
                display: flex;
                justify-content: space-between;
                padding: 16px;
                background: #fff;
                border-radius: 16px;
                margin-bottom: 12px;
                border: 1px solid #f0f0f0;
            }

            .skeleton-text-group {
                flex: 1;
                padding-right: 16px;
            }

            .skeleton-title {
                height: 18px;
                width: 60%;
                margin-bottom: 8px;
            }

            .skeleton-desc {
                height: 12px;
                width: 90%;
                margin-bottom: 6px;
            }

            .skeleton-price {
                height: 16px;
                width: 30%;
                margin-top: 12px;
            }

            .skeleton-img-box {
                width: 80px;
                height: 80px;
                border-radius: 12px;
            }

            .rating-badge {
                padding: 0;
                border-radius: 0;
                font-size: 0.96rem;
                font-weight: 700;
                display: inline-flex;
                align-items: center;
                gap: 6px;
                white-space: nowrap;
                color: #f59e0b;
            }

            .rating-badge.has-rating {
                color: #f59e0b;
            }

            .rating-badge.no-rating {
                color: #6b7280;
                font-size: 0.9rem;
                font-weight: 600;
            }

            .store-header-actions {
                display: inline-flex;
                align-items: center;
                gap: 12px;
                flex-wrap: wrap;
                justify-content: flex-end;
                margin-left: auto;
            }

            .more-link-btn {
                appearance: none;
                border: none;
                background: transparent;
                color: var(--primary-color);
                font-size: 0.95rem;
                font-weight: 700;
                display: inline-flex;
                align-items: center;
                gap: 6px;
                cursor: pointer;
                padding: 6px 0;
                white-space: nowrap;
            }

            .more-link-btn:hover {
                opacity: 0.82;
            }

            .header-divider {
                width: 1px;
                height: 22px;
                background: rgba(0, 0, 0, 0.10);
            }
        </style>
    </head>

    <body class="<?php echo $isDarkTheme ? 'theme-dark' : 'theme-light'; ?>">

        <header class="top-nav">
            <div class="container nav-wrapper">
                <div class="store-info">
                    <div class="store-logo"><img src="<?php echo $logoUrl; ?>" alt="Logo" fetchpriority="high"
                            decoding="async"></div>
                    <div class="store-details">
                        <div class="store-name-row">
                            <div class="store-title-block">
                                <h1 id="store-name"><?php echo htmlspecialchars($businessName, ENT_QUOTES, 'UTF-8'); ?></h1>
                                <?php if ($businessCategory !== ''): ?>
                                    <div class="store-category"><?php echo htmlspecialchars($businessCategory, ENT_QUOTES, 'UTF-8'); ?></div>
                                <?php endif; ?>
                                <div class="store-meta-line">
                                    <span id="store-status-badge" class="status-badge <?php echo $marketplaceReady ? 'open' : 'closed'; ?>"><?php echo $marketplaceReady ? 'Aberto' : 'Inativo'; ?></span>
                                    <?php if ($prepTimeLabel !== ''): ?>
                                        <span class="store-meta-separator" aria-hidden="true">•</span>
                                        <span id="store-prep-time" class="store-prep-time"><?php echo htmlspecialchars($prepTimeLabel, ENT_QUOTES, 'UTF-8'); ?></span>
                                    <?php endif; ?>
                                </div>
                            </div>
                            <?php if ($orderCount > 0): ?>
                                <div id="store-rating-badge" class="rating-badge has-rating">
                                    <svg class="rating-star-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                        <path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9L12 2.5z" fill="currentColor"></path>
                                    </svg>
                                    <?php echo number_format($reviewAverage, 1, ',', '.'); ?><?php if ($reviewCount > 0): ?> (<?php echo (int) $reviewCount; ?> <?php echo $reviewCount === 1 ? 'avaliação' : 'avaliações'; ?>)<?php endif; ?>
                                </div>
                            <?php endif; ?>
                        </div>
                    </div>
                </div>
                <div class="store-header-actions">
                    <button class="more-link-btn" id="history-toggle-btn" aria-label="Ver mais sobre a loja">
                        <span class="more-link-text">Ver mais</span><i data-lucide="chevron-down"></i>
                    </button>
                    <div class="header-divider" aria-hidden="true"></div>
                </div>
            </div>
        </header>

        <nav id="order-tabs-nav" class="category-tabs <?php echo $showOrderTabsNav ? '' : 'hidden'; ?>">
            <div class="container tabs-scroll">
                <?php if ($showDeliveryTab): ?>
                    <button class="cat-tab active" data-tab="delivery">Entrega</button>
                <?php endif; ?>
                <?php if ($showOrderTab): ?>
                    <button class="cat-tab<?php echo $showDeliveryTab ? '' : ' active'; ?>" data-tab="order">Encomendas</button>
                <?php endif; ?>
            </div>
        </nav>

        <nav class="category-nav hidden">
            <div class="container category-nav-shell">
                <div class="category-nav-scroll" id="category-nav-scroll"></div>
                <button type="button" class="category-search-toggle" id="mobile-search-toggle" aria-label="Abrir busca">
                    <i data-lucide="search"></i>
                </button>
            </div>
        </nav>

        <div class="container search-container" id="search-container">
            <div class="search-box">
                <i data-lucide="search"></i>
                <input type="text" id="search-input" placeholder="Buscar no cardápio">
            </div>
        </div>

        <main class="container main-menu">
            <div id="menu-sections">
                <div id="skeleton-loader" class="hidden"></div>
                <div id="actual-menu-content">
                    <?php
                    $imgCounter = 0;
                    $groupedProducts = [];
                    $orderedSectionKeys = [];

                    foreach ($products as $p) {
                        $catName = 'Geral';
                        if (!empty($p['categoryId'])) {
                            foreach ($categories as $cat) {
                                if ((string) $cat['id'] === (string) $p['categoryId']) {
                                    $catName = $cat['name'];
                                    break;
                                }
                            }
                        } elseif (!empty($p['category'])) {
                            $catName = $p['category'];
                        }

                        if (!isset($groupedProducts[$catName])) {
                            $groupedProducts[$catName] = [];
                            $orderedSectionKeys[] = $catName;
                        }

                        $groupedProducts[$catName][] = $p;
                    }

                    foreach ($orderedSectionKeys as $sectionName):
                        $catProducts = $groupedProducts[$sectionName] ?? [];
                        if (empty($catProducts))
                            continue;
                    ?>
                        <section class="menu-section">
                            <h2 class="section-title"><?php echo htmlspecialchars($sectionName, ENT_QUOTES, 'UTF-8'); ?></h2>
                            <div class="products-grid">
                                <?php foreach ($catProducts as $p): ?>
                                    <div class="product-card" onclick="openItemDetail('<?php echo $p['id']; ?>')">
                                        <?php if ($p['image']): ?>
                                            <img src="<?php echo str_replace('.webp', '_550.webp', json_decode($p['image'], true)[0] ?? $p['image']); ?>"
                                                class="product-img" <?php echo $imgCounter < 4 ? 'fetchpriority="high"' : 'loading="lazy" decoding="async"'; ?>>
                                            <?php $imgCounter++; ?>
                                        <?php endif; ?>
                                        <div class="product-info">
                                            <h3><?php echo $p['name']; ?></h3>
                                            <p><?php echo $p['description']; ?></p>
                                            <?php
                                            $basePrice = isset($p['price']) ? (float) $p['price'] : 0;
                                            $promoPrice = isset($p['promoPrice']) ? (float) $p['promoPrice'] : 0;
                                            $hasPromo = $promoPrice > 0 && $promoPrice < $basePrice;
                                            ?>
                                            <div class="product-price">
                                                <?php if ($hasPromo): ?>
                                                    <span style="text-decoration:line-through;opacity:.65;margin-right:6px;">R$ <?php echo number_format($basePrice, 2, ',', '.'); ?></span>
                                                    <span>R$ <?php echo number_format($promoPrice, 2, ',', '.'); ?></span>
                                                <?php else: ?>
                                                    R$ <?php echo number_format($basePrice, 2, ',', '.'); ?>
                                                <?php endif; ?>
                                            </div>
                                        </div>
                                    </div>
                                <?php endforeach; ?>
                            </div>
                        </section>
                    <?php endforeach; ?>
                </div>
            </div>
        </main>
        </footer>
        <!-- MODAL DETALHE -->
        <div id="item-detail-modal" class="modal hidden" aria-modal="true" role="dialog" aria-label="Detalhes do Produto">
            <div class="modal-overlay"></div>
            <div class="modal-content item-detail-content">
                <button class="close-modal-btn" onclick="closeWithAnimation('item-detail-modal')" aria-label="Fechar Modal">
                    <i data-lucide="x"></i>
                </button>
                <div id="item-detail-body"></div>
            </div>
        </div>

        <!-- MODAL AGENDAMENTO DA ENCOMENDA -->
        <div id="order-schedule-modal" class="modal hidden" aria-modal="true" role="dialog" aria-label="Agendamento da Encomenda">
            <div class="modal-overlay"></div>
            <div class="modal-content" style="max-width: 420px;">
                <div class="modal-header">
                    <button class="close-modal-btn" onclick="closeWithAnimation('order-schedule-modal')" aria-label="Fechar Agendamento">
                        <i data-lucide="x"></i>
                    </button>
                    <h2 style="margin: 0; font-size: 1.15rem;">Escolha data e horário</h2>
                    <div style="width: 40px;"></div>
                </div>
                <div class="modal-scroll-body" style="padding-top: 10px;">
                    <p style="margin: 0 0 16px; color: var(--text-gray); font-size: 0.92rem;">Antes de adicionar sua encomenda, confirme quando deseja receber ou retirar.</p>
                    <div class="form-group">
                        <label class="field-label">Data da Encomenda</label>
                        <input type="date" id="schedule-date" class="ifood-input">
                    </div>
                    <div class="form-group">
                        <label class="field-label">Horário</label>
                        <select id="schedule-time" class="ifood-input">
                            <option value="">Selecione uma data primeiro</option>
                        </select>
                    </div>
                    <div id="schedule-availability-note" style="margin-top: 10px; color: var(--text-gray); font-size: 0.82rem;"></div>
                </div>
                <div class="modal-footer-sticky" style="position: sticky; bottom: 0;">
                    <button id="confirm-schedule-btn" class="primary-btn">Confirmar horário</button>
                </div>
            </div>
        </div>

        <!-- MODAL CHECKOUT 2.0 -->
        <div id="checkout-modal" class="modal hidden" aria-modal="true" role="dialog" aria-label="Checkout">
            <div class="modal-overlay"></div>
            <div class="modal-content checkout-content">
                <div class="modal-header">
                    <button id="checkout-back-btn" class="back-btn" aria-label="Voltar"><i
                            data-lucide="chevron-left"></i></button>
                    <h2 id="checkout-step-title">Finalizar Pedido</h2>
                    <button class="close-modal-btn" aria-label="Fechar Checkout"><i data-lucide="x"></i></button>
                </div>

                <div class="modal-scroll-body">
                    <!-- Step 1: Cart -->
                    <div class="checkout-step" id="step-1">
                        <div id="checkout-items-list" class="checkout-items"></div>
                        <div style="margin-top:20px; border-top:1px solid #eee; padding-top:20px;">
                            <div class="form-group">
                                <label class="field-label">Seu Nome</label>
                                <input type="text" id="user-name" class="ifood-input" placeholder="Nome completo">
                            </div>
                            <div class="form-group">
                                <label class="field-label">WhatsApp</label>
                                <input type="tel" id="user-phone" class="ifood-input" placeholder="(00) 00000-0000">
                            </div>
                        </div>
                    </div>

                    <!-- Step 2: Details -->
                    <div class="checkout-step hidden" id="step-2">
                        <!-- Toggle Delivery/Pickup -->
                        <div id="checkout-type-tabs" style="display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap;">
                            <button type="button" class="ifood-btn type-tab active" data-method="delivery" style="flex: 1; padding: 10px;"
                                onclick="setDeliveryType('delivery')">Entrega</button>
                            <button type="button" class="ifood-btn type-tab" data-method="pickup"
                                style="flex: 1; background: var(--bg-gray); color: var(--text-main); padding: 10px;"
                                onclick="setDeliveryType('pickup')">Retirada na Loja</button>
                            <button type="button" class="ifood-btn type-tab" data-method="local"
                                style="flex: 1; background: var(--bg-gray); color: var(--text-main); padding: 10px;"
                                onclick="setDeliveryType('local')">Consumo no Local</button>
                        </div>

                        <!-- Address Section -->
                        <div id="delivery-address-section">
                            <div class="form-group">
                                <label class="field-label">Endereço de Entrega</label>
                                <input type="text" id="user-address" class="ifood-input"
                                    placeholder="Rua, número, bairro...">
                            </div>
                            <div id="delivery-map"
                                style="height:200px; width:100%; border-radius:12px; background:#e8e8e8; margin-bottom:14px; overflow:hidden;">
                            </div>
                            <div id="delivery-fee-display"
                                style="margin-bottom:15px; font-weight:600; text-align:center; padding:10px; border-radius:10px; background:#f9f9f9; display:none;">
                            </div>
                        </div>

                        <!-- Extras da Encomenda -->
                        <div id="order-step-content" class="hidden"></div>
                    </div>

                    <!-- Step 3: Payment Method -->
                    <div class="checkout-step hidden" id="step-3">
                        <h3 style="font-size:1rem; font-weight:700; margin-bottom:18px; color:var(--text-main);">Forma de
                            Pagamento</h3>
                        <div id="payment-options" style="display:flex; flex-direction:column; gap:12px;"></div>
                    </div>

                    <!-- Step 4: Summary -->
                    <div class="checkout-step hidden" id="step-4">
                        <div id="order-summary-content">
                            <div class="summary-section">
                                <h3 class="field-label" style="font-size: 1.1rem; margin-bottom: 12px;">Resumo dos Itens
                                </h3>
                                <div id="review-items-list" style="margin-bottom: 20px;"></div>
                            </div>
                            <div id="payment-method-summary"
                                style="margin-bottom:12px; padding:10px 14px; border-radius:10px; background:#f0fdf4; color:#166534; font-weight:600;">
                            </div>
                            <div id="order-schedule-review" class="summary-section hidden" style="margin-bottom: 14px; padding: 12px 14px; border-radius: 12px; background: rgba(74, 44, 42, 0.06); border: 1px solid rgba(74, 44, 42, 0.10);">
                                <div style="font-size: 11px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-gray);">Agendamento</div>
                                <div id="order-schedule-review-value" style="margin-top: 4px; font-size: 14px; font-weight: 700; color: var(--text-main);">Nenhum horário selecionado.</div>
                            </div>
                            <div class="summary-section" style="background: #f9f9f9; padding: 15px; border-radius: 12px;">
                                <div class="summary-row"
                                    style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                                    <span>Subtotal</span>
                                    <span id="summary-subtotal">R$ 0,00</span>
                                </div>
                                <div id="delivery-fee-line" class="summary-row hidden"
                                    style="display: flex; justify-content: space-between; margin-bottom: 8px; color: #166534;">
                                    <span>Taxa de entrega</span>
                                    <span id="summary-fee">R$ 0,00</span>
                                </div>
                                <div class="summary-total-row"
                                    style="display: flex; justify-content: space-between; font-weight: 800; font-size: 1.2rem; border-top: 1px dashed #ddd; padding-top: 12px; margin-top: 12px;">
                                    <span>Total</span>
                                    <span id="summary-total">R$ 0,00</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="modal-footer-sticky">
                    <button id="next-step-btn" class="primary-btn">Próximo</button>
                    <button id="place-order-btn" class="primary-btn hidden">Confirmar e Pagar</button>
                </div>
            </div>
        </div>

        <div id="history-modal" class="modal hidden">
            <div class="modal-overlay"></div>
            <div class="modal-content history-drawer">
                <div class="history-modal-header">
                    <h3>Sobre a loja</h3>
                    <button class="close-modal-btn"><i data-lucide="x"></i></button>
                </div>
                <div class="store-info-panel">
                    <div class="store-info-panel-head">
                        <?php if ($logoUrl): ?>
                            <img src="<?php echo htmlspecialchars($logoUrl); ?>" alt="<?php echo htmlspecialchars($businessName); ?>" class="store-info-logo">
                        <?php endif; ?>
                        <div class="store-info-copy">
                            <strong><?php echo htmlspecialchars($businessName); ?></strong>
                            <?php if ($businessCategory !== ''): ?>
                                <div class="store-info-category"><?php echo htmlspecialchars($businessCategory, ENT_QUOTES, 'UTF-8'); ?></div>
                            <?php endif; ?>
                            <?php if ($orderCount > 0): ?>
                                <div class="store-info-rating">
                                    <svg class="rating-star-icon filled" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                        <path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9L12 2.5z" fill="currentColor"></path>
                                    </svg>
                                    <span><?php echo number_format($reviewAverage, 1, ',', '.'); ?></span>
                                    <small>(<?php echo (int) $reviewCount; ?>)</small>
                                </div>
                            <?php endif; ?>
                            <div class="store-meta-line">
                                <div id="drawer-store-status" class="status-badge open">Aberto</div>
                                <?php if ($prepTimeLabel !== ''): ?>
                                    <span class="store-meta-separator" aria-hidden="true">•</span>
                                    <span id="drawer-store-prep-time" class="store-prep-time"><?php echo htmlspecialchars($prepTimeLabel, ENT_QUOTES, 'UTF-8'); ?></span>
                                <?php endif; ?>
                            </div>
                        </div>
                    </div>

                    <?php if (!empty($store['seoDescription'])): ?>
                        <p class="store-info-description"><?php echo htmlspecialchars($store['seoDescription']); ?></p>
                    <?php endif; ?>

                    <div class="store-info-hours">
                            <h4>Horários de abertura</h4>
                            <div class="store-info-hours-list">
                                <?php
                                $dayNames = [
                                    0 => 'Dom',
                                    1 => 'Seg',
                                    2 => 'Ter',
                                    3 => 'Qua',
                                    4 => 'Qui',
                                    5 => 'Sex',
                                    6 => 'Sab'
                                ];
                                $slotsByDay = [];
                                foreach ($availableSlots as $slot) {
                                    $day = (int) ($slot['dayOfWeek'] ?? 0);
                                    $slotsByDay[$day][] = substr((string) ($slot['startTime'] ?? '00:00'), 0, 5) . ' - ' . substr((string) ($slot['endTime'] ?? '00:00'), 0, 5);
                                }
                                for ($day = 0; $day <= 6; $day++):
                                    $dayLabel = $dayNames[$day];
                                    $dayHours = $slotsByDay[$day] ?? [];
                                ?>
                                    <div class="store-info-hour-row<?php echo empty($dayHours) ? ' is-closed' : ''; ?>">
                                        <span><?php echo htmlspecialchars($dayLabel); ?></span>
                                        <strong><?php echo htmlspecialchars(empty($dayHours) ? 'Fechado' : implode(' • ', $dayHours)); ?></strong>
                                    </div>
                                <?php endfor; ?>
                            </div>
                    </div>
                </div>
                <h4 class="store-info-section-title">Meus pedidos</h4>
                <div id="history-modal-list" class="history-modal-list"></div>
            </div>
        </div>

        <div id="review-modal" class="modal hidden">
            <div class="modal-overlay"></div>
            <div class="modal-content" style="max-width: 520px;">
                <div class="history-modal-header">
                    <h3>Avaliar pedido</h3>
                    <button class="close-modal-btn" onclick="closeWithAnimation('review-modal')" aria-label="Fechar avaliação"><i data-lucide="x"></i></button>
                </div>
                <div class="review-modal-body">
                    <div id="review-target" class="review-target">Selecione uma nota para continuar.</div>
                    <div id="review-stars" class="review-stars"></div>
                    <textarea id="review-comment" class="ifood-input review-comment" placeholder="Comentário opcional"></textarea>
                    <div class="review-modal-note">Sua avaliação ajuda outras pessoas a escolherem melhor.</div>
                    <button id="submit-review-btn" class="primary-btn" onclick="submitStoreReview()">Enviar avaliação</button>
                </div>
            </div>
        </div>

        <!-- RODAPé CARRINHO -->
        <footer id="cart-footer" class="cart-footer hidden">
            <div class="container">
                <button class="primary-btn cart-btn" id="view-cart-btn">
                    <div class="cart-btn-content"><i data-lucide="shopping-bag" style="width:20px;height:20px;"></i><span id="cart-qty-badge">0</span><span>Ver carrinho</span></div>
                    <span id="cart-total-footer">R$ 0,00</span>
                </button>
            </div>
        </footer>

        <?php include 'componentes/footer.php'; ?>

        <!-- Inline SVG Sprite: only the icons we use (~3 KiB vs 92 KiB full Lucide) -->
        <svg xmlns="http://www.w3.org/2000/svg" style="display:none">
            <symbol id="lucide-history" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M12 7v5l4 2" />
            </symbol>
            <symbol id="lucide-search" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
            </symbol>
            <symbol id="lucide-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
            </symbol>
            <symbol id="lucide-minus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12h14" />
            </symbol>
            <symbol id="lucide-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12h14" />
                <path d="M12 5v14" />
            </symbol>
            <symbol id="lucide-chevron-left" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m15 18-6-6 6-6" />
            </symbol>
            <symbol id="lucide-chevron-right" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m9 18 6-6-6-6" />
            </symbol>
            <symbol id="lucide-chevron-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m6 9 6 6 6-6" />
            </symbol>
            <symbol id="lucide-image" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                <circle cx="9" cy="9" r="2" />
                <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
            </symbol>
            <symbol id="lucide-trash-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                <line x1="10" x2="10" y1="11" y2="17" />
                <line x1="14" x2="14" y1="11" y2="17" />
            </symbol>
            <symbol id="lucide-credit-card" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="20" height="14" x="2" y="5" rx="2" />
                <line x1="2" x2="22" y1="10" y2="10" />
            </symbol>
            <symbol id="lucide-check-circle-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="m9 12 2 2 4-4" />
            </symbol>
            <symbol id="lucide-banknote" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="20" height="12" x="2" y="6" rx="2" />
                <circle cx="12" cy="12" r="2" />
                <path d="M6 12h.01M18 12h.01" />
            </symbol>
            <symbol id="lucide-star" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </symbol>
            <symbol id="lucide-shopping-bag" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
                <path d="M3 6h18" />
                <path d="M16 10a4 4 0 0 1-8 0" />
            </symbol>
        </svg>

        <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11" defer></script>
        <script type="text/javascript" src="/cardapio/script.js?v=0.7" defer></script>

    </html>
<?php
    $finalHtml = ob_get_clean();

    // Salva no cache silenciosamente
    if (!is_dir($cacheDir)) {
        @mkdir($cacheDir, 0755, true);
    }
    @file_put_contents($cacheFile, $finalHtml);

    echo $finalHtml;
} catch (Exception $e) {
    die("Erro: " . $e->getMessage());
}
