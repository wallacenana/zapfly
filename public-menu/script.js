window.lucide = {
    createIcons: function () {
        document.querySelectorAll('i[data-lucide]').forEach(function (el) {
            if (el.dataset.processed) return;
            var name = el.getAttribute('data-lucide');
            var symbol = document.getElementById('lucide-' + name);
            if (!symbol) return;
            var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', el.style.width || '24');
            svg.setAttribute('height', el.style.height || '24');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('fill', symbol.getAttribute('fill') || 'none');
            svg.setAttribute('stroke', 'currentColor');
            svg.setAttribute('stroke-width', '2');
            svg.setAttribute('stroke-linecap', 'round');
            svg.setAttribute('stroke-linejoin', 'round');
            svg.innerHTML = symbol.innerHTML;
            // Copy over inline styles from the <i> tag
            if (el.style.cssText) svg.style.cssText = el.style.cssText;
            if (el.className) svg.setAttribute('class', el.className);
            // Handle fill/color overrides on the <i> tag
            var elFill = el.style.fill;
            if (elFill) svg.setAttribute('fill', elFill);
            var elColor = el.style.color;
            if (elColor) svg.setAttribute('stroke', elColor);
            el.dataset.processed = '1';
            el.replaceWith(svg);
        });
    }
};
const API_BASE = 'https://api.menzzu.com';
// Configurações
const BASE_DOMAIN = 'menzzu.com';

// Detecta se estamos na HOME exatamente
const isHome = (window.location.hostname === BASE_DOMAIN || window.location.hostname === 'www.' + BASE_DOMAIN) &&
    (window.location.pathname === '/' || window.location.pathname === '');

// Detecta o slug da URL (query ?loja= tem prioridade quando o servidor reescreve a rota)
const pathSegments = window.location.pathname.split('/').filter(p => p);
const querySlug = new URLSearchParams(window.location.search).get('loja') || '';
const STORE_SLUG = window.__STORE_SLUG__ || (isHome ? '' : (querySlug || pathSegments[0] || ''));

// Função auxiliar para alertas bonitos
const showAlert = (title, text, icon = 'warning') => {
    Swal.fire({
        title: title,
        text: text,
        icon: icon,
        confirmButtonColor: getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim() || '#82F026',
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
    orderBumpSelected: false,
    userInfo: JSON.parse(localStorage.getItem('menzzu_user') || '{"name":"","phone":"","address":""}'),
    publicSettings: {
        googleApiKey: '',
        deliveryRules: [],
        dailyDeliveryItems: {
            orderTypes: { delivery: true, order: true },
            fulfillmentMethods: { delivery: true, pickup: true, local: true }
        },
        businessName: 'Carregando...',
        businessCategory: '',
        prepTime: '',
        acceptOrders: true,
        featuredCountDesktop: 4,
        featuredCountTablet: 2,
        featuredCountMobile: 1
    },
    currentStep: 1,
    deliveryFee: 0,
    googleMap: null,
    mapMarker: null,
    geocoder: null,
    isOpen: false,
    deliveryType: 'delivery',
    paymentMethod: 'mercadopago',
    allowCash: true,
    withinDeliveryRadius: false,
    withinDeliveryRadius: false,
    availableSlots: [],
    addonGroups: [],
    orderAvailabilityRequestId: 0,
    orderAvailability: null,
    orderSchedule: null,
    scheduleModalContext: null,
    bodyScrollY: 0,
    isBodyScrollLocked: false,
    currentCarouselIdx: 0,
    previousOrders: [],
    orderDetailsInfo: '',
    reviewModalOrderId: null,
    reviewModalRating: 0,
    storeReviewSummary: window.__SSR__?.reviewSummary || {
        averageRating: 5,
        reviewCount: 0,
        orderCount: 0
    },
    storeRecentReviews: window.__SSR__?.recentReviews || []
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

function formatProductPriceText(product) {
    const basePrice = parseFloat(product?.price || 0) || 0;
    const promoPrice = parseFloat(product?.promoPrice || 0) || 0;
    if (promoPrice > 0 && promoPrice < basePrice) {
        return `de R$ ${basePrice.toFixed(2)} por R$ ${promoPrice.toFixed(2)}`;
    }
    return `R$ ${basePrice.toFixed(2)}`;
}

function getEffectiveProductPrice(product) {
    const basePrice = parseFloat(product?.price || 0) || 0;
    const promoPrice = parseFloat(product?.promoPrice || 0) || 0;
    return promoPrice > 0 && promoPrice < basePrice ? promoPrice : basePrice;
}

function hasPaidAddonsForProduct(product) {
    try {
        const groupIds = JSON.parse(product?.addonGroups || '[]');
        if (!Array.isArray(groupIds) || groupIds.length === 0) return false;
        return (state.addonGroups || []).some(group => {
            if (!groupIds.includes(group.id)) return false;
            const items = JSON.parse(group.items || '[]');
            return Array.isArray(items) && items.some(item => (parseFloat(item?.price || 0) || 0) > 0);
        });
    } catch (error) {
        return false;
    }
}

function getDisplayPriceText(product) {
    const variations = JSON.parse(product?.variations || '[]').filter(v => !v.hidden);
    const basePrice = getEffectiveProductPrice(product);

    if (variations.length > 0) {
        const effectiveVariationPrices = variations
            .map(v => getEffectiveProductPrice(v))
            .filter(price => Number.isFinite(price) && price > 0);
        const fromPrice = effectiveVariationPrices.length > 0 ? Math.min(...effectiveVariationPrices) : basePrice;
        return `A partir de R$ ${fromPrice.toFixed(2)}`;
    }

    if (hasPaidAddonsForProduct(product)) {
        return `A partir de R$ ${basePrice.toFixed(2)}`;
    }

    const price = parseFloat(product?.price || 0) || 0;
    const promoPrice = parseFloat(product?.promoPrice || 0) || 0;
    if (promoPrice > 0 && promoPrice < price) {
        return `de R$ ${price.toFixed(2)} por R$ ${promoPrice.toFixed(2)}`;
    }
    return `R$ ${basePrice.toFixed(2)}`;
}

function getSuggestedProductForItem(item) {
    if (!item?.suggestedItemId) return null;
    const suggestedId = String(item.suggestedItemId || '');
    if (!suggestedId) return null;
    if (String(item.id || '') === suggestedId) return null;
    return (state.products || []).find(product => String(product.id) === suggestedId) || null;
}

function minPositiveNumber(values = []) {
    const valid = values
        .map((value) => parseFloat(value || 0))
        .filter((value) => Number.isFinite(value) && value > 0);
    if (!valid.length) return 0;
    return Math.min(...valid);
}

/**
 * Seleciona a versão correta da imagem gerada pelo upload.php
 * @param {string} url - URL original
 * @param {'thumb'|'medium'|'full'} size - Tamanho desejado
 */
function getImg(url, size = 'full') {
    if (!url) return url;
    if (!url.includes('files.menzzu.com')) return url; // Só funciona para o nosso servidor

    if (size === 'thumb') return url.replace('.webp', '_550.webp');
    if (size === 'medium') return url.replace('.webp', '_550.webp');
    return url;
}

function isOrderEnabled() {
    const options = getMenuDeliveryOptions();
    return state.publicSettings.acceptOrders !== false && options.orderTypes.order !== false;
}

function isDeliveryTabEnabled() {
    return getMenuDeliveryOptions().orderTypes.delivery !== false;
}

function getMenuDeliveryOptions() {
    const parsed = parseJsonValue(state.publicSettings.dailyDeliveryItems || {}, {});
    const orderTypes = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.orderTypes && typeof parsed.orderTypes === 'object'
        ? parsed.orderTypes
        : {};
    const fulfillmentMethods = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.fulfillmentMethods && typeof parsed.fulfillmentMethods === 'object'
        ? parsed.fulfillmentMethods
        : {};

    return {
        orderTypes: {
            delivery: orderTypes.delivery !== false,
            order: orderTypes.order !== false
        },
        fulfillmentMethods: {
            delivery: fulfillmentMethods.delivery !== false,
            pickup: fulfillmentMethods.pickup !== false,
            local: fulfillmentMethods.local !== false
        }
    };
}

function isFulfillmentMethodEnabled(method) {
    const options = getMenuDeliveryOptions();
    return options.fulfillmentMethods[method] !== false;
}

function getEnabledFulfillmentMethods() {
    return ['delivery', 'pickup', 'local'].filter(method => isFulfillmentMethodEnabled(method));
}

function getDefaultFulfillmentMethod() {
    const enabled = getEnabledFulfillmentMethods();
    return enabled[0] || 'delivery';
}

function parseJsonValue(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) return value;
    if (typeof value !== 'string') return fallback;

    try {
        return JSON.parse(value);
    } catch (e) {
        return fallback;
    }
}

function sanitizeDomId(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function getCustomFieldSchema(item) {
    const parsed = parseJsonValue(item?.customFieldSchema || item?.customFieldsSchema || item?.customFields, []);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
}

function getCustomFieldAnswers(item) {
    const parsed = parseJsonValue(item?.customFieldValues || item?.customFields, {});
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function hasCheckoutExtras(cart = getActiveCart()) {
    return Array.isArray(cart) && cart.some(item => getCustomFieldSchema(item).length > 0);
}

function getCustomFieldSummaryParts(item) {
    return Object.entries(getCustomFieldAnswers(item)).map(([key, value]) => ({
        key,
        value,
        isUrl: typeof value === 'string' && value.startsWith('http')
    }));
}

function formatOrderSchedule() {
    if (!state.orderSchedule?.date || !state.orderSchedule?.time) return 'Nenhum horário selecionado.';
    try {
        const dateText = new Date(`${state.orderSchedule.date}T12:00:00`).toLocaleDateString('pt-BR');
        return `${dateText} às ${state.orderSchedule.time}`;
    } catch (e) {
        return `${state.orderSchedule.date} às ${state.orderSchedule.time}`;
    }
}

function openScheduleModal(context = 'add') {
    state.scheduleModalContext = context;
    if (context !== 'add') {
        state.currentStep = 1;
    }
    const modal = document.getElementById('order-schedule-modal');
    if (!modal) return;
    const dateInput = document.getElementById('schedule-date');
    const timeSelect = document.getElementById('schedule-time');
    const note = document.getElementById('schedule-availability-note');
    const today = getBrazilDateString();
    if (dateInput) {
        dateInput.min = today;
        dateInput.value = state.orderSchedule?.date || today;
    }
    if (timeSelect) {
        timeSelect.disabled = true;
        timeSelect.innerHTML = `<option value="">Selecione uma data primeiro</option>`;
        timeSelect.value = state.orderSchedule?.time || '';
    }
    if (note) note.innerText = '';
    openModal('order-schedule-modal');
    if (dateInput?.value) {
        loadOrderAvailability(dateInput.value, true, {
            timeSelectId: 'schedule-time',
            dateInputId: 'schedule-date',
            noteId: 'schedule-availability-note'
        });
    }
}

async function commitScheduleAndMaybeAdd() {
    const dateInput = document.getElementById('schedule-date');
    const timeSelect = document.getElementById('schedule-time');
    const dateVal = dateInput?.value;
    const timeVal = timeSelect?.value;

    if (!dateVal || !timeVal) {
        return showAlert('Horário ausente', 'Escolha a data e o horário da encomenda.');
    }

    const availability = await loadOrderAvailability(dateVal, true, {
        timeSelectId: 'schedule-time',
        dateInputId: 'schedule-date',
        noteId: 'schedule-availability-note'
    });
    const selectedSlot = Array.isArray(availability?.times) ? availability.times.find(slot => slot.time === timeVal) : null;
    if (!selectedSlot || !selectedSlot.available) {
        if (timeSelect) timeSelect.value = '';
        return showAlert('Horário indisponível', selectedSlot?.reason || availability?.reason || 'Escolha outro horário.');
    }

    state.orderSchedule = {
        date: dateVal,
        time: timeVal
    };
    saveCheckoutState();

    closeWithAnimation('order-schedule-modal');
    if (state.scheduleModalContext === 'add') {
        commitAddToCart();
    } else if (state.currentStep === 1 && state.activeTab === 'order') {
        goToStep(hasCheckoutExtras() ? 2 : 3);
    } else if (state.currentStep >= 2 && state.activeTab === 'order') {
        renderStep2();
    }
}

function getBrazilDateParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);

    return Object.fromEntries(
        parts
            .filter(part => part.type !== 'literal')
            .map(part => [part.type, part.value])
    );
}

function getBrazilDateString(date = new Date()) {
    const parts = getBrazilDateParts(date);
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function setOrderDateConstraints() {
    const dateInput = document.getElementById('schedule-date');
    if (!dateInput) return;

    const today = getBrazilDateString();
    dateInput.min = today;
    if (dateInput.value && dateInput.value < today) {
        dateInput.value = '';
    }
}

async function loadOrderAvailability(dateStr, preserveSelection = true, config = {}) {
    const timeSelectId = config.timeSelectId || 'schedule-time';
    const dateInputId = config.dateInputId || 'schedule-date';
    const noteId = config.noteId || null;
    const timeSelect = document.getElementById(timeSelectId);
    const dateInput = document.getElementById(dateInputId);
    const noteEl = noteId ? document.getElementById(noteId) : null;
    if (!timeSelect) return null;

    const today = getBrazilDateString();
    const cleanDate = (dateStr || '').trim();
    const previousValue = timeSelect.value;

    if (!cleanDate) {
        state.orderAvailability = null;
        timeSelect.disabled = true;
        timeSelect.innerHTML = `<option value="">Selecione uma data primeiro</option>`;
        if (noteEl) noteEl.innerText = '';
        return null;
    }

    if (cleanDate < today) {
        if (dateInput) dateInput.value = '';
        state.orderAvailability = {
            available: false,
            reason: 'Data anterior a hoje.',
            date: cleanDate,
            times: []
        };
        timeSelect.disabled = true;
        timeSelect.innerHTML = `<option value="">Escolha uma data válida</option>`;
        if (noteEl) noteEl.innerText = 'Data anterior a hoje.';
        return state.orderAvailability;
    }

    const requestId = ++state.orderAvailabilityRequestId;
    timeSelect.disabled = true;
    timeSelect.innerHTML = `<option value="">Carregando horários...</option>`;

    try {
        const response = await fetch(`${API_BASE}/orders/availability?slug=${encodeURIComponent(STORE_SLUG)}&date=${encodeURIComponent(cleanDate)}&type=order`);
        const data = await response.json();

        if (requestId !== state.orderAvailabilityRequestId) return data;

        if (!response.ok) {
            const reason = data.error || data.reason || 'Falha ao carregar horários.';
            state.orderAvailability = {
                available: false,
                reason,
                date: cleanDate,
                times: []
            };
            timeSelect.disabled = true;
            timeSelect.innerHTML = `<option value="">${reason}</option>`;
            if (noteEl) noteEl.innerText = reason;
            return state.orderAvailability;
        }

        const times = Array.isArray(data.times) ? data.times : [];
        state.orderAvailability = {
            ...data,
            times
        };

        const availableTimes = times.filter(slot => slot.available);
        if (times.length > 0) {
            let html = `<option value="">${availableTimes.length > 0 ? 'Selecione um horário' : (data.reason || 'Nenhum horário disponível')}</option>`;
            times.forEach(slot => {
                const label = slot.available ? slot.time : `${slot.time} - Indisponível`;
                html += `<option value="${slot.time}" ${slot.available ? '' : 'disabled'}>${label}</option>`;
            });
            timeSelect.innerHTML = html;
            timeSelect.disabled = false;
            if (noteEl) noteEl.innerText = data.reason || (availableTimes.length > 0 ? '' : 'Nenhum horário disponível');
        } else {
            const reason = data.reason || 'Nenhum horário disponível';
            timeSelect.disabled = true;
            timeSelect.innerHTML = `<option value="">${reason}</option>`;
            if (noteEl) noteEl.innerText = reason;
        }

        if (preserveSelection && previousValue) {
            const stillAvailable = availableTimes.some(slot => slot.time === previousValue);
            timeSelect.value = stillAvailable ? previousValue : '';
        } else {
            timeSelect.value = '';
        }

        return state.orderAvailability;
    } catch (error) {
        if (requestId !== state.orderAvailabilityRequestId) return null;
        const reason = 'Falha ao carregar horários.';
        state.orderAvailability = {
            available: false,
            reason,
            date: cleanDate,
            times: []
        };
        timeSelect.disabled = true;
        timeSelect.innerHTML = `<option value="">${reason}</option>`;
        if (noteEl) noteEl.innerText = reason;
        return state.orderAvailability;
    }
}

const getActiveCart = () => state.activeTab === 'delivery' ? state.deliveryCart : state.orderCart;
const setActiveCart = (newCart) => {
    if (state.activeTab === 'delivery') state.deliveryCart = newCart;
    else state.orderCart = newCart;
    saveCart();
};

function saveCart() {
    const carts = {
        delivery: {
            items: state.deliveryCart,
            expires: Date.now() + (24 * 60 * 60 * 1000)
        },
        order: {
            items: state.orderCart,
            expires: Date.now() + (7 * 24 * 60 * 60 * 1000)
        }
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
    } catch (e) {
        console.error("Erro ao carregar carrinho", e);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Carrega o cardápio (o servidor já garantiu que temos um slug válido aqui)
    loadCart();
    lucide.createIcons();

    // Em vez de fazer um fetch pesado, o PHP já injetou tudo em window.__SSR__
    setTimeout(() => {
        hydrateFromSSR();
        initEventListeners();
        updateUI();
        if (state.userInfo.phone) fetchPreviousOrders();
    }, 10);
});

function hydrateFromSSR() {
    try {
        const data = window.__SSR__;
        if (!data) throw new Error("SSR Data Missing");

        state.publicSettings = {
            ...state.publicSettings,
            ...data
        };
        state.products = data.products || [];
        state.categories = data.categories || [];
        state.availableSlots = data.availableSlots || [];
        state.addonGroups = data.addonGroups || [];
        state.storeReviewSummary = data.reviewSummary || state.storeReviewSummary || {
            averageRating: 5,
            reviewCount: 0,
            orderCount: 0
        };
        state.storeRecentReviews = data.recentReviews || state.storeRecentReviews || [];
        state.loading = false;

        const deliveryEnabled = isDeliveryTabEnabled();
        const orderEnabled = isOrderEnabled();
        if (state.activeTab === 'order' && !orderEnabled && deliveryEnabled) {
            state.activeTab = 'delivery';
            document.body.classList.remove('theme-order');
        } else if (state.activeTab === 'delivery' && !deliveryEnabled && orderEnabled) {
            state.activeTab = 'order';
            document.body.classList.add('theme-order');
        } else if (!deliveryEnabled && !orderEnabled) {
            state.activeTab = 'delivery';
            document.body.classList.remove('theme-order');
        }

        updateFeaturedCardSizing();

        // Remove Skeletons e mostra o conteúdo real instantaneamente
        const loader = document.getElementById('skeleton-loader');
        if (loader) loader.remove();
        const historyContainer = document.getElementById('history-section');
        if (historyContainer) historyContainer.classList.remove('hidden');
        const content = document.getElementById('actual-menu-content');
        if (content) content.classList.remove('hidden');

        checkStoreStatus();

        if (data.googleApiKey) loadGoogleMaps(data.googleApiKey);

        updateTheme();

        // Scripts de Tracking
        if (data.googleAnalyticsId && !document.getElementById('ga-script')) {
            const ga = document.createElement('script');
            ga.id = 'ga-script';
            ga.async = true;
            ga.src = `https://www.googletagmanager.com/gtag/js?id=${data.googleAnalyticsId}`;
            document.head.appendChild(ga);
            window.dataLayer = window.dataLayer || [];

            function gtag() {
                dataLayer.push(arguments);
            }
            window.gtag = gtag;
            gtag('js', new Date());
            gtag('config', data.googleAnalyticsId);
        }

        if (data.microsoftClarityId && !document.getElementById('clarity-script')) {
            const cl = document.createElement('script');
            cl.id = 'clarity-script';
            cl.type = 'text/javascript';
            cl.innerHTML = `(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y)})(window,document,"clarity","script","${data.microsoftClarityId}");`;
            document.head.appendChild(cl);
        }

        if (data.pixelId && !document.getElementById('fb-script')) {
            const fb = document.createElement('script');
            fb.id = 'fb-script';
            fb.innerHTML = `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${data.pixelId}');fbq('track','PageView');`;
            document.head.appendChild(fb);
        }

        // Logo update
        const logoImg = document.getElementById('store-logo-img');
        const placeholder = document.querySelector('.logo-placeholder');
        if (data.logoUrl && logoImg) {
            logoImg.src = data.logoUrl;
            logoImg.style.display = 'block';
            if (placeholder) placeholder.style.display = 'none';
        }

        const nameEl = document.getElementById('store-name');
        if (nameEl) nameEl.innerText = data.businessName;

        const statusEl = document.getElementById('store-status-badge');
        if (statusEl) {
            checkStoreStatus();
            setInterval(checkStoreStatus, 60000);
        }

        updateStoreRatingBadge();

        renderMenu();
    } catch (err) {
        console.error('Erro no Hydrate:', err);
        document.body.innerHTML = `
            <div style="display:flex; flex-direction:column; justify-content:center; align-items:center; height:100vh; font-family:sans-serif;">
                <h1>Loja não encontrada</h1>
                <p>Verifique o link e tente novamente.</p>
            </div>
        `;
    }
}

function checkStoreStatus() {
    const hasMinimumSetup = state.publicSettings.marketplaceReady === true
        && state.publicSettings.hasLogo === true
        && Number(state.publicSettings.maxDeliveryKm || 0) > 0
        && state.availableSlots.length > 0
        && state.products.some(product => product && product.active !== false && String(product.type || '').toLowerCase() !== 'addon');
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

    const statusLabel = !hasMinimumSetup ? 'Inativo' : state.isOpen ? 'Aberto' : (isOrderEnabled() ? 'Apenas encomendas' : 'Fechado');
    const statusClass = !hasMinimumSetup || !state.isOpen ? 'status-badge closed' : 'status-badge open';

    const statusEl = document.getElementById('store-status-badge');
    if (statusEl) {
        statusEl.innerText = statusLabel;
        statusEl.className = statusClass;
    }

    const drawerStatusEl = document.getElementById('drawer-store-status');
    if (drawerStatusEl) {
        drawerStatusEl.innerText = statusLabel;
        drawerStatusEl.className = statusClass;
    }
}

function loadGoogleMaps(apiKey) {
    if (window.google || document.querySelector('script[src*="maps.googleapis.com"]')) return;
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=initMapsAutocomplete`;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
}

window.initMapsAutocomplete = () => {
    const input = document.getElementById('user-address');
    if (!input) return;

    try {
        input.dataset.placeSelected = '0';
        const autocomplete = new google.maps.places.Autocomplete(input);
        autocomplete.setComponentRestrictions({
            country: 'br'
        });
        state.geocoder = new google.maps.Geocoder();

        autocomplete.addListener('place_changed', () => {
            const place = autocomplete.getPlace();
            if (!place.geometry) return;
            input.dataset.placeSelected = '1';
            updateLocation(place.geometry.location, place.formatted_address);
        });

        input.addEventListener('input', () => {
            input.dataset.placeSelected = '0';
        }, { passive: true });

        input.addEventListener('change', () => {
            const value = input.value.trim();
            if (!value || input.dataset.placeSelected === '1') return;
            setTimeout(() => geocodeAddress(value), 120);
        });

        input.addEventListener('blur', () => {
            const value = input.value.trim();
            if (!value || input.dataset.placeSelected === '1') return;
            setTimeout(() => geocodeAddress(value), 120);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const value = input.value.trim();
                if (value) geocodeAddress(value);
                input.blur();
            }
        });
    } catch (e) {
        console.error('Autocomplete init error:', e);
    }
};

function initDeliveryMap() {
    const mapEl = document.getElementById('delivery-map');
    if (!mapEl || state.googleMap || !window.google) return;

    try {
        const mapCenter = {
            lat: -2.5307,
            lng: -44.3068
        };
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

        state.mapMarker.addListener('dragend', () => reverseGeocode(state.mapMarker.getPosition()));
        state.googleMap.addListener('click', (e) => {
            updateLocation(e.latLng);
            reverseGeocode(e.latLng);
        });
    } catch (e) {
        console.error('Delivery map init error:', e);
    }
}

function geocodeAddress(address) {
    if (!state.geocoder) return;
    state.geocoder.geocode({
        address: address
    }, (results, status) => {
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
        localStorage.setItem('menzzu_user', JSON.stringify(state.userInfo));
        calculateDeliveryFee(address);
    }
}

function reverseGeocode(latLng) {
    state.geocoder.geocode({
        location: latLng
    }, (results, status) => {
        if (status === 'OK' && results[0]) updateLocation(latLng, results[0].formatted_address);
    });
}

async function calculateDeliveryFee(address) {
    try {
        const response = await fetch(`${API_BASE}/orders/calculate-fee`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                address,
                slug: STORE_SLUG
            })
        });
        const data = await response.json();
        const display = document.getElementById('delivery-fee-display');
        if (data.fee !== undefined) {
            state.deliveryFee = data.fee;
            state.allowCash = data.type === 'estimated' ? false : (data.allowCash !== false);
            if (display) {
                display.style.display = 'block';
                display.innerHTML = `Taxa de entrega: <strong style="color:var(--primary-color)">R$ ${data.fee.toFixed(2)}</strong>`;
                display.style.background = '#f0fdf4';
                display.style.color = '#166534';
            }
            updateStep4Summary();
        } else if (data.error) {
            state.deliveryFee = 0;
            state.allowCash = false;
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
    } catch (err) {
        console.error('Erro ao calcular frete:', err);
    }
}

function maskPhone(v) {
    v = v.replace(/\D/g, "");
    v = v.replace(/^(\d{2})(\d)/g, "($1) $2");
    v = v.replace(/(\d)(\d{4})$/, "$1-$2");
    return v;
}
async function compressImage(file, maxSize = 1000, quality = 0.8) {
    return new Promise((resolve) => {
        if (!file) return resolve(file);

        const reader = new FileReader();
        reader.onerror = () => resolve(file);
        reader.onload = (event) => {
            const img = new Image();
            img.onerror = () => resolve(file);
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                if (width > height && width > maxSize) {
                    height = Math.round(height * (maxSize / width));
                    width = maxSize;
                } else if (height >= width && height > maxSize) {
                    width = Math.round(width * (maxSize / height));
                    height = maxSize;
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob((blob) => {
                    if (!blob) return resolve(file);
                    resolve(new File(
                        [blob],
                        file.name.replace(/\.[^.]+$/, '') + '.webp', {
                        type: 'image/webp',
                        lastModified: Date.now()
                    }
                    ));
                }, 'image/webp', quality);
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    });
}

async function handleExternalUpload(file) {
    if (!file) return null;

    Swal.fire({
        title: 'Otimizando Imagem...',
        text: 'Preparando para o cardápio rápido',
        allowOutsideClick: false,
        didOpen: () => {
            Swal.showLoading();
        }
    });

    try {
        const compressedFile = await compressImage(file, 1000, 0.8);
        const formData = new FormData();
        formData.append('file', compressedFile);
        formData.append('secret', 'BlinkMediaSecret123!');
        formData.append('size', '500');

        const res = await fetch('https://files.menzzu.com/upload.php', {
            method: 'POST',
            body: formData
        });
        if (!res.ok) {
            throw new Error(`Upload falhou com status ${res.status}`);
        }
        const data = await res.json();
        Swal.close();
        return data?.url || null;
    } catch (err) {
        console.error(err);
        Swal.close();
        Swal.fire('Erro', 'Falha no upload para o servidor externo', 'error');
        return null;
    }
}

function getFeaturedCountByViewport() {
    const data = state.publicSettings || {};
    const width = window.innerWidth || document.documentElement.clientWidth || 0;
    const desktop = Math.max(1, parseInt(data.featuredCountDesktop || 4, 10) || 4);
    const tablet = Math.max(1, parseInt(data.featuredCountTablet || 2, 10) || 2);
    const mobile = Math.max(1, parseInt(data.featuredCountMobile || 1, 10) || 1);
    if (width < 768) return mobile;
    if (width < 1024) return tablet;
    return desktop;
}

function updateFeaturedCardSizing() {
    const featuredList = document.querySelector('.featured-list');
    if (!featuredList) return;
    const visibleCount = getFeaturedCountByViewport();
    const gap = 16;
    featuredList.style.setProperty('--featured-visible-count', String(visibleCount));
    featuredList.style.setProperty('--featured-gap', `${gap}px`);
}

function updateFeaturedCarouselControls() {
    const featuredList = document.querySelector('.featured-list');
    const prevBtn = document.querySelector('.featured-prev');
    const nextBtn = document.querySelector('.featured-next');
    if (!featuredList || !prevBtn || !nextBtn) return;

    const canScroll = featuredList.scrollWidth > featuredList.clientWidth + 8;
    const atStart = featuredList.scrollLeft <= 4;
    const atEnd = featuredList.scrollLeft + featuredList.clientWidth >= featuredList.scrollWidth - 4;

    prevBtn.classList.toggle('hidden', !canScroll || atStart);
    nextBtn.classList.toggle('hidden', !canScroll || atEnd);
}

function scrollFeaturedCarousel(direction) {
    const featuredList = document.querySelector('.featured-list');
    if (!featuredList) return;

    const card = featuredList.querySelector('.featured-card, .featured-card--banner');
    const cardWidth = card ? card.getBoundingClientRect().width : 320;
    const gap = parseInt(getComputedStyle(featuredList).getPropertyValue('--featured-gap') || '16', 10) || 16;
    featuredList.scrollBy({
        left: direction * (cardWidth + gap),
        behavior: 'smooth'
    });
    setTimeout(updateFeaturedCarouselControls, 220);
}

function renderMenu() {
    const skeletonContainer = document.getElementById('skeleton-loader');
    const actualContainer = document.getElementById('actual-menu-content');

    if (state.loading) {
        if (skeletonContainer) {
            skeletonContainer.innerHTML = `
                            <div class="menu-section">
                                <div class="skeleton" style="height:24px; width:160px; margin-bottom:20px;"></div>
                                <div class="products-grid">
                                    ${Array(4).fill().map(() => `
                                        <div class="skeleton-card">
                                            <div class="skeleton-text-group">
                                                <div class="skeleton skeleton-title"></div>
                                                <div class="skeleton skeleton-desc"></div>
                                                <div class="skeleton skeleton-desc" style="width:70%"></div>
                                                <div class="skeleton skeleton-price"></div>
                                            </div>
                                            <div class="skeleton skeleton-img-box"></div>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                            <div class="menu-section">
                                <div class="skeleton" style="height:24px; width:120px; margin-bottom:20px;"></div>
                                <div class="products-grid">
                                    ${Array(2).fill().map(() => `
                                        <div class="skeleton-card">
                                            <div class="skeleton-text-group">
                                                <div class="skeleton skeleton-title"></div>
                                                <div class="skeleton skeleton-desc"></div>
                                                <div class="skeleton skeleton-price"></div>
                                            </div>
                                            <div class="skeleton skeleton-img-box"></div>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        `;
            skeletonContainer.classList.remove('hidden');
        }
        if (actualContainer) actualContainer.classList.add('hidden');
        return;
    }

    if (!state.products || state.products.length === 0) {

        if (skeletonContainer) skeletonContainer.classList.add('hidden');
        if (actualContainer) actualContainer.classList.remove('hidden');
        return;
    }

    if (!actualContainer) return;

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

        const matchesSearch = p.name.toLowerCase().includes(query) || (p.description && p.description.toLowerCase().includes(query));
        const matchesTab = (state.activeTab === 'delivery' && isDeliveryTabEnabled() && p.type === 'delivery') || (state.activeTab === 'order' && isOrderEnabled());
        return matchesTab && matchesSearch;
    });

    // Separar destaques (apenas se não houver busca ativa)
    const featured = query ? [] : filtered.filter(p => p.featured).sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
    const nonFeatured = query ? filtered : filtered.filter(p => !p.featured);

    const grouped = {};
    const sortedCategories = [];
    nonFeatured.forEach(p => {
        let cat = 'Geral';
        if (p.categoryId && state.categories && state.categories.length > 0) {
            const foundCat = state.categories.find(c => String(c.id) === String(p.categoryId));
            if (foundCat) cat = foundCat.name;
        } else if (p.category) {
            cat = p.category; // fallback para produtos antigos
        }

        if (!grouped[cat]) {
            grouped[cat] = [];
            sortedCategories.push(cat);
        }
        grouped[cat].push(p);
    });

    let html = '';

    // Renderizar Destaques
    if (featured.length > 0) {
        html += `
            <section class="menu-section featured-section">
                <div class="featured-carousel">
                    <button class="featured-nav featured-prev hidden" type="button" aria-label="Destaques anteriores" onclick="scrollFeaturedCarousel(-1)">
                        <i data-lucide="chevron-left"></i>
                    </button>
                    <div class="featured-list">
                        ${featured.map((item, idx) => renderFeaturedCard(item, idx < Math.min(4, getFeaturedCountByViewport()))).join('')}
                    </div>
                    <button class="featured-nav featured-next hidden" type="button" aria-label="Proximos destaques" onclick="scrollFeaturedCarousel(1)">
                        <i data-lucide="chevron-right"></i>
                    </button>
                </div>
            </section>
        `;
    }

    // Renderizar Categorias
    html += sortedCategories.map((category, catIdx) => {
        const items = grouped[category];
        return `
            <section class="menu-section" id="cat-${category.replace(/\s+/g, '-')}">
                <h2>${category}</h2>
                <div class="product-list">${items.map((item, itemIdx) => renderProductCard(item, catIdx === 0 && itemIdx < 4)).join('')}</div>
            </section>
        `;
    }).join('');

    actualContainer.innerHTML = html;
    renderCategoryNav(sortedCategories);
    lucide.createIcons();
    updateFeaturedCardSizing();
    updateFeaturedCarouselControls();
    const featuredListEl = document.querySelector('.featured-list');
    if (featuredListEl) {
        featuredListEl.addEventListener('scroll', updateFeaturedCarouselControls, { passive: true });
    }

    // Troca a visibilidade SOMENTE APOS o DOM estar completamente pronto
    if (skeletonContainer) skeletonContainer.classList.add('hidden');
    if (actualContainer) actualContainer.classList.remove('hidden');
}

function renderFeaturedCard(product, isPriority = false) {
    const priceText = getDisplayPriceText(product);
    const images = parseImages(product.image);
    const imgAttr = isPriority ? 'fetchpriority="high" loading="eager" decoding="async"' : 'loading="lazy" decoding="async"';

    if (product.bannerUrl) {
        const bannerAttr = isPriority ? 'fetchpriority="high" loading="eager" decoding="async"' : 'loading="lazy" decoding="async"';
        return `
        <div class="featured-card featured-card--banner" onclick="openItemDetail('${product.id}')">
            <img src="${getImg(product.bannerUrl, 'full')}" alt="${product.name}" ${bannerAttr}>
        </div>
    `;
    }

    return `
        <div class="featured-card" onclick="openItemDetail('${product.id}')">
            <div class="featured-img-wrapper">
                ${images.length > 0 ? `<img src="${getImg(images[0], 'medium')}" alt="${product.name}" ${imgAttr}>` : `<div class="img-placeholder"><i data-lucide="image"></i></div>`}
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
    syncStickyOffsets();
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

function renderProductCard(product, isPriority = false) {
    const priceText = getDisplayPriceText(product);
    const imgAttr = isPriority ? 'fetchpriority="high"' : 'loading="lazy" decoding="async"';
    return `
        <div class="product-card" onclick="openItemDetail('${product.id}')">
                    ${parseImages(product.image).length > 0 ? `<img src="${getImg(parseImages(product.image)[0], 'thumb')}" alt="${product.name}" class="product-img" ${imgAttr}>` : `<div class="img-placeholder"><i data-lucide="image"></i></div>`}
            <div class="product-info">
                <h3>${product.name}</h3>
                <p>${product.description || ''}</p>
                <div class="product-footer">
                    <div class="product-price">${priceText}</div>
                    <button class="product-add-btn" type="button" aria-label="Adicionar item" onclick="event.stopPropagation(); openItemDetail('${product.id}')">
                        <i data-lucide="plus"></i>
                    </button>
                </div>
            </div>
        </div>
    `;
}

async function handleCustomFieldImageUpload(input, idx) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const btn = input.nextElementSibling;
    const originalBtnText = btn.innerHTML;

    btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Enviando...';
    btn.disabled = true;
    lucide.createIcons();

    try {
        const url = await handleExternalUpload(file);
        if (url) {
            document.getElementById(`cf-${idx}`).value = url;
            const preview = document.getElementById(`cf-${idx}-preview`);
            if (preview) {
                preview.querySelector('img').src = url;
                preview.style.display = 'flex';
            }
        } else {
            showAlert('Erro', 'Falha no upload da imagem.');
        }
    } catch (e) {
        console.error(e);
        showAlert('Erro', 'Ocorreu um erro ao enviar a imagem.');
    } finally {
        btn.innerHTML = originalBtnText;
        btn.disabled = false;
        lucide.createIcons();
    }
}

async function handleCheckoutFieldImageUpload(input, hiddenId, previewId) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const btn = input.closest('.checkout-extra-image')?.querySelector('button[data-upload-btn="true"]') || input.previousElementSibling;
    const originalBtnText = btn?.innerHTML || '';

    if (btn) {
        btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Enviando...';
        btn.disabled = true;
        lucide.createIcons();
    }

    try {
        const url = await handleExternalUpload(file);
        if (url) {
            const hidden = document.getElementById(hiddenId);
            if (hidden) hidden.value = url;
            const preview = document.getElementById(previewId);
            if (preview) {
                preview.querySelector('img').src = url;
                preview.style.display = 'flex';
            }
        } else {
            showAlert('Erro', 'Falha no upload da imagem.');
        }
    } catch (e) {
        console.error(e);
        showAlert('Erro', 'Ocorreu um erro ao enviar a imagem.');
    } finally {
        if (btn) {
            btn.innerHTML = originalBtnText;
            btn.disabled = false;
            lucide.createIcons();
        }
    }
}

function ensureDetailFooter() {
    const modalContent = document.querySelector('#item-detail-modal .item-detail-content');
    if (!modalContent || document.getElementById('item-detail-footer')) return;

    modalContent.insertAdjacentHTML('beforeend', `
        <div id="item-detail-footer" class="modal-footer-sticky">
            <div class="qty-selector">
                <button class="qty-btn" id="qty-minus" aria-label="Diminuir quantidade">
                    <i data-lucide="minus"></i>
                </button>
                <span id="detail-qty">1</span>
                <button class="qty-btn" id="qty-plus" aria-label="Aumentar quantidade">
                    <i data-lucide="plus"></i>
                </button>
            </div>
            <button id="add-to-cart-btn" class="primary-btn">
                Adicionar <span id="add-btn-price"></span>
            </button>
        </div>
    `);
    lucide.createIcons();
}

function openItemDetail(productId) {
    ensureDetailFooter();
    const item = state.products.find(p => p.id === productId);
    state.currentItem = item;
    state.currentQty = 1;
    state.currentVariation = null;
    state.orderBumpSelected = false;

    const body = document.getElementById('item-detail-body');

    // Inicia com Skeleton
    body.innerHTML = `
                    <div class="item-detail-layout">
                        <div class="item-detail-media">
                            <div class="skeleton" style="width:100%; height:100%; min-height:320px; border-radius:0;"></div>
                        </div>
                        <div class="item-detail-panel">
                            <div style="padding:4px 0 0;">
                                <div class="skeleton" style="height:24px; width:70%; margin-bottom:10px;"></div>
                                <div class="skeleton" style="height:14px; width:90%; margin-bottom:5px;"></div>
                                <div class="skeleton" style="height:14px; width:80%; margin-bottom:20px;"></div>
                            </div>
                            <div class="skeleton" style="height:92px; width:100%;"></div>
                            <div class="skeleton" style="height:92px; width:100%;"></div>
                        </div>
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
            items: [{
                item_id: item.id,
                item_name: item.name,
                price: parseFloat(item.price)
            }]
        });
    }

    setTimeout(() => {
        state.currentCarouselIdx = 0;
        const variations = JSON.parse(item.variations || '[]').filter(v => !v.hidden);
        const images = parseImages(item.image);
        const mediaHtml = images.length > 0 ?
            `
                            <div class="item-detail-media">
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
                            </div>
                        ` :
            `
                            <div class="item-detail-media item-detail-media-empty">
                                <div class="item-hero-placeholder">
                                    <i data-lucide="image"></i>
                                    <div>Sem imagem cadastrada</div>
                                </div>
                            </div>
                        `;

        const mainInfoHtml = `
                        <div class="item-main-info">
                            <h2>${item.name}</h2>
                            <p>${item.description || ''}</p>
                            <div class="price">${getDisplayPriceText(item)}</div>
                        </div>
                    `;

        const variationsHtml = variations.length > 0 ?
            `<div class="variation-section"><div class="addon-group-header"><h4>Escolha uma opção</h4></div>${variations.map(v => `<div class="var-option" onclick="selectVariation('${v.name.replace(/'/g, "\\'")}', ${v.price || 0})"><div class="var-label">${v.name}</div><div class="var-price">+ R$ ${parseFloat(v.price || 0).toFixed(2)}</div></div>`).join('')}</div>` :
            '';

        const customFieldsHtml = state.activeTab === 'order' ? '' : (() => {
            let cfHtml = '';
            try {
                const cfs = JSON.parse(item.customFields || '[]');
                if (cfs.length > 0) {
                    cfHtml = `<div class="custom-fields-section" style="margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border-color);">
                                    <h4 style="margin-bottom: 15px; font-weight: 700;">Personalize seu pedido</h4>
                                    ${cfs.map((cf, i) => {
                        let inputHtml = '';
                        if (cf.type === 'dropdown') {
                            const opts = typeof cf.options === 'string' ? cf.options.split(',').map(o => o.trim()).filter(o => o) : [];
                            inputHtml = `<select id="cf-${i}" class="custom-field-input" data-name="${cf.name}" style="width: 100%; padding: 12px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary); font-family: inherit;">
                                                <option value="">Selecione...</option>
                                                ${opts.map(opt => `<option value="${opt}">${opt}</option>`).join('')}
                                            </select>`;
                        } else if (cf.type === 'image') {
                            inputHtml = ` < div style = "display:flex; flex-direction:column; gap:10px;" >
                                                <
                                                input type = "file"
                                            id = "cf-${i}-file"
                                            accept = "image/*"
                                            style = "display:none;"
                                            onchange = "handleCustomFieldImageUpload(this, ${i})" >
                                                <
                                                button type = "button"
                                            onclick = "document.getElementById('cf-${i}-file').click()"
                                            style = "padding: 10px; border-radius: 8px; border: 1px dashed var(--primary-color); background: var(--bg-tertiary); color: var(--primary-color); font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;" > < i data - lucide = "image"
                                            style = "width:16px; height:16px;" > < /i> Anexar Imagem</button >
                                                <
                                                input type = "hidden"
                                            id = "cf-${i}"
                                            class = "custom-field-input"
                                            data - name = "${cf.name}" >
                                                <
                                                div id = "cf-${i}-preview"
                                            style = "display:none; margin-top: 10px; align-items: center;" >
                                                <
                                                img src = ""
                                            style = "max-width: 80px; max-height: 80px; border-radius: 8px; border: 1px solid var(--border-color); object-fit: cover;" >
                                                <
                                                span style = "font-size: 12px; color: #ef4444; margin-left: 10px; cursor:pointer; font-weight: 700;"
                                            onclick = "document.getElementById('cf-${i}').value=''; document.getElementById('cf-${i}-preview').style.display='none';" > Remover < /span> < /
                                            div > <
                                                /div>`;
                        } else {
                            inputHtml = `<input type="text" id="cf-${i}" class="custom-field-input" data-name="${cf.name}" placeholder="Ex: ${cf.name}" style="width: 100%; padding: 12px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary); font-family: inherit;">`;
                        }
                        return `<div style="margin-bottom: 15px;">
                                            <label style="display: block; font-size: 13px; font-weight: 600; color: var(--text-secondary); margin-bottom: 5px;">${cf.name} ${cf.required ? '<span style="color:#ef4444">*</span>' : ''}</label>
                                            ${inputHtml}
                                        </div>`;
                    }).join('')
                        } <
                            /div>`;
                }
            }
            catch (e) { }
            return cfHtml;
        })();

        const suggestedItem = getSuggestedProductForItem(item);
        const orderBumpHtml = suggestedItem ? `
                <div class="variation-section addon-group-section order-bump-section" style="margin-top: 18px;">
                    <div class="addon-group-header">
                        <h4>Leve também</h4>
                        <span class="addon-group-badge optional">Sugestão</span>
                    </div>
                    <label class="var-option addon-option order-bump-option ${state.orderBumpSelected ? 'selected' : ''}" style="--addon-accent: var(--primary-color);" onclick="toggleOrderBumpSelect(event)">
                        <div class="addon-option-main">
                            <span class="var-label">${suggestedItem.name}</span>
                            <span style="font-size:12px; color:var(--text-gray); margin-top: 4px;">${suggestedItem.description || 'Sugestão para complementar o pedido.'}</span>
                        </div>
                        <div class="addon-option-meta">
                            <span class="var-price addon-option-price">${getDisplayPriceText(suggestedItem)}</span>
                            <span class="addon-option-mark" aria-hidden="true"></span>
                        </div>
                        <input type="checkbox" id="order-bump-input" class="addon-input" ${state.orderBumpSelected ? 'checked' : ''}>
                    </label>
                </div>
            ` : '';

        const addonsHtml = (() => {
            let agHtml = '';
            try {
                const groupIds = JSON.parse(item.addonGroups || '[]');
                const groups = (state.addonGroups || []).filter(g => groupIds.includes(g.id));
                if (groups.length > 0) {
                    agHtml = groups.map((g, gi) => {
                        const gItems = JSON.parse(g.items || '[]');
                        const maxSelections = Math.max(parseInt(g.max, 10) || 1, 1);
                        return `<div class="variation-section addon-group-section" data-group-id="${g.id}" data-min="${g.min}" data-max="${g.max}">
                                        <div class="addon-group-header">
                                            <h4>${g.name}</h4>
                                            <span class="addon-group-badge ${g.min > 0 ? 'required' : 'optional'}">${g.min > 0 ? 'Obrigatório' : 'Opcional'} • Máx ${g.max}</span>
                                        </div>
                                        <div class="addon-options">
                                        ${gItems.map((gItem, ii) => {
                            const inputId = `ag-${gi}-${ii}`;
                            const inputName = `ag-group-${gi}`;
                            const itemAccent = String(gItem.color || gItem.accent || gItem.accentColor || g.color || g.accentColor || 'var(--primary-color)').replace(/"/g, '&quot;');
                            return `<label for="${inputId}" class="var-option addon-option" style="--addon-accent: ${itemAccent};" onclick="handleAddonSelect(event, '${g.id}', ${maxSelections}, ${gi}, ${ii}, ${parseFloat(gItem.price || 0)})">
                                                <div class="addon-option-main">
                                                    <span class="var-label">${gItem.name}</span>
                                                </div>
                                                <div class="addon-option-meta">
                                                    ${parseFloat(gItem.price || 0) > 0 ? `<span class="var-price addon-option-price">+ R$ ${parseFloat(gItem.price).toFixed(2)}</span>` : ''}
                                                    <span class="addon-option-mark" aria-hidden="true"></span>
                                                </div>
                                                <input type="checkbox" id="${inputId}" name="${inputName}" class="addon-input" data-group-id="${g.id}" data-max="${maxSelections}" data-item-name="${gItem.name.replace(/"/g, '&quot;')}" data-item-price="${parseFloat(gItem.price || 0)}">
                                            </label>`;
                        }).join('')}
                                        </div>
                                    </div>`;
                    }).join('');
                }
            } catch (e) {
                console.error('Addon render error:', e);
            }
            return agHtml;
        })();

        body.innerHTML = `
                        <div class="item-detail-layout">
                            ${mediaHtml}
                            <div class="item-detail-panel">
                                ${mainInfoHtml}
                                ${variationsHtml}
                                ${customFieldsHtml}
                                ${addonsHtml}
                                ${orderBumpHtml}
                            </div>
                        </div>
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
    modal.classList.add('hidden');
    const anyVisibleModal = ['item-detail-modal', 'checkout-modal', 'history-modal', 'order-schedule-modal', 'review-modal']
        .some(id => {
            const el = document.getElementById(id);
            return el && !el.classList.contains('hidden');
        });
    if (!anyVisibleModal) {
        unlockBodyScroll();
    }
}

function lockBodyScroll() {
    if (state.isBodyScrollLocked) return;
    state.bodyScrollY = window.scrollY || window.pageYOffset || 0;
    state.isBodyScrollLocked = true;
    document.body.classList.add('modal-open');
    document.body.style.position = 'fixed';
    document.body.style.top = `-${state.bodyScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
}

function unlockBodyScroll() {
    if (!state.isBodyScrollLocked) return;
    state.isBodyScrollLocked = false;
    document.body.classList.remove('modal-open');
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    document.body.style.overflow = '';
    window.scrollTo(0, state.bodyScrollY || 0);
}

function selectVariation(name, price) {
    state.currentVariation = {
        name,
        price
    };
    document.querySelectorAll('.var-option').forEach(el => el.classList.toggle('selected', el.querySelector('.var-label').innerText === name));
    updateDetailFooter();
}

function syncAddonGroupState(groupSection) {
    if (!groupSection) return;
    const maxAllowed = Math.max(parseInt(groupSection.dataset.max || '1', 10) || 1, 1);
    const inputs = Array.from(groupSection.querySelectorAll('.addon-input'));
    const selectedCount = inputs.filter(input => input.checked).length;

    inputs.forEach(input => {
        const label = input.closest('label');
        const isSelected = input.checked;
        const isDisabled = !isSelected && selectedCount >= maxAllowed;

        input.disabled = isDisabled;

        if (label) {
            label.classList.toggle('selected', isSelected);
            label.classList.toggle('disabled', isDisabled);
        }
    });
}

function handleAddonSelect(event, groupId, maxSelections, gi, ii, price) {
    event.preventDefault();
    const inputId = `ag-${gi}-${ii}`;
    const input = document.getElementById(inputId);
    if (!input) return;
    const label = input.closest('label');
    const groupSection = label?.closest('.addon-group-section');
    const maxAllowed = Math.max(parseInt(maxSelections, 10) || 1, 1);
    const willSelect = !input.checked;

    if (input.disabled && !input.checked) {
        return;
    }

    if (maxAllowed <= 1) {
        const isCurrentlySelected = input.checked;

        // Desmarca visuais do grupo
        (groupSection ? groupSection.querySelectorAll('.addon-input') : document.querySelectorAll(`[data-group-id="${groupId}"].addon-input`)).forEach(el => {
            el.checked = false;
            const option = el.closest('label');
            if (option) option.classList.remove('selected');
        });

        if (isCurrentlySelected) {
            syncAddonGroupState(groupSection);
            updateDetailFooter();
            return;
        }

        input.checked = true;
    } else {
        const selectedCount = groupSection ? groupSection.querySelectorAll('.addon-input:checked').length : 0;
        if (willSelect && maxAllowed > 0 && selectedCount >= maxAllowed) {
            syncAddonGroupState(groupSection);
            return;
        }
        input.checked = willSelect;
    }

    syncAddonGroupState(groupSection);
    updateDetailFooter();
}

function getSelectedAddons() {
    const addons = [];
    let addonTotal = 0;
    document.querySelectorAll('.addon-input:checked').forEach(input => {
        const price = parseFloat(input.dataset.itemPrice || 0);
        addons.push({
            groupId: input.dataset.groupId,
            name: input.dataset.itemName,
            price
        });
        addonTotal += price;
    });
    return {
        addons,
        addonTotal
    };
}

function updateDetailFooter() {
    const basePrice = state.currentVariation ? parseFloat(state.currentVariation.price || 0) : parseFloat(state.currentItem?.price || 0);
    const {
        addonTotal
    } = getSelectedAddons();
    const suggestedItem = getSuggestedProductForItem(state.currentItem);
    const bumpPrice = state.orderBumpSelected && suggestedItem ? getEffectiveProductPrice(suggestedItem) : 0;
    const totalUnit = basePrice + addonTotal;
    const priceEl = document.getElementById('add-btn-price');
    if (priceEl) priceEl.innerText = `R$ ${((totalUnit * state.currentQty) + bumpPrice).toFixed(2)}`;

    const qtyEl = document.getElementById('detail-qty');
    if (qtyEl) qtyEl.innerText = state.currentQty;
}

function toggleOrderBumpSelect(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    state.orderBumpSelected = !state.orderBumpSelected;
    const input = document.getElementById('order-bump-input');
    if (input) input.checked = state.orderBumpSelected;
    const label = input?.closest('label');
    if (label) label.classList.toggle('selected', state.orderBumpSelected);
    updateDetailFooter();
}

function validateCurrentItemSelections() {
    const item = state.currentItem;
    if (!item) {
        return {
            ok: false,
            message: 'Selecione um item primeiro.'
        };
    }

    const variation = state.currentVariation;
    const variations = JSON.parse(item.variations || '[]').filter(v => !v.hidden);
    if (variations.length > 0 && !variation) {
        return {
            ok: false,
            message: 'Por favor, selecione uma opção para continuar.'
        };
    }

    const groupIds = JSON.parse(item.addonGroups || '[]');
    const groups = (state.addonGroups || []).filter(g => groupIds.includes(g.id));
    for (const g of groups) {
        const maxAllowed = Math.max(parseInt(g.max, 10) || 1, 1);
        const checked = document.querySelectorAll(`.addon-input[data-group-id="${g.id}"]:checked`).length;
        if (g.min > 0 && checked < g.min) {
            return {
                ok: false,
                message: `Selecione pelo menos ${g.min} opção em "${g.name}".`
            };
        }
        if (checked > maxAllowed) {
            return {
                ok: false,
                message: `O grupo "${g.name}" permite no máximo ${maxAllowed} opção(ões).`
            };
        }
    }

    return {
        ok: true
    };
}

function renderCheckoutExtraField(item, field, idx, itemKeyBase, currentValue = '') {
    const fieldId = `extra-${itemKeyBase}-${idx}`;
    const fieldLabel = `${field.name || 'Campo'} ${field.required ? '<span style="color:#ef4444">*</span>' : ''}`;
    const fieldType = String(field.type || 'text').toLowerCase();

    if (fieldType === 'dropdown') {
        const options = parseJsonValue(field.options, []);
        const opts = Array.isArray(options) ?
            options.filter(Boolean) :
            String(field.options || '').split(',').map(opt => opt.trim()).filter(Boolean);
        return `
                        <div style="margin-bottom: 14px;">
                            <label style="display:block; font-size:13px; font-weight:600; color:var(--text-secondary); margin-bottom:5px;">${fieldLabel}</label>
                            <select id="${fieldId}" class="ifood-input" data-field-name="${field.name}">
                                <option value="">Selecione...</option>
                                ${opts.map(opt => `<option value="${opt}" ${currentValue === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                            </select>
                        </div>
                    `;
    }

    if (fieldType === 'image') {
        const previewId = `${fieldId}-preview`;
        return `
                        <div class="checkout-extra-image" style="margin-bottom: 14px;">
                            <label style="display:block; font-size:13px; font-weight:600; color:var(--text-secondary); margin-bottom:5px;">${fieldLabel}</label>
                            <input type="hidden" id="${fieldId}" data-field-name="${field.name}" value="${currentValue || ''}">
                            <button type="button" data-upload-btn="true" onclick="document.getElementById('${fieldId}-file').click()" style="padding: 10px; border-radius: 8px; border: 1px dashed var(--primary-color); background: var(--bg-tertiary); color: var(--primary-color); font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%;">
                                <i data-lucide="image" style="width:16px; height:16px;"></i> Anexar Imagem
                            </button>
                            <input type="file" id="${fieldId}-file" accept="image/*" style="display:none;" onchange="handleCheckoutFieldImageUpload(this, '${fieldId}', '${previewId}')">
                            <div id="${previewId}" style="display:${currentValue ? 'flex' : 'none'}; margin-top: 10px; align-items: center;">
                                <img src="${currentValue || ''}" style="max-width: 80px; max-height: 80px; border-radius: 8px; border: 1px solid var(--border-color); object-fit: cover;">
                                <span style="font-size: 12px; color: #ef4444; margin-left: 10px; cursor:pointer; font-weight: 700;" onclick="document.getElementById('${fieldId}').value=''; document.getElementById('${previewId}').style.display='none';">Remover</span>
                            </div>
                        </div>
                    `;
    }

    return `
                    <div style="margin-bottom: 14px;">
                        <label style="display:block; font-size:13px; font-weight:600; color:var(--text-secondary); margin-bottom:5px;">${fieldLabel}</label>
                        <input type="text" id="${fieldId}" class="ifood-input" data-field-name="${field.name}" placeholder="Ex: ${field.name}" value="${currentValue || ''}">
                    </div>
                `;
}

function renderCheckoutExtraStep() {
    const container = document.getElementById('order-extra-step-content');
    const orderStepContent = document.getElementById('order-step-content');
    if (!container || !orderStepContent) return false;

    const cart = getActiveCart();
    const itemsWithExtras = cart.filter(item => getCustomFieldSchema(item).length > 0);
    if (state.activeTab !== 'order' || itemsWithExtras.length === 0) {
        container.innerHTML = '';
        orderStepContent.classList.add('hidden');
        return false;
    }

    container.innerHTML = itemsWithExtras.map(item => {
        const schema = getCustomFieldSchema(item);
        const answers = getCustomFieldAnswers(item);
        const itemKeyBase = sanitizeDomId(item.itemKey || item.productId || item.name);
        return `
                        <div style="padding: 14px; border-radius: 14px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); margin-bottom: 14px;">
                            <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; margin-bottom: 12px;">
                                <div>
                                    <div style="font-weight: 800; color: var(--text-main);">${item.name}${item.variation ? ` (${item.variation})` : ''}</div>
                                    <div style="font-size: 12px; color: var(--text-gray); margin-top: 3px;">Preencha as informações pedidas abaixo.</div>
                                </div>
                            </div>
                            ${schema.map((field, idx) => renderCheckoutExtraField(item, field, idx, itemKeyBase, answers[field.name] || '')).join('')}
                        </div>
                    `;
    }).join('');

    orderStepContent.classList.remove('hidden');
    lucide.createIcons();
    return true;
}

function collectCheckoutExtraStep() {
    const cart = getActiveCart();
    const itemsWithExtras = cart.filter(item => getCustomFieldSchema(item).length > 0);
    if (itemsWithExtras.length === 0) return {
        ok: true,
        cart
    };

    const updatedCart = [...cart];
    for (const item of itemsWithExtras) {
        const schema = getCustomFieldSchema(item);
        const itemKeyBase = sanitizeDomId(item.itemKey || item.productId || item.name);
        const answers = {};
        for (let idx = 0; idx < schema.length; idx++) {
            const field = schema[idx];
            const fieldId = `extra-${itemKeyBase}-${idx}`;
            const input = document.getElementById(fieldId);
            const value = input?.value?.trim() || '';
            if (field.required && !value) {
                return {
                    ok: false,
                    message: `Preencha o campo "${field.name}" do item "${item.name}".`
                };
            }
            if (value) answers[field.name] = value;
        }

        const cartIndex = updatedCart.findIndex(c => c.itemKey === item.itemKey);
        if (cartIndex >= 0) {
            updatedCart[cartIndex] = {
                ...updatedCart[cartIndex],
                customFieldValues: JSON.stringify(answers)
            };
        }
    }

    setActiveCart(updatedCart);
    return {
        ok: true,
        cart: updatedCart
    };
}

function closeModal(modalId = null) {
    const ids = ['item-detail-modal', 'checkout-modal', 'history-modal', 'order-schedule-modal', 'review-modal'];
    ids.forEach(id => {
        const m = document.getElementById(id);
        if (m && !m.classList.contains('hidden')) {
            if (modalId && modalId !== id) return;
            closeWithAnimation(id);
        }
    });
}

function openModal(id) {
    const ids = ['item-detail-modal', 'checkout-modal', 'history-modal', 'order-schedule-modal', 'review-modal'];
    lockBodyScroll();
    ids.forEach(modalId => {
        const m = document.getElementById(modalId);
        if (m) m.classList.add('hidden', 'closing');
    });
    const target = document.getElementById(id);
    if (target) target.classList.remove('hidden', 'closing');
}

let tabsNavScrollY = window.scrollY || window.pageYOffset || 0;
let tabsNavScrollTicking = false;

function syncStickyOffsets() {
    const categoryNav = document.querySelector('.category-nav');
    const orderNav = document.getElementById('order-tabs-nav');
    const searchContainer = document.querySelector('.search-container');
    if (!categoryNav) return;

    const isMobile = window.innerWidth <= 599;
    if (isMobile) {
        categoryNav.style.setProperty('--category-nav-top', '0px');
        if (searchContainer) {
            searchContainer.style.setProperty('--search-container-top', '56px');
        }
        return;
    }

    const shouldOffset = !!orderNav && !orderNav.classList.contains('hidden') && !orderNav.classList.contains('is-hidden');
    const offset = shouldOffset ? `${orderNav.offsetHeight || 0}px` : '0px';
    categoryNav.style.setProperty('--category-nav-top', offset);
    if (searchContainer) {
        searchContainer.style.setProperty('--search-container-top', '0px');
    }
}

function updateOrderTabsVisibility(forceSync = false) {
    const nav = document.getElementById('order-tabs-nav');
    if (!nav || nav.classList.contains('hidden')) return;

    if (window.innerWidth <= 599) {
        nav.classList.remove('is-hidden');
        syncStickyOffsets();
        return;
    }

    const currentY = window.scrollY || window.pageYOffset || 0;
    if (forceSync) {
        nav.classList.remove('is-hidden');
        tabsNavScrollY = currentY;
        syncStickyOffsets();
        return;
    }

    const scrollDelta = currentY - tabsNavScrollY;
    if (currentY <= 24 || scrollDelta < -8) {
        nav.classList.remove('is-hidden');
    } else if (scrollDelta > 8) {
        nav.classList.add('is-hidden');
    }
    tabsNavScrollY = currentY;
    syncStickyOffsets();
}

function initEventListeners() {
    ensureDetailFooter();
    const searchInput = document.getElementById('search-input');
    const mobileSearchToggle = document.getElementById('mobile-search-toggle');
    const searchContainer = document.getElementById('search-container');

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            state.searchQuery = e.target.value;
            renderMenu();
        });
    }

    if (mobileSearchToggle && searchContainer && searchInput) {
        mobileSearchToggle.addEventListener('click', () => {
            const isOpen = searchContainer.classList.toggle('is-open');
            mobileSearchToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            if (isOpen) {
                searchInput.focus();
            }
        });
    }
    document.querySelectorAll('.cat-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.tab === 'order' && !isOrderEnabled()) return;
            document.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.activeTab = btn.dataset.tab;
            document.body.classList.toggle('theme-order', state.activeTab === 'order');
            updateTheme(); // Muda as cores ao trocar de aba
            renderMenu();
            updateUI();
        });
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

    document.querySelectorAll('.close-modal-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            closeModal();
        });
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (event) => {
            if (event.target !== event.currentTarget) return;
            const modal = overlay.closest('.modal');
            if (modal?.id) closeWithAnimation(modal.id);
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });

    document.getElementById('history-toggle-btn').addEventListener('click', () => {
        openModal('history-modal');
        renderPreviousOrders();
    });

    document.getElementById('add-to-cart-btn').addEventListener('click', addToCart);
    document.getElementById('view-cart-btn').addEventListener('click', () => {
        restoreCheckoutState();
        if (state.activeTab === 'order' && (!state.orderSchedule?.date || !state.orderSchedule?.time) && getActiveCart().length > 0) {
            openScheduleModal('resume');
            return;
        }
        goToStep(getResumeStep());
    });
    document.getElementById('next-step-btn').addEventListener('click', handleNextStep);
    document.getElementById('place-order-btn').addEventListener('click', handlePlaceOrder);

    updateOrderTabsVisibility(true);
    window.addEventListener('scroll', () => {
        if (tabsNavScrollTicking) return;
        tabsNavScrollTicking = true;
        window.requestAnimationFrame(() => {
            updateOrderTabsVisibility(false);
            tabsNavScrollTicking = false;
        });
    }, { passive: true });

    window.addEventListener('resize', () => {
        syncStickyOffsets();
        updateFeaturedCardSizing();
        updateFeaturedCarouselControls();
    }, {
        passive: true
    });

    const featuredScrollHandler = () => updateFeaturedCarouselControls();
    window.addEventListener('scroll', featuredScrollHandler, { passive: true });

    const scheduleDateInput = document.getElementById('schedule-date');
    if (scheduleDateInput) {
        const handleScheduleDateChange = async (e) => {
            const dateStr = e.target.value;
            const today = getBrazilDateString();
            if (dateStr && dateStr < today) {
                e.target.value = '';
                await loadOrderAvailability('', false, {
                    timeSelectId: 'schedule-time',
                    dateInputId: 'schedule-date',
                    noteId: 'schedule-availability-note'
                });
                return;
            }
            await loadOrderAvailability(dateStr, true, {
                timeSelectId: 'schedule-time',
                dateInputId: 'schedule-date',
                noteId: 'schedule-availability-note'
            });
        };

        scheduleDateInput.addEventListener('change', handleScheduleDateChange);
        scheduleDateInput.addEventListener('blur', handleScheduleDateChange);
    }

    document.getElementById('confirm-schedule-btn')?.addEventListener('click', commitScheduleAndMaybeAdd);
    document.getElementById('schedule-time')?.addEventListener('change', async (e) => {
        if (!e.target.value) return;
        const noteEl = document.getElementById('schedule-availability-note');
        if (noteEl) noteEl.innerText = '';
    });

    document.getElementById('user-name').value = state.userInfo.name || '';
    document.getElementById('user-phone').value = state.userInfo.phone || '';
    document.getElementById('user-address').value = state.userInfo.address || '';

    const phoneInput = document.getElementById('user-phone');
    if (phoneInput) {
        phoneInput.addEventListener('input', (e) => {
            e.target.value = maskPhone(e.target.value);
            state.userInfo.phone = e.target.value;
            localStorage.setItem('menzzu_user', JSON.stringify(state.userInfo));
        });
    }

    ['user-name', 'user-address'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', (e) => {
                state.userInfo[id.split('-')[1]] = e.target.value;
                localStorage.setItem('menzzu_user', JSON.stringify(state.userInfo));
            });
        }
    });
}

function goToStep(step) {
    if (step === 2 && state.activeTab === 'order' && !hasCheckoutExtras()) {
        step = 3;
    }

    state.currentStep = step;

    // Persist checkout progress
    saveCheckoutState();

    // Esconde todos os passos explicitamente por ID para não ter erro
    document.getElementById('step-1')?.classList.add('hidden');
    document.getElementById('step-2')?.classList.add('hidden');
    document.getElementById('step-3')?.classList.add('hidden');
    document.getElementById('step-4')?.classList.add('hidden');

    // Mostra apenas o atual
    document.getElementById(`step-${step}`)?.classList.remove('hidden');

    openModal('checkout-modal');

    let title = "Ver sacola";
    if (step === 2) title = state.activeTab === 'delivery' ? "Entrega" : "Extras do Pedido";
    if (step === 3) title = "Forma de Pagamento";
    if (step === 4) title = "Confirmar Pedido";

    document.getElementById('checkout-step-title').innerText = title;

    const isLast = step === 4;
    document.getElementById('next-step-btn').classList.toggle('hidden', isLast);
    document.getElementById('place-order-btn').classList.toggle('hidden', !isLast);

    if (step === 1) renderStep1();
    if (step === 2) renderStep2();
    if (step === 3) renderStep3();
    if (step === 4) {
        updateStep4Summary();
    }
}

// Persist/restore checkout progress so the user can resume where they left off
function saveCheckoutState() {
    const payload = {
        step: state.currentStep,
        activeTab: state.activeTab,
        deliveryType: state.deliveryType,
        paymentMethod: state.paymentMethod,
        deliveryFee: state.deliveryFee || 0,
        orderSchedule: state.orderSchedule || null,
        orderDetailsInfo: state.orderDetailsInfo || '',
        expires: Date.now() + (24 * 60 * 60 * 1000)
    };
    try {
        localStorage.setItem('menzzu_checkout', JSON.stringify(payload));
    } catch (e) { }
}

function restoreCheckoutState() {
    let saved;
    try {
        saved = JSON.parse(localStorage.getItem('menzzu_checkout') || 'null');
    } catch (e) {
        saved = null;
    }
    if (!saved || (saved.expires && saved.expires < Date.now())) {
        localStorage.removeItem('menzzu_checkout');
        return;
    }
    // Only restore if the saved progress matches the cart the user is currently looking at
    if (saved.activeTab && saved.activeTab !== state.activeTab) return;
    if (saved.deliveryType) {
        const allowedMethods = getEnabledFulfillmentMethods();
        state.deliveryType = allowedMethods.includes(saved.deliveryType) ? saved.deliveryType : getDefaultFulfillmentMethod();
    }
    if (saved.paymentMethod) state.paymentMethod = saved.paymentMethod;
    if (typeof saved.deliveryFee === 'number') state.deliveryFee = saved.deliveryFee;
    if (saved.orderSchedule && typeof saved.orderSchedule === 'object') {
        state.orderSchedule = {
            date: saved.orderSchedule.date || '',
            time: saved.orderSchedule.time || ''
        };
    }
    if (saved.orderDetailsInfo) {
        state.orderDetailsInfo = saved.orderDetailsInfo;
    }
}

// Returns the step the user should land on when reopening the cart:
// the first step with missing data, or the previously saved step if everything is filled.
function getResumeStep() {
    if (getActiveCart().length === 0) return 1;

    let saved;
    try {
        saved = JSON.parse(localStorage.getItem('menzzu_checkout') || 'null');
    } catch (e) {
        saved = null;
    }
    // Saved step only counts if the user is on the same tab they were checking out from
    const sameTab = saved && saved.activeTab === state.activeTab;
    const savedStep = sameTab && saved.step ? parseInt(saved.step) : 1;

    // Step 2 requires name + valid phone (from step 1 form)
    const phone = state.userInfo.phone || '';
    if (!state.userInfo.name || !phone || phone.length < 14) return 1;

    // Step 3 requires step 2 data: address + delivery fee for delivery; schedule + extras for order
    if (state.activeTab === 'delivery') {
        if (state.deliveryType === 'delivery') {
            if (!state.userInfo.address) return 2;
            if (!state.deliveryFee) return 2;
        }
    } else {
        if (!state.orderSchedule?.date || !state.orderSchedule?.time) return 1;
        if (hasCheckoutExtras() && savedStep < 3) return 2;
    }

    // Step 4 requires payment method (defaults to 'mercadopago', but guard anyway)
    if (!state.paymentMethod) return 3;

    // All data present: respect where the user actually was, capped between 1 and 4
    return Math.max(1, Math.min(4, savedStep));
}

document.getElementById('checkout-back-btn')?.addEventListener('click', () => {
    if (state.currentStep > 1) {
        const previousStep = (state.activeTab === 'order' && !hasCheckoutExtras() && state.currentStep === 3) ? 1 : state.currentStep - 1;
        goToStep(previousStep);
    } else closeWithAnimation('checkout-modal');
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
                            <div>
                                <strong>${item.name}</strong>
                                ${item.variation ? `<p style="font-size: 0.75rem; color: var(--text-gray);">${item.variation}</p>` : ''}
                                ${getCustomFieldSummaryParts(item).map(({ key, value, isUrl }) => '<p style="font-size:0.7rem;color:var(--text-gray);margin-top:2px;"><b>' + key + ':</b> ' + (isUrl ? '<a href="' + value + '" target="_blank" style="color:var(--primary-color);">Ver Imagem</a>' : String(value)) + '</p>').join('')}
                                ${item.addons ? (() => { try { const ads = JSON.parse(item.addons); return ads.map(a => '<p style="font-size:0.7rem;color:var(--text-gray);margin-top:2px;">- ' + a.name + (a.price > 0 ? ' (R$ ' + parseFloat(a.price).toFixed(2) + ')' : '') + '</p>').join(''); } catch (e) { return ''; } })() : ''}
                            </div>
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

function selectPaymentMethod(method) {
    state.paymentMethod = method;
    document.querySelectorAll('.payment-card').forEach(el => {
        const isSelected = el.dataset.method === method;
        el.classList.toggle('selected', isSelected);
        el.style.borderColor = isSelected ? 'var(--primary-color)' : '#e5e7eb';
        el.style.backgroundColor = isSelected ? 'var(--primary-color)05' : '#fff';
        const checkIcon = el.querySelector('.payment-check-icon');
        if (checkIcon) checkIcon.style.color = isSelected ? 'var(--primary-color)' : '#ccc';
    });
}

function renderStep3() {
    const opts = document.getElementById('payment-options');
    if (!opts) return;

    const isCashAllowed = ['pickup', 'local'].includes(state.deliveryType) || state.allowCash;

    // fallback dinamico:
    if (!isCashAllowed && state.paymentMethod === 'dinheiro') {
        state.paymentMethod = 'mercadopago';
    }

    let html = `
                                            <div class="payment-card" data-method="mercadopago" onclick="selectPaymentMethod('mercadopago')" style="display:flex; align-items:center; border:2px solid #e5e7eb; border-radius:12px; padding:12px; cursor:pointer; transition:0.2s;">
                                                <div class="payment-icon" style="background:#e0f2fe; color:#0284c7; width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center; margin-right:12px;">
                                                    <i data-lucide="credit-card"></i>
                                                </div>
                                                <div class="payment-info" style="flex:1;">
                                                    <h4 style="margin:0; font-size:1rem;">Pix ou Crédito</h4>
                                                    <p style="margin:0; font-size:0.8rem; color:#6b7280;">Pagamento online 100% seguro via Mercado Pago.</p>
                                                </div>
                                                <div class="payment-check-icon" style="color:#ccc;">
                                                    <i data-lucide="check-circle-2"></i>
                                                </div>
                                            </div>
                                        `;

    if (isCashAllowed) {
        html += `
                                                <div class="payment-card" data-method="dinheiro" onclick="selectPaymentMethod('dinheiro')" style="display:flex; align-items:center; border:2px solid #e5e7eb; border-radius:12px; padding:12px; cursor:pointer; transition:0.2s;">
                                                    <div class="payment-icon" style="background:#fef3c7; color:#d97706; width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center; margin-right:12px;">
                                                        <i data-lucide="banknote"></i>
                                                    </div>
                                                    <div class="payment-info" style="flex:1;">
                                                        <h4 style="margin:0; font-size:1rem;">Dinheiro</h4>
                                                        <p style="margin:0; font-size:0.8rem; color:#6b7280;">Pagamento na entrega ou retirada.</p>
                                                    </div>
                                                    <div class="payment-check-icon" style="color:#ccc;">
                                                        <i data-lucide="check-circle-2"></i>
                                                    </div>
                                                </div>
                                            `;
    } else {
        html += `
                                                <div class="payment-card disabled" style="display:flex; align-items:center; border:2px solid #e5e7eb; border-radius:12px; padding:12px; opacity:0.6; background:#f9fafb;">
                                                    <div class="payment-icon" style="background:#f3f4f6; color:#9ca3af; width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center; margin-right:12px;">
                                                        <i data-lucide="banknote"></i>
                                                    </div>
                                                    <div class="payment-info" style="flex:1;">
                                                        <h4 style="margin:0; font-size:1rem; color:#9ca3af;">Dinheiro</h4>
                                                        <p style="margin:0; font-size:0.8rem; color:#ef4444; font-weight:600;">⚠️ Não disponível para este endereço de entrega.</p>
                                                    </div>
                                                </div>
                                            `;
    }
    opts.innerHTML = html;
    lucide.createIcons();
    selectPaymentMethod(state.paymentMethod);
}

function renderStep2() {
    const isDelivery = state.activeTab === 'delivery';
    const enabledMethods = getEnabledFulfillmentMethods();

    // Hide delivery toggle entirely for orders
    const typeTabs = document.getElementById('checkout-type-tabs');
    if (typeTabs) {
        const methodButtons = Array.from(typeTabs.querySelectorAll('.type-tab[data-method]'));
        const visibleButtons = methodButtons.filter(btn => isFulfillmentMethodEnabled(btn.dataset.method));
        typeTabs.style.display = isDelivery && visibleButtons.length ? 'flex' : 'none';
        methodButtons.forEach(btn => {
            const method = btn.dataset.method;
            const enabled = isFulfillmentMethodEnabled(method);
            btn.style.display = enabled ? 'flex' : 'none';
            btn.style.flex = visibleButtons.length <= 1 ? '1 1 100%' : '1';
        });
    }

    if (!enabledMethods.includes(state.deliveryType)) {
        setDeliveryType(getDefaultFulfillmentMethod());
    } else {
        setDeliveryType(state.deliveryType);
    }

    const deliveryContent = document.getElementById('delivery-step-content');
    const orderContent = document.getElementById('order-step-content');
    if (deliveryContent) deliveryContent.classList.toggle('hidden', !isDelivery);
    if (orderContent) {
        if (isDelivery) {
            orderContent.classList.add('hidden');
            orderContent.innerHTML = '';
        } else {
            const hasExtras = hasCheckoutExtras();
            if (hasExtras) {
                orderContent.classList.remove('hidden');
                orderContent.innerHTML = `
                                <div id="order-extra-step-content"></div>
                            `;
                renderCheckoutExtraStep();
            } else {
                orderContent.classList.add('hidden');
                orderContent.innerHTML = '';
            }
        }
    }

    // Sempre carrega o mapa se deliveryType = delivery
    if (state.deliveryType === 'delivery') {
        if (window.google && !state.googleMap) {
            initMapsAutocomplete();
            initDeliveryMap();
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

function setDeliveryType(type) {
    const allowedMethods = getEnabledFulfillmentMethods();
    if (!allowedMethods.includes(type)) {
        type = allowedMethods[0] || 'delivery';
    }

    state.deliveryType = type;
    const btns = document.querySelectorAll('#checkout-type-tabs .type-tab[data-method]');
    const labels = {
        delivery: 'Entrega',
        pickup: 'Retirada na Loja',
        local: 'Consumo no Local'
    };

    btns.forEach(btn => {
        const method = btn.dataset.method;
        const isActive = method === type;
        btn.classList.toggle('active', isActive);
        btn.style.background = isActive ? '#fff' : 'var(--bg-gray)';
        btn.style.color = isActive ? 'var(--primary-color)' : 'var(--text-main)';
        btn.style.border = isActive ? '2px solid var(--primary-color)' : '1px solid var(--border-color)';
        btn.style.fontWeight = isActive ? '700' : '500';
        btn.innerHTML = isActive
            ? `<i data-lucide="check-circle-2" style="margin-right:6px; display:inline-block; vertical-align:middle; width:18px; height:18px;"></i> ${labels[method] || method}`
            : (labels[method] || method);
    });

    lucide.createIcons();

    const addressSection = document.getElementById('delivery-address-section');
    if (addressSection) addressSection.classList.toggle('hidden', type !== 'delivery');

    if (type === 'delivery') {
        if (state.userInfo.address) {
            calculateDeliveryFee(state.userInfo.address);
        } else {
            state.deliveryFee = 0;
            updateStep4Summary();
        }
    } else {
        state.deliveryFee = 0;
        updateStep4Summary();
    }
}

async function handleNextStep() {
    if (state.currentStep === 1) {
        const nameVal = document.getElementById('user-name')?.value;
        const phoneVal = document.getElementById('user-phone')?.value;
        if (!nameVal || !phoneVal || phoneVal.length < 14) return showAlert('Ops!', 'Preencha seu nome e um WhatsApp válido.');
        state.userInfo.name = nameVal;
        state.userInfo.phone = phoneVal;
        saveCheckoutState();
        if (state.activeTab === 'delivery' && !state.isOpen) {
            return showAlert('Loja Fechada', isOrderEnabled() ?
                'Estamos fechados para pronta entrega no momento. Por favor, utilize a aba de Encomendas para agendar seu pedido.' :
                'Estamos fechados para pronta entrega no momento.');
        }
        if (state.activeTab === 'order') {
            if (!state.orderSchedule?.date || !state.orderSchedule?.time) {
                openScheduleModal('resume');
                return;
            }
            goToStep(hasCheckoutExtras() ? 2 : 3);
            return;
        }
        goToStep(2);
    } else if (state.currentStep === 2) {
        if (state.activeTab === 'delivery') {
            if (state.deliveryType === 'delivery' && !state.userInfo.address) return showAlert('Endereço Ausente', 'Por favor, selecione seu endereço no mapa.');
            if (state.deliveryFee === 0 && state.deliveryType === 'delivery' && state.userInfo.address) {
                return showAlert('Taxa Indisponível', 'Por favor, aguarde o cálculo da taxa de entrega ou verifique se o endereço está no raio de entrega.');
            }
        } else if (state.activeTab === 'order') {
            if (!isOrderEnabled()) return showAlert('Encomendas desativadas', 'No momento não estamos aceitando encomendas.');
            if (hasCheckoutExtras()) {
                const extrasResult = collectCheckoutExtraStep();
                if (!extrasResult.ok) {
                    return showAlert('Atenção', extrasResult.message || 'Preencha os campos extras antes de continuar.');
                }
            }
            goToStep(3);
            return;
        }
        goToStep(3);
    } else if (state.currentStep === 3) {
        if (!state.paymentMethod) return showAlert('Atenção', 'Selecione uma forma de pagamento.');
        goToStep(4);
    }
}

function updateStep4Summary() {
    const cart = getActiveCart();
    const subtotal = cart.reduce((acc, i) => acc + (i.price * i.quantity), 0);
    const fee = state.deliveryType === 'delivery' ? state.deliveryFee : 0;
    const total = subtotal + fee;

    const subEl = document.getElementById('summary-subtotal');
    const feeEl = document.getElementById('summary-fee');
    const totalEl = document.getElementById('summary-total');
    const lineEl = document.getElementById('delivery-fee-line');
    const listEl = document.getElementById('review-items-list');
    const paymentSummaryEl = document.getElementById('payment-method-summary');
    const scheduleReviewEl = document.getElementById('order-schedule-review');
    const scheduleReviewValueEl = document.getElementById('order-schedule-review-value');

    if (paymentSummaryEl) {
        if (state.paymentMethod === 'dinheiro') {
            paymentSummaryEl.innerHTML = '<i data-lucide="banknote" style="vertical-align: middle; margin-right: 5px;"></i> Pagamento em Dinheiro';
            paymentSummaryEl.style.background = '#fef3c7';
            paymentSummaryEl.style.color = '#d97706';
        } else {
            paymentSummaryEl.innerHTML = '<i data-lucide="credit-card" style="vertical-align: middle; margin-right: 5px;"></i> Pix ou Crédito (Online)';
            paymentSummaryEl.style.background = '#f0fdf4';
            paymentSummaryEl.style.color = '#166534';
        }
        lucide.createIcons();
    }

    if (scheduleReviewEl && scheduleReviewValueEl) {
        const showSchedule = state.activeTab === 'order' && !!state.orderSchedule?.date && !!state.orderSchedule?.time;
        scheduleReviewEl.classList.toggle('hidden', !showSchedule);
        scheduleReviewValueEl.innerText = showSchedule ? formatOrderSchedule() : 'Nenhum horário selecionado.';
    }

    if (subEl) subEl.innerText = `R$ ${subtotal.toFixed(2)}`;
    if (feeEl) feeEl.innerText = `R$ ${fee.toFixed(2)}`;
    if (totalEl) totalEl.innerText = `R$ ${total.toFixed(2)}`;
    if (lineEl) lineEl.classList.toggle('hidden', state.deliveryType !== 'delivery');

    if (listEl) {
        listEl.innerHTML = cart.map(item => `
                        <div style="margin-bottom: 8px;">
                            <p style="font-size: 0.9rem; margin-bottom: 0;">${item.quantity}x ${item.name} ${item.variation ? `(${item.variation})` : ''}</p>
                            ${getCustomFieldSummaryParts(item).map(({ key, value, isUrl }) => '<p style="font-size:0.75rem;color:var(--text-gray);margin-left:15px;margin-bottom:0;">- ' + key + ': ' + (isUrl ? 'Anexo' : String(value)) + '</p>').join('')}
                            ${item.addons ? (() => { try { const ads = JSON.parse(item.addons); return ads.map(a => '<p style="font-size:0.75rem;color:var(--text-gray);margin-left:15px;margin-bottom:0;">- ' + a.name + '</p>').join(''); } catch (e) { return ''; } })() : ''}
                        </div>
                    `).join('');
    }
}

function addToCart() {
    if (state.activeTab === 'order') {
        const precheck = validateCurrentItemSelections();
        if (!precheck.ok) {
            return showAlert('Atenção', precheck.message);
        }
    }

    if (state.activeTab === 'order' && (!state.orderSchedule?.date || !state.orderSchedule?.time)) {
        openScheduleModal('add');
        return;
    }
    commitAddToCart();
}

function commitAddToCart() {
    const item = state.currentItem;
    if (state.activeTab === 'delivery' && !state.isOpen) {
        return showAlert('Loja Fechada', isOrderEnabled() ?
            'Estamos fechados para pronta entrega no momento. Utilize a aba de Encomendas para agendar!' :
            'Estamos fechados para pronta entrega no momento.');
    }
    const variation = state.currentVariation;
    const variations = JSON.parse(item.variations || '[]').filter(v => !v.hidden);
    if (variations.length > 0 && !variation) return showAlert('Quase lá...', 'Por favor, selecione uma opção para continuar.');

    // Coleta custom fields (texto/imagem)
    let customAnswers = {};
    let missingRequired = false;
    if (state.activeTab !== 'order') {
        try {
            const cfs = JSON.parse(item.customFields || '[]');
            cfs.forEach((cf, i) => {
                const val = document.getElementById(`cf-${i}`)?.value.trim();
                if (cf.required && !val) missingRequired = true;
                if (val) customAnswers[cf.name] = val;
            });
        } catch (e) { }
        if (missingRequired) return showAlert('Atenção', 'Por favor, preencha todos os campos obrigatórios (marcados com *).');
    }

    // Valida grupos de adicionais obrigatórios
    const groupIds = JSON.parse(item.addonGroups || '[]');
    const groups = (state.addonGroups || []).filter(g => groupIds.includes(g.id));
    for (const g of groups) {
        const maxAllowed = Math.max(parseInt(g.max, 10) || 1, 1);
        if (g.min > 0) {
            const checked = document.querySelectorAll(`.addon-input[data-group-id="${g.id}"]:checked`).length;
            if (checked < g.min) {
                return showAlert('Atenção', `Selecione pelo menos ${g.min} opção em "${g.name}".`);
            }
        }
        const checked = document.querySelectorAll(`.addon-input[data-group-id="${g.id}"]:checked`).length;
        if (checked > maxAllowed) {
            return showAlert('Atenção', `O grupo "${g.name}" permite no máximo ${maxAllowed} opção(ões).`);
        }
    }

    // Coleta adicionais selecionados
    const {
        addons,
        addonTotal
    } = getSelectedAddons();
    const addonsJSON = addons.length > 0 ? JSON.stringify(addons) : null;

    const basePrice = parseFloat((variation ? variation.price : item.price) || 0);
    const finalUnitPrice = basePrice + addonTotal;

    const customFieldSchema = getCustomFieldSchema(item);
    const customFieldSchemaJSON = customFieldSchema.length > 0 ? JSON.stringify(customFieldSchema) : null;
    const customAnswersJSON = Object.keys(customAnswers).length > 0 ? JSON.stringify(customAnswers) : null;
    const sigKey = (customAnswersJSON || '') + (addonsJSON || '');
    const itemKeyBase = variation ? `${item.id}-${variation.name}` : item.id;
    const itemKey = sigKey ? `${itemKeyBase}-${btoa(encodeURIComponent(sigKey)).substring(0, 12)}` : itemKeyBase;

    let cart = getActiveCart();
    const existing = cart.find(c => c.itemKey === itemKey);
    if (existing) existing.quantity += state.currentQty;
    else cart.push({
        productId: item.id,
        itemKey,
        name: item.name,
        variation: variation ? variation.name : null,
        price: finalUnitPrice,
        quantity: state.currentQty,
        customFieldSchema: customFieldSchemaJSON,
        customFieldValues: customAnswersJSON,
        addons: addonsJSON
    });
    setActiveCart(cart);

    const suggestedItem = state.orderBumpSelected ? getSuggestedProductForItem(item) : null;
    if (suggestedItem) {
        const bumpKey = `${item.id}--bump--${suggestedItem.id}`;
        const bumpPrice = getEffectiveProductPrice(suggestedItem);
        const existingBump = cart.find(c => c.itemKey === bumpKey);
        if (existingBump) {
            existingBump.quantity += 1;
        } else {
            cart.push({
                productId: suggestedItem.id,
                itemKey: bumpKey,
                name: suggestedItem.name,
                variation: null,
                price: bumpPrice,
                quantity: 1,
                customFieldSchema: null,
                customFieldValues: null,
                addons: null,
                isOrderBump: true
            });
        }
        setActiveCart(cart);
    }

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
            items: [{
                item_id: item.id,
                item_name: item.name,
                price: parseFloat(finalPrice),
                quantity: state.currentQty
            }]
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
    btn.disabled = true;
    btn.innerHTML = 'Processando Pagamento...';

    if (state.activeTab === 'order') {
        if (!state.orderSchedule?.date || !state.orderSchedule?.time) {
            btn.disabled = false;
            btn.innerHTML = 'Fazer pedido';
            return showAlert('Agendamento ausente', 'Escolha a data e o horário da encomenda antes de concluir.');
        }
        const missingExtraItem = cart.find(item => {
            const schema = getCustomFieldSchema(item);
            if (!schema.length) return false;
            const answers = getCustomFieldAnswers(item);
            return schema.some(field => field?.required && !String(answers[field.name] || '').trim());
        });
        if (missingExtraItem) {
            btn.disabled = false;
            btn.innerHTML = 'Fazer pedido';
            showAlert('Campos extras pendentes', `Preencha os campos extras do item "${missingExtraItem.name}" antes de concluir.`);
            goToStep(2);
            return;
        }
    }

    const totalValue = cart.reduce((acc, i) => acc + (i.price * i.quantity), 0) + (state.deliveryType === 'delivery' ? state.deliveryFee : 0);

    const formatItemName = (item) => {
        let base = item.name + (item.variation ? ` (${item.variation})` : '');
        const extras = [];
        if (item.addons) {
            try {
                const ads = JSON.parse(item.addons);
                ads.forEach(a => extras.push(a.name));
            } catch (e) { }
        }
        getCustomFieldSummaryParts(item).forEach(({
            key,
            value,
            isUrl
        }) => extras.push(`${key}: ${isUrl ? 'Anexo' : value}`));
        if (extras.length > 0) base += ` [${extras.join(', ')}]`;
        return base;
    };

    const payload = {
        clientName: state.userInfo.name,
        clientPhone: state.userInfo.phone,
        productId: cart[0].productId,
        product: formatItemName(cart[0]),
        variation: cart[0].variation,
        quantity: cart[0].quantity,
        type: state.activeTab,
        deliveryAddress: state.deliveryType === 'delivery'
            ? state.userInfo.address
            : (state.deliveryType === 'local' ? 'Consumo no Local' : 'Retirada na Loja'),
        scheduledDate: state.activeTab === 'order' ? state.orderSchedule?.date || null : null,
        scheduledTime: state.activeTab === 'order' ? state.orderSchedule?.time || null : null,
        deliveryFee: state.deliveryType === 'delivery' ? state.deliveryFee : 0,
        paymentMethod: state.paymentMethod,
        totalValue: totalValue,
        carrinho_itens_extras: cart.slice(1).map(item => ({
            productId: item.productId,
            name: formatItemName(item),
            price: item.price,
            quantity: item.quantity
        }))
    };

    try {
        const response = await fetch(`${API_BASE}/orders`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ...payload,
                slug: STORE_SLUG
            })
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
                    items: cart.map(i => ({
                        item_id: i.productId,
                        item_name: i.name,
                        price: i.price,
                        quantity: i.quantity
                    }))
                });
            }

            setActiveCart([]);
            location.href = data.paymentLink;
        } else if (data.id) {
            if (state.paymentMethod === 'dinheiro') {
                Swal.fire({
                    title: 'Pedido Recebido!',
                    text: 'Seu pedido foi registrado e está aguardando confirmação.',
                    icon: 'success',
                    confirmButtonColor: getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim() || '#82F026',
                    confirmButtonText: 'Ver meus pedidos'
                }).then(() => {
                    setActiveCart([]);
                    openModal('history-modal');
                    fetchPreviousOrders();
                    location.reload();
                });
            } else {
                alert('Pedido registrado, mas houve um problema ao gerar o link de pagamento. Por favor, entre em contato.');
            }
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
        const res = await fetch(`${API_BASE}/orders/history/public/${STORE_SLUG}/${phone}`);
        const data = await res.json();
        state.previousOrders = Array.isArray(data) ? data : [];
        renderPreviousOrders();
    } catch (e) {
        console.error(e);
        state.previousOrders = [];
        renderPreviousOrders();
    }
}

function getStarSvg(filled = true) {
    return `
                    <svg class="rating-star-icon ${filled ? 'filled' : 'outline'}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9L12 2.5z" fill="${filled ? 'currentColor' : 'none'}" stroke="${filled ? 'none' : 'currentColor'}" stroke-width="1.8"></path>
                    </svg>
                `;
}

function updateStoreRatingBadge() {
    const badge = document.getElementById('store-rating-badge');
    if (!badge) return;

    const summary = state.storeReviewSummary || {};
    const orderCount = Number(summary.orderCount || 0);
    if (orderCount < 1) {
        badge.hidden = true;
        badge.innerHTML = '';
        return;
    }

    const average = summary.averageRating !== null && summary.averageRating !== undefined ?
        Number(summary.averageRating) :
        5;
    const count = Number(summary.reviewCount || 0);

    badge.hidden = false;
    badge.className = 'rating-badge has-rating';

    if (Number.isFinite(average)) {
        const avgText = average.toFixed(1).replace('.', ',');
        badge.innerHTML = `${getStarSvg(true)}<span class="rating-value">${avgText}</span>${count > 0 ? `<span class="rating-count">(${count})</span>` : ''}`;
    } else {
        badge.innerHTML = `${getStarSvg(true)}<span class="rating-value">5,0</span>`;
    }
}

function renderReviewStars() {
    const stars = document.getElementById('review-stars');
    if (!stars) return;

    stars.innerHTML = [1, 2, 3, 4, 5].map((rating) => `
                    <button type="button" class="review-star-btn ${state.reviewModalRating >= rating ? 'active' : ''}" aria-label="Nota ${rating}" onclick="setReviewRating(${rating})">
                        ${getStarSvg(state.reviewModalRating >= rating)}
                    </button>
                `).join('');
}

function openReviewModal(orderId) {
    const order = state.previousOrders.find(o => o.id === orderId);
    if (!order) {
        return showAlert('Avaliação', 'Não foi possível localizar este pedido.', 'error');
    }

    state.reviewModalOrderId = orderId;
    state.reviewModalRating = 0;

    const target = document.getElementById('review-target');
    if (target) {
        const variationText = order.variation ? ` (${order.variation})` : '';
        target.innerText = `Avaliando: ${order.product}${variationText}`;
    }

    const comment = document.getElementById('review-comment');
    if (comment) comment.value = '';

    renderReviewStars();
    lockBodyScroll();
    const modal = document.getElementById('review-modal');
    if (modal) modal.classList.remove('hidden', 'closing');
}

function setReviewRating(rating) {
    state.reviewModalRating = rating;
    renderReviewStars();
}

async function submitStoreReview() {
    if (!state.reviewModalOrderId) {
        return showAlert('Avaliação', 'Selecione um pedido válido.', 'error');
    }
    if (!state.reviewModalRating) {
        return showAlert('Avaliação', 'Escolha uma nota para continuar.', 'error');
    }

    const btn = document.getElementById('submit-review-btn');
    const commentEl = document.getElementById('review-comment');
    const comment = commentEl ? commentEl.value.trim() : '';

    if (btn) {
        btn.disabled = true;
        btn.innerText = 'Enviando...';
    }

    try {
        const order = state.previousOrders.find(o => o.id === state.reviewModalOrderId);
        const response = await fetch(`${API_BASE}/reviews/public/${STORE_SLUG}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                orderId: state.reviewModalOrderId,
                rating: state.reviewModalRating,
                comment,
                clientName: state.userInfo.name || order?.clientName || '',
                clientPhone: state.userInfo.phone || ''
            })
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data?.error || 'Não foi possível enviar sua avaliação.');
        }

        if (data.summary) {
            state.storeReviewSummary = data.summary;
        }
        updateStoreRatingBadge();
        closeWithAnimation('review-modal');
        await fetchPreviousOrders();
        showAlert('Obrigado!', 'Sua avaliação foi enviada com sucesso.', 'success');
    } catch (err) {
        showAlert('Erro', err.message || 'Não foi possível enviar a avaliação.', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = 'Enviar avaliação';
        }
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
                            ${o.reviewed ? '<span class="history-reviewed-badge">Avaliado</span>' : (o.canReview ? `<button type="button" class="history-review-btn" onclick="event.stopPropagation(); openReviewModal('${o.id}')">Avaliar</button>` : '')}
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
        state.currentVariation = order.variation ? {
            name: order.variation,
            price: order.totalPrice / order.quantity
        } : null;
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
    const body = document.body;
    const isOrder = state.activeTab === 'order';
    const useDarkTheme = data.menuTheme === 'dark'
        && !['', '#ffffff'].includes(String(data.backgroundColor || '').toLowerCase());

    const accent = isOrder
        ? (data.accentColorOrders || data.accentColor || (useDarkTheme ? '#a2e403' : '#82F026'))
        : (data.accentColor || (useDarkTheme ? '#a2e403' : '#82F026'));
    const button = isOrder
        ? (data.buttonColorOrders || data.buttonColor || accent)
        : (data.buttonColor || accent);

    if (body) {
        body.classList.toggle('theme-dark', useDarkTheme);
        body.classList.toggle('theme-light', !useDarkTheme);
    }

    root.style.setProperty('--primary-color', accent);
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--btn-bg', button);
    root.style.setProperty('--button-color', button);
    root.style.setProperty('--btn-text', data.buttonTextColor || '#ffffff');
    const themeBg = useDarkTheme ? '#031614' : '#ffffff';
    const themeSurface = useDarkTheme
        ? (data.surfaceColor || '#092b24')
        : `color-mix(in srgb, ${themeBg} 96%, #ffffff 4%)`;
    const themeSoft = useDarkTheme
        ? (data.surfaceSoftColor || '#06231e')
        : `color-mix(in srgb, ${themeBg} 90%, #ffffff 10%)`;
    const themeText = data.textColor || (useDarkTheme ? '#ffffff' : '#031614');
    const themeSecondary = useDarkTheme ? 'rgba(255,255,255,0.72)' : `${themeText}99`;
    const themeBorder = useDarkTheme
        ? `color-mix(in srgb, ${accent} 16%, transparent)`
        : `${themeText}15`;
    root.style.setProperty('--bg-color', themeBg);
    root.style.setProperty('--text-main', themeText);
    root.style.setProperty('--text-secondary', themeSecondary);
    root.style.setProperty('--border', themeBorder);
    root.style.setProperty('--border-color', themeBorder);
    root.style.setProperty('--bg-gray', `${themeText}08`);
    root.style.setProperty('--surface-color', themeSurface);
    root.style.setProperty('--surface-soft', themeSoft);
    root.style.setProperty('--bg-tertiary', themeSoft);
    root.style.setProperty('--text-primary', themeText);
    root.style.setProperty('--text-black', themeText);
    root.style.setProperty('--text-gray', `${themeText}99`);
    root.style.setProperty('--theme-bg-color', themeBg);
    root.style.setProperty('--theme-surface-color', themeSurface);
    root.style.setProperty('--theme-surface-soft', themeSoft);
    root.style.setProperty('--theme-text-main', themeText);
    root.style.setProperty('--theme-text-secondary', themeSecondary);
    root.style.setProperty('--theme-border', themeBorder);
    root.style.setProperty('--theme-border-color', themeBorder);
    root.style.setProperty('--theme-bg-gray', `${themeText}08`);
}

// Inicialização imediata de elementos visuais
renderMenu(); // Mostra o skeleton imediatamente
updateUI();
lucide.createIcons();
