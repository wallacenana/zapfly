<?php
/**
 * DigiZap - Cardápio Digital (Versão Final Sincronizada)
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

    $stmt = $pdo->prepare("
        SELECT u.*, s.businessName, s.logoUrl, s.faviconUrl,
               s.accentColor, s.backgroundColor, s.textColor,
               s.buttonColor, s.buttonTextColor
        FROM user u
        LEFT JOIN setting s ON u.id = s.userId
        WHERE u.slug = ?
    ");
    $stmt->execute([$slug]);
    $store = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$store) {
        header("Location: /");
        exit;
    }

    $businessName = $store['businessName'] ?: $store['name'];
    $logoUrl = $store['logoUrl'] ?: '/cardapio/logo.png';
    $faviconUrl = $store['faviconUrl'] ?: '/favicon.ico';
    $accentColor = $store['accentColor'] ?: '#ff4d6d';
    $backgroundColor = $store['backgroundColor'] ?: '#ffffff';
    $textColor = $store['textColor'] ?: '#1a1a1a';
    $buttonColor = $store['buttonColor'] ?: $accentColor;
    $buttonTextColor = $store['buttonTextColor'] ?: '#ffffff';

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
        <title><?php echo htmlspecialchars($businessName); ?> | Cardápio Digital</title>
        <link rel="icon" type="image/x-icon" href="<?php echo $faviconUrl; ?>">
        <link
            href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
            rel="stylesheet">
        <link rel="stylesheet" href="/cardapio/style.css?v=2.5">
        <script src="https://unpkg.com/lucide@latest"></script>
        <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
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

            /* Inputs do checkout — fundo claro, texto escuro, sempre legível */
            .ifood-input {
                width: 100%;
                padding: 14px;
                border-radius: 12px;
                border: 1.5px solid #e0e0e0;
                background: #f5f5f5;
                color: #1a1a1a;
                margin-bottom: 14px;
                font-family: inherit;
                font-size: 1rem;
                box-sizing: border-box;
                transition: border-color .2s;
            }

            .ifood-input:focus {
                border-color: var(--accent);
                outline: none;
                background: #fff;
            }

            /* Controle de passos */
            .checkout-step {
                display: block;
            }

            .checkout-step.hidden {
                display: none;
            }

            /* Labels do checkout */
            .form-group {
                margin-bottom: 4px;
            }

            .form-group label {
                display: block;
                margin-bottom: 6px;
                font-size: .85rem;
                font-weight: 600;
                color: #555;
            }

            /* Resumo financeiro */
            .summary-row {
                display: flex;
                justify-content: space-between;
                padding: 8px 0;
                font-size: .95rem;
                border-bottom: 1px solid #f0f0f0;
            }

            .summary-row.total {
                font-weight: 800;
                font-size: 1.1rem;
                border-bottom: none;
                padding-top: 12px;
            }
        </style>
    </head>

    <body>

        <!-- HEADER -->
        <header class="top-nav">
            <div class="container nav-wrapper">
                <div class="store-info">
                    <div class="store-logo"><img src="<?php echo $logoUrl; ?>" alt="Logo"
                            onerror="this.style.display='none'"></div>
                    <div class="store-details">
                        <h1><?php echo htmlspecialchars($businessName); ?></h1>
                        <div class="store-status"><span class="status-dot"></span> Aberto agora</div>
                    </div>
                </div>
                <button class="icon-btn" id="history-toggle-btn"><i data-lucide="history"></i></button>
            </div>
        </header>

        <!-- ABAS -->
        <nav class="category-tabs">
            <div class="container tabs-scroll">
                <button class="cat-tab active" data-tab="delivery">Entrega</button>
                <button class="cat-tab" data-tab="order">Encomendas</button>
            </div>
        </nav>

        <!-- BUSCA -->
        <div class="container search-container">
            <div class="search-box">
                <i data-lucide="search"></i>
                <input type="text" id="search-input" placeholder="Buscar no cardápio">
            </div>
        </div>

        <!-- MENU -->
        <main class="container main-menu">
            <div id="menu-sections">
                <div id="skeleton-loader" class="hidden"></div>
                <div id="actual-menu-content">
                    <?php foreach ($categories as $cat):
                        $catProducts = array_filter($products, fn($p) => $p['categoryId'] == $cat['id']);
                        if (empty($catProducts))
                            continue;
                        ?>
                        <section class="menu-section">
                            <h2 class="section-title"><?php echo htmlspecialchars($cat['name']); ?></h2>
                            <div class="products-grid">
                                <?php foreach ($catProducts as $p): ?>
                                    <div class="product-card" onclick="openItemDetail('<?php echo $p['id']; ?>')">
                                        <div class="product-info">
                                            <h3><?php echo htmlspecialchars($p['name']); ?></h3>
                                            <p><?php echo htmlspecialchars($p['description']); ?></p>
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

        <!-- RODAPÉ CARRINHO (único — id=cart-footer) -->
        <footer id="cart-footer" class="cart-footer hidden">
            <div class="container">
                <button class="primary-btn cart-btn" id="view-cart-btn">
                    <div class="cart-btn-content">
                        <span id="cart-qty-badge">0</span>
                        <span>Ver sacola</span>
                    </div>
                    <span id="cart-total-footer">R$ 0,00</span>
                </button>
            </div>
        </footer>

        <!-- ═══════════════════════════════════════════════════
     MODAL: DETALHE DO ITEM
     ID usado pelo script: item-detail-modal
     ═══════════════════════════════════════════════════ -->
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

        <!-- ═══════════════════════════════════════════════════
     MODAL: CHECKOUT (3 passos)
     Estrutura sincronizada com script.js
     ═══════════════════════════════════════════════════ -->
        <div id="checkout-modal" class="modal hidden">
            <div class="modal-overlay"></div>
            <div class="modal-content checkout-content">
                <div class="modal-header">
                    <button class="back-btn" id="checkout-back-btn"><i data-lucide="chevron-left"></i></button>
                    <h2 id="checkout-step-title">Ver sacola</h2>
                </div>

                <div class="modal-scroll-body" style="padding: 20px;">

                    <!-- PASSO 1: itens + nome + whatsapp
                 IDs que o script usa: checkout-items-list, customer-name, customer-phone -->
                    <div class="checkout-step" id="step-1">
                        <div id="checkout-items-list"></div>
                        <div style="margin-top:24px; border-top:1px solid #eee; padding-top:20px;">
                            <div class="form-group">
                                <label>Seu nome</label>
                                <input type="text" id="customer-name" class="ifood-input" placeholder="Nome completo">
                            </div>
                            <div class="form-group">
                                <label>WhatsApp</label>
                                <input type="tel" id="customer-phone" class="ifood-input" placeholder="(00) 00000-0000">
                            </div>
                        </div>
                    </div>

                    <!-- PASSO 2: entrega ou agendamento
                 IDs que o script usa: delivery-step-content, order-step-content,
                 customer-address, delivery-map, order-date, order-time -->
                    <div class="checkout-step hidden" id="step-2">
                        <!-- Entrega -->
                        <div id="delivery-step-content">
                            <div class="form-group">
                                <label>Endereço de entrega</label>
                                <input type="text" id="customer-address" class="ifood-input"
                                    placeholder="Rua, número, bairro...">
                            </div>
                            <div id="delivery-map"
                                style="height:200px; width:100%; border-radius:12px; background:#e8e8e8; margin-bottom:14px;">
                            </div>
                        </div>
                        <!-- Agendamento -->
                        <div id="order-step-content" class="hidden">
                            <div class="form-group">
                                <label>Data da encomenda</label>
                                <input type="date" id="order-date" class="ifood-input">
                            </div>
                            <div class="form-group">
                                <label>Horário disponível</label>
                                <select id="order-time" class="ifood-input">
                                    <option value="">Selecione uma data primeiro</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <!-- PASSO 3: resumo
                 IDs que o script usa: review-items-list, summary-subtotal,
                 summary-fee, delivery-fee-line, summary-total -->
                    <div class="checkout-step hidden" id="step-3">
                        <div id="review-items-list" style="margin-bottom:16px;"></div>
                        <div style="background:#f9f9f9; border:1px solid #eee; border-radius:14px; padding:18px;">
                            <div class="summary-row">
                                <span>Subtotal</span>
                                <span id="summary-subtotal">R$ 0,00</span>
                            </div>
                            <div class="summary-row" id="delivery-fee-line">
                                <span>Taxa de entrega</span>
                                <span id="summary-fee">R$ 0,00</span>
                            </div>
                            <div class="summary-row total">
                                <span>Total</span>
                                <span id="summary-total">R$ 0,00</span>
                            </div>
                        </div>
                    </div>

                </div><!-- /modal-scroll-body -->

                <div class="modal-footer-sticky">
                    <button id="next-step-btn" class="primary-btn">Continuar</button>
                    <button id="place-order-btn" class="primary-btn hidden">Finalizar Pedido</button>
                </div>
            </div>
        </div>

        <!-- ═══════════════════════════════════════════════════
     MODAL: HISTÓRICO DE PEDIDOS
     ID da lista usado pelo script: history-modal-list
     ═══════════════════════════════════════════════════ -->
        <div id="history-modal" class="modal hidden">
            <div class="modal-overlay"></div>
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Meus Pedidos</h3>
                    <button class="close-modal-btn"><i data-lucide="x"></i></button>
                </div>
                <div id="history-modal-list" style="padding:16px;"></div>
            </div>
        </div>

        <?php include 'componentes/footer.php'; ?>

        <script>const API_BASE = 'https://api.digizap.com.br';</script>
        <script src="/cardapio/script.js?v=2.8"></script>
        <script>lucide.createIcons();</script>
    </body>

    </html>
    <?php
} catch (Exception $e) {
    die("Erro: " . $e->getMessage());
}
