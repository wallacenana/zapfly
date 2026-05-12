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
    mapMarker: null,
    geocoder: null,
    isOpen: false,
    availableSlots: [],
    currentCarouselIdx: 0
};

function parseImages(imgField) {
    if (!imgField) return [];
    try {
        const parsed = JSON.parse(imgField);
        return Array.isArray(parsed) ? parsed : [imgField];
    } catch(e) {
        return [imgField];
    }
}

const getActiveCart = () => state.activeTab === 'delivery' ? state.deliveryCart : state.orderCart;
const setActiveCart = (newCart) => {
    if (state.activeTab === 'delivery') state.deliveryCart = newCart;
    else state.orderCart = newCart;
};

document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    fetchPublicSettings();
    fetchProducts();
    fetchSlots();
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

async function fetchSlots() {
    try {
        const response = await fetch(`${API_BASE}/orders/available-slots`);
        state.availableSlots = await response.json();
        checkStoreStatus();
    } catch (err) { console.error('Erro ao buscar slots:', err); }
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

    const statusEl = document.querySelector('.store-status');
    if (statusEl) {
        statusEl.innerHTML = state.isOpen 
            ? `<span class="status-dot online"></span> Aberto agora` 
            : `<span class="status-dot offline"></span> Fechado para entrega (Apenas agendamento)`;
        statusEl.classList.toggle('closed', !state.isOpen);
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
    const input = document.getElementById('user-address');
    const autocomplete = new google.maps.places.Autocomplete(input);
    autocomplete.setComponentRestrictions({ country: 'br' });
    state.geocoder = new google.maps.Geocoder();
    
    const mapCenter = { lat: -2.5307, lng: -44.3068 }; 
    state.googleMap = new google.maps.Map(document.getElementById('map-container'), {
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

    if (state.userInfo.address) geocodeAddress(state.userInfo.address);

    autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        if (!place.geometry) return;
        updateLocation(place.geometry.location, place.formatted_address);
    });

    state.mapMarker.addListener('dragend', () => reverseGeocode(state.mapMarker.getPosition()));
    state.googleMap.addListener('click', (e) => {
        updateLocation(e.latLng);
        reverseGeocode(e.latLng);
    });
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
        localStorage.setItem('linda_cake_user', JSON.stringify(state.userInfo));
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
            body: JSON.stringify({ address })
        });
        const data = await response.json();
        if (data.fee !== undefined) {
            state.deliveryFee = data.fee;
            const badge = document.getElementById('step2-delivery-fee');
            const value = document.getElementById('step2-fee-value');
            if (badge && value) {
                badge.classList.remove('hidden');
                value.innerText = `R$ ${data.fee.toFixed(2)}`;
            }
            updateStep3Summary();
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
        const response = await fetch(`${API_BASE}/orders/products`);
        state.products = await response.json();
        state.loading = false;
        renderMenu();
    } catch (err) { console.error('Erro ao buscar produtos:', err); }
}

function renderMenu() {
    const container = document.getElementById('menu-sections');
    const query = state.searchQuery.toLowerCase();
    const filtered = state.products.filter(p => {
        // CORREÇÃO: Filtra itens inativos, categoria Adicionais e tipo addon
        if (p.active === false) return false;
        if (p.category === 'Adicionais' || p.type === 'addon') return false;

        const matchesTab = (state.activeTab === 'delivery' && p.type === 'delivery') || (state.activeTab === 'order');
        const matchesSearch = p.name.toLowerCase().includes(query) || (p.description && p.description.toLowerCase().includes(query));
        return matchesTab && matchesSearch;
    });

    if (state.activeTab === 'order') {
        filtered.sort((a, b) => (a.type === 'encomenda' ? -1 : 1) - (b.type === 'encomenda' ? -1 : 1));
    }

    const grouped = filtered.reduce((acc, p) => {
        const cat = p.category && p.category !== 'Doces' && p.category !== 'Geral' ? p.category : 'Outros';
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
    const variations = JSON.parse(product.variations || '[]').filter(v => !v.hidden);
    const priceText = variations.length > 0 ? `A partir de R$ ${Math.min(...variations.map(v => v.price)).toFixed(2)}` : `R$ ${parseFloat(product.price).toFixed(2)}`;
    return `
        <div class="product-card" onclick="openItemDetail('${product.id}')">
            <div class="product-info">
                <h3>${product.name}</h3>
                <p>${product.description || ''}</p>
                <div class="product-price">${priceText}</div>
            </div>
            ${parseImages(product.image).length > 0 ? `<img src="${parseImages(product.image)[0]}" class="product-img">` : `<div class="img-placeholder"><i data-lucide="image"></i></div>`}
        </div>
    `;
}

function openItemDetail(productId) {
    const item = state.products.find(p => p.id === productId);
    state.currentItem = item;
    state.currentQty = 1;
    state.currentVariation = null;
    state.currentCarouselIdx = 0;
    const variations = JSON.parse(item.variations || '[]').filter(v => !v.hidden);
    const images = parseImages(item.image);
    const body = document.getElementById('item-detail-body');
    body.innerHTML = `
        <button class="chevron-close-btn" onclick="closeWithAnimation('item-modal')"><i data-lucide="chevron-down"></i></button>
        ${images.length > 0 ? `
            <div class="carousel-container">
                <div class="carousel-track" style="transform: translateX(0%)">
                    ${images.map(img => `<div class="carousel-slide"><img src="${img}"></div>`).join('')}
                </div>
                ${images.length > 1 ? `
                    <button class="carousel-btn carousel-prev" onclick="moveCarousel(-1)"><i data-lucide="chevron-left"></i></button>
                    <button class="carousel-btn carousel-next" onclick="moveCarousel(1)"><i data-lucide="chevron-right"></i></button>
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
    const modal = document.getElementById('item-modal');
    modal.classList.remove('hidden', 'closing');
    lucide.createIcons();
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
    
    const closeModal = () => {
        if (!document.getElementById('item-modal').classList.contains('hidden')) closeWithAnimation('item-modal');
        if (!document.getElementById('checkout-modal').classList.contains('hidden')) closeWithAnimation('checkout-modal');
    };
    
    document.querySelector('.close-modal-btn').addEventListener('click', closeModal);
    document.addEventListener('keydown', (e) => { if(e.key === 'Escape') closeModal(); });

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
    phoneInput.addEventListener('input', (e) => {
        e.target.value = maskPhone(e.target.value);
        state.userInfo.phone = e.target.value;
        localStorage.setItem('linda_cake_user', JSON.stringify(state.userInfo));
    });

    ['user-name', 'user-address'].forEach(id => {
        const el = document.getElementById(id);
        if(el) {
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
    const modal = document.getElementById('checkout-modal');
    modal.classList.remove('hidden', 'closing');
    document.getElementById('checkout-step-title').innerText = ["Ver sacola", "Entrega & Agendamento", "Confirmar Pedido"][step - 1];
    
    const isLast = step === 3;
    document.getElementById('next-step-btn').classList.toggle('hidden', isLast);
    document.getElementById('place-order-btn').classList.toggle('hidden', !isLast);

    if (step === 1) renderStep1();
    if (step === 2) renderStep2();
    if (step === 3) updateStep3Summary();
}

document.getElementById('checkout-back-btn').addEventListener('click', () => { 
    if(state.currentStep > 1) goToStep(state.currentStep - 1); 
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
    document.getElementById('delivery-step-content').classList.toggle('hidden', !isDelivery);
    document.getElementById('order-step-content').classList.toggle('hidden', isDelivery);
    if (isDelivery && state.googleMap) {
        setTimeout(() => {
            google.maps.event.trigger(state.googleMap, 'resize');
            if (state.mapMarker) state.googleMap.panTo(state.mapMarker.getPosition());
        }, 100);
    }
}

function handleNextStep() {
    if (state.currentStep === 1) {
        if (!state.userInfo.name || !state.userInfo.phone || state.userInfo.phone.length < 14) return alert('Preencha seu nome e um WhatsApp válido.');
        if (state.activeTab === 'delivery' && !state.isOpen) return alert('Estamos fechados para pronta entrega no momento. Por favor, utilize a aba de Encomendas para agendar seu pedido.');
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
    if (state.activeTab === 'delivery' && !state.isOpen) return alert('Estamos fechados para pronta entrega no momento. Por favor, utilize a aba de Encomendas para agendar seu pedido.');
    const variation = state.currentVariation;
    const variations = JSON.parse(item.variations || '[]').filter(v => !v.hidden);
    if (variations.length > 0 && !variation) return alert('Por favor, selecione uma opção.');
    const itemKey = variation ? `${item.id}-${variation.name}` : item.id;
    let cart = getActiveCart();
    const existing = cart.find(c => c.itemKey === itemKey);
    if (existing) existing.quantity += state.currentQty;
    else cart.push({ productId: item.id, itemKey, name: item.name, variation: variation ? variation.name : null, price: variation ? variation.price : item.price, quantity: state.currentQty });
    setActiveCart(cart);
    closeWithAnimation('item-modal');
    updateUI();
}

function updateUI() {
    const cart = getActiveCart();
    const footer = document.getElementById('cart-footer');
    if (cart.length > 0) {
        footer.classList.remove('hidden');
        document.getElementById('cart-qty-badge').innerText = cart.reduce((acc, i) => acc + i.quantity, 0);
        document.getElementById('cart-total-footer').innerText = `R$ ${cart.reduce((acc, i) => acc + (i.price * i.quantity), 0).toFixed(2)}`;
    } else footer.classList.add('hidden');
}

async function handlePlaceOrder() {
    const cart = getActiveCart();
    const btn = document.getElementById('place-order-btn');
    btn.disabled = true; btn.innerHTML = 'Processando Pagamento...';
    const payload = {
        clientName: state.userInfo.name, clientPhone: state.userInfo.phone,
        product: cart[0].name + (cart[0].variation ? ` (${cart[0].variation})` : ''),
        quantity: cart[0].quantity, type: state.activeTab,
        deliveryAddress: state.activeTab === 'delivery' ? state.userInfo.address : null,
        scheduledDate: state.activeTab === 'order' ? document.getElementById('order-date').value : null,
        scheduledTime: state.activeTab === 'order' ? document.getElementById('order-time').value : null,
        deliveryFee: state.activeTab === 'delivery' ? state.deliveryFee : 0,
        carrinho_itens_extras: cart.slice(1).map(item => ({ name: item.name + (item.variation ? ` (${item.variation})` : ''), price: item.price, quantity: item.quantity }))
    };
    try {
        const response = await fetch(`${API_BASE}/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await response.json();
        if (data.paymentLink) location.href = data.paymentLink;
        else if (data.id) alert('Pedido registrado, mas houve um problema ao gerar o link de pagamento. Por favor, entre em contato.');
        else throw new Error(data.error);
    } catch (err) { alert('Erro: ' + err.message); btn.disabled = false; btn.innerHTML = 'Fazer pedido'; }
}
