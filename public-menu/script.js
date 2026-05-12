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
    publicSettings: { googleApiKey: '', deliveryRules: [], businessName: 'Linda Cake' },
    currentStep: 1,
    deliveryFee: 0,
    googleMap: null,
    mapMarker: null
};

const getActiveCart = () => state.activeTab === 'delivery' ? state.deliveryCart : state.orderCart;
const setActiveCart = (newCart) => {
    if (state.activeTab === 'delivery') state.deliveryCart = newCart;
    else state.orderCart = newCart;
};

document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    fetchPublicSettings();
    fetchProducts();
    initEventListeners();
    updateUI();
});

async function fetchPublicSettings() {
    try {
        const response = await fetch(`${API_BASE}/orders/settings/public`);
        state.publicSettings = await response.json();
        if (state.publicSettings.googleApiKey) loadGoogleMaps(state.publicSettings.googleApiKey);
    } catch (err) { console.error('Erro ao carregar configurações:', err); }
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
    const input = document.getElementById('user-address');
    const autocomplete = new google.maps.places.Autocomplete(input);
    autocomplete.setComponentRestrictions({ country: 'br' });
    
    // Init Map
    const mapCenter = { lat: -2.5307, lng: -44.3068 }; // São Luís, MA (Default)
    state.googleMap = new google.maps.Map(document.getElementById('map-container'), {
        zoom: 14,
        center: mapCenter,
        disableDefaultUI: true
    });
    state.mapMarker = new google.maps.Marker({ map: state.googleMap, position: mapCenter });

    autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        if (!place.geometry) return;
        
        state.userInfo.address = place.formatted_address;
        localStorage.setItem('linda_cake_user', JSON.stringify(state.userInfo));

        // Update Map
        state.googleMap.setCenter(place.geometry.location);
        state.mapMarker.setPosition(place.geometry.location);
        
        calculateDeliveryFee(place.formatted_address);
    });
};

async function calculateDeliveryFee(address) {
    try {
        const response = await fetch(`${API_BASE}/orders/calculate-fee`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address })
        });
        const data = await response.json();
        if (data.fee !== undefined) {
            state.deliveryFee = data.fee;
            updateStep3Summary();
        } else if (data.error) {
            alert(data.error);
        }
    } catch (err) { console.error('Erro ao calcular frete:', err); }
}

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

function renderMenu() {
    const container = document.getElementById('menu-sections');
    const query = state.searchQuery.toLowerCase();
    
    const filtered = state.products.filter(p => {
        if (p.active === false) return false;
        const matchesTab = (state.activeTab === 'delivery' && p.type === 'delivery') || (state.activeTab === 'order');
        const matchesSearch = p.name.toLowerCase().includes(query) || (p.description && p.description.toLowerCase().includes(query));
        return matchesTab && matchesSearch;
    });

    if (state.activeTab === 'order') {
        filtered.sort((a, b) => (a.type === 'encomenda' ? -1 : 1) - (b.type === 'encomenda' ? -1 : 1));
    }

    const grouped = filtered.reduce((acc, p) => {
        const cat = p.category || 'Outros';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(p);
        return acc;
    }, {});

    container.innerHTML = Object.entries(grouped).map(([category, items]) => `
        <section class="menu-section">
            ${category !== 'Outros' ? `<h2>${category}</h2>` : ''}
            <div class="product-list">${items.map(item => renderProductCard(item)).join('')}</div>
        </section>
    `).join('');
    lucide.createIcons();
}

function renderProductCard(product) {
    const variations = JSON.parse(product.variations || '[]');
    const priceText = variations.length > 0 ? `A partir de R$ ${Math.min(...variations.map(v => v.price)).toFixed(2)}` : `R$ ${parseFloat(product.price).toFixed(2)}`;
    return `
        <div class="product-card" onclick="openItemDetail('${product.id}')">
            <div class="product-info">
                <h3>${product.name}</h3>
                <p>${product.description || ''}</p>
                <div class="product-price">${priceText}</div>
            </div>
            ${product.image ? `<img src="${product.image}" class="product-img">` : `<div class="img-placeholder"><i data-lucide="image"></i></div>`}
        </div>
    `;
}

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
        ${variations.length > 0 ? `<div class="variation-section"><h4>Escolha uma opção</h4>${variations.map(v => `<div class="var-option" onclick="selectVariation('${v.name.replace(/'/g, "\\'")}', ${v.price})"><div class="var-label">${v.name}</div><div class="var-price">+ R$ ${parseFloat(v.price).toFixed(2)}</div></div>`).join('')}</div>` : ''}
    `;
    updateDetailFooter();
    document.getElementById('item-modal').classList.remove('hidden');
    lucide.createIcons();
}

function selectVariation(name, price) {
    state.currentVariation = { name, price };
    document.querySelectorAll('.var-option').forEach(el => el.classList.toggle('selected', el.querySelector('.var-label').innerText === name));
    updateDetailFooter();
}

function updateDetailFooter() {
    const basePrice = state.currentVariation ? state.currentVariation.price : (state.currentItem?.price || 0);
    document.getElementById('add-btn-price').innerText = `R$ ${(basePrice * state.currentQty).toFixed(2)}`;
    document.getElementById('detail-qty').innerText = state.currentQty;
}

function initEventListeners() {
    document.getElementById('search-input').addEventListener('input', (e) => { state.searchQuery = e.target.value; renderMenu(); });
    document.querySelectorAll('.cat-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.activeTab = btn.dataset.tab;
            document.body.className = state.activeTab === 'order' ? 'theme-order' : '';
            renderMenu(); updateUI();
        });
    });

    document.getElementById('qty-plus').addEventListener('click', () => { state.currentQty++; updateDetailFooter(); });
    document.getElementById('qty-minus').addEventListener('click', () => { if(state.currentQty > 1) { state.currentQty--; updateDetailFooter(); } });
    document.querySelector('.close-modal-btn').addEventListener('click', () => document.getElementById('item-modal').classList.add('hidden'));
    document.getElementById('add-to-cart-btn').addEventListener('click', addToCart);
    document.getElementById('view-cart-btn').addEventListener('click', () => goToStep(1));
    document.getElementById('checkout-back-btn').addEventListener('click', () => { if(state.currentStep > 1) goToStep(state.currentStep - 1); else document.getElementById('checkout-modal').classList.add('hidden'); });
    document.getElementById('next-step-btn').addEventListener('click', handleNextStep);
    document.getElementById('place-order-btn').addEventListener('click', handlePlaceOrder);

    ['user-name', 'user-phone', 'user-address'].forEach(id => {
        const el = document.getElementById(id);
        if(el) {
            el.value = state.userInfo[id.split('-')[1]] || '';
            el.addEventListener('input', (e) => {
                state.userInfo[id.split('-')[1]] = e.target.value;
                localStorage.setItem('linda_cake_user', JSON.stringify(state.userInfo));
            });
        }
    });
}

function goToStep(step) {
    state.currentStep = step;
    document.querySelectorAll('.checkout-step').forEach((el, idx) => el.classList.toggle('hidden', idx + 1 !== step));
    document.getElementById('checkout-modal').classList.remove('hidden');
    
    // Update Header/Footer
    const titles = ["Ver sacola", "Entrega & Agendamento", "Confirmar Pedido"];
    document.getElementById('checkout-step-title').innerText = titles[step - 1];
    
    const isLast = step === 3;
    document.getElementById('next-step-btn').classList.toggle('hidden', isLast);
    document.getElementById('place-order-btn').classList.toggle('hidden', !isLast);

    if (step === 1) renderStep1();
    if (step === 2) renderStep2();
    if (step === 3) updateStep3Summary();
}

function renderStep1() {
    const cart = getActiveCart();
    const list = document.getElementById('checkout-items-list');
    list.innerHTML = cart.map(item => `<div class="checkout-item"><div class="item-name-qty"><span class="qty-text">${item.quantity}x</span><div><strong>${item.name}</strong>${item.variation ? `<p style="font-size: 0.75rem; color: var(--text-gray);">${item.variation}</p>` : ''}</div></div><div class="item-price">R$ ${(item.price * item.quantity).toFixed(2)}</div></div>`).join('');
}

function renderStep2() {
    const isDelivery = state.activeTab === 'delivery';
    document.getElementById('delivery-step-content').classList.toggle('hidden', !isDelivery);
    document.getElementById('order-step-content').classList.toggle('hidden', isDelivery);
    if (isDelivery && state.googleMap) {
        setTimeout(() => google.maps.event.trigger(state.googleMap, 'resize'), 100);
    }
}

function handleNextStep() {
    if (state.currentStep === 1) {
        if (!state.userInfo.name || !state.userInfo.phone) return alert('Preencha seu nome e telefone.');
        goToStep(2);
    } else if (state.currentStep === 2) {
        if (state.activeTab === 'delivery' && !state.userInfo.address) return alert('Selecione seu endereço.');
        if (state.activeTab === 'order' && (!document.getElementById('order-date').value || !document.getElementById('order-time').value)) return alert('Escolha data e hora.');
        goToStep(3);
    }
}

function updateStep3Summary() {
    const cart = getActiveCart();
    const subtotal = cart.reduce((acc, i) => acc + (i.price * i.quantity), 0);
    const fee = state.activeTab === 'delivery' ? state.deliveryFee : 0;
    const total = subtotal + fee;

    document.getElementById('summary-subtotal').innerText = `R$ ${subtotal.toFixed(2)}`;
    document.getElementById('summary-fee').innerText = `R$ ${fee.toFixed(2)}`;
    document.getElementById('summary-total').innerText = `R$ ${total.toFixed(2)}`;
    document.getElementById('delivery-fee-line').classList.toggle('hidden', state.activeTab !== 'delivery');

    document.getElementById('review-items-list').innerHTML = cart.map(item => `<p style="font-size: 0.9rem; margin-bottom: 4px;">${item.quantity}x ${item.name} ${item.variation ? `(${item.variation})` : ''}</p>`).join('');
}

function addToCart() {
    const item = state.currentItem;
    const variation = state.currentVariation;
    const variations = JSON.parse(item.variations || '[]');
    if (variations.length > 0 && !variation) return alert('Por favor, selecione uma opção.');
    const itemKey = variation ? `${item.id}-${variation.name}` : item.id;
    let cart = getActiveCart();
    const existing = cart.find(c => c.itemKey === itemKey);
    if (existing) existing.quantity += state.currentQty;
    else cart.push({ productId: item.id, itemKey, name: item.name, variation: variation ? variation.name : null, price: variation ? variation.price : item.price, quantity: state.currentQty });
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
    } else footer.classList.add('hidden');
}

async function handlePlaceOrder() {
    const cart = getActiveCart();
    const btn = document.getElementById('place-order-btn');
    btn.disabled = true; btn.innerHTML = 'Processando...';

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
        carrinho_itens_extras: cart.slice(1).map(item => ({ name: item.name + (item.variation ? ` (${item.variation})` : ''), price: item.price, quantity: item.quantity }))
    };

    try {
        const response = await fetch(`${API_BASE}/orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (data.id) {
            if (data.paymentLink) location.href = data.paymentLink; // Redireciona direto para o Mercado Pago
            else showSuccessScreen(data);
        } else throw new Error(data.error);
    } catch (err) { alert('Erro: ' + err.message); btn.disabled = false; btn.innerHTML = 'Fazer pedido'; }
}

function showSuccessScreen(data) {
    document.getElementById('checkout-modal').classList.add('hidden');
    document.getElementById('success-screen').classList.remove('hidden');
    if (state.activeTab === 'delivery') state.deliveryCart = []; else state.orderCart = [];
}
