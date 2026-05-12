// Configurações
const API_BASE = 'http://157.230.239.80:3001';

// Estado da Aplicação
let state = {
    products: [],
    activeTab: 'delivery',
    cart: [],
    loading: true,
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
        renderProducts();
    } catch (err) {
        console.error('Erro ao buscar produtos:', err);
        document.getElementById('product-list').innerHTML = `<p class="error">Erro ao carregar cardápio. Verifique sua conexão.</p>`;
    }
}

// Renderização
function renderProducts() {
    const list = document.getElementById('product-list');
    
    // Mapeamento: Aba 'order' no front-end corresponde ao tipo 'encomenda' no banco
    const filtered = state.products.filter(p => {
        if (state.activeTab === 'delivery') return p.type === 'delivery';
        if (state.activeTab === 'order') return p.type === 'encomenda' || p.type === 'order';
        return false;
    });
    
    if (filtered.length === 0) {
        list.innerHTML = `
            <div class="empty-state" style="text-align: center; padding: 40px; color: var(--text-muted);">
                <i data-lucide="shopping-bag" style="width: 48px; height: 48px; margin-bottom: 10px; opacity: 0.5;"></i>
                <p>Nenhum item disponível nesta categoria.</p>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    list.innerHTML = filtered.map(product => {
        const variations = JSON.parse(product.variations || '[]');
        
        let actionsHtml = '';
        if (variations.length > 0) {
            actionsHtml = `<div class="variations-list">
                ${variations.map(v => `
                    <button class="btn-var" onclick="addToCart('${product.id}', '${v.name}')">
                        <span>${v.name}</span>
                        <span class="var-price">R$ ${parseFloat(v.price).toFixed(2)}</span>
                    </button>
                `).join('')}
            </div>`;
        } else {
            actionsHtml = `<button class="btn-add" onclick="addToCart('${product.id}')">
                <i data-lucide="plus"></i> Adicionar ao Carrinho
            </button>`;
        }

        return `
            <div class="product-card">
                <div class="card-header">
                    <h3>${product.name}</h3>
                    ${variations.length === 0 ? `<span class="price-badge">R$ ${parseFloat(product.price).toFixed(2)}</span>` : ''}
                </div>
                <p class="product-desc">${product.description || ''}</p>
                ${actionsHtml}
            </div>
        `;
    }).join('');
    
    lucide.createIcons();
}

// Lógica do Carrinho
function addToCart(productId, variationName = null) {
    const product = state.products.find(p => p.id === productId);
    const variations = JSON.parse(product.variations || '[]');
    const variation = variationName ? variations.find(v => v.name === variationName) : null;
    
    const itemKey = variationName ? `${productId}-${variationName}` : productId;
    const existing = state.cart.find(item => item.itemKey === itemKey);

    if (existing) {
        existing.quantity += 1;
    } else {
        state.cart.push({
            productId,
            itemKey,
            name: product.name,
            variation: variationName,
            price: variation ? parseFloat(variation.price) : parseFloat(product.price),
            quantity: 1
        });
    }
    
    updateUI();
}

function updateUI() {
    const cartBar = document.getElementById('cart-bar');
    const cartCount = document.getElementById('cart-count');
    const cartTotal = document.getElementById('cart-total-value');
    
    if (state.cart.length > 0) {
        cartBar.classList.remove('hidden');
        const count = state.cart.reduce((acc, item) => acc + item.quantity, 0);
        const total = state.cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);
        
        cartCount.innerText = count;
        cartTotal.innerText = total.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    } else {
        cartBar.classList.add('hidden');
    }

    // Atualiza campos do formulário se existirem dados salvos
    document.getElementById('client-name').value = state.userInfo.name;
    document.getElementById('client-phone').value = state.userInfo.phone;
    document.getElementById('delivery-address').value = state.userInfo.address;
}

// Eventos
function initEventListeners() {
    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.activeTab = btn.dataset.tab;
            
            // Toggle sections in modal
            if (state.activeTab === 'delivery') {
                document.getElementById('delivery-section').classList.remove('hidden');
                document.getElementById('order-section').classList.add('hidden');
            } else {
                document.getElementById('delivery-section').classList.add('hidden');
                document.getElementById('order-section').classList.remove('hidden');
            }
            
            renderProducts();
        });
    });

    // Checkout Modal
    document.getElementById('open-checkout').addEventListener('click', openCheckout);
    document.getElementById('close-checkout').addEventListener('click', () => {
        document.getElementById('checkout-modal').classList.add('hidden');
    });

    // Confirm Order
    document.getElementById('confirm-order').addEventListener('click', handleCheckout);

    // New Order (Success screen)
    document.getElementById('new-order').addEventListener('click', () => {
        location.reload();
    });

    // Save inputs to state and localStorage
    ['client-name', 'client-phone', 'delivery-address'].forEach(id => {
        document.getElementById(id).addEventListener('input', (e) => {
            const field = id.split('-')[1];
            state.userInfo[field] = e.target.value;
            localStorage.setItem('linda_cake_user', JSON.stringify(state.userInfo));
        });
    });
}

function openCheckout() {
    const list = document.getElementById('cart-items');
    list.innerHTML = state.cart.map(item => `
        <div class="cart-item">
            <div class="cart-item-info">
                <h4>${item.name}</h4>
                ${item.variation ? `<span>${item.variation}</span>` : ''}
            </div>
            <div class="cart-item-price">
                ${item.quantity}x R$ ${item.price.toFixed(2)}
            </div>
        </div>
    `).join('');

    const total = state.cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);
    document.getElementById('final-total').innerText = `R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    
    document.getElementById('checkout-modal').classList.remove('hidden');
}

async function handleCheckout() {
    const btn = document.getElementById('confirm-order');
    const name = document.getElementById('client-name').value;
    const phone = document.getElementById('client-phone').value;

    if (!name || !phone) {
        alert('Por favor, preencha seu nome e telefone.');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = 'Processando...';

    const payload = {
        clientName: name,
        clientPhone: phone,
        product: state.cart[0].name + (state.cart[0].variation ? ` (${state.cart[0].variation})` : ''),
        quantity: state.cart[0].quantity,
        type: state.activeTab,
        deliveryAddress: state.activeTab === 'delivery' ? document.getElementById('delivery-address').value : null,
        scheduledDate: state.activeTab === 'order' ? document.getElementById('scheduled-date').value : null,
        scheduledTime: state.activeTab === 'order' ? document.getElementById('scheduled-time').value : null,
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
            showSuccess(data);
        } else {
            throw new Error(data.error || 'Erro desconhecido');
        }
    } catch (err) {
        alert('Erro ao realizar pedido: ' + err.message);
        btn.disabled = false;
        btn.innerHTML = 'CONFIRMAR E PAGAR <i data-lucide="arrow-right"></i>';
        lucide.createIcons();
    }
}

function showSuccess(data) {
    document.getElementById('checkout-modal').classList.add('hidden');
    document.getElementById('success-modal').classList.remove('hidden');
    
    if (data.paymentLink) {
        const pLink = document.getElementById('payment-link');
        pLink.href = data.paymentLink;
        pLink.classList.remove('hidden');
    }
    
    lucide.createIcons();
}
