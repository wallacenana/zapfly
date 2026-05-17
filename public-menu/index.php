<?php
/**
 * DigiZap - Cardápio All-in-One (Versão Checkout 2.0)
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
        <title><?php echo $businessName; ?> | Cardápio Digital</title>
        <link rel="icon" type="image/x-icon" href="<?php echo $faviconUrl; ?>">
        <link
            href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
            rel="stylesheet">
        <link rel="stylesheet" href="/cardapio/style.css?v=2.4">
        <script src="https://unpkg.com/lucide@latest"></script>
        <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

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

        </style>
    </head>

    <body>

        <header class="top-nav">
            <div class="container nav-wrapper">
                <div class="store-info">
                    <div class="store-logo"><img src="<?php echo $logoUrl; ?>" alt="Logo"></div>
                    <div class="store-details">
                        <h1 id="store-name"><?php echo $businessName; ?></h1>
                        <div id="store-status-badge" class="status-badge open">● Aberto agora</div>
                    </div>
                </div>
                <button class="icon-btn" id="history-toggle-btn"><i data-lucide="history"></i></button>
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

        <main class="container main-menu">
            <div id="menu-sections">
                <div id="skeleton-loader" class="hidden"></div>
                <div id="actual-menu-content">
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
        </footer>
        <!-- MODAL DETALHE -->
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
                    <button id="add-to-cart-btn" class="primary-btn">Adicionar <span id="add-btn-price"></span></button>
                </div>
            </div>
        </div>

        <!-- MODAL CHECKOUT 2.0 -->
        <div id="checkout-modal" class="modal hidden">
            <div class="modal-overlay"></div>
            <div class="modal-content checkout-content">
                <div class="modal-header">
                    <button id="checkout-back-btn" class="back-btn"><i data-lucide="chevron-left"></i></button>
                    <h2 id="checkout-step-title">Finalizar Pedido</h2>
                    <button class="close-modal-btn"><i data-lucide="x"></i></button>
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
                        <div id="delivery-step-content">
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
                        <div id="order-step-content" class="hidden">
                            <div class="form-group">
                                <label class="field-label">Data da Encomenda</label>
                                <input type="date" id="order-date" class="ifood-input">
                            </div>
                            <div class="form-group">
                                <label class="field-label">Horário</label>
                                <select id="order-time" class="ifood-input">
                                    <option value="">Selecione uma data primeiro</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <!-- Step 3: Summary -->
                    <div class="checkout-step hidden" id="step-3">
                        <div id="order-summary-content">
                            <div class="summary-section">
                                <h3 class="field-label" style="font-size: 1.1rem; margin-bottom: 12px;">Resumo dos Itens
                                </h3>
                                <div id="review-items-list" style="margin-bottom: 20px;"></div>
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
                    <button id="place-order-btn" class="primary-btn hidden">Confirmar Pedido</button>
                </div>
            </div>
        </div>

        <div id="history-modal" class="modal hidden">
            <div class="modal-overlay"></div>
            <div class="modal-content">
                <div class="history-modal-header">
                    <h3>Meus Pedidos</h3>
                    <button class="close-modal-btn"><i data-lucide="x"></i></button>
                </div>
                <div id="history-list" class="history-modal-list"></div>
            </div>
        </div>

        <!-- RODAPÉ CARRINHO -->
        <footer id="cart-footer" class="cart-footer hidden">
            <div class="container">
                <button class="primary-btn cart-btn" id="view-cart-btn">
                    <div class="cart-btn-content"><span id="cart-qty-badge">0</span><span>Ver carrinho</span></div>
                    <span id="cart-total-footer">R$ 0,00</span>
                </button>
            </div>
        </footer>

        <?php include 'componentes/footer.php'; ?>

        <script>const API_BASE = 'https://api.digizap.com.br';</script>
        <script>
            // Configurações
            const BASE_DOMAIN = 'digizap.com.br';

            // Detecta se estamos na HOME exatamente
            const isHome = (window.location.hostname === BASE_DOMAIN || window.location.hostname === 'www.' + BASE_DOMAIN) &&
                (window.location.pathname === '/' || window.location.pathname === '');

            // Detecta o slug da URL (ex: domain.com/linda-cake -> linda-cake)
            const pathSegments = window.location.pathname.split('/').filter(p => p);
            const STORE_SLUG = isHome ? '' : (pathSegments[0] || '');

            // Função auxiliar para alertas bonitos
            const showAlert = (title, text, icon = 'warning') => {
                Swal.fire({
                    title: title,
                    text: text,
                    icon: icon,
                    confirmButtonColor: getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim() || '#ff4d6d',
                    confirmButtonText: 'Entendi'
                });
            };

            // Estado da Aplicação
            let state = {
                products: [],
                activeTab: 'delivery',
                deliveryCart: [],
                orderCart: [],
                loading: true,
                searchQuery: '',
                currentItem: null,
                currentQty: 1,
                currentVariation: null,
                userInfo: JSON.parse(localStorage.getItem('zapfly_user') || '{"name":"","phone":"","address":""}'),
                publicSettings: { googleApiKey: '', deliveryRules: [], businessName: 'Carregando...' },
                currentStep: 1,
                deliveryFee: 0,
                googleMap: null,
                mapMarker: null,
                geocoder: null,
                isOpen: false,
                availableSlots: [],
                currentCarouselIdx: 0,
                previousOrders: []
            };

            function parseImages(imgField) {
                if (!imgField) return [];
                try {
                    const parsed = JSON.parse(imgField);
                    return Array.isArray(parsed) ? parsed : [imgField];
                } catch (e) {
                    return [imgField];
                }
            }

            /**
             * Seleciona a versão correta da imagem gerada pelo upload.php
             * @param {string} url - URL original
             * @param {'thumb'|'medium'|'full'} size - Tamanho desejado
             */
            function getImg(url, size = 'full') {
                if (!url) return url;
                if (!url.includes('files.digizap.com.br')) return url; // Só funciona para o nosso servidor

                if (size === 'thumb') return url.replace('.webp', '_90.webp');
                if (size === 'medium') return url.replace('.webp', '_550.webp');
                return url;
            }

            const getActiveCart = () => state.activeTab === 'delivery' ? state.deliveryCart : state.orderCart;
            const setActiveCart = (newCart) => {
                if (state.activeTab === 'delivery') state.deliveryCart = newCart;
                else state.orderCart = newCart;
                saveCart();
            };

            function saveCart() {
                const carts = {
                    delivery: { items: state.deliveryCart, expires: Date.now() + (24 * 60 * 60 * 1000) },
                    order: { items: state.orderCart, expires: Date.now() + (7 * 24 * 60 * 60 * 1000) }
                };
                localStorage.setItem('linda_cake_carts', JSON.stringify(carts));
            }

            function loadCart() {
                const saved = localStorage.getItem('linda_cake_carts');
                if (!saved) return;
                try {
                    const carts = JSON.parse(saved);
                    const now = Date.now();
                    if (carts.delivery && carts.delivery.expires > now) state.deliveryCart = carts.delivery.items;
                    if (carts.order && carts.order.expires > now) state.orderCart = carts.order.items;
                } catch (e) { console.error("Erro ao carregar carrinho", e); }
            }

            document.addEventListener('DOMContentLoaded', () => {
                // Carrega o cardápio (o servidor já garantiu que temos um slug válido aqui)
                loadCart();
                lucide.createIcons();

                // Inicia o carregamento e aguarda
                Promise.all([
                    fetchPublicSettings(),
                    fetchProducts()
                ]).then(() => {
                    initEventListeners();
                    updateUI();
                    if (state.userInfo.phone) fetchPreviousOrders();
                });
            });

            async function fetchPublicSettings() {
                try {
                    const response = await fetch(`${API_BASE}/public/menu/${STORE_SLUG}`);
                    if (!response.ok) throw new Error('Loja não encontrada');
                    const data = await response.json();
                    console.log(data)
                    state.publicSettings = {
                        ...state.publicSettings,
                        ...data
                    };

                    state.products = data.products || [];
                    state.availableSlots = data.availableSlots || [];

                    // Remove Skeletons e mostra o conteúdo real
                    const loader = document.getElementById('skeleton-loader');
                    if (loader) loader.remove();
                    const content = document.getElementById('actual-menu-content');
                    if (content) content.classList.remove('hidden');

                    checkStoreStatus();

                    if (data.googleApiKey) {
                        loadGoogleMaps(data.googleApiKey);
                    }

                    // Favicon
                    if (data.faviconUrl) {
                        let fav = document.querySelector('link[rel="icon"]');
                        if (!fav) {
                            fav = document.createElement('link');
                            fav.rel = 'icon';
                            document.head.appendChild(fav);
                        }
                        fav.href = data.faviconUrl;
                    }

                    updateTheme(); // Aplica o tema inicial
                    // SEO Injection Dinâmico (Lido pelo Google JS Engine)
                    const titleText = data.businessName ? `${data.businessName} | Cardápio Digital DigiZap` : 'Cardápio Digital DigiZap';
                    document.title = titleText;
                    const ogTitle = document.querySelector('meta[property="og:title"]');
                    if (ogTitle) ogTitle.setAttribute('content', titleText);

                    const descText = data.seoDescription || `Confira o cardápio digital de ${data.businessName || 'nossa loja'} e faça seu pedido online.`;
                    const metaDesc = document.querySelector('meta[name="description"]');
                    if (metaDesc) metaDesc.setAttribute('content', descText);
                    const ogDesc = document.querySelector('meta[property="og:description"]');
                    if (ogDesc) ogDesc.setAttribute('content', descText);

                    if (data.logoUrl) {
                        const ogImage = document.querySelector('meta[property="og:image"]');
                        if (ogImage) ogImage.setAttribute('content', data.logoUrl);
                    }

                    // Scripts de Tracking (Google Analytics, Clarity, Pixel)
                    if (data.googleAnalyticsId && !document.getElementById('ga-script')) {
                        const ga = document.createElement('script');
                        ga.id = 'ga-script';
                        ga.async = true;
                        ga.src = `https://www.googletagmanager.com/gtag/js?id=${data.googleAnalyticsId}`;
                        document.head.appendChild(ga);

                        window.dataLayer = window.dataLayer || [];
                        function gtag() { dataLayer.push(arguments); }
                        window.gtag = gtag;
                        gtag('js', new Date());
                        gtag('config', data.googleAnalyticsId);
                    }

                    if (data.microsoftClarityId && !document.getElementById('clarity-script')) {
                        const cl = document.createElement('script');
                        cl.id = 'clarity-script';
                        cl.type = 'text/javascript';
                        cl.innerHTML = `
                (function(c,l,a,r,i,t,y){
                    c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
                    t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
                    y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
                })(window, document, "clarity", "script", "${data.microsoftClarityId}");
            `;
                        document.head.appendChild(cl);
                    }

                    if (data.pixelId && !document.getElementById('fb-script')) {
                        const fb = document.createElement('script');
                        fb.id = 'fb-script';
                        fb.innerHTML = `
                !function(f,b,e,v,n,t,s)
                {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
                n.callMethod.apply(n,arguments):n.queue.push(arguments)};
                if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
                n.queue=[];t=b.createElement(e);t.async=!0;
                t.src=v;s=b.getElementsByTagName(e)[0];
                s.parentNode.insertBefore(t,s)}(window, document,'script',
                'https://connect.facebook.net/en_US/fbevents.js');
                fbq('init', '${data.pixelId}');
                fbq('track', 'PageView');
            `;
                        document.head.appendChild(fb);
                    }

                    // Logo
                    const logoImg = document.getElementById('store-logo-img');
                    const placeholder = document.querySelector('.logo-placeholder');
                    if (data.logoUrl && logoImg) {
                        logoImg.src = data.logoUrl;
                        logoImg.style.display = 'block';
                        if (placeholder) placeholder.style.display = 'none';
                    }

                    // Atualiza o título e nome na página
                    const nameEl = document.getElementById('store-name');
                    if (nameEl) nameEl.innerText = data.businessName;

                    const statusEl = document.getElementById('store-status-badge');
                    if (statusEl) {
                        checkStoreStatus();
                        // Atualiza a cada 1 minuto
                        setInterval(checkStoreStatus, 60000);
                    }
                } catch (err) {
                    console.error('Erro ao carregar configurações:', err);
                    document.body.innerHTML = `
            <div style="display:flex; flex-direction:column; justify-content:center; align-items:center; height:100vh; font-family:sans-serif;">
                <h1>Loja não encontrada</h1>
                <p>Verifique o link e tente novamente.</p>
            </div>
        `;
                }
            }

            function checkStoreStatus() {
                const now = new Date();
                const day = now.getDay();
                const time = now.getHours() * 60 + now.getMinutes();

                const todaySlots = state.availableSlots.filter(s => s.dayOfWeek === day);
                state.isOpen = todaySlots.some(s => {
                    const [sh, sm] = s.startTime.split(':').map(Number);
                    const [eh, em] = s.endTime.split(':').map(Number);
                    const start = sh * 60 + sm;
                    const end = eh * 60 + em;
                    return time >= start && time <= end;
                });

                const statusEl = document.getElementById('store-status-badge');
                if (statusEl) {
                    statusEl.innerText = state.isOpen ? '● Aberto agora' : '● Fechado (Apenas encomendas)';
                    statusEl.className = state.isOpen ? 'status-badge open' : 'status-badge closed';
                }
            }

            function loadGoogleMaps(apiKey) {
                if (window.google) return;
                const script = document.createElement('script');
                script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=initMapsAutocomplete`;
                script.async = true;
                script.defer = true;
                document.head.appendChild(script);
            }

            window.initMapsAutocomplete = () => {
                console.log('[Maps] Iniciando Autocomplete...');
                const mapEl = document.getElementById('delivery-map');
                const input = document.getElementById('user-address');

                if (!mapEl || !input) {
                    console.log('[Maps] Elementos não encontrados ainda.');
                    return;
                }

                if (state.googleMap) {
                    console.log('[Maps] Mapa já existe, ignorando reinicialização.');
                    return;
                }

                try {
                    const autocomplete = new google.maps.places.Autocomplete(input);
                    autocomplete.setComponentRestrictions({ country: 'br' });
                    state.geocoder = new google.maps.Geocoder();

                    console.log('[Maps] Criando objeto Map...');
                    const mapCenter = { lat: -2.5307, lng: -44.3068 };
                    state.googleMap = new google.maps.Map(mapEl, {
                        zoom: 16,
                        center: mapCenter,
                        disableDefaultUI: false,
                        mapTypeControl: false,
                        streetViewControl: false
                    });

                    state.mapMarker = new google.maps.Marker({
                        map: state.googleMap,
                        position: mapCenter,
                        draggable: true,
                        animation: google.maps.Animation.DROP
                    });

                    if (state.userInfo.address) {
                        geocodeAddress(state.userInfo.address);
                    }

                    autocomplete.addListener('place_changed', () => {
                        const place = autocomplete.getPlace();
                        console.log('[Maps] Place selecionado:', place.formatted_address);
                        if (!place.geometry) return;
                        updateLocation(place.geometry.location, place.formatted_address);
                    });

                    state.mapMarker.addListener('dragend', () => reverseGeocode(state.mapMarker.getPosition()));
                    state.googleMap.addListener('click', (e) => {
                        updateLocation(e.latLng);
                        reverseGeocode(e.latLng);
                    });
                    console.log('[Maps] Autocomplete pronto!');
                } catch (e) {
                    console.error('[Maps Error] Erro na inicialização:', e);
                }
            };

            function geocodeAddress(address) {
                if (!state.geocoder) return;
                state.geocoder.geocode({ address: address }, (results, status) => {
                    if (status === 'OK' && results[0]) updateLocation(results[0].geometry.location, results[0].formatted_address);
                });
            }

            function updateLocation(location, address = null) {
                if (!state.googleMap) return;
                state.googleMap.panTo(location);
                state.mapMarker.setPosition(location);
                if (address) {
                    document.getElementById('user-address').value = address;
                    state.userInfo.address = address;
                    localStorage.setItem('zapfly_user', JSON.stringify(state.userInfo));
                    calculateDeliveryFee(address);
                }
            }

            function reverseGeocode(latLng) {
                state.geocoder.geocode({ location: latLng }, (results, status) => {
                    if (status === 'OK' && results[0]) updateLocation(latLng, results[0].formatted_address);
                });
            }

            async function calculateDeliveryFee(address) {
                try {
                    const response = await fetch(`${API_BASE}/orders/calculate-fee`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ address, slug: STORE_SLUG })
                    });
                    const data = await response.json();
                    const display = document.getElementById('delivery-fee-display');
                    if (data.fee !== undefined) {
                        state.deliveryFee = data.fee;
                        if (display) {
                            display.style.display = 'block';
                            display.innerHTML = `Taxa de entrega: <strong style="color:var(--primary-color)">R$ ${data.fee.toFixed(2)}</strong>`;
                            display.style.background = '#f0fdf4';
                            display.style.color = '#166534';
                        }
                        updateStep3Summary();
                    } else if (data.error) {
                        state.deliveryFee = 0;
                        if (display) {
                            display.style.display = 'block';
                            display.innerHTML = `⚠️ ${data.error}`;
                            display.style.background = '#fef2f2';
                            display.style.color = '#991b1b';
                            display.style.border = '1px solid #fee2e2';
                        }
                    } else {
                        if (display) display.style.display = 'none';
                    }
                } catch (err) { console.error('Erro ao calcular frete:', err); }
            }

            function maskPhone(v) {
                v = v.replace(/\D/g, "");
                v = v.replace(/^(\d{2})(\d)/g, "($1) $2");
                v = v.replace(/(\d)(\d{4})$/, "$1-$2");
                return v;
            }

            async function fetchProducts() {
                try {
                    const response = await fetch(`${API_BASE}/public/menu/${STORE_SLUG}`);
                    const data = await response.json();
                    state.products = data.products || [];
                    state.categories = data.categories || [];
                    state.loading = false;

                    // History Section
                    const historyContainer = document.getElementById('history-section');
                    if (historyContainer) historyContainer.classList.remove('hidden');

                    // Main Menu
                    renderMenu();
                } catch (err) { console.error('Erro ao buscar produtos:', err); }
            }

            function renderMenu() {
                if (!state.products || state.products.length === 0) {
                    console.log('Mantendo menu do PHP (API retornou vazio)');
                    return;
                }
                const container = document.getElementById('menu-sections');
                if (!container) return;

                if (state.loading) {
                    container.innerHTML = `
                        <div class="menu-section">
                            <h2 class="section-title"><div class="skeleton" style="height: 24px; width: 140px; border-radius: 4px;"></div></h2>
                            <div class="products-grid">
                                ${Array(4).fill().map(() => `
                                    <div class="product-card" style="pointer-events: none; opacity: 0.8;">
                                        <div class="product-info">
                                            <div class="skeleton" style="height: 18px; width: 70%; margin-bottom: 8px; border-radius: 4px;"></div>
                                            <div class="skeleton" style="height: 12px; width: 100%; margin-bottom: 4px; border-radius: 4px;"></div>
                                            <div class="skeleton" style="height: 12px; width: 80%; border-radius: 4px; margin-bottom: 12px;"></div>
                                            <div class="skeleton" style="height: 16px; width: 40%; border-radius: 4px;"></div>
                                        </div>
                                        <div class="skeleton product-img" style="border-radius: 8px;"></div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                        <div class="menu-section">
                            <h2 class="section-title"><div class="skeleton" style="height: 24px; width: 180px; border-radius: 4px;"></div></h2>
                            <div class="products-grid">
                                ${Array(2).fill().map(() => `
                                    <div class="product-card" style="pointer-events: none; opacity: 0.8;">
                                        <div class="product-info">
                                            <div class="skeleton" style="height: 18px; width: 60%; margin-bottom: 8px; border-radius: 4px;"></div>
                                            <div class="skeleton" style="height: 12px; width: 90%; margin-bottom: 4px; border-radius: 4px;"></div>
                                            <div class="skeleton" style="height: 16px; width: 35%; border-radius: 4px; margin-top: 12px;"></div>
                                        </div>
                                        <div class="skeleton product-img" style="border-radius: 8px;"></div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `;
                    return;
                }

                const query = state.searchQuery.toLowerCase();

                const filtered = state.products.filter(p => {
                    if (p.active === false) return false;
                    if (p.category === 'Adicionais' || p.type === 'addon') return false;

                    // Verificar se tem variações e se todas estão escondidas
                    const variations = JSON.parse(p.variations || '[]');
                    if (variations.length > 0) {
                        const hasVisibleVar = variations.some(v => !v.hidden);
                        if (!hasVisibleVar) return false;
                    }

                    const matchesTab = (state.activeTab === 'delivery' && p.type === 'delivery') || (state.activeTab === 'order');
                    const matchesSearch = p.name.toLowerCase().includes(query) || (p.description && p.description.toLowerCase().includes(query));
                    return matchesTab && matchesSearch;
                });

                // Separar destaques (apenas se não houver busca ativa)
                const featured = query ? [] : filtered.filter(p => p.featured).sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
                const nonFeatured = query ? filtered : filtered.filter(p => !p.featured);

                const grouped = nonFeatured.reduce((acc, p) => {
                    let cat = 'Geral';
                    if (p.categoryId && state.categories && state.categories.length > 0) {
                        const foundCat = state.categories.find(c => c.id === p.categoryId);
                        if (foundCat) cat = foundCat.name;
                    } else if (p.category) {
                        cat = p.category; // fallback para produtos antigos
                    }
                    if (!acc[cat]) acc[cat] = [];
                    acc[cat].push(p);
                    return acc;
                }, {});

                // Ordenar itens dentro de cada categoria pelo campo 'displayOrder'
                Object.keys(grouped).forEach(cat => {
                    grouped[cat].sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
                });

                // Ordenar pela propriedade 'order' que já vem do banco de dados
                const sortedCategories = [];
                const orderedCats = [...(state.categories || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
                orderedCats.forEach(c => {
                    if (grouped[c.name]) sortedCategories.push(c.name);
                });
                // Adiciona categorias legadas ('Geral') que não existem em state.categories
                Object.keys(grouped).forEach(catName => {
                    if (!sortedCategories.includes(catName)) sortedCategories.push(catName);
                });

                let html = '';

                // Renderizar Destaques
                if (featured.length > 0) {
                    html += `
            <section class="menu-section featured-section">
                <div class="section-header">
                    <i data-lucide="star" style="color: #fbbf24; fill: #fbbf24;"></i>
                    <h2>Destaques</h2>
                </div>
                <div class="featured-list">
                    ${featured.map(item => renderFeaturedCard(item)).join('')}
                </div>
            </section>
        `;
                }

                // Renderizar Categorias
                html += sortedCategories.map(category => {
                    const items = grouped[category];
                    return `
            <section class="menu-section" id="cat-${category.replace(/\s+/g, '-')}">
                <h2>${category}</h2>
                <div class="product-list">${items.map(item => renderProductCard(item)).join('')}</div>
            </section>
        `;
                }).join('');

                container.innerHTML = html;
                renderCategoryNav(sortedCategories);
                lucide.createIcons();
            }

            function renderFeaturedCard(product) {
                const variations = JSON.parse(product.variations || '[]').filter(v => !v.hidden);
                const priceText = variations.length > 0 ? `A partir de R$ ${Math.min(...variations.map(v => v.price)).toFixed(2)}` : `R$ ${parseFloat(product.price).toFixed(2)}`;
                const images = parseImages(product.image);

                return `
        <div class="featured-card" onclick="openItemDetail('${product.id}')">
            <div class="featured-img-wrapper">
                ${images.length > 0 ? `<img src="${getImg(images[0], 'medium')}" alt="${product.name}" loading="lazy" decoding="async">` : `<div class="img-placeholder"><i data-lucide="image"></i></div>`}
            </div>
            <div class="featured-info">
                <h3>${product.name}</h3>
                <div class="product-price">${priceText}</div>
            </div>
        </div>
    `;
            }

            function renderCategoryNav(categories) {
                const navContainer = document.getElementById('category-nav-scroll');
                if (!navContainer) return;

                if (categories.length <= 1) {
                    navContainer.parentElement.classList.add('hidden');
                    return;
                }

                navContainer.parentElement.classList.remove('hidden');
                navContainer.innerHTML = categories.map(cat => `
        <button class="nav-cat-btn" onclick="scrollToCategory('cat-${cat.replace(/\s+/g, '-')}')">${cat}</button>
    `).join('');
            }

            function scrollToCategory(id) {
                const el = document.getElementById(id);
                if (el) {
                    const offset = 140; // Ajuste conforme o header
                    const bodyRect = document.body.getBoundingClientRect().top;
                    const elementRect = el.getBoundingClientRect().top;
                    const elementPosition = elementRect - bodyRect;
                    const offsetPosition = elementPosition - offset;

                    window.scrollTo({
                        top: offsetPosition,
                        behavior: 'smooth'
                    });
                }
            }

            function renderProductCard(product) {
                const variations = JSON.parse(product.variations || '[]').filter(v => !v.hidden);
                const priceText = variations.length > 0 ? `A partir de R$ ${Math.min(...variations.map(v => v.price)).toFixed(2)}` : `R$ ${parseFloat(product.price).toFixed(2)}`;
                return `
        <div class="product-card" onclick="openItemDetail('${product.id}')">
            <div class="product-info">
                <h3>${product.name}</h3>
                <p>${product.description || ''}</p>
                <div class="product-price">${priceText}</div>
            </div>
            ${parseImages(product.image).length > 0 ? `<img src="${getImg(parseImages(product.image)[0], 'thumb')}" alt="${product.name}" class="product-img" loading="lazy" decoding="async">` : `<div class="img-placeholder"><i data-lucide="image"></i></div>`}
        </div>
    `;
            }

            function openItemDetail(productId) {
                const item = state.products.find(p => p.id === productId);
                state.currentItem = item;
                state.currentQty = 1;
                state.currentVariation = null;

                const modal = document.getElementById('item-detail-modal');
                const body = document.getElementById('item-detail-body');

                // Inicia com Skeleton
                body.innerHTML = `
        <button class="chevron-close-btn" onclick="closeWithAnimation('item-detail-modal')"><i data-lucide="chevron-down"></i></button>
        <div class="skeleton" style="width:100%; height:300px; border-radius:0;"></div>
        <div style="padding:20px;">
            <div class="skeleton" style="height:24px; width:70%; margin-bottom:10px;"></div>
            <div class="skeleton" style="height:14px; width:90%; margin-bottom:5px;"></div>
            <div class="skeleton" style="height:14px; width:80%; margin-bottom:20px;"></div>
        </div>
    `;

                openModal('item-detail-modal');
                lucide.createIcons();

                // Tracking: ViewContent (Meta) & view_item (GA4)
                if (typeof fbq === 'function') {
                    fbq('track', 'ViewContent', {
                        content_ids: [item.id],
                        content_name: item.name,
                        content_type: 'product',
                        value: parseFloat(item.price),
                        currency: 'BRL'
                    });
                }
                if (typeof gtag === 'function') {
                    gtag('event', 'view_item', {
                        currency: 'BRL',
                        value: parseFloat(item.price),
                        items: [{ item_id: item.id, item_name: item.name, price: parseFloat(item.price) }]
                    });
                }

                setTimeout(() => {
                    state.currentCarouselIdx = 0;
                    const variations = JSON.parse(item.variations || '[]').filter(v => !v.hidden);
                    const images = parseImages(item.image);

                    body.innerHTML = `
            <button class="chevron-close-btn" onclick="closeWithAnimation('item-detail-modal')" aria-label="Fechar Detalhes"><i data-lucide="chevron-down"></i></button>
            ${images.length > 0 ? `
                <div class="carousel-container">
                    <div class="carousel-track" style="transform: translateX(0%)">
                        ${images.map(img => `<div class="carousel-slide"><img src="${getImg(img, 'medium')}" alt="${item.name}"></div>`).join('')}
                    </div>
                    ${images.length > 1 ? `
                        <button class="carousel-btn carousel-prev" onclick="moveCarousel(-1)" aria-label="Imagem Anterior"><i data-lucide="chevron-left"></i></button>
                        <button class="carousel-btn carousel-next" onclick="moveCarousel(1)" aria-label="Próxima Imagem"><i data-lucide="chevron-right"></i></button>
                        <div class="carousel-dots">
                            ${images.map((_, i) => `<div class="carousel-dot ${i === 0 ? 'active' : ''}"></div>`).join('')}
                        </div>
                    ` : ''}
                </div>
            ` : ''}
            <div class="item-main-info">
                <h2>${item.name}</h2>
                <p>${item.description || ''}</p>
                ${variations.length === 0 ? `<div class="price">R$ ${parseFloat(item.price).toFixed(2)}</div>` : ''}
            </div>
            ${variations.length > 0 ? `<div class="variation-section"><h4>Escolha uma opção</h4>${variations.map(v => `<div class="var-option" onclick="selectVariation('${v.name.replace(/'/g, "\\'")}', ${v.price})"><div class="var-label">${v.name}</div><div class="var-price">+ R$ ${parseFloat(v.price).toFixed(2)}</div></div>`).join('')}</div>` : ''}
                                            `;
                    updateDetailFooter();
                    lucide.createIcons();
                }, 50);
            }

            function moveCarousel(delta) {
                const images = parseImages(state.currentItem.image);
                if (images.length <= 1) return;

                state.currentCarouselIdx = (state.currentCarouselIdx + delta + images.length) % images.length;

                const track = document.querySelector('.carousel-track');
                const dots = document.querySelectorAll('.carousel-dot');

                track.style.transform = `translateX(-${state.currentCarouselIdx * 100}%)`;
                dots.forEach((dot, i) => dot.classList.toggle('active', i === state.currentCarouselIdx));
            }

            function closeWithAnimation(modalId) {
                const modal = document.getElementById(modalId);
                modal.classList.add('closing');
                setTimeout(() => {
                    modal.classList.add('hidden');
                    modal.classList.remove('closing');
                }, 400);
            }

            function selectVariation(name, price) {
                state.currentVariation = { name, price };
                document.querySelectorAll('.var-option').forEach(el => el.classList.toggle('selected', el.querySelector('.var-label').innerText === name));
                updateDetailFooter();
            }

            function updateDetailFooter() {
                const basePrice = state.currentVariation ? state.currentVariation.price : (state.currentItem?.price || 0);
                const priceEl = document.getElementById('add-btn-price');
                if (priceEl) priceEl.innerText = `R$ ${(basePrice * state.currentQty).toFixed(2)}`;

                const qtyEl = document.getElementById('detail-qty');
                if (qtyEl) qtyEl.innerText = state.currentQty;
            }

            function closeModal(modalId = null) {
                const ids = ['item-detail-modal', 'checkout-modal', 'history-modal'];
                ids.forEach(id => {
                    const m = document.getElementById(id);
                    if (m && !m.classList.contains('hidden')) {
                        if (modalId && modalId !== id) return;
                        closeWithAnimation(id);
                    }
                });
            }

            function openModal(id) {
                const ids = ['item-detail-modal', 'checkout-modal', 'history-modal'];
                ids.forEach(modalId => {
                    const m = document.getElementById(modalId);
                    if (m) m.classList.add('hidden', 'closing');
                });
                const target = document.getElementById(id);
                if (target) target.classList.remove('hidden', 'closing');
            }

            function initEventListeners() {
                document.getElementById('search-input').addEventListener('input', (e) => { state.searchQuery = e.target.value; renderMenu(); });
                document.querySelectorAll('.cat-tab').forEach(btn => {
                    btn.addEventListener('click', () => {
                        document.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        state.activeTab = btn.dataset.tab;
                        document.body.className = state.activeTab === 'order' ? 'theme-order' : '';
                        updateTheme(); // Muda as cores ao trocar de aba
                        renderMenu(); updateUI();
                    });
                });

                document.getElementById('qty-plus').addEventListener('click', () => { state.currentQty++; updateDetailFooter(); });
                document.getElementById('qty-minus').addEventListener('click', () => { if (state.currentQty > 1) { state.currentQty--; updateDetailFooter(); } });

                document.querySelectorAll('.close-modal-btn').forEach(btn => {
                    btn.addEventListener('click', closeModal);
                });

                document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

                document.getElementById('history-toggle-btn').addEventListener('click', () => {
                    openModal('history-modal');
                    renderPreviousOrders();
                });

                document.getElementById('add-to-cart-btn').addEventListener('click', addToCart);
                document.getElementById('view-cart-btn').addEventListener('click', () => goToStep(1));
                document.getElementById('next-step-btn').addEventListener('click', handleNextStep);
                document.getElementById('place-order-btn').addEventListener('click', handlePlaceOrder);

                // Listener para carregar horários disponíveis ao selecionar data
                document.getElementById('order-date').addEventListener('change', (e) => {
                    const dateStr = e.target.value;
                    if (!dateStr) return;

                    const date = new Date(dateStr + 'T12:00:00');
                    const dayOfWeek = date.getDay();

                    const slots = state.availableSlots.filter(s => s.dayOfWeek === dayOfWeek);
                    const timeSelect = document.getElementById('order-time');

                    timeSelect.innerHTML = `<option value="">Horário</option>` + slots.map(s => `<option value="${s.startTime}">${s.startTime}</option>`).join('');
                });

                document.getElementById('user-name').value = state.userInfo.name || '';
                document.getElementById('user-phone').value = state.userInfo.phone || '';
                document.getElementById('user-address').value = state.userInfo.address || '';

                const phoneInput = document.getElementById('user-phone');
                if (phoneInput) {
                    phoneInput.addEventListener('input', (e) => {
                        e.target.value = maskPhone(e.target.value);
                        state.userInfo.phone = e.target.value;
                        localStorage.setItem('zapfly_user', JSON.stringify(state.userInfo));
                    });
                }

                ['user-name', 'user-address'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) {
                        el.addEventListener('input', (e) => {
                            state.userInfo[id.split('-')[1]] = e.target.value;
                            localStorage.setItem('zapfly_user', JSON.stringify(state.userInfo));
                        });
                    }
                });
            }

            function goToStep(step) {
                state.currentStep = step;

                // Esconde todos os passos explicitamente por ID para não ter erro
                document.getElementById('step-1')?.classList.add('hidden');
                document.getElementById('step-2')?.classList.add('hidden');
                document.getElementById('step-3')?.classList.add('hidden');

                // Mostra apenas o atual
                document.getElementById(`step-${step}`)?.classList.remove('hidden');

                openModal('checkout-modal');

                let title = "Ver sacola";
                if (step === 2) title = state.activeTab === 'delivery' ? "Entrega" : "Encomenda";
                if (step === 3) title = "Confirmar Pedido";

                document.getElementById('checkout-step-title').innerText = title;

                const isLast = step === 3;
                document.getElementById('next-step-btn').classList.toggle('hidden', isLast);
                document.getElementById('place-order-btn').classList.toggle('hidden', !isLast);

                if (step === 1) renderStep1();
                if (step === 2) renderStep2();
                if (step === 3) updateStep3Summary();
            }

            document.getElementById('checkout-back-btn')?.addEventListener('click', () => {
                if (state.currentStep > 1) goToStep(state.currentStep - 1);
                else closeWithAnimation('checkout-modal');
            });

            function renderStep1() {
                const cart = getActiveCart();
                const list = document.getElementById('checkout-items-list');
                if (cart.length === 0) {
                    list.innerHTML = `<p style="text-align: center; padding: 40px; color: var(--text-gray);">Sua sacola está vazia.</p>`;
                    document.getElementById('next-step-btn').disabled = true;
                    return;
                }
                document.getElementById('next-step-btn').disabled = false;
                list.innerHTML = cart.map(item => `
                                            <div class="checkout-item">
                                                <div class="item-name-qty">
                                                    <div><strong>${item.name}</strong>${item.variation ? `<p style="font-size: 0.75rem; color: var(--text-gray);">${item.variation}</p>` : ''}</div>
                                                </div>
                                                <div style="display: flex; align-items: center; gap: 16px;">
                                                    <div class="cart-qty-control">
                                                        <button class="qty-btn-mini" onclick="updateCartQty('${item.itemKey}', -1)">
                                                            ${item.quantity === 1 ? '<i data-lucide="trash-2"></i>' : '<i data-lucide="minus"></i>'}
                                                        </button>
                                                        <span class="qty-val-mini">${item.quantity}</span>
                                                        <button class="qty-btn-mini" onclick="updateCartQty('${item.itemKey}', 1)">
                                                            <i data-lucide="plus"></i>
                                                        </button>
                                                    </div>
                                                    <div class="item-price">R$ ${(item.price * item.quantity).toFixed(2)}</div>
                                                </div>
                                            </div>
                                        `).join('');
                lucide.createIcons();
            }

            function updateCartQty(itemKey, delta) {
                let cart = getActiveCart();
                const item = cart.find(i => i.itemKey === itemKey);
                if (!item) return;

                item.quantity += delta;
                if (item.quantity <= 0) {
                    cart = cart.filter(i => i.itemKey !== itemKey);
                }

                setActiveCart(cart);
                renderStep1();
                updateUI();
            }

            function removeFromCart(itemKey) {
                let cart = getActiveCart();
                cart = cart.filter(i => i.itemKey !== itemKey);
                setActiveCart(cart);
                renderStep1();
                updateUI();
            }

            function renderStep2() {
                const isDelivery = state.activeTab === 'delivery';
                const deliveryContent = document.getElementById('delivery-step-content');
                const orderContent = document.getElementById('order-step-content');

                if (deliveryContent) deliveryContent.classList.toggle('hidden', !isDelivery);
                if (orderContent) orderContent.classList.toggle('hidden', isDelivery);

                if (isDelivery) {
                    // Se o Google Maps carregou mas o mapa ainda não foi criado, cria agora
                    if (window.google && !state.googleMap) {
                        initMapsAutocomplete();
                    }

                    if (state.googleMap) {
                        setTimeout(() => {
                            google.maps.event.trigger(state.googleMap, 'resize');
                            if (state.mapMarker) {
                                state.googleMap.panTo(state.mapMarker.getPosition());
                            } else if (state.userInfo.address) {
                                geocodeAddress(state.userInfo.address);
                            }
                        }, 300);
                    }
                }
            }

            function handleNextStep() {
                if (state.currentStep === 1) {
                    const nameVal = document.getElementById('user-name')?.value;
                    const phoneVal = document.getElementById('user-phone')?.value;
                    if (!nameVal || !phoneVal || phoneVal.length < 14) return showAlert('Ops!', 'Preencha seu nome e um WhatsApp válido.');
                    state.userInfo.name = nameVal;
                    state.userInfo.phone = phoneVal;
                    if (state.activeTab === 'delivery' && !state.isOpen) return showAlert('Loja Fechada', 'Estamos fechados para pronta entrega no momento. Por favor, utilize a aba de Encomendas para agendar seu pedido.');
                    goToStep(2);
                } else if (state.currentStep === 2) {
                    if (state.activeTab === 'delivery' && !state.userInfo.address) return showAlert('Endereço Ausente', 'Por favor, selecione seu endereço no mapa.');
                    if (state.activeTab === 'order' && (!document.getElementById('order-date').value || !document.getElementById('order-time').value)) return showAlert('Horário Ausente', 'Escolha uma data e um horário para sua encomenda.');
                    goToStep(3);
                }
            }

            function updateStep3Summary() {
                const cart = getActiveCart();
                const subtotal = cart.reduce((acc, i) => acc + (i.price * i.quantity), 0);
                const fee = state.activeTab === 'delivery' ? state.deliveryFee : 0;
                const total = subtotal + fee;

                const subEl = document.getElementById('summary-subtotal');
                const feeEl = document.getElementById('summary-fee');
                const totalEl = document.getElementById('summary-total');
                const lineEl = document.getElementById('delivery-fee-line');
                const listEl = document.getElementById('review-items-list');

                if (subEl) subEl.innerText = `R$ ${subtotal.toFixed(2)}`;
                if (feeEl) feeEl.innerText = `R$ ${fee.toFixed(2)}`;
                if (totalEl) totalEl.innerText = `R$ ${total.toFixed(2)}`;
                if (lineEl) lineEl.classList.toggle('hidden', state.activeTab !== 'delivery');

                if (listEl) {
                    listEl.innerHTML = cart.map(item => `<p style="font-size: 0.9rem; margin-bottom: 4px;">${item.quantity}x ${item.name} ${item.variation ? `(${item.variation})` : ''}</p>`).join('');
                }
            }

            function addToCart() {
                const item = state.currentItem;
                if (state.activeTab === 'delivery' && !state.isOpen) {
                    return showAlert('Loja Fechada', 'Estamos fechados para pronta entrega no momento. Utilize a aba de Encomendas para agendar!');
                }
                const variation = state.currentVariation;
                const variations = JSON.parse(item.variations || '[]').filter(v => !v.hidden);
                if (variations.length > 0 && !variation) return showAlert('Quase lá...', 'Por favor, selecione uma opção para continuar.');
                const itemKey = variation ? `${item.id}-${variation.name}` : item.id;
                let cart = getActiveCart();
                const existing = cart.find(c => c.itemKey === itemKey);
                if (existing) existing.quantity += state.currentQty;
                else cart.push({ productId: item.id, itemKey, name: item.name, variation: variation ? variation.name : null, price: variation ? variation.price : item.price, quantity: state.currentQty });
                setActiveCart(cart);

                // Tracking: AddToCart
                const finalPrice = variation ? variation.price : item.price;
                if (typeof fbq === 'function') {
                    fbq('track', 'AddToCart', {
                        content_ids: [item.id],
                        content_name: item.name,
                        content_type: 'product',
                        value: parseFloat(finalPrice) * state.currentQty,
                        currency: 'BRL'
                    });
                }
                if (typeof gtag === 'function') {
                    gtag('event', 'add_to_cart', {
                        currency: 'BRL',
                        value: parseFloat(finalPrice) * state.currentQty,
                        items: [{ item_id: item.id, item_name: item.name, price: parseFloat(finalPrice), quantity: state.currentQty }]
                    });
                }

                closeWithAnimation('item-detail-modal');
                renderMenu();
                updateUI();
            }

            function updateUI() {
                const cart = getActiveCart();
                const footer = document.getElementById('cart-footer');
                if (!footer) return; // Blindagem contra erro de null

                if (cart.length > 0) {
                    footer.classList.remove('hidden');
                    const badge = document.getElementById('cart-qty-badge');
                    if (badge) badge.innerText = cart.reduce((acc, i) => acc + i.quantity, 0);

                    const totalFooter = document.getElementById('cart-total-footer');
                    if (totalFooter) totalFooter.innerText = `R$ ${cart.reduce((acc, i) => acc + (i.price * i.quantity), 0).toFixed(2)}`;
                } else {
                    footer.classList.add('hidden');
                }
            }

            async function handlePlaceOrder() {
                const cart = getActiveCart();
                const btn = document.getElementById('place-order-btn');
                btn.disabled = true; btn.innerHTML = 'Processando Pagamento...';

                const payload = {
                    clientName: state.userInfo.name,
                    clientPhone: state.userInfo.phone,
                    product: cart[0].name + (cart[0].variation ? ` (${cart[0].variation})` : ''),
                    quantity: cart[0].quantity,
                    type: state.activeTab,
                    deliveryAddress: state.activeTab === 'delivery' ? state.userInfo.address : null,
                    scheduledDate: state.activeTab === 'order' ? document.getElementById('order-date').value : null,
                    scheduledTime: state.activeTab === 'order' ? document.getElementById('order-time').value : null,
                    deliveryFee: state.activeTab === 'delivery' ? state.deliveryFee : 0,
                    carrinho_itens_extras: cart.slice(1).map(item => ({
                        name: item.name + (item.variation ? ` (${item.variation})` : ''),
                        price: item.price,
                        quantity: item.quantity
                    }))
                };

                try {
                    const response = await fetch(`${API_BASE}/orders`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ...payload, slug: STORE_SLUG })
                    });
                    const data = await response.json();
                    if (data.paymentLink) {
                        // Tracking: InitiateCheckout (Meta) & begin_checkout (GA4)
                        const totalValue = cart.reduce((acc, i) => acc + (i.price * i.quantity), 0) + (state.activeTab === 'delivery' ? state.deliveryFee : 0);
                        if (typeof fbq === 'function') {
                            fbq('track', 'InitiateCheckout', {
                                value: totalValue,
                                currency: 'BRL',
                                num_items: cart.reduce((acc, i) => acc + i.quantity, 0)
                            });
                        }
                        if (typeof gtag === 'function') {
                            gtag('event', 'begin_checkout', {
                                currency: 'BRL',
                                value: totalValue,
                                items: cart.map(i => ({ item_id: i.productId, item_name: i.name, price: i.price, quantity: i.quantity }))
                            });
                        }

                        setActiveCart([]);
                        location.href = data.paymentLink;
                    } else if (data.id) {
                        alert('Pedido registrado, mas houve um problema ao gerar o link de pagamento. Por favor, entre em contato.');
                    } else {
                        throw new Error(data.error);
                    }
                } catch (err) {
                    showAlert('Erro no Pedido', err.message, 'error');
                    btn.disabled = false;
                    btn.innerHTML = 'Fazer pedido';
                }
            }

            async function fetchPreviousOrders() {
                if (!state.userInfo.phone) return;
                try {
                    const phone = state.userInfo.phone.replace(/\D/g, '');
                    const res = await fetch(`${API_BASE}/orders/history/${phone}`);
                    const data = await res.json();
                    state.previousOrders = Array.isArray(data) ? data : [];
                    renderPreviousOrders();
                } catch (e) {
                    console.error(e);
                    state.previousOrders = [];
                    renderPreviousOrders();
                }
            }

            function renderPreviousOrders() {
                const list = document.getElementById('history-modal-list');
                if (!list) return;

                if (!Array.isArray(state.previousOrders) || state.previousOrders.length === 0) {
                    list.innerHTML = `<p style="text-align: center; padding: 40px; color: var(--text-gray);">Você ainda não possui pedidos anteriores.</p>`;
                    return;
                }

                // Pegar apenas itens únicos para não repetir
                const uniqueItems = [];
                const seen = new Set();
                state.previousOrders.forEach(o => {
                    const key = `${o.product}-${o.variation || ''}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        uniqueItems.push(o);
                    }
                });

                list.innerHTML = uniqueItems.slice(0, 6).map(o => `
                                            <div class="history-card" onclick="reorderItem('${o.id}')">
                                                <div class="history-card-info">
                                                    <strong>${o.product}</strong>
                                                    ${o.variation ? `<p>${o.variation}</p>` : ''}
                                                </div>
                                                <div class="history-card-action">
                                                    <span>Pedir de novo</span>
                                                    <i data-lucide="chevron-right"></i>
                                                </div>
                                            </div>
                                        `).join('');
                lucide.createIcons();
            }

            function reorderItem(orderId) {
                const order = state.previousOrders.find(o => o.id === orderId);
                if (!order) return;

                // Tenta encontrar o produto original no menu para pegar o ID correto e imagem
                const baseName = order.product.split('(')[0].trim();
                const product = state.products.find(p => p.name.toLowerCase().includes(baseName.toLowerCase()));

                if (product) {
                    state.currentItem = product;
                    state.currentQty = 1;
                    state.currentVariation = order.variation ? { name: order.variation, price: order.totalPrice / order.quantity } : null;
                    addToCart();
                    closeWithAnimation('history-modal');
                    goToStep(1);
                } else {
                    showAlert('Produto Indisponível', 'Este produto não está mais disponível no cardápio no momento.', 'error');
                }
            }

            function updateTheme() {
                const data = state.publicSettings;
                if (!data) return;

                const root = document.documentElement;
                const isOrder = state.activeTab === 'order';

                // Escolhe as cores baseadas na aba ativa
                const accent = isOrder ? (data.accentColorOrders || '#4a2c2a') : (data.accentColor || '#ff4d6d');
                const button = isOrder ? (data.buttonColorOrders || '#4a2c2a') : (data.buttonColor || '#ff4d6d');

                // Aplica as variáveis
                root.style.setProperty('--primary-color', accent);
                root.style.setProperty('--btn-bg', button);
                root.style.setProperty('--btn-text', data.buttonTextColor || '#ffffff');
                root.style.setProperty('--bg-color', data.backgroundColor || '#ffffff');
                root.style.setProperty('--text-main', data.textColor || '#333333');
                root.style.setProperty('--border', `${data.textColor || '#333333'}15`);
                root.style.setProperty('--bg-gray', `${data.textColor || '#333333'}08`);
                root.style.setProperty('--text-black', data.textColor || '#333333');
                root.style.setProperty('--text-gray', `${data.textColor || '#333333'}99`);
            }

            // Inicialização
            fetchPublicSettings();
            fetchProducts();
            renderMenu(); // Mostra o skeleton imediatamente
            updateUI();
        </script>
        <script>lucide.createIcons();</script>
    </body>

    </html>
    <?php
} catch (Exception $e) {
    die("Erro: " . $e->getMessage());
}
