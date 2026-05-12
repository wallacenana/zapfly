// Configurações
const API_BASE = 'http://157.230.239.80:3001';

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
    userInfo: JSON.parse(localStorage.getItem('linda_cake_user') || '{"name":"","phone":"","address":""}'),
    publicSettings: { googleApiKey: '', deliveryRules: [], businessName: 'Linda Cake' }
};

// Getters para o carrinho ativo
const getActiveCart = () => state.activeTab === 'delivery' ? state.deliveryCart : state.orderCart;
const setActiveCart = (newCart) => {
    if (state.activeTab === 'delivery') state.deliveryCart = newCart;
    else state.orderCart = newCart;
};

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    fetchPublicSettings();
    fetchProducts();
    initEventListeners();
    updateUI();
});

// Busca de Configurações (API Key, Regras de Entrega)
async function fetchPublicSettings() {
    try {
        const response = await fetch(`${API_BASE}/orders/settings/public`);
        state.publicSettings = await response.json();
        
        if (state.publicSettings.googleApiKey) {
            loadGoogleMaps(state.publicSettings.googleApiKey);
        }
    } catch (err) {
        console.error('Erro ao carregar configurações:', err);
    }
}

// Carregamento Dinâmico do Google Maps
function loadGoogleMaps(apiKey) {
    if (window.google) return;
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=initMapsAutocomplete`;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
}

// Callback do Google Maps
window.initMapsAutocomplete = () => {
    const input = document.getElementById('user-address');
    const autocomplete = new google.maps.places.Autocomplete(input);
    autocomplete.setComponentRestrictions({ country: 'br' });
    
    autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        if (!place.geometry) return;
        
        // Salva endereço no state
        state.userInfo.address = place.formatted_address;
        localStorage.setItem('linda_cake_user', JSON.stringify(state.userInfo));
        
        // Aqui poderia disparar cálculo de frete via API se necessário
    });
};

// Busca de Produtos
async function fetchProducts() {
    try {
        const response = await fetch(`${API_BASE}/orders/products`);
        state.products = await response.json();
        state.loading = false;
        renderMenu();
    } catch (err) {
        console.error('Erro ao buscar produtos:', err);
        document.getElementById('menu-sections').innerHTML = `<p class="error">Erro ao carregar cardápio.</p>`;
    }
}

// Renderização AJAX do Menu
function renderMenu() {
    const container = document.getElementById('menu-sections');
    const query = state.searchQuery.toLowerCase();
    
    // Produtos filtrados por Aba + Busca
    const filtered = state.products.filter(p => {
        const matchesTab = (state.activeTab === 'delivery' && p.type === 'delivery') || 
                          (state.activeTab === 'order'); // Na aba Encomenda, mostra tudo
        
        const matchesSearch = p.name.toLowerCase().includes(query) || 
                             (p.description && p.description.toLowerCase().includes(query)) ||
                             (p.category && p.category.toLowerCase().includes(query));
        
        return matchesTab && matchesSearch;
    });

    if (filtered.length === 0) {
        container.innerHTML = `<div class="loading-state"><p>${state.searchQuery ? 'Nenhum resultado encontrado.' : 'Nenhum item disponível.'}</p></div>`;
        return;
    }

    // Agrupa por categoria
    const grouped = filtered.reduce((acc, p) => {
        const cat = p.category || 'Outros';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(p);
        return acc;
    }, {});

    container.innerHTML = Object.entries(grouped).map(([category, items]) => `
        <section class="menu-section">
            <h2>${category}</h2>
            <div class="product-list">
                ${items.map(item => renderProductCard(item)).join('')}
            </div>
        </section>
    `).join('');
    
    lucide.createIcons();
}

function renderProductCard(product) {
    const variations = JSON.parse(product.variations || '[]');
    const priceText = variations.length > 0 
        ? `A partir de R$ ${Math.min(...variations.map(v => v.price)).toFixed(2)}`
        : `R$ ${parseFloat(product.price).toFixed(2)}`;

    return `
        <div class="product-card" onclick="openItemDetail('${product.id}')">
            <div class="product-info">
                <h3>${product.name}</h3>
                <p>${product.description || ''}</p>
                <div class="product-price">${priceText}</div>
            </div>
            ${product.image 
                ? `<img src="${product.image}" alt="${product.name}" class="product-img">`
                : `<div class="img-placeholder"><i data-lucide="image"></i></div>`
            }
        </div>
    `;
}

// Detalhes do Item
function openItemDetail(productId) {
    const item = state.products.find(p => p.id === productId);
    state.currentItem = item;
    state.currentQty = 1;
    state.currentVariation = null;

    const variations = JSON.parse(item.variations || '[]');
    const body = document.getElementById('item-detail-body');

    body.innerHTML = `
        ${item.image ? `<img src="${item.image}" class="item-hero-img">` : ''}
        <div class="item-main-info">
            <h2>${item.name}</h2>
            <p>${item.description || ''}</p>
            ${variations.length === 0 ? `<div class="price">R$ ${parseFloat(item.price).toFixed(2)}</div>` : ''}
        </div>
        ${variations.length > 0 ? `
            <div class="variation-section">
                <h4>Escolha uma opção</h4>
                ${variations.map(v => `
                    <div class="var-option" onclick="selectVariation('${v.name.replace(/'/g, "\\'")}', ${v.price})">
                        <div class="var-label">${v.name}</div>
                        <div class="var-price">+ R$ ${parseFloat(v.price).toFixed(2)}</div>
                    </div>
                `).join('')}
            </div>
        ` : ''}
    `;

    updateDetailFooter();
    document.getElementById('item-modal').classList.remove('hidden');
    lucide.createIcons();
}

function selectVariation(name, price) {
    state.currentVariation = { name, price };
    document.querySelectorAll('.var-option').forEach(el => {
        el.classList.toggle('selected', el.querySelector('.var-label').innerText === name);
    });
    updateDetailFooter();
}

function updateDetailFooter() {
    const basePrice = state.currentVariation ? state.currentVariation.price : (state.currentItem?.price || 0);
    document.getElementById('add-btn-price').innerText = `R$ ${(basePrice * state.currentQty).toFixed(2)}`;
    document.getElementById('detail-qty').innerText = state.currentQty;
}

// Event Listeners
function initEventListeners() {
    // Busca AJAX
    document.getElementById('search-input').addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        renderMenu();
    });

    // Troca de Abas + Temas
    document.querySelectorAll('.cat-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.activeTab = btn.dataset.tab;
            
            // Troca o tema visual
            document.body.className = state.activeTab === 'order' ? 'theme-order' : '';
            
            renderMenu();
            updateUI();
        });
    });

    // Qty Selector no Modal
    document.getElementById('qty-plus').addEventListener('click', () => { state.currentQty++; updateDetailFooter(); });
    document.getElementById('qty-minus').addEventListener('click', () => { if(state.currentQty > 1) { state.currentQty--; updateDetailFooter(); } });

    // Modais
    document.querySelector('.close-modal-btn').addEventListener('click', () => document.getElementById('item-modal').classList.add('hidden'));
    document.getElementById('add-to-cart-btn').addEventListener('click', addToCart);
    document.getElementById('view-cart-btn').addEventListener('click', openCheckout);
    document.querySelector('.back-btn').addEventListener('click', () => document.getElementById('checkout-modal').classList.add('hidden'));
    document.getElementById('place-order-btn').addEventListener('click', handlePlaceOrder);

    // Inputs Persistence
    ['user-name', 'user-phone', 'user-address'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.addEventListener('input', (e) => {
            state.userInfo[id.split('-')[1]] = e.target.value;
            localStorage.setItem('linda_cake_user', JSON.stringify(state.userInfo));
        });
    });
}

function addToCart() {
    const item = state.currentItem;
    const variation = state.currentVariation;
    const variations = JSON.parse(item.variations || '[]');
    
    if (variations.length > 0 && !variation) {
        alert('Por favor, selecione uma opção.');
        return;
    }

    const itemKey = variation ? `${item.id}-${variation.name}` : item.id;
    let cart = getActiveCart();
    
    const existing = cart.find(c => c.itemKey === itemKey);
    if (existing) {
        existing.quantity += state.currentQty;
    } else {
        cart.push({
            productId: item.id,
            itemKey,
            name: item.name,
            variation: variation ? variation.name : null,
            price: variation ? variation.price : item.price,
            quantity: state.currentQty
        });
    }

    setActiveCart(cart);
    document.getElementById('item-modal').classList.add('hidden');
    updateUI();
}

function updateUI() {
    const cart = getActiveCart();
    const footer = document.getElementById('cart-footer');
    
    if (cart.length > 0) {
        footer.classList.remove('hidden');
        const qty = cart.reduce((acc, i) => acc + i.quantity, 0);
        const total = cart.reduce((acc, i) => acc + (i.price * i.quantity), 0);
        document.getElementById('cart-qty-badge').innerText = qty;
        document.getElementById('cart-total-footer').innerText = `R$ ${total.toFixed(2)}`;
    } else {
        footer.classList.add('hidden');
    }
}

function openCheckout() {
    const cart = getActiveCart();
    const list = document.getElementById('checkout-items-list');
    list.innerHTML = cart.map(item => `
        <div class="checkout-item">
            <div class="item-name-qty">
                <span class="qty-text">${item.quantity}x</span>
                <div>
                    <strong>${item.name}</strong>
                    ${item.variation ? `<p style="font-size: 0.75rem; color: var(--text-gray);">${item.variation}</p>` : ''}
                </div>
            </div>
            <div class="item-price">R$ ${(item.price * item.quantity).toFixed(2)}</div>
        </div>
    `).join('');

    const total = cart.reduce((acc, i) => acc + (i.price * i.quantity), 0);
    document.getElementById('summary-subtotal').innerText = `R$ ${total.toFixed(2)}`;
    document.getElementById('summary-total').innerText = `R$ ${total.toFixed(2)}`;

    // Toggle Seções do Formulário
    const isDelivery = state.activeTab === 'delivery';
    document.getElementById('delivery-info').classList.toggle('hidden', !isDelivery);
    document.getElementById('order-info').classList.toggle('hidden', isDelivery);

    document.getElementById('checkout-modal').classList.remove('hidden');
}

async function handlePlaceOrder() {
    const cart = getActiveCart();
    const name = document.getElementById('user-name').value;
    const phone = document.getElementById('user-phone').value;
    const btn = document.getElementById('place-order-btn');

    if (!name || !phone) { alert('Preencha nome e telefone.'); return; }

    btn.disabled = true;
    btn.innerHTML = 'Processando...';

    const payload = {
        clientName: name,
        clientPhone: phone,
        product: cart[0].name + (cart[0].variation ? ` (${cart[0].variation})` : ''),
        quantity: cart[0].quantity,
        type: state.activeTab,
        deliveryAddress: state.activeTab === 'delivery' ? document.getElementById('user-address').value : null,
        scheduledDate: state.activeTab === 'order' ? document.getElementById('order-date').value : null,
        scheduledTime: state.activeTab === 'order' ? document.getElementById('order-time').value : null,
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
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (data.id) showSuccessScreen(data);
        else throw new Error(data.error);
    } catch (err) {
        alert('Erro: ' + err.message);
        btn.disabled = false;
        btn.innerHTML = 'Fazer pedido';
    }
}

function showSuccessScreen(data) {
    document.getElementById('checkout-modal').classList.add('hidden');
    document.getElementById('success-screen').classList.remove('hidden');
    if (data.paymentLink) document.getElementById('ext-payment-link').href = data.paymentLink;
    else document.getElementById('ext-payment-link').classList.add('hidden');
    
    // Limpa apenas o carrinho da aba ativa
    if (state.activeTab === 'delivery') state.deliveryCart = [];
    else state.orderCart = [];
}
