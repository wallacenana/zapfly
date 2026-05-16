// Configurações
const BASE_DOMAIN = 'digizap.com.br';

// Detecta se estamos na HOME exatamente
const isHome = (window.location.hostname === BASE_DOMAIN || window.location.hostname === 'www.' + BASE_DOMAIN) &&
    (window.location.pathname === '/' || window.location.pathname === '');

// Detecta o slug da URL
const pathSegments = window.location.pathname.split('/').filter(p => p);
const STORE_SLUG = isHome ? '' : (pathSegments[0] || '');

// Função auxiliar para alertas
const showAlert = (title, text, icon = 'warning') => {
    if (typeof Swal !== 'undefined') {
        Swal.fire({
            title: title,
            text: text,
            icon: icon,
            confirmButtonColor: getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim() || '#ff4d6d',
            confirmButtonText: 'Entendi'
        });
    } else {
        alert(`${title}\n${text}`);
    }
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
    currentCarouselIdx: 0,
    isOpen: true,
    availableSlots: []
};

// --- Funções de Mapa (Leaflet/OSM) ---
function loadLeaflet() {
    return new Promise((resolve) => {
        if (window.L) { resolve(); return; }
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.onload = resolve;
        document.head.appendChild(script);
    });
}

async function geocodeOSM(address) {
    try {
        const q = encodeURIComponent(address);
        const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`, {
            headers: { 'Accept-Language': 'pt-BR' }
        });
        const data = await res.json();
        if (data && data[0]) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    } catch (e) {}
    return null;
}

async function reverseGeocodeOSM(lat, lng) {
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`, {
            headers: { 'Accept-Language': 'pt-BR' }
        });
        const data = await res.json();
        return data.display_name || '';
    } catch (e) { return ''; }
}

async function calcDeliveryFee(lat, lng) {
    try {
        const res = await fetch(`${API_BASE}/public/delivery-fee/${STORE_SLUG}?lat=${lat}&lng=${lng}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        state.deliveryFee = data.fee || 0;
    } catch (e) { state.deliveryFee = 0; }

    const feeEl = document.getElementById('delivery-fee-display');
    if (feeEl) {
        feeEl.textContent = state.deliveryFee > 0
            ? `Taxa de entrega: R$ ${state.deliveryFee.toFixed(2).replace('.', ',')}`
            : 'Entrega grátis nessa área!';
    }
}

// --- Inicialização ---
document.addEventListener('DOMContentLoaded', () => {
    loadCart();
    lucide.createIcons();
    Promise.all([fetchPublicSettings(), fetchProducts()]).then(() => {
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
        state.publicSettings = data;
        state.products = data.products || [];
        state.availableSlots = data.availableSlots || [];
        state.isOpen = data.isOpen !== false;
        updateTheme();
    } catch (error) {
        console.error('Erro ao carregar configurações:', error);
    }
}

async function fetchProducts() {
    // Já vem no fetchPublicSettings no DigiZap
}

function initEventListeners() {
    // Tabs
    document.querySelectorAll('.cat-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.activeTab = btn.dataset.tab;
            renderMenu();
            updateUI();
        });
    });

    // Busca
    document.getElementById('search-input')?.addEventListener('input', (e) => {
        state.searchQuery = e.target.value.toLowerCase();
        renderMenu();
    });

    // Modal Events
    document.querySelectorAll('.modal-overlay, .close-modal-btn').forEach(el => {
        el.addEventListener('click', closeModal);
    });

    document.getElementById('qty-minus')?.addEventListener('click', () => { if (state.currentQty > 1) { state.currentQty--; updateDetailFooter(); } });
    document.getElementById('qty-plus')?.addEventListener('click', () => { state.currentQty++; updateDetailFooter(); });

    document.getElementById('history-toggle-btn')?.addEventListener('click', () => {
        document.getElementById('history-modal')?.classList.remove('hidden');
        renderPreviousOrders();
    });

    document.getElementById('add-to-cart-btn')?.addEventListener('click', addToCart);
    document.getElementById('view-cart-btn')?.addEventListener('click', () => goToStep(1));
    document.getElementById('next-step-btn')?.addEventListener('click', handleNextStep);
    document.getElementById('place-order-btn')?.addEventListener('click', handlePlaceOrder);

    document.getElementById('checkout-back-btn')?.addEventListener('click', () => {
        if (state.currentStep > 1) goToStep(state.currentStep - 1);
        else closeModal();
    });

    // Inputs Persistence
    ['user-name', 'user-phone', 'user-address'].forEach(id => {
        const input = document.getElementById(id);
        if (!input) return;
        const key = id.replace('user-', '');
        input.value = state.userInfo[key] || '';
        input.addEventListener('input', (e) => {
            if (id === 'user-phone') e.target.value = maskPhone(e.target.value);
            state.userInfo[key] = e.target.value;
            localStorage.setItem('zapfly_user', JSON.stringify(state.userInfo));
        });
    });
}

function maskPhone(v) {
    v = v.replace(/\D/g, "");
    v = v.replace(/^(\d{2})(\d)/g, "($1) $2");
    v = v.replace(/(\d{5})(\d)/, "$1-$2");
    return v;
}

function goToStep(step) {
    state.currentStep = step;
    document.querySelectorAll('.checkout-step').forEach((el, idx) => el.classList.toggle('hidden', idx + 1 !== step));
    const titleEl = document.getElementById('checkout-step-title');
    if (titleEl) titleEl.innerText = ["Ver sacola", "Entrega & Agendamento", "Confirmar Pedido"][step - 1];
    
    document.getElementById('next-step-btn')?.classList.toggle('hidden', step === 3);
    document.getElementById('place-order-btn')?.classList.toggle('hidden', step !== 3);
    
    if (step === 1) renderStep1();
    if (step === 2) renderStep2();
    if (step === 3) updateStep3Summary();
}

async function renderStep2() {
    const isDelivery = state.activeTab === 'delivery';
    const mapContainer = document.getElementById('delivery-map');
    
    // Cria div de taxa se não existir
    if (!document.getElementById('delivery-fee-display') && mapContainer) {
        const feeDiv = document.createElement('div');
        feeDiv.id = 'delivery-fee-display';
        feeDiv.style.cssText = 'margin-top:10px; font-size:.9rem; font-weight:600; text-align:center; padding:10px; border-radius:10px; background:#f5f5f5; color:#666;';
        feeDiv.textContent = 'Digite seu endereço para calcular o frete';
        mapContainer.insertAdjacentElement('afterend', feeDiv);
    }

    if (!isDelivery) {
        if (mapContainer) mapContainer.style.display = 'none';
        return;
    }
    
    if (mapContainer) mapContainer.style.display = 'block';
    await loadLeaflet();

    if (!state.googleMap && mapContainer) {
        state.googleMap = L.map(mapContainer).setView([-14.235, -51.925], 4);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(state.googleMap);
        state.mapMarker = L.marker([-14.235, -51.925], { draggable: true }).addTo(state.googleMap);
        state.mapMarker.setOpacity(0);

        state.mapMarker.on('dragend', async () => {
            const pos = state.mapMarker.getLatLng();
            state.mapMarker.setOpacity(1);
            const addr = await reverseGeocodeOSM(pos.lat, pos.lng);
            if (addr) {
                state.userInfo.address = addr;
                localStorage.setItem('zapfly_user', JSON.stringify(state.userInfo));
                document.getElementById('user-address').value = addr;
            }
            calcDeliveryFee(pos.lat, pos.lng);
        });

        // Debounce no input
        let _timeout = null;
        document.getElementById('user-address')?.addEventListener('input', (e) => {
            clearTimeout(_timeout);
            _timeout = setTimeout(async () => {
                const loc = await geocodeOSM(e.target.value);
                if (loc) {
                    state.mapMarker.setLatLng([loc.lat, loc.lng]).setOpacity(1);
                    state.googleMap.setView([loc.lat, loc.lng], 16);
                    calcDeliveryFee(loc.lat, loc.lng);
                }
            }, 800);
        });
    }

    setTimeout(() => {
        if (state.googleMap) {
            state.googleMap.invalidateSize();
            if (state.userInfo.address) {
                geocodeOSM(state.userInfo.address).then(loc => {
                    if (loc) {
                        state.mapMarker.setLatLng([loc.lat, loc.lng]).setOpacity(1);
                        state.googleMap.setView([loc.lat, loc.lng], 16);
                        calcDeliveryFee(loc.lat, loc.lng);
                    }
                });
            }
        }
    }, 300);
}

function handleNextStep() {
    if (state.currentStep === 1) {
        const cart = getActiveCart();
        if (cart.length === 0) return showAlert('Sacola Vazia', 'Adicione itens para continuar.');
        
        const { name, phone } = state.userInfo;
        if (!name || !phone || phone.length < 14) {
            return showAlert('Ops!', 'Preencha seu nome e um WhatsApp válido.');
        }
        
        goToStep(2);
    } else if (state.currentStep === 2) {
        const { name, phone, address } = state.userInfo;
        if (!name || phone.length < 14) return showAlert('Dados Incompletos', 'Preencha seu nome e um WhatsApp válido.');
        if (state.activeTab === 'delivery' && !address) return showAlert('Endereço', 'Informe seu endereço para entrega.');
        if (state.activeTab === 'order' && (!document.getElementById('order-date').value || !document.getElementById('order-time').value)) 
            return showAlert('Agendamento', 'Escolha data e hora.');
        goToStep(3);
    }
}

function updateStep3Summary() {
    const cart = getActiveCart();
    const subtotal = cart.reduce((acc, i) => acc + (i.price * i.quantity), 0);
    const fee = state.activeTab === 'delivery' ? state.deliveryFee : 0;
    const total = subtotal + fee;

    const html = `
        <div class="summary-card">
            <h4>Resumo do Pedido</h4>
            <div class="summary-items">
                ${cart.map(i => `<p><span>${i.quantity}x ${i.name}</span> <span>R$ ${(i.price * i.quantity).toFixed(2)}</span></p>`).join('')}
            </div>
            <div class="summary-totals">
                <p><span>Subtotal</span> <span>R$ ${subtotal.toFixed(2)}</span></p>
                ${state.activeTab === 'delivery' ? `<p><span>Entrega</span> <span>R$ ${fee.toFixed(2)}</span></p>` : ''}
                <p class="total"><span>Total</span> <span>R$ ${total.toFixed(2)}</span></p>
            </div>
            <div class="summary-info">
                <p><strong>Cliente:</strong> ${state.userInfo.name}</p>
                <p><strong>WhatsApp:</strong> ${state.userInfo.phone}</p>
                ${state.activeTab === 'delivery' ? `<p><strong>Endereço:</strong> ${state.userInfo.address}</p>` : ''}
                ${state.activeTab === 'order' ? `<p><strong>Data/Hora:</strong> ${document.getElementById('order-date')?.value} às ${document.getElementById('order-time')?.value}</p>` : ''}
            </div>
        </div>
    `;
    const summaryEl = document.getElementById('order-summary-content');
    if (summaryEl) summaryEl.innerHTML = html;
}

async function handlePlaceOrder() {
    const cart = getActiveCart();
    const subtotal = cart.reduce((acc, i) => acc + (i.price * i.quantity), 0);
    const fee = state.activeTab === 'delivery' ? state.deliveryFee : 0;
    
    const orderData = {
        storeSlug: STORE_SLUG,
        customerName: state.userInfo.name,
        customerPhone: state.userInfo.phone,
        address: state.userInfo.address,
        type: state.activeTab,
        items: cart,
        subtotal: subtotal,
        deliveryFee: fee,
        total: subtotal + fee,
        orderDate: document.getElementById('order-date')?.value,
        orderTime: document.getElementById('order-time')?.value
    };

    try {
        const res = await fetch(`${API_BASE}/public/orders/${STORE_SLUG}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(orderData)
        });
        const data = await res.json();
        if (data.whatsappUrl) {
            window.location.href = data.whatsappUrl;
            localStorage.removeItem(state.activeTab === 'delivery' ? 'delivery_cart' : 'order_cart');
        } else {
            showAlert('Erro', 'Não foi possível gerar o link do WhatsApp.');
        }
    } catch (e) {
        showAlert('Erro', 'Falha ao enviar pedido.');
    }
}

// --- Resto das Funções (Menu, Cart, UI) ---
function renderMenu() {
    const sections = document.getElementById('menu-sections');
    if (!sections) return;
    
    const categories = [...new Set(state.products.map(p => p.category))];
    sections.innerHTML = categories.map(cat => {
        const catProducts = state.products.filter(p => p.category === cat && p.name.toLowerCase().includes(state.searchQuery));
        if (catProducts.length === 0) return '';
        return `
            <section class="menu-section">
                <h3 class="category-title">${cat}</h3>
                <div class="products-grid">
                    ${catProducts.map(p => renderProductCard(p)).join('')}
                </div>
            </section>
        `;
    }).join('');
}

function renderProductCard(p) {
    const images = parseImages(p.image);
    return `
        <div class="product-card" onclick="openItemDetail('${p.id}')">
            <div class="product-info">
                <h4>${p.name}</h4>
                <p class="product-desc">${p.description || ''}</p>
                <div class="product-price">A partir de R$ ${parseFloat(p.price).toFixed(2)}</div>
            </div>
            ${images[0] ? `<img src="${getImg(images[0], 'medium')}" class="product-img">` : ''}
        </div>
    `;
}

async function openItemDetail(id) {
    const product = state.products.find(p => p.id === id);
    if (!product) return;
    state.currentItem = product;
    state.currentQty = 1;
    state.currentVariation = null;
    
    const images = parseImages(product.image);
    const variations = product.variations || [];
    
    document.getElementById('item-detail-body').innerHTML = `
        <div class="item-detail">
            ${images[0] ? `<img src="${getImg(images[0])}" class="detail-hero">` : ''}
            <div class="detail-info">
                <h3>${product.name}</h3>
                <p>${product.description || ''}</p>
                ${variations.length > 0 ? `
                    <div class="variation-section">
                        <h4>Escolha uma opção</h4>
                        ${variations.map(v => `<div class="var-option" onclick="selectVariation('${v.name.replace(/'/g, "\\'")}', ${v.price})">${v.name} (+ R$ ${v.price.toFixed(2)})</div>`).join('')}
                    </div>
                ` : `<div class="price-tag">R$ ${product.price.toFixed(2)}</div>`}
            </div>
        </div>
    `;
    updateDetailFooter();
    document.getElementById('item-modal').classList.remove('hidden');
}

function selectVariation(name, price) {
    state.currentVariation = { name, price };
    document.querySelectorAll('.var-option').forEach(el => el.classList.toggle('selected', el.innerText.includes(name)));
    updateDetailFooter();
}

function updateDetailFooter() {
    const price = state.currentVariation ? state.currentVariation.price : (state.currentItem?.price || 0);
    document.getElementById('add-btn-price').innerText = `R$ ${(price * state.currentQty).toFixed(2)}`;
    document.getElementById('detail-qty').innerText = state.currentQty;
}

function addToCart() {
    const item = state.currentItem;
    const variation = state.currentVariation;
    const cart = getActiveCart();
    cart.push({ ...item, variation, quantity: state.currentQty, price: variation ? variation.price : item.price });
    setActiveCart(cart);
    closeModal();
    updateUI();
}

function getActiveCart() { return state.activeTab === 'delivery' ? state.deliveryCart : state.orderCart; }
function setActiveCart(cart) { 
    if (state.activeTab === 'delivery') state.deliveryCart = cart; 
    else state.orderCart = cart;
    localStorage.setItem(state.activeTab === 'delivery' ? 'delivery_cart' : 'order_cart', JSON.stringify(cart));
}
function loadCart() {
    state.deliveryCart = JSON.parse(localStorage.getItem('delivery_cart') || '[]');
    state.orderCart = JSON.parse(localStorage.getItem('order_cart') || '[]');
}

function closeModal() { document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden')); }

function renderStep1() {
    const cart = getActiveCart();
    document.getElementById('checkout-items-list').innerHTML = cart.map((item, idx) => `
        <div class="cart-item">
            <div class="cart-item-info">
                <strong>${item.quantity}x ${item.name}</strong>
                ${item.variation ? `<small>${item.variation.name}</small>` : ''}
                <div class="price">R$ ${(item.price * item.quantity).toFixed(2)}</div>
            </div>
            <button class="remove-btn" onclick="removeFromCart(${idx})"><i data-lucide="trash-2"></i></button>
        </div>
    `).join('');
    lucide.createIcons();
}

function removeFromCart(idx) {
    const cart = getActiveCart();
    cart.splice(idx, 1);
    setActiveCart(cart);
    renderStep1();
    updateUI();
}

function updateUI() {
    const cart = getActiveCart();
    const total = cart.reduce((acc, i) => acc + (i.price * i.quantity), 0);
    
    const qtyBadge = document.getElementById('cart-qty-badge');
    if (qtyBadge) qtyBadge.innerText = cart.length;

    const totalFooter = document.getElementById('cart-total-footer');
    if (totalFooter) totalFooter.innerText = `R$ ${total.toFixed(2)}`;

    document.getElementById('cart-footer')?.classList.toggle('hidden', cart.length === 0);
    
    const storeName = document.getElementById('store-name');
    if (storeName) storeName.innerText = state.publicSettings.businessName;

    const statusBadge = document.getElementById('store-status-badge');
    if (statusBadge) statusBadge.innerText = state.isOpen ? 'Aberto' : 'Fechado (Agendamento)';
}

function updateTheme() {
    const color = state.publicSettings.accentColor || '#ff4d6d';
    document.documentElement.style.setProperty('--primary-color', color);
}

function parseImages(imgField) {
    if (!imgField) return [];
    try { return JSON.parse(imgField); } catch (e) { return [imgField]; }
}

function getImg(url, size = 'full') {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    return `https://files.digizap.com.br/uploads/${url}`;
}

async function fetchPreviousOrders() {
    try {
        const phone = state.userInfo.phone.replace(/\D/g, "");
        if (!phone) return;
        const res = await fetch(`${API_BASE}/public/orders/history/${STORE_SLUG}/55${phone}`);
        if (res.ok) state.previousOrders = await res.json();
    } catch (e) {}
}

function renderPreviousOrders() {
    const list = document.getElementById('history-list');
    if (!list) return;
    if (!state.previousOrders || state.previousOrders.length === 0) {
        list.innerHTML = '<p class="empty-msg">Nenhum pedido encontrado.</p>';
        return;
    }
    list.innerHTML = state.previousOrders.map(o => `
        <div class="history-item">
            <div class="h-header">
                <strong>Pedido #${o.id.slice(-4)}</strong>
                <span>${new Date(o.createdAt).toLocaleDateString()}</span>
            </div>
            <p>${o.totalValue ? `Total: R$ ${o.totalValue.toFixed(2)}` : ''}</p>
        </div>
    `).join('');
}
