<?php
// --- CONFIGURAÇÃO DO BANCO ---
$host = '192.185.211.125';
$db = 'monte814_zapfly';
$user = 'monte814_zapfly';
$pass = 'Wa76855867.';

try {
    $pdo = new PDO("mysql:host=$host;dbname=$db;charset=utf8", $user, $pass);

    $uri = $_SERVER['REQUEST_URI'];
    $parts = explode('/', trim($uri, '/'));
    $slug = strtolower($parts[0]);

    if (empty($slug) || $slug === 'index.php' || $slug === 'home') {
        // --- HOME SAAS ---
        ?>
        <!DOCTYPE html>
        <html lang="pt-BR">

        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>DigiZap | Transforme seu WhatsApp em uma Máquina de Vendas</title>
            <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&display=swap" rel="stylesheet">
            <script src="https://unpkg.com/lucide@latest"></script>
            <style>
                :root {
                    --primary: #ff4d6d;
                    --dark: #0f0f0f;
                }

                body {
                    font-family: 'Outfit', sans-serif;
                    background: var(--dark);
                    color: white;
                    text-align: center;
                    margin: 0;
                }

                .hero {
                    height: 100vh;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    align-items: center;
                    padding: 2rem;
                }

                h1 {
                    font-size: 4rem;
                    margin-bottom: 1rem;
                }

                h1 span {
                    color: var(--primary);
                }

                p {
                    color: #888;
                    font-size: 1.2rem;
                    max-width: 600px;
                    margin-bottom: 2rem;
                }

                .btn {
                    background: var(--primary);
                    color: white;
                    padding: 1rem 2rem;
                    border-radius: 50px;
                    text-decoration: none;
                    font-weight: 700;
                }
            </style>
        </head>

        <body>
            <div class="hero">
                <h1>O Cardápio <span>mais rápido</span> do Brasil.</h1>
                <p>Aumente suas vendas no WhatsApp com automação e um cardápio digital que voa.</p>
                <a href="/register" class="btn">Começar Agora Grátis</a>
            </div>
            <script>lucide.createIcons();</script>
        </body>

        </html>
        <?php
        exit;
    }

    // --- CARDÁPIO DO CLIENTE ---
    $stmt = $pdo->prepare("SELECT u.*, s.businessName, s.logoUrl, s.seoDescription, s.accentColor FROM user u LEFT JOIN setting s ON u.id = s.userId WHERE u.slug = ?");
    $stmt->execute([$slug]);
    $store = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$store) {
        header("Location: /");
        exit;
    }

    $businessName = $store['businessName'] ?: $store['name'];
    $accentColor = $store['accentColor'] ?: '#ff4d6d';

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
        <title><?php echo $businessName; ?> - Cardápio Digital</title>
        <meta name="description" content="<?php echo $store['seoDescription']; ?>">
        <meta property="og:title" content="<?php echo $businessName; ?> - Cardápio Digital">
        <meta property="og:image" content="<?php echo $store['logoUrl']; ?>">
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
            rel="stylesheet">
        <link rel="stylesheet" href="style.css?v=1.65">
        <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
        <style>
            :root {
                --accent:
                    <?php echo $accentColor; ?>
                ;
            }
        </style>
    </head>

    <body>
        <div id="app">
            <header class="top-nav">
                <div class="container nav-wrapper">
                    <div class="store-info">
                        <div class="store-logo">
                            <img id="store-logo-img" src="<?php echo $store['logoUrl']; ?>"
                                alt="Logo - <?php echo $businessName; ?>"
                                style="width: 100%; height: 100%; object-fit: contain;">
                        </div>
                        <div class="store-details">
                            <h1 id="store-name"><?php echo $businessName; ?></h1>
                            <div class="store-status">
                                <span class="status-badge" id="store-status-badge">Carregando...</span>
                            </div>
                        </div>
                    </div>
                    <div class="nav-actions">
                        <button id="history-toggle-btn" class="icon-btn" aria-label="Ver Histórico"><i
                                data-lucide="history"></i></button>
                    </div>
                </div>
            </header>

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

            <div id="category-nav" class="container category-nav hidden">
                <div id="category-nav-scroll" class="category-nav-scroll"></div>
            </div>

            <main class="container main-menu">
                <div id="menu-sections">
                    <?php foreach ($categories as $cat):
                        $catProducts = array_filter($products, function ($p) use ($cat) {
                            return $p['categoryId'] == $cat['id'];
                        });
                        if (empty($catProducts))
                            continue;
                        ?>
                        <section class="menu-section">
                            <h2 class="section-title"><?php echo $cat['name']; ?></h2>
                            <div class="products-grid">
                                <?php foreach ($catProducts as $p): ?>
                                    <div class="product-card"
                                        onclick="openItemModal(<?php echo htmlspecialchars(json_encode($p)); ?>)">
                                        <div class="product-info">
                                            <h3><?php echo $p['name']; ?></h3>
                                            <p><?php echo $p['description']; ?></p>
                                            <div class="product-price">R$ <?php echo number_format($p['price'], 2, ',', '.'); ?>
                                            </div>
                                        </div>
                                        <?php if ($p['image']):
                                            $img = json_decode($p['image'], true);
                                            $thumb = is_array($img) ? $img[0] : $p['image'];
                                            $thumbUrl = str_replace('.webp', '_90.webp', $thumb);
                                            ?>
                                            <img src="<?php echo $thumbUrl; ?>" alt="<?php echo $p['name']; ?>" class="product-img">
                                        <?php endif; ?>
                                    </div>
                                <?php endforeach; ?>
                            </div>
                        </section>
                    <?php endforeach; ?>
                </div>
            </main>

            <footer id="cart-footer" class="cart-footer hidden">
                <div class="container">
                    <button id="view-cart-btn" class="primary-btn cart-btn">
                        <div class="cart-btn-content">
                            <span id="cart-qty-badge">0</span>
                            <strong>Ver sacola</strong>
                        </div>
                        <span id="cart-total-footer">R$ 0,00</span>
                    </button>
                </div>
            </footer>

            <!-- Modais -->
            <div id="item-modal" class="modal hidden">
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
                        <button id="add-to-cart-btn" class="primary-btn">Adicionar <span id="add-btn-price"></span></button>
                    </div>
                </div>
            </div>

            <div id="checkout-modal" class="modal hidden">
                <div class="modal-overlay"></div>
                <div class="modal-content checkout-content">
                    <div class="modal-header">
                        <button id="checkout-back-btn" class="back-btn"><i data-lucide="chevron-left"></i></button>
                        <h2 id="checkout-step-title">Finalizar Pedido</h2>
                        <button class="close-modal-btn"><i data-lucide="x"></i></button>
                    </div>
                    <div class="modal-scroll-body">
                        <div class="checkout-step" id="step-1">
                            <div id="checkout-items-list" class="checkout-items"></div>
                        </div>
                        <div class="checkout-step hidden" id="step-2">
                            <div class="form-group"><label>Nome</label><input type="text" id="user-name"
                                    class="ifood-input"></div>
                            <div class="form-group"><label>WhatsApp</label><input type="tel" id="user-phone"
                                    class="ifood-input"></div>
                            <div class="form-group"><label>Endereço</label><textarea id="user-address"
                                    class="ifood-input"></textarea></div>
                            <div class="form-group"><label>Data</label><input type="date" id="order-date"
                                    class="ifood-input"></div>
                            <div class="form-group"><label>Horário</label><select id="order-time" class="ifood-input">
                                    <option value="">Selecione uma data</option>
                                </select></div>
                        </div>
                        <div class="checkout-step hidden" id="step-3">
                            <div id="order-summary-content"></div>
                        </div>
                    </div>
                    <div class="modal-footer-sticky">
                        <button id="next-step-btn" class="primary-btn">Próximo</button>
                        <button id="place-order-btn" class="primary-btn hidden">Confirmar Pedido</button>
                    </div>
                </div>
            </div>

            <div id="history-modal" class="modal hidden">
                <div class="modal-overlay"></div>
                <div class="modal-content">
                    <div class="history-modal-header">
                        <h3>Meus Pedidos</h3><button class="close-modal-btn"><i data-lucide="x"></i></button>
                    </div>
                    <div id="history-list" class="history-modal-list"></div>
                </div>
            </div>
        </div>

        <script>
            const API_BASE = 'https://api.digizap.com.br';
        </script>
        <script src="https://unpkg.com/lucide@latest"></script>
        <script src="script.js?v=1.33"></script>
    </body>

    </html>
    <?php
} catch (Exception $e) {
    die("Erro no sistema: " . $e->getMessage());
}
