// Configurações
const API_BASE = 'http://157.230.239.80:3001';

// Estado da Aplicação
let state = {
    products: [],
    activeTab: 'delivery',
    cart: [],
    loading: true,
    currentItem: null, // Para o modal de detalhes
    currentQty: 1,
    currentVariation: null,
    userInfo: JSON.parse(localStorage.getItem('linda_cake_user') || '{"name":"","phone":"","address":""}')
};

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    fetchProducts();
    initEventListeners();
    updateUI();
});

// Busca de Produtos
async function fetchProducts() {
    try {
        const response = await fetch(`${API_BASE}/orders/products`);
        state.products = await response.json();
        state.loading = false;
        renderMenu();
    } catch (err) {
        console.error('Erro ao buscar produtos:', err);
        document.getElementById('menu-sections').innerHTML = `<p class="error">Erro ao carregar cardápio. Verifique sua conexão.</p>`;
    }
}

// Renderização do Menu por Categorias (Estilo iFood)
function renderMenu() {
    const container = document.getElementById('menu-sections');
    
    // Filtra produtos pelo tipo de aba (delivery vs encomenda)
    const filtered = state.products.filter(p => {
        if (state.activeTab === 'delivery') return p.type === 'delivery';
        if (state.activeTab === 'order') return p.type === 'encomenda' || p.type === 'order';
        return false;
    });

    if (filtered.length === 0) {
        container.innerHTML = `<div class="loading-state"><p>Nenhum item disponível nesta categoria.</p></div>`;
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

// Modal de Detalhes (Popup)
function openItemDetail(productId) {
    const item = state.products.find(p => p.id === productId);
    state.currentItem = item;
    state.currentQty = 1;
    state.currentVariation = null;

    const variations = JSON.parse(item.variations || '[]');
    const body = document.getElementById('item-detail-body');

    let variationsHtml = '';
    if (variations.length > 0) {
        variationsHtml = `
            <div class="variation-section">
                <h4>Escolha uma opção</h4>
                ${variations.map((v, idx) => `
                    <div class="var-option" onclick="selectVariation('${v.name}', ${v.price})">
                        <div class="var-label">${v.name}</div>
                        <div class="var-price">+ R$ ${parseFloat(v.price).toFixed(2)}</div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    body.innerHTML = `
        ${item.image ? `<img src="${item.image}" class="item-hero-img">` : ''}
        <div class="item-main-info">
            <h2>${item.name}</h2>
            <p>${item.description || ''}</p>
            ${variations.length === 0 ? `<div class="price">R$ ${parseFloat(item.price).toFixed(2)}</div>` : ''}
        </div>
        ${variationsHtml}
    `;

    updateDetailFooter();
    document.getElementById('item-modal').classList.remove('hidden');
    lucide.createIcons();
}

function selectVariation(name, price) {
    state.currentVariation = { name, price };
    
    // Visual update of selection
    document.querySelectorAll('.var-option').forEach(el => {
        el.classList.remove('selected');
        if (el.querySelector('.var-label').innerText === name) {
            el.classList.add('selected');
        }
    });

    updateDetailFooter();
}

function updateDetailFooter() {
    const basePrice = state.currentVariation ? state.currentVariation.price : (state.currentItem?.price || 0);
    const total = basePrice * state.currentQty;
    document.getElementById('add-btn-price').innerText = `R$ ${total.toFixed(2)}`;
    document.getElementById('detail-qty').innerText = state.currentQty;
}

// Event Listeners Centralizados
function initEventListeners() {
    // Tabs
    document.querySelectorAll('.cat-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.activeTab = btn.dataset.tab;
            renderMenu();
        });
    });

    // Modal Details
    document.querySelector('.close-modal-btn').addEventListener('click', () => {
        document.getElementById('item-modal').classList.add('hidden');
    });

    document.getElementById('qty-plus').addEventListener('click', () => {
        state.currentQty++;
        updateDetailFooter();
    });

    document.getElementById('qty-minus').addEventListener('click', () => {
        if (state.currentQty > 1) {
            state.currentQty--;
            updateDetailFooter();
        }
    });

    document.getElementById('add-to-cart-btn').addEventListener('click', () => {
        const variations = JSON.parse(state.currentItem.variations || '[]');
        if (variations.length > 0 && !state.currentVariation) {
            alert('Por favor, selecione uma opção.');
            return;
        }
        addToCart();
    });

    // Cart Logic
    document.getElementById('view-cart-btn').addEventListener('click', openCheckout);
    document.querySelector('.back-btn').addEventListener('click', () => {
        document.getElementById('checkout-modal').classList.add('hidden');
    });

    document.getElementById('place-order-btn').addEventListener('click', handlePlaceOrder);

    // Inputs Persistence
    ['user-name', 'user-phone', 'user-address'].forEach(id => {
        const el = document.getElementById(id);
        el.value = state.userInfo[id.split('-')[1]] || '';
        el.addEventListener('input', (e) => {
            state.userInfo[id.split('-')[1]] = e.target.value;
            localStorage.setItem('linda_cake_user', JSON.stringify(state.userInfo));
        });
    });
}

function addToCart() {
    const item = state.currentItem;
    const variation = state.currentVariation;
    const itemKey = variation ? `${item.id}-${variation.name}` : item.id;
    
    const existing = state.cart.find(c => c.itemKey === itemKey);
    if (existing) {
        existing.quantity += state.currentQty;
    } else {
        state.cart.push({
            productId: item.id,
            itemKey,
            name: item.name,
            variation: variation ? variation.name : null,
            price: variation ? variation.price : item.price,
            quantity: state.currentQty
        });
    }

    document.getElementById('item-modal').classList.add('hidden');
    updateUI();
}

function updateUI() {
    const footer = document.getElementById('cart-footer');
    if (state.cart.length > 0) {
        footer.classList.remove('hidden');
        const qty = state.cart.reduce((acc, i) => acc + i.quantity, 0);
        const total = state.cart.reduce((acc, i) => acc + (i.price * i.quantity), 0);
        
        document.getElementById('cart-qty-badge').innerText = qty;
        document.getElementById('cart-total-footer').innerText = `R$ ${total.toFixed(2)}`;
    } else {
        footer.classList.add('hidden');
    }
}

function openCheckout() {
    const list = document.getElementById('checkout-items-list');
    list.innerHTML = state.cart.map(item => `
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

    const total = state.cart.reduce((acc, i) => acc + (i.price * i.quantity), 0);
    document.getElementById('summary-subtotal').innerText = `R$ ${total.toFixed(2)}`;
    document.getElementById('summary-total').innerText = `R$ ${total.toFixed(2)}`;

    // Toggle info sections
    if (state.activeTab === 'delivery') {
        document.getElementById('delivery-info').classList.remove('hidden');
        document.getElementById('order-info').classList.add('hidden');
    } else {
        document.getElementById('delivery-info').classList.add('hidden');
        document.getElementById('order-info').classList.remove('hidden');
    }

    document.getElementById('checkout-modal').classList.remove('hidden');
}

async function handlePlaceOrder() {
    const name = document.getElementById('user-name').value;
    const phone = document.getElementById('user-phone').value;
    const btn = document.getElementById('place-order-btn');

    if (!name || !phone) {
        alert('Preencha seu nome e telefone.');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<div class="spinner" style="width:20px;height:20px;margin:0"></div>';

    const payload = {
        clientName: name,
        clientPhone: phone,
        product: state.cart[0].name + (state.cart[0].variation ? ` (${state.cart[0].variation})` : ''),
        quantity: state.cart[0].quantity,
        type: state.activeTab,
        deliveryAddress: state.activeTab === 'delivery' ? document.getElementById('user-address').value : null,
        scheduledDate: state.activeTab === 'order' ? document.getElementById('order-date').value : null,
        scheduledTime: state.activeTab === 'order' ? document.getElementById('order-time').value : null,
        carrinho_itens_extras: state.cart.slice(1).map(item => ({
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
        if (data.id) {
            showSuccessScreen(data);
        } else {
            throw new Error(data.error || 'Erro ao processar');
        }
    } catch (err) {
        alert('Erro: ' + err.message);
        btn.disabled = false;
        btn.innerHTML = 'Fazer pedido <i data-lucide="chevron-right"></i>';
        lucide.createIcons();
    }
}

function showSuccessScreen(data) {
    document.getElementById('checkout-modal').classList.add('hidden');
    document.getElementById('success-screen').classList.remove('hidden');
    if (data.paymentLink) {
        document.getElementById('ext-payment-link').href = data.paymentLink;
    } else {
        document.getElementById('ext-payment-link').classList.add('hidden');
    }
    lucide.createIcons();
}
