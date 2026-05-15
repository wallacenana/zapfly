<?php
/**
 * DigiZap - Cardápio All-in-One (Versão Blindada)
 */

if (php_sapi_name() === 'cli-server') {
    $path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
    if (file_exists(__DIR__ . $path) && !is_dir(__DIR__ . $path)) {
        return false;
    }
}

$host = '192.185.211.125';
$db = 'monte814_zapfly';
$user = 'monte814_zapfly';
$pass = 'Wa76855867.';

try {
    $pdo = new PDO("mysql:host=$host;dbname=$db;charset=utf8", $user, $pass);

    $uri = $_SERVER['REQUEST_URI'];
    $path = parse_url($uri, PHP_URL_PATH);
    $parts = explode('/', trim($path, '/'));
    $slug = strtolower(end($parts));

    if (empty($slug) || $slug === 'cardapio' || $slug === 'index.php') {
        header("Location: /");
        exit;
    }

    $stmt = $pdo->prepare("SELECT u.*, s.businessName, s.logoUrl, s.faviconUrl, s.accentColor, s.backgroundColor, s.textColor, s.buttonColor, s.buttonTextColor FROM user u LEFT JOIN setting s ON u.id = s.userId WHERE u.slug = ?");
    $stmt->execute([$slug]);
    $store = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$store) {
        header("Location: /");
        exit;
    }

    $businessName = $store['businessName'] ?: $store['name'];
    $faviconUrl = $store['faviconUrl'] ?: '/favicon.ico';
    $accentColor = $store['accentColor'] ?: '#ff4d6d';
    $backgroundColor = $store['backgroundColor'] ?: '#0f0f0f';
    $textColor = $store['textColor'] ?: '#ffffff';
    $buttonColor = $store['buttonColor'] ?: $accentColor;
    $buttonTextColor = $store['buttonTextColor'] ?: '#ffffff';

    // Dados de Menu
    $stmt = $pdo->prepare("SELECT * FROM category WHERE userId = ? ORDER BY `order` ASC");
    $stmt->execute([$store['id']]);
    $categories = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $stmt = $pdo->prepare("SELECT * FROM product WHERE userId = ? ORDER BY displayOrder ASC");
    $stmt->execute([$store['id']]);
    $products = $stmt->fetchAll(PDO::FETCH_ASSOC);

    ?>
    <!DOCTYPE html>
    <html lang="pt-BR">

    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title><?php echo $businessName; ?> | Cardápio Digital</title>
        <link rel="icon" type="image/x-icon" href="<?php echo $faviconUrl; ?>">
        <link
            href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
            rel="stylesheet">
        <link rel="stylesheet" href="/cardapio/style.css?v=1.70">
        <script src="https://unpkg.com/lucide@latest"></script>
        <style>
            :root {
                --primary-color:
                    <?php echo $accentColor; ?>
                ;
                --bg-color:
                    <?php echo $backgroundColor; ?>
                ;
                --text-main:
                    <?php echo $textColor; ?>
                ;
                --btn:
                    <?php echo $buttonColor; ?>
                ;
                --btn-text:
                    <?php echo $buttonTextColor; ?>
                ;
                --accent:
                    <?php echo $accentColor; ?>
                ;
            }

            body {
                background-color: var(--bg-color);
                color: var(--text-main);
            }
        </style>
    </head>

    <body>

        <?php include 'componentes/header.php'; ?>

        <nav class="category-tabs">
            <div class="container tabs-scroll">
                <button class="cat-tab active" data-tab="delivery">Entrega</button>
                <button class="cat-tab" data-tab="order">Encomendas</button>
            </div>
        </nav>

        <div class="container search-container">
            <div class="search-box">
                <i data-lucide="search"></i>
                <input type="text" id="search-input" placeholder="Buscar no cardápio">
            </div>
        </div>

        <main class="container main-menu">
            <div id="menu-sections">
                <div id="skeleton-loader" class="hidden"></div> <!-- O JS vai controlar o skeleton -->
                <div id="actual-menu-content">
                    <?php foreach ($categories as $cat):
                        $catProducts = array_filter($products, function ($p) use ($cat) {
                            return $p['categoryId'] == $cat['id']; });
                        if (empty($catProducts))
                            continue;
                        ?>
                        <section class="menu-section">
                            <h2 class="section-title"><?php echo $cat['name']; ?></h2>
                            <div class="products-grid">
                                <?php foreach ($catProducts as $p): ?>
                                    <div class="product-card" onclick="openItemDetail('<?php echo $p['id']; ?>')">
                                        <div class="product-info">
                                            <h3><?php echo $p['name']; ?></h3>
                                            <p><?php echo $p['description']; ?></p>
                                            <div class="product-price">R$ <?php echo number_format($p['price'], 2, ',', '.'); ?>
                                            </div>
                                        </div>
                                        <?php if ($p['image']): ?>
                                            <img src="<?php echo str_replace('.webp', '_90.webp', json_decode($p['image'], true)[0] ?? $p['image']); ?>"
                                                class="product-img">
                                        <?php endif; ?>
                                    </div>
                                <?php endforeach; ?>
                            </div>
                        </section>
                    <?php endforeach; ?>
                </div>
            </div>
        </main>

        <!-- MODAL DETALHE DO ITEM -->
        <div id="item-detail-modal" class="modal hidden">
            <div class="modal-overlay"></div>
            <div class="modal-content item-detail-content">
                <button class="close-modal-btn"><i data-lucide="x"></i></button>
                <div id="item-detail-body"></div>
                <div class="modal-footer-sticky">
                    <div class="qty-selector">
                        <button class="qty-btn" id="qty-minus"><i data-lucide="minus"></i></button>
                        <span id="detail-qty">1</span>
                        <button class="qty-btn" id="qty-plus"><i data-lucide="plus"></i></button>
                    </div>
                    <button id="add-to-cart-btn" class="primary-btn">
                        Adicionar <span id="add-btn-price">R$ 0,00</span>
                    </button>
                </div>
            </div>
        </div>

        <!-- MODAL CHECKOUT -->
        <div id="checkout-modal" class="modal hidden">
            <div class="modal-overlay"></div>
            <div class="modal-content checkout-content">
                <div class="modal-header">
                    <button class="back-btn" id="checkout-back-btn"><i data-lucide="chevron-left"></i></button>
                    <h2 id="checkout-step-title">Ver sacola</h2>
                </div>
                <div class="modal-scroll-body">
                    <div id="checkout-items-list"></div>
                    <!-- Campos de dados serão injetados pelo JS conforme o passo -->
                </div>
                <div class="modal-footer-sticky">
                    <button id="next-step-btn" class="primary-btn">Continuar</button>
                    <button id="place-order-btn" class="primary-btn hidden">Finalizar Pedido</button>
                </div>
            </div>
        </div>

        <!-- BOTÃO FLUTUANTE CARRINHO -->
        <footer id="cart-footer" class="cart-footer hidden">
            <div class="container">
                <button class="primary-btn cart-btn" id="view-cart-btn">
                    <div class="cart-btn-content">
                        <span id="cart-qty-badge">0</span>
                        <span>Ver carrinho</span>
                    </div>
                    <span id="cart-total-footer">R$ 0,00</span>
                </button>
            </div>
        </footer>

        <?php include 'componentes/footer.php'; ?>

        <script>
            const API_BASE = 'https://api.digizap.com.br';
        </script>
        <script src="/cardapio/script.js?v=1.50"></script>
        <script>lucide.createIcons();</script>
    </body>

    </html>
    <?php
} catch (Exception $e) {
    die("Erro: " . $e->getMessage());
}
