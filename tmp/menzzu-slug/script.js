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
const ACTIVE_TAB_STORAGE_KEY = `menzzu_active_tab:${STORE_SLUG || 'store'}`;

function restoreActiveTab() {
    try {
        const savedTab = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
        if (savedTab === 'delivery' || savedTab === 'order') state.activeTab = savedTab;
    } catch (error) {
        // Browsing still works when storage is unavailable.
    }
}

function persistActiveTab() {
    try {
        localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, state.activeTab);
    } catch (error) {
        // Browsing still works when storage is unavailable.
    }
}

function productSlugName(product) {
    return String(product?.name || 'produto')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'produto';
}

function productSlugBase(product) {
    const name = productSlugName(product);
    if (name.length <= 50) return name;
    const prefix = name.slice(0, 50);
    const boundary = prefix.lastIndexOf('-');
    return boundary > 0 ? prefix.slice(0, boundary) : prefix;
}

function productShareSlug(product) {
    const name = productSlugBase(product);
    const others = (state.products || []).filter(item => String(item.id) !== String(product.id));
    if (!others.some(item => productSlugBase(item) === name)) return name;

    // Use only enough of the ID to distinguish products with the same name.
    const id = String(product.id);
    for (let length = Math.min(6, id.length); length <= id.length; length++) {
        const suffix = id.slice(0, length);
        const candidate = `${name}-${suffix}`;
        const collision = others.some(item => productSlugBase(item) === candidate ||
            (productSlugBase(item) === name && String(item.id).slice(0, length) === suffix));
        if (!collision) return candidate;
    }
    return `${name}-${id}`;
}

function setProductUrl(product) {
    const url = new URL(window.location.href);
    url.searchParams.set('p', productShareSlug(product));
    window.history.replaceState({ productId: product.id }, '', url.toString());
}

function clearProductUrl() {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('p')) return;
    url.searchParams.delete('p');
    window.history.replaceState({}, '', url.toString());
}

function getProductFromUrl() {
    const productSlug = new URLSearchParams(window.location.search).get('p');
    if (!productSlug) return null;
    const products = state.products || [];
    // Previously shared links included the full name and ID.
    return products.find(product => `${productSlugName(product)}-${product.id}` === productSlug) ||
        products.find(product => productShareSlug(product) === productSlug) || null;
}


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
    currentSubItem: null,
    suggestedSelection: null,
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
        acceptSameDayOrders: false,
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
    cashChangeFor: null,
    allowCash: true,
    withinDeliveryRadius: false,
    withinDeliveryRadius: false,
    availableSlots: [],
    deliverySlots: [],
    orderSlots: [],
    addonGroups: [],
    orderAvailabilityRequestId: 0,
    orderAvailability: null,
    orderSchedule: null,
    couponCode: '',
    couponQuote: null,
    scheduleModalContext: null,
    bodyScrollY: 0,
    isBodyScrollLocked: false,
    currentCarouselIdx: 0,
    previousOrders: [],
    orderDetailsInfo: '',
    reviewModalOrderId: null,
    reviewModalRating: 0,
    trackedOrderId: null,
    orderStatusRefreshTimer: null,
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
    const price = promoPrice > 0 && promoPrice < basePrice ? promoPrice : basePrice;
    return Math.max(0, price);
}

function getResolvedProductPrice(product, ...fallbackProducts) {
    for (const candidate of [product, ...fallbackProducts]) {
        const price = getEffectiveProductPrice(candidate);
        if (price > 0) return price;
    }
    return 0;
}

function isStockTrackingEnabled(product) {
    return product?.trackStock === true || product?.trackStock === 1 || product?.trackStock === 'true';
}

function hasAvailableVariationStock(product, variation) {
    if (!isStockTrackingEnabled(product)) return true;
    const subItems = (Array.isArray(variation?.subItems) ? variation.subItems : []).filter(item => !item?.hidden);
    return subItems.length > 0
        ? subItems.some(item => Number(item?.stock) > 0)
        : Number(variation?.stock) > 0;
}

function hasAvailableProductStock(product, variations = null) {
    if (!isStockTrackingEnabled(product)) return true;
    const availableVariations = variations || JSON.parse(product?.variations || '[]').filter(variation => !variation?.hidden);
    if (availableVariations.length > 0) {
        return availableVariations.some(variation => hasAvailableVariationStock(product, variation));
    }
    return Number(product?.stock) > 0;
}

function getVariationPrice(variation) {
    const directPrice = getEffectiveProductPrice(variation);
    if (directPrice > 0 && !(Array.isArray(variation?.subItems) && variation.subItems.length > 0)) return directPrice;

    const subItemPrices = (Array.isArray(variation?.subItems) ? variation.subItems : [])
        .filter(subItem => !subItem?.hidden)
        .map(subItem => getResolvedProductPrice(subItem, variation))
        .filter(price => Number.isFinite(price) && price > 0);

    return subItemPrices.length > 0 ? Math.min(...subItemPrices) : 0;
}

function formatDisplayPrice(price, prefix = 'R$') {
    return price > 0 ? `${prefix} ${price.toFixed(2).replace('.', ',')}` : 'Preço não informado';
}

function formatPriceDifference(price, referencePrice) {
    const difference = Number(price || 0) - Number(referencePrice || 0);
    if (Math.abs(difference) < 0.005) return '';
    return `${difference > 0 ? '+' : '-'} ${formatDisplayPrice(Math.abs(difference))}`;
}

function getSelectedItemPrice(item = state.currentItem) {
    const variation = state.currentVariation;
    if (!variation) {
        const variations = JSON.parse(item?.variations || '[]').filter(candidate => !candidate.hidden);
        if (variations.length > 0) {
            const prices = variations.map(candidate => getVariationPrice(candidate)).filter(price => price > 0);
            return prices.length > 0 ? Math.min(...prices) : 0;
        }
        return getEffectiveProductPrice(item);
    }

    if (state.currentSubItem) {
        return getResolvedProductPrice(state.currentSubItem, variation);
    }
    return getVariationPrice(variation);
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
            .map(variation => getVariationPrice(variation))
            .filter(price => Number.isFinite(price) && price > 0);
        const fromPrice = effectiveVariationPrices.length > 0 ? Math.min(...effectiveVariationPrices) : basePrice;
        const hasDifferentVariationPrices = effectiveVariationPrices.some(price => Math.abs(price - fromPrice) >= 0.005);
        if (fromPrice <= 0) return 'Preço não informado';
        return hasDifferentVariationPrices
            ? `A partir de ${formatDisplayPrice(fromPrice)}`
            : formatDisplayPrice(fromPrice);
    }

    if (hasPaidAddonsForProduct(product)) {
        return basePrice > 0 ? `A partir de ${formatDisplayPrice(basePrice)}` : 'Preço não informado';
    }

    const price = parseFloat(product?.price || 0) || 0;
    const promoPrice = parseFloat(product?.promoPrice || 0) || 0;
    if (promoPrice > 0 && promoPrice < price) {
        return `de ${formatDisplayPrice(price)} por ${formatDisplayPrice(basePrice)}`;
    }
    return formatDisplayPrice(basePrice);
}

function getSuggestedProductForItem(item) {
    if (!item?.suggestedItemId) return null;
    const suggestedId = String(item.suggestedItemId || '');
    if (!suggestedId) return null;
    if (String(item.id || '') === suggestedId) return null;
    const suggestedItem = (state.products || []).find(product => String(product.id) === suggestedId);
    if (!suggestedItem || suggestedItem.active === false || !hasAvailableProductStock(suggestedItem)) return null;
    return suggestedItem;
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

function areOrdersPaused() {
    return state.publicSettings.acceptOrders === false;
}

function isOrderTabVisible() {
    const options = getMenuDeliveryOptions();
    return options.orderTypes.order !== false;
}

function isOrderEnabled() {
    return !areOrdersPaused() && isOrderTabVisible();
}

function isDeliveryTabVisible() {
    return getMenuDeliveryOptions().orderTypes.delivery !== false;
}

function isDeliveryTabEnabled() {
    return !areOrdersPaused() && isDeliveryTabVisible();
}

function showOrdersPausedAlert() {
    return showAlert('Pedidos pausados', 'A loja está fechada para novos pedidos no momento. Você pode continuar consultando o cardápio.');
}

function getMenuDeliveryOptions() {
    const parsed = parseJsonValue(state.publicSettings.dailyDeliveryItems || {}, {});
    const orderTypes = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.orderTypes && typeof parsed.orderTypes === 'object'
        ? parsed.orderTypes
        : {};
    const fulfillmentMethods = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.fulfillmentMethods && typeof parsed.fulfillmentMethods === 'object'
        ? parsed.fulfillmentMethods
        : {};
    const orderFulfillmentMethods = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.orderFulfillmentMethods && typeof parsed.orderFulfillmentMethods === 'object'
        ? parsed.orderFulfillmentMethods
        : { delivery: false, pickup: true, local: false };

    return {
        orderTypes: {
            delivery: orderTypes.delivery !== false,
            order: orderTypes.order !== false
        },
        fulfillmentMethods: {
            delivery: fulfillmentMethods.delivery !== false,
            pickup: fulfillmentMethods.pickup !== false,
            local: fulfillmentMethods.local !== false
        },
        orderFulfillmentMethods: {
            delivery: orderFulfillmentMethods.delivery === true,
            pickup: orderFulfillmentMethods.pickup !== false,
            local: orderFulfillmentMethods.local === true
        },
        includeDeliveryItemsInOrders: parsed?.includeDeliveryItemsInOrders === true
    };
}

function isOrderDeliveryEnabled() {
    return getMenuDeliveryOptions().includeDeliveryItemsInOrders === true;
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
    const product = state.products.find((entry) => String(entry?.id) === String(item?.productId || item?.id));
    const candidates = [
        item?.customFieldSchema,
        item?.customFieldsSchema,
        item?.customFields,
        product?.customFieldSchema,
        product?.customFieldsSchema,
        product?.customFields
    ];
    for (const candidate of candidates) {
        const parsed = parseJsonValue(candidate, []);
        if (Array.isArray(parsed) && parsed.filter(Boolean).length > 0) return parsed.filter(Boolean);
    }
    return [];
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
    const modal = document.getElementById('order-schedule-modal');
    if (!modal) return;
    const dateInput = document.getElementById('schedule-date');
    const timeSelect = document.getElementById('schedule-time');
    const note = document.getElementById('schedule-availability-note');
    const couponInput = document.getElementById('schedule-coupon');
    const earliestDate = getEarliestOrderDate();
    if (couponInput) couponInput.value = state.couponCode || '';
    if (dateInput) {
        dateInput.min = earliestDate;
        dateInput.value = state.orderSchedule?.date >= earliestDate
            ? state.orderSchedule.date
            : earliestDate;
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
    } else if (state.currentStep === 2 && state.activeTab === 'order') {
        goToStep(hasCheckoutExtras() ? 3 : 4);
    } else if (state.currentStep >= 2 && state.activeTab === 'order') {
        renderReceivingStep();
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

function getBrazilDateAfterDays(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return getBrazilDateString(date);
}

function getEarliestOrderDate() {
    return state.publicSettings.acceptSameDayOrders === true
        ? getBrazilDateString()
        : getBrazilDateAfterDays(1);
}

function setOrderDateConstraints() {
    const dateInput = document.getElementById('schedule-date');
    if (!dateInput) return;

    const earliestDate = getEarliestOrderDate();
    dateInput.min = earliestDate;
    if (dateInput.value && dateInput.value < earliestDate) {
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

    const earliestDate = getEarliestOrderDate();
    const cleanDate = (dateStr || '').trim();
    const previousValue = timeSelect.value;

    if (!cleanDate) {
        state.orderAvailability = null;
        timeSelect.disabled = true;
        timeSelect.innerHTML = `<option value="">Selecione uma data primeiro</option>`;
        if (noteEl) noteEl.innerText = '';
        return null;
    }

    if (cleanDate < earliestDate) {
        if (dateInput) dateInput.value = '';
        const reason = cleanDate < getBrazilDateString()
            ? 'Data anterior a hoje.'
            : 'Encomendas para o mesmo dia ficam disponíveis a partir de amanhã.';
        state.orderAvailability = {
            available: false,
            reason,
            date: cleanDate,
            times: []
        };
        timeSelect.disabled = true;
        timeSelect.innerHTML = `<option value="">Escolha uma data válida</option>`;
        if (noteEl) noteEl.innerText = state.orderAvailability.reason;
        return state.orderAvailability;
    }

    const requestId = ++state.orderAvailabilityRequestId;
    timeSelect.disabled = true;
    timeSelect.innerHTML = `<option value="">Carregando horários...</option>`;

    try {
        const couponQuery = state.couponCode ? `&couponCode=${encodeURIComponent(state.couponCode)}` : '';
        const response = await fetch(`${API_BASE}/orders/availability?slug=${encodeURIComponent(STORE_SLUG)}&date=${encodeURIComponent(cleanDate)}&type=order${couponQuery}`);
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
            timeSelect.disabled = availableTimes.length === 0;
            if (noteEl) noteEl.innerText = data.reason || (availableTimes.length > 0
                ? `${data.used ?? 0} de ${data.limit ?? '?'} encomendas ocupadas. ${data.remaining ?? 0} disponíveis.`
                : 'Nenhum horário disponível');
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

function clearCompletedCheckout() {
    setActiveCart([]);
    state.couponCode = '';
    state.couponQuote = null;
    state.cashChangeFor = null;
    saveCheckoutState();
    updateUI();
    closeWithAnimation('checkout-modal');
}

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
    restoreActiveTab();
    const marketplaceBackButton = document.getElementById('marketplace-back-btn');
    let enteredFromMarketplace = false;
    try {
        const rawEntry = localStorage.getItem('menzzu_marketplace_store_entry') || '';
        const entry = JSON.parse(rawEntry);
        const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
        const referrer = document.referrer ? new URL(document.referrer) : null;
        const sameSiteReferrer = referrer
            && referrer.origin === window.location.origin
            && (referrer.pathname.replace(/\/+$/, '') || '/') !== currentPath;
        const validMarker = entry
            && entry.timestamp > 0
            && Date.now() - Number(entry.timestamp) < 30000
            && String(entry.path || '') === currentPath;
        enteredFromMarketplace = Boolean(validMarker || sameSiteReferrer);
        localStorage.removeItem('menzzu_marketplace_store_entry');
    } catch (error) {
        // ignore
    }

    if (marketplaceBackButton && enteredFromMarketplace) {
        marketplaceBackButton.hidden = false;
        marketplaceBackButton.addEventListener('click', () => {
            if (window.history.length > 1) {
                window.history.back();
                return;
            }
            window.location.href = 'https://menzzu.com/';
        });
    }

    // Carrega o cardápio (o servidor já garantiu que temos um slug válido aqui)
    loadCart();
    lucide.createIcons();

    // Em vez de fazer um fetch pesado, o PHP já injetou tudo em window.__SSR__
    setTimeout(() => {
        hydrateFromSSR();
        initEventListeners();
        updateUI();
        const linkedProduct = getProductFromUrl();
        if (linkedProduct) openItemDetail(linkedProduct.id, { updateUrl: false });
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
        state.deliverySlots = data.deliverySlots || data.availableSlots || [];
        state.orderSlots = data.orderSlots || data.availableSlots || [];
        state.availableSlots = state.deliverySlots;
        state.addonGroups = data.addonGroups || [];
        state.storeReviewSummary = data.reviewSummary || state.storeReviewSummary || {
            averageRating: 5,
            reviewCount: 0,
            orderCount: 0
        };
        state.storeRecentReviews = data.recentReviews || state.storeRecentReviews || [];
        state.loading = false;

        const deliveryVisible = isDeliveryTabVisible();
        const orderVisible = isOrderTabVisible();
        if (state.activeTab === 'order' && !orderVisible && deliveryVisible) {
            state.activeTab = 'delivery';
            document.body.classList.remove('theme-order');
        } else if (state.activeTab === 'delivery' && !deliveryVisible && orderVisible) {
            state.activeTab = 'order';
            document.body.classList.add('theme-order');
        } else if (!deliveryVisible && !orderVisible) {
            state.activeTab = 'delivery';
            document.body.classList.remove('theme-order');
        }
        persistActiveTab();
        document.querySelectorAll('.cat-tab').forEach(button => {
            button.classList.toggle('active', button.dataset.tab === state.activeTab);
        });
        document.body.classList.toggle('theme-order', state.activeTab === 'order');

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
        && (state.deliverySlots.length > 0 || (isOrderEnabled() && state.orderSlots.length > 0))
        && state.products.some(product => product && product.active !== false && String(product.type || '').toLowerCase() !== 'addon');
    const now = new Date();
    const day = now.getDay();
    const time = now.getHours() * 60 + now.getMinutes();

    const todaySlots = state.deliverySlots.filter(s => s.dayOfWeek === day);
    state.isOpen = todaySlots.some(s => {
        const [sh, sm] = s.startTime.split(':').map(Number);
        const [eh, em] = s.endTime.split(':').map(Number);
        const start = sh * 60 + sm;
        const end = eh * 60 + em;
        return time >= start && time <= end;
    });

    const ordersPaused = state.publicSettings.acceptOrders === false;
    const statusLabel = ordersPaused
        ? 'Fechado agora'
        : (!hasMinimumSetup ? 'Inativo' : state.isOpen ? 'Aberto' : (isOrderEnabled() && state.orderSlots.length > 0 ? 'Apenas encomendas' : 'Fechado'));
    const statusClass = ordersPaused || !hasMinimumSetup || !state.isOpen
        ? 'status-badge closed'
        : 'status-badge open';

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

let postalCodeLookupTimer = null;
let structuredAddressGeocodeTimer = null;

function formatPostalCode(value) {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 8);
    return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

function setAddressLocationStatus(message) {
    const status = document.getElementById('restaurant-location-coordinates');
    if (status) status.textContent = message;
}

async function lookupPostalCode(postalCode) {
    const cepInput = document.getElementById('user-address-cep');
    const streetInput = document.getElementById('user-address');
    const numberInput = document.getElementById('user-address-number');
    const normalizedPostalCode = String(postalCode || '').replace(/\D/g, '');
    if (normalizedPostalCode.length !== 8 || !cepInput || !streetInput) return;

    setAddressLocationStatus('Buscando endereço pelo CEP...');
    try {
        const response = await fetch(`https://viacep.com.br/ws/${normalizedPostalCode}/json/`);
        const data = await response.json();
        if (!response.ok || data?.erro) throw new Error('CEP não encontrado');

        streetInput.value = String(data.logradouro || '').trim();
        streetInput.dataset.locality = [data.bairro, data.localidade].filter(Boolean).join(', ');
        streetInput.dataset.region = String(data.uf || '').trim();
        clearAddressCoordinates();
        if (streetInput.value) {
            setAddressLocationStatus('Endereço preenchido. Informe o número para confirmar no mapa.');
            numberInput?.focus();
        } else {
            setAddressLocationStatus('CEP encontrado. Informe a rua e o número para confirmar no mapa.');
            streetInput.focus();
        }
    } catch (error) {
        setAddressLocationStatus('Não encontramos este CEP. Confira os números ou informe o endereço manualmente.');
    }
}

function scheduleStructuredAddressGeocode() {
    clearTimeout(structuredAddressGeocodeTimer);
    const address = getStructuredAddress();
    if (!address.isComplete) return;
    structuredAddressGeocodeTimer = setTimeout(() => geocodeAddress(address.searchAddress), 450);
}

window.initMapsAutocomplete = () => {
    const input = document.getElementById('user-address');
    const cepInput = document.getElementById('user-address-cep');
    const numberInput = document.getElementById('user-address-number');
    if (!input) return;

    try {
        input.dataset.placeSelected = '0';
        const autocomplete = new google.maps.places.Autocomplete(input, {
            fields: ['address_components', 'formatted_address', 'geometry']
        });
        autocomplete.setComponentRestrictions({
            country: 'br'
        });
        state.geocoder = new google.maps.Geocoder();

        autocomplete.addListener('place_changed', () => {
            const place = autocomplete.getPlace();
            if (!place.geometry) return;
            input.dataset.placeSelected = '1';
            populateAddressFields(place);
            updateLocation(place.geometry.location, place.formatted_address, place);
        });

        [cepInput, input, numberInput].filter(Boolean).forEach((field) => {
            field.addEventListener('input', () => {
                if (field === cepInput) {
                    cepInput.value = formatPostalCode(cepInput.value);
                    clearTimeout(postalCodeLookupTimer);
                    if (cepInput.value.replace(/\D/g, '').length === 8) {
                        postalCodeLookupTimer = setTimeout(() => lookupPostalCode(cepInput.value), 250);
                    }
                }
                clearAddressCoordinates();
                if (field !== cepInput) scheduleStructuredAddressGeocode();
            }, { passive: true });
            field.addEventListener('change', () => {
                if (getStructuredAddress().isComplete) geocodeAddress(getStructuredAddress().searchAddress);
            });
        });

        input.addEventListener('change', () => {
            const address = getStructuredAddress();
            if (!address.isComplete || input.dataset.placeSelected === '1') return;
            setTimeout(() => geocodeAddress(address.searchAddress), 120);
        });

        input.addEventListener('blur', () => {
            const address = getStructuredAddress();
            if (!address.isComplete || input.dataset.placeSelected === '1') return;
            setTimeout(() => geocodeAddress(address.searchAddress), 120);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const address = getStructuredAddress();
                if (address.isComplete) geocodeAddress(address.searchAddress);
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
        const configuredLat = Number(state.publicSettings.businessLat);
        const configuredLng = Number(state.publicSettings.businessLng);
        const mapCenter = Number.isFinite(configuredLat) && Number.isFinite(configuredLng)
            ? { lat: configuredLat, lng: configuredLng }
            : { lat: -2.5307, lng: -44.3068 };
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

function getStructuredAddress() {
    const streetInput = document.getElementById('user-address');
    const numberInput = document.getElementById('user-address-number');
    const cepInput = document.getElementById('user-address-cep');
    const complementInput = document.getElementById('user-address-complement');
    const street = String(streetInput?.value || '').trim();
    const number = String(numberInput?.value || '').trim();
    const postalCode = String(cepInput?.value || '').replace(/\D/g, '').replace(/(\d{5})(\d{0,3})/, '$1-$2').replace(/-$/, '');
    const complement = String(complementInput?.value || '').trim();
    const locality = String(streetInput?.dataset.locality || '').trim();
    const region = String(streetInput?.dataset.region || '').trim();
    const base = [street, number].filter(Boolean).join(', ');
    const localityLabel = [locality, region].filter(Boolean).join(' - ');
    const displayAddress = [
        base,
        complement ? `Complemento: ${complement}` : '',
        postalCode ? `CEP ${postalCode}` : '',
        localityLabel
    ].filter(Boolean).join(' - ');
    return {
        street,
        number,
        postalCode,
        complement,
        displayAddress,
        searchAddress: [base, postalCode, localityLabel, 'Brasil'].filter(Boolean).join(', '),
        isComplete: Boolean(street && number && postalCode.length === 9)
    };
}

function populateAddressFields(place) {
    const streetInput = document.getElementById('user-address');
    const numberInput = document.getElementById('user-address-number');
    const cepInput = document.getElementById('user-address-cep');
    if (!streetInput) return;
    const components = Array.isArray(place?.address_components) ? place.address_components : [];
    const byType = (type) => components.find(component => component.types?.includes(type))?.long_name || '';
    const route = byType('route');
    const number = byType('street_number');
    const postalCode = byType('postal_code');
    const locality = byType('sublocality_level_1') || byType('neighborhood') || byType('administrative_area_level_2');
    const region = byType('administrative_area_level_1');
    if (route) streetInput.value = route;
    if (number && numberInput) numberInput.value = number;
    if (postalCode && cepInput) cepInput.value = postalCode.replace(/(\d{5})(\d{3})/, '$1-$2');
    streetInput.dataset.locality = locality;
    streetInput.dataset.region = region;
}

function getLocationCoordinates(location) {
    const latitude = typeof location?.lat === 'function' ? location.lat() : Number(location?.lat);
    const longitude = typeof location?.lng === 'function' ? location.lng() : Number(location?.lng);
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

function clearAddressCoordinates() {
    const streetInput = document.getElementById('user-address');
    const status = document.getElementById('restaurant-location-coordinates');
    if (!streetInput) return;
    streetInput.dataset.placeSelected = '0';
    delete streetInput.dataset.latitude;
    delete streetInput.dataset.longitude;
    delete state.userInfo.latitude;
    delete state.userInfo.longitude;
    if (status) status.textContent = 'Confirme o endereço no mapa para calcular a entrega.';
}

function geocodeAddress(address) {
    if (!state.geocoder) return;
    state.geocoder.geocode({
        address: address
    }, (results, status) => {
        if (status === 'OK' && results[0]) {
            populateAddressFields(results[0]);
            updateLocation(results[0].geometry.location, results[0].formatted_address, results[0]);
        }
    });
}

function updateLocation(location, address = null, place = null) {
    const coordinates = getLocationCoordinates(location);
    const streetInput = document.getElementById('user-address');
    if (place) populateAddressFields(place);
    if (coordinates && streetInput) {
        streetInput.dataset.placeSelected = '1';
        streetInput.dataset.latitude = String(coordinates.latitude);
        streetInput.dataset.longitude = String(coordinates.longitude);
        state.userInfo.latitude = coordinates.latitude;
        state.userInfo.longitude = coordinates.longitude;
    }
    if (state.googleMap) {
        state.googleMap.panTo(location);
        if (state.mapMarker) state.mapMarker.setPosition(location);
    }
    const structuredAddress = getStructuredAddress();
    if (structuredAddress.isComplete && coordinates) {
        state.userInfo.address = structuredAddress.displayAddress;
        state.userInfo.postalCode = structuredAddress.postalCode;
        state.userInfo.addressStreet = structuredAddress.street;
        state.userInfo.addressNumber = structuredAddress.number;
        state.userInfo.addressComplement = structuredAddress.complement;
        localStorage.setItem('menzzu_user', JSON.stringify(state.userInfo));
        const status = document.getElementById('restaurant-location-coordinates');
        if (status) status.textContent = 'Localização confirmada no mapa.';
        const modal = document.getElementById('restaurant-location-modal');
        if (modal && !modal.classList.contains('hidden')) {
            modal.dataset.calculatedAddress = structuredAddress.displayAddress;
            window.dispatchEvent(new CustomEvent('menzzu-address-selected', {
                detail: { address: structuredAddress.displayAddress, coordinates, addressData: structuredAddress }
            }));
        } else {
            calculateDeliveryFee(structuredAddress.displayAddress, coordinates);
        }
    }
}

function reverseGeocode(latLng) {
    state.geocoder.geocode({
        location: latLng
    }, (results, status) => {
        if (status === 'OK' && results[0]) updateLocation(latLng, results[0].formatted_address, results[0]);
    });
}

async function calculateDeliveryFee(address, coordinates = null) {
    try {
        const response = await fetch(`${API_BASE}/orders/calculate-fee`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                address,
                lat: coordinates?.latitude ?? state.userInfo.latitude,
                lng: coordinates?.longitude ?? state.userInfo.longitude,
                slug: STORE_SLUG
            })
        });
        const data = await response.json();
        const display = document.getElementById('delivery-fee-display');
        const locationFeeDisplay = document.getElementById('restaurant-location-fee');
        if (data.fee !== undefined) {
            state.deliveryFee = data.fee;
            state.allowCash = data.type === 'estimated' ? false : (data.allowCash !== false);
            if (display) {
                display.style.display = 'block';
                display.innerHTML = `Taxa de entrega: <strong style="color:var(--primary-color)">R$ ${data.fee.toFixed(2)}</strong>`;
                display.style.background = '#f0fdf4';
                display.style.color = '#166534';
            }
            if (locationFeeDisplay) {
                locationFeeDisplay.hidden = false;
                locationFeeDisplay.className = 'restaurant-location-fee is-success';
                locationFeeDisplay.innerHTML = `Taxa calculada: <strong>R$ ${Number(data.fee).toFixed(2).replace('.', ',')}</strong>`;
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
            if (locationFeeDisplay) {
                locationFeeDisplay.hidden = false;
                locationFeeDisplay.className = 'restaurant-location-fee is-error';
                locationFeeDisplay.innerText = data.error;
            }
        } else {
            if (display) display.style.display = 'none';
        }
        return data;
    } catch (err) {
        console.error('Erro ao calcular frete:', err);
        const locationFeeDisplay = document.getElementById('restaurant-location-fee');
        if (locationFeeDisplay) {
            locationFeeDisplay.hidden = false;
            locationFeeDisplay.className = 'restaurant-location-fee is-error';
            locationFeeDisplay.innerText = 'Não foi possível calcular a taxa agora.';
        }
        return { error: 'Não foi possível calcular a taxa agora.' };
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
            const visibleVariations = variations.filter(v => !v.hidden);
            if (visibleVariations.length === 0) return false;
            if (!hasAvailableProductStock(p, visibleVariations)) return false;
        } else if (!hasAvailableProductStock(p, [])) {
            return false;
        }

        const matchesSearch = p.name.toLowerCase().includes(query) || (p.description && p.description.toLowerCase().includes(query));
        const productType = String(p.type || 'delivery').toLowerCase();
        const isDeliveryProduct = productType === 'delivery' || productType === 'combo_delivery';
        const isOrderProduct = productType === 'encomenda' || (productType.startsWith('combo_') && !isDeliveryProduct);
        const matchesTab = (state.activeTab === 'delivery' && isDeliveryTabVisible() && isDeliveryProduct)
            || (state.activeTab === 'order' && isOrderTabVisible() && (isOrderProduct || (isOrderDeliveryEnabled() && isDeliveryProduct)));
        return matchesTab && matchesSearch;
    });

    // Separar destaques (apenas se não houver busca ativa)
    const featured = query ? [] : filtered.filter(p => p.featured).sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
    // Destaque e vitrine adicional: o produto tambem permanece na categoria.
    const catalogItems = filtered;

    const grouped = {};
    const sortedCategories = [];
    const categoryOrders = new Map((state.categories || []).map(category => [
        String(category.name || ''),
        Number.isFinite(Number(category.order)) ? Number(category.order) : Number.MAX_SAFE_INTEGER
    ]));
    catalogItems.forEach(p => {
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

    // Preserve the sequence defined in category management, independently
    // from the display order of the products in each category.
    sortedCategories.sort((left, right) => {
        const leftOrder = categoryOrders.get(String(left)) ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = categoryOrders.get(String(right)) ?? Number.MAX_SAFE_INTEGER;
        return leftOrder - rightOrder || String(left).localeCompare(String(right), 'pt-BR');
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
    const files = Array.from(input.files);
    const allowMultiple = input.dataset.multiple === 'true';
    const btn = input.closest('.checkout-extra-image')?.querySelector('button[data-upload-btn="true"]') || input.previousElementSibling;
    const originalBtnText = btn?.innerHTML || '';

    if (btn) {
        btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Enviando...';
        btn.disabled = true;
        lucide.createIcons();
    }

    try {
        const urls = [];
        for (const file of (allowMultiple ? files : files.slice(0, 1))) {
            const url = await handleExternalUpload(file);
            if (url) urls.push(url);
        }
        if (urls.length > 0) {
            const hidden = document.getElementById(hiddenId);
            if (hidden) hidden.value = allowMultiple ? JSON.stringify(urls) : urls[0];
            const preview = document.getElementById(previewId);
            if (preview) {
                preview.innerHTML = urls.map(url => `<img src="${url}" style="max-width: 80px; max-height: 80px; border-radius: 8px; border: 1px solid var(--border-color); object-fit: cover;">`).join('');
                preview.style.display = 'flex';
                preview.style.gap = '8px';
                preview.style.flexWrap = 'wrap';
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
    const panel = document.querySelector('#item-detail-modal .item-detail-panel');
    if (!panel || document.getElementById('item-detail-footer')) return;

    panel.insertAdjacentHTML('beforeend', `
        <div id="item-detail-footer" class="modal-footer-sticky">
            <div class="qty-selector">
                <button class="qty-btn" id="qty-minus" aria-label="Diminuir quantidade"><i data-lucide="minus"></i></button>
                <span id="detail-qty">1</span>
                <button class="qty-btn" id="qty-plus" aria-label="Aumentar quantidade"><i data-lucide="plus"></i></button>
            </div>
            <button id="add-to-cart-btn" class="primary-btn">Adicionar <span id="add-btn-price"></span></button>
        </div>
    `);
    lucide.createIcons();
}

function openItemDetail(productId, { updateUrl = true } = {}) {
    ensureDetailFooter();
    const item = state.products.find(p => p.id === productId);
    if (!item) return;
    if (updateUrl) setProductUrl(item);
    state.currentItem = item;
    state.currentQty = 1;
    state.currentVariation = null;
    state.currentSubItem = null;
    state.suggestedSelection = null;

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

        const variationPrices = variations.map(variation => getVariationPrice(variation));
        const minimumVariationPrice = variationPrices
            .filter(price => Number.isFinite(price) && price > 0)
            .reduce((minimum, price) => Math.min(minimum, price), Infinity);
        const hasDifferentVariationPrices = variationPrices.some(price => (
            Number.isFinite(price) && price > 0 && Math.abs(price - minimumVariationPrice) >= 0.005
        ));
        const variationsHtml = variations.length > 0
            ? `<div class="variation-section"><div class="addon-group-header"><h4>Escolha uma opção</h4></div>${variations.map((v, index) => {
                const price = variationPrices[index];
                const available = hasAvailableVariationStock(item, v);
                const priceLabel = hasDifferentVariationPrices && price > minimumVariationPrice + 0.005
                    ? formatPriceDifference(price, minimumVariationPrice)
                    : '';
                return `<div class="var-option ${available ? '' : 'disabled'}" ${available ? `onclick="selectVariation('${v.name.replace(/'/g, "\\'")}', ${getVariationPrice(v)})"` : 'aria-disabled="true"'}><div class="var-label">${v.name}</div><div class="var-price">${available ? priceLabel : 'Esgotado'}</div></div>`;
            }).join('')}</div>`
            : '';

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
        const suggestedVariations = suggestedItem
            ? JSON.parse(suggestedItem.variations || '[]').filter(variation => !variation.hidden && hasAvailableVariationStock(suggestedItem, variation))
            : [];
        const orderBumpHtml = suggestedItem ? `
                <div class="variation-section addon-group-section order-bump-section">
                    <div class="addon-group-header">
                        <h4>Leve também</h4>
                        <span class="addon-group-badge optional">Sugestão</span>
                    </div>
                    <div class="suggested-product-card">
                        ${parseImages(suggestedItem.image).length > 0 ? `<img src="${getImg(parseImages(suggestedItem.image)[0], 'thumb')}" alt="${suggestedItem.name}">` : ''}
                        <div>
                            <strong>${suggestedItem.name}</strong>
                            <span>${suggestedItem.description || 'Escolha uma opção para adicionar.'}</span>
                        </div>
                    </div>
                    <div class="suggested-options">
                        ${(suggestedVariations.length > 0 ? suggestedVariations : [null]).map(variation => {
                            const variationName = variation?.name || '';
                            const price = variation ? getVariationPrice(variation) : getEffectiveProductPrice(suggestedItem);
                            const isSelected = state.suggestedSelection?.productId === suggestedItem.id
                                && state.suggestedSelection?.variation === variationName;
                            const label = variationName || 'Adicionar item';
                            return `<button type="button" class="var-option ${isSelected ? 'selected' : ''}" onclick="selectSuggestedItem('${suggestedItem.id}', '${variationName.replace(/'/g, "\\'")}', ${price})"><span class="var-label">${label}</span><span class="var-price">${formatDisplayPrice(price)}</span></button>`;
                        }).join('')}
                    </div>
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
                            const itemAccent = String(gItem.color || gItem.accent || gItem.accentColor || g.color || g.accentColor || 'var(--primary-color)').replace(/"/g, '&quot;');
                            return `<label for="${inputId}" class="var-option addon-option" style="--addon-accent: ${itemAccent};" onclick="handleAddonSelect(event, '${g.id}', ${maxSelections}, ${gi}, ${ii})">
                                                <div class="addon-option-main">
                                                    <span class="var-label">${gItem.name}</span>
                                                </div>
                                                <div class="addon-option-meta">
                                                    ${parseFloat(gItem.price || 0) > 0 ? `<span class="var-price addon-option-price">+ R$ ${parseFloat(gItem.price).toFixed(2)}</span>` : ''}
                                                    <span class="addon-option-controls" aria-label="Quantidade de ${gItem.name}">
                                                        <button type="button" class="addon-qty-btn addon-qty-decrease" aria-label="Remover ${gItem.name}" onclick="changeAddonQuantity(event, '${g.id}', ${maxSelections}, ${gi}, ${ii}, -1)"><i data-lucide="trash-2"></i></button>
                                                        <span class="addon-option-quantity" aria-live="polite">0</span>
                                                        <button type="button" class="addon-qty-btn addon-qty-increase" aria-label="Adicionar ${gItem.name}" onclick="changeAddonQuantity(event, '${g.id}', ${maxSelections}, ${gi}, ${ii}, 1)"><i data-lucide="plus"></i></button>
                                                    </span>
                                                </div>
                                                <input type="checkbox" id="${inputId}" class="addon-input" data-quantity="0" data-group-id="${g.id}" data-group-name="${g.name.replace(/"/g, '&quot;')}" data-max="${maxSelections}" data-item-name="${gItem.name.replace(/"/g, '&quot;')}" data-item-price="${parseFloat(gItem.price || 0)}">
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
        ensureDetailFooter();
        renderVariationAccordion();
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
    if (modalId === 'item-detail-modal') clearProductUrl();
    if (modalId === 'order-status-modal') {
        if (state.orderStatusRefreshTimer) clearInterval(state.orderStatusRefreshTimer);
        state.orderStatusRefreshTimer = null;
        const url = new URL(window.location.href);
        if (url.searchParams.has('pedido')) {
            url.searchParams.delete('pedido');
            window.history.replaceState({}, '', url.toString());
        }
    }
    const anyVisibleModal = ['item-detail-modal', 'checkout-modal', 'history-modal', 'order-schedule-modal', 'review-modal', 'order-status-modal']
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

function renderVariationAccordion() {
    const section = document.querySelector('#item-detail-modal .variation-section');
    if (!section) return;

    let variations = [];
    try {
        variations = JSON.parse(state.currentItem?.variations || '[]').filter(variation => !variation.hidden);
    } catch (e) {
        variations = [];
    }

    const rows = Array.from(section.querySelectorAll(':scope > .var-option'));
    rows.forEach((row, index) => {
        const variation = variations[index];
        if (!variation) return;
        if (!hasAvailableVariationStock(state.currentItem, variation)) {
            row.classList.add('disabled');
            row.removeAttribute('onclick');
            row.setAttribute('aria-disabled', 'true');
            return;
        }

        const variationSubItems = Array.isArray(variation.subItems) ? variation.subItems : [];
        if (variationSubItems.length === 0) return;

        const details = document.createElement('div');
        details.className = 'variation-subitems';
        details.dataset.open = 'false';
        const detailsInner = document.createElement('div');
        detailsInner.className = 'variation-subitems-inner';

        const subItems = variationSubItems
            .filter(item => !item.hidden && (!state.currentItem?.trackStock || Number(item.stock) > 0));

        if (subItems.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = 'Nenhuma opção adicional';
            empty.style.cssText = 'padding: 4px 0; color: var(--text-secondary); font-size: 13px;';
            detailsInner.appendChild(empty);
        } else {
            const title = document.createElement('div');
            title.textContent = 'Escolha uma opção';
            title.style.cssText = 'margin-bottom: 6px; color: var(--text-secondary); font-size: 12px; font-weight: 700;';
            detailsInner.appendChild(title);

            subItems.forEach(subItem => {
                const option = document.createElement('div');
                option.className = 'var-option subitem-option';
                option.style.margin = '6px 0 0';
                option.style.gap = '12px';
                option.style.minHeight = '50px';
                option.style.boxSizing = 'border-box';
                option.innerHTML = '<div class="var-label"></div><div class="var-price"></div>';
                option.querySelector('.var-label').textContent = subItem.name || 'Opção';
                const price = getResolvedProductPrice(subItem, variation);
                const variationPrice = getVariationPrice(variation);
                option.querySelector('.var-price').textContent = price > 0
                    ? formatPriceDifference(price, variationPrice)
                    : '';
                option.querySelector('.var-label').style.cssText = 'min-width: 0; flex: 1 1 auto;';
                option.querySelector('.var-price').style.cssText = 'margin-left: auto; flex: 0 0 auto; white-space: nowrap;';
                option.addEventListener('click', event => {
                    event.stopPropagation();
                    selectSubItem(subItem.name, subItem.price);
                });
                detailsInner.appendChild(option);
            });
        }
        details.appendChild(detailsInner);

        const indicator = document.createElement('span');
        indicator.className = 'variation-accordion-indicator';
        indicator.textContent = '+';
        row.appendChild(indicator);
        row.style.cursor = 'pointer';
        row.style.gap = '12px';
        row.style.minHeight = '56px';
        row.style.boxSizing = 'border-box';
        row.style.transition = 'background 220ms ease, border-color 220ms ease, transform 220ms ease';
        row.querySelector('.var-label').style.cssText = 'min-width: 0; flex: 1 1 auto;';
        row.querySelector('.var-price').style.cssText = 'margin-left: auto; flex: 0 0 auto; white-space: nowrap;';
        row.removeAttribute('onclick');
        row.setAttribute('role', 'button');
        row.setAttribute('aria-expanded', 'false');
        row.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            const shouldOpen = details.dataset.open !== 'true';
            section.querySelectorAll('.variation-subitems').forEach(item => {
                item.dataset.open = 'false';
                item.classList.remove('is-open');
            });
            section.querySelectorAll(':scope > .var-option').forEach(item => {
                item.classList.remove('selected');
                item.setAttribute('aria-expanded', 'false');
                const itemIndicator = item.querySelector('.variation-accordion-indicator');
                if (itemIndicator) {
                    itemIndicator.classList.remove('is-open');
                }
            });

            selectVariation(variation.name, variation.price, false);
            if (shouldOpen) {
                details.dataset.open = 'true';
                details.classList.add('is-open');
                row.classList.add('selected');
                row.setAttribute('aria-expanded', 'true');
                indicator.classList.add('is-open');
            }
        });
        row.insertAdjacentElement('afterend', details);
    });
}

function selectVariation(name, price, renderOptions = true) {
    const variations = JSON.parse(state.currentItem?.variations || '[]');
    const selected = variations.find(variation => String(variation.name) === String(name));
    state.currentVariation = {
        ...(selected || {}),
        name,
        price,
        subItems: Array.isArray(selected?.subItems) ? selected.subItems : []
    };
    state.currentSubItem = null;
    document.querySelectorAll('.var-option').forEach(el => el.classList.toggle('selected', el.querySelector('.var-label').innerText === name));
    if (renderOptions) renderVariationAccordion();
    updateDetailFooter();
}

function renderSubItemSelection() {
    renderVariationAccordion();
}

function selectSubItem(name, price) {
    const selected = (state.currentVariation?.subItems || []).find(item => String(item?.name || '') === String(name || ''));
    state.currentSubItem = selected || { name, price };
    document.querySelectorAll('.subitem-option').forEach(el => el.classList.toggle('selected', el.querySelector('.var-label').innerText === name));
    updateDetailFooter();
}

function syncAddonGroupState(groupSection) {
    if (!groupSection) return;
    const maxAllowed = Math.max(parseInt(groupSection.dataset.max || '1', 10) || 1, 1);
    const inputs = Array.from(groupSection.querySelectorAll('.addon-input'));
    const selectedCount = inputs.reduce((total, input) => total + getAddonQuantity(input), 0);

    inputs.forEach(input => {
        const label = input.closest('label');
        const quantity = getAddonQuantity(input);
        const isSelected = quantity > 0;
        const isDisabled = !isSelected && selectedCount >= maxAllowed;

        input.disabled = isDisabled;

        if (label) {
            label.classList.toggle('selected', isSelected);
            label.classList.toggle('disabled', isDisabled);
            const quantityEl = label.querySelector('.addon-option-quantity');
            const decreaseButton = label.querySelector('.addon-qty-decrease');
            if (quantityEl) quantityEl.textContent = quantity;
            if (decreaseButton) {
                const isSingleItem = quantity === 1;
                decreaseButton.setAttribute('aria-label', `${isSingleItem ? 'Remover' : 'Diminuir'} ${input.dataset.itemName || 'opção'}`);
                decreaseButton.innerHTML = `<i data-lucide="${isSingleItem ? 'trash-2' : 'minus'}"></i>`;
            }
        }
    });

    if (window.lucide) lucide.createIcons();
}

function getAddonQuantity(input) {
    return Math.max(parseInt(input?.dataset?.quantity || '0', 10) || 0, 0);
}

function changeAddonQuantity(event, groupId, maxSelections, gi, ii, delta) {
    event.preventDefault();
    event.stopPropagation();
    const inputId = `ag-${gi}-${ii}`;
    const input = document.getElementById(inputId);
    if (!input) return;
    const label = input.closest('label');
    const groupSection = label?.closest('.addon-group-section');
    const maxAllowed = Math.max(parseInt(maxSelections, 10) || 1, 1);
    const currentQuantity = getAddonQuantity(input);
    const selectedCount = groupSection
        ? Array.from(groupSection.querySelectorAll('.addon-input')).reduce((total, option) => total + getAddonQuantity(option), 0)
        : 0;

    if (delta > 0 && selectedCount >= maxAllowed) return;
    const nextQuantity = Math.max(currentQuantity + delta, 0);
    if (nextQuantity === currentQuantity) return;

    input.dataset.quantity = String(nextQuantity);
    input.checked = nextQuantity > 0;

    syncAddonGroupState(groupSection);
    updateDetailFooter();
}

function handleAddonSelect(event, groupId, maxSelections, gi, ii) {
    changeAddonQuantity(event, groupId, maxSelections, gi, ii, 1);
}

function getSelectedAddons() {
    const addons = [];
    let addonTotal = 0;
    document.querySelectorAll('.addon-input:checked').forEach(input => {
        const price = parseFloat(input.dataset.itemPrice || 0);
        const quantity = getAddonQuantity(input);
        addons.push({
            groupId: input.dataset.groupId,
            groupName: input.dataset.groupName,
            name: input.dataset.itemName,
            price,
            quantity
        });
        addonTotal += price * quantity;
    });
    return {
        addons,
        addonTotal
    };
}

function getSelectedCustomFields(item) {
    return getCustomFieldSummaryParts(item).map(({ key, value, isUrl }) => ({
        groupName: key,
        name: value,
        isCustomField: true,
        isAttachment: isUrl,
        price: 0
    }));
}

function getOrderAddonsJSON(item) {
    let addons = [];
    try {
        const parsed = typeof item?.addons === 'string' ? JSON.parse(item.addons) : item?.addons;
        addons = Array.isArray(parsed) ? parsed.filter(addon => !addon?.isCustomField) : [];
    } catch (e) { }

    const selections = [...addons, ...getSelectedCustomFields(item)];
    return selections.length > 0 ? JSON.stringify(selections) : null;
}

function updateDetailFooter() {
    const variations = JSON.parse(state.currentItem?.variations || '[]').filter(variation => !variation.hidden);
    const selectedSubItems = (state.currentVariation?.subItems || []).filter(subItem => !subItem.hidden);
    const needsSelection = (variations.length > 0 && !state.currentVariation)
        || (selectedSubItems.length > 0 && !state.currentSubItem);
    const basePrice = getSelectedItemPrice();
    const {
        addonTotal
    } = getSelectedAddons();
    const suggestedPrice = Number(state.suggestedSelection?.price || 0);
    const totalUnit = basePrice + addonTotal;
    const priceEl = document.getElementById('add-btn-price');
    const addButton = document.getElementById('add-to-cart-btn');
    if (priceEl) priceEl.innerText = needsSelection ? '' : `R$ ${((totalUnit * state.currentQty) + suggestedPrice).toFixed(2)}`;
    if (addButton) {
        addButton.disabled = needsSelection;
        addButton.title = needsSelection ? 'Escolha uma opção para continuar.' : '';
    }

    const qtyEl = document.getElementById('detail-qty');
    if (qtyEl) qtyEl.innerText = state.currentQty;
}

function selectSuggestedItem(productId, variationName, price) {
    const product = (state.products || []).find(item => String(item.id) === String(productId));
    const variation = variationName
        ? JSON.parse(product?.variations || '[]').find(item => String(item?.name || '') === String(variationName))
        : null;
    if (!product || product.active === false || !hasAvailableProductStock(product) || (variation && !hasAvailableVariationStock(product, variation))) {
        state.suggestedSelection = null;
        return showAlert('Item indisponível', 'Esta sugestão está sem estoque no momento.');
    }
    const current = state.suggestedSelection;
    if (current?.productId === productId && current?.variation === variationName) {
        state.suggestedSelection = null;
    } else {
        state.suggestedSelection = { productId, variation: variationName, price: Number(price) || 0 };
    }
    document.querySelectorAll('.suggested-options .var-option').forEach(option => {
        option.classList.toggle('selected', option.querySelector('.var-label')?.textContent === (state.suggestedSelection?.variation || 'Adicionar item'));
    });
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
    const subItems = (variation?.subItems || []).filter(item => !item.hidden);
    if (subItems.length > 0 && !state.currentSubItem) {
        return {
            ok: false,
            message: 'Por favor, selecione uma opção para continuar.'
        };
    }

    const groupIds = JSON.parse(item.addonGroups || '[]');
    const groups = (state.addonGroups || []).filter(g => groupIds.includes(g.id));
    for (const g of groups) {
        const maxAllowed = Math.max(parseInt(g.max, 10) || 1, 1);
        const quantity = Array.from(document.querySelectorAll(`.addon-input[data-group-id="${g.id}"]`)).reduce((total, input) => total + getAddonQuantity(input), 0);
        if (g.min > 0 && quantity < g.min) {
            return {
                ok: false,
                message: `Selecione pelo menos ${g.min} opção em "${g.name}".`
            };
        }
        if (quantity > maxAllowed) {
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
        const imageValues = parseJsonValue(currentValue, currentValue ? [currentValue] : []);
        const previewImages = Array.isArray(imageValues) ? imageValues.filter(Boolean) : [];
        return `
                        <div class="checkout-extra-image" style="margin-bottom: 14px;">
                            <label style="display:block; font-size:13px; font-weight:600; color:var(--text-secondary); margin-bottom:5px;">${fieldLabel}</label>
                            <input type="hidden" id="${fieldId}" data-field-name="${field.name}" value="${currentValue || ''}">
                            <button type="button" data-upload-btn="true" onclick="document.getElementById('${fieldId}-file').click()" style="padding: 10px; border-radius: 8px; border: 1px dashed var(--primary-color); background: var(--bg-tertiary); color: var(--primary-color); font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%;">
                                <i data-lucide="image" style="width:16px; height:16px;"></i> Anexar Imagem
                            </button>
                            <input type="file" id="${fieldId}-file" accept="image/*" ${field.multiple !== false ? 'multiple' : ''} data-multiple="${field.multiple !== false}" style="display:none;" onchange="handleCheckoutFieldImageUpload(this, '${fieldId}', '${previewId}')">
                            <div id="${previewId}" style="display:${previewImages.length ? 'flex' : 'none'}; margin-top: 10px; align-items: center; gap:8px; flex-wrap:wrap;">
                                ${previewImages.map(url => `<img src="${url}" style="max-width: 80px; max-height: 80px; border-radius: 8px; border: 1px solid var(--border-color); object-fit: cover;">`).join('')}
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
    const orderStepContent = document.getElementById('order-step-content');
    if (!orderStepContent) return false;
    let container = document.getElementById('order-extra-step-content');
    if (!container) {
        orderStepContent.innerHTML = '<div id="order-extra-step-content"></div>';
        container = document.getElementById('order-extra-step-content');
    }

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
    const ids = ['item-detail-modal', 'checkout-modal', 'history-modal', 'order-schedule-modal', 'review-modal', 'order-status-modal'];
    ids.forEach(id => {
        const m = document.getElementById(id);
        if (m && !m.classList.contains('hidden')) {
            if (modalId && modalId !== id) return;
            closeWithAnimation(id);
        }
    });
}

function openModal(id) {
    const ids = ['item-detail-modal', 'checkout-modal', 'history-modal', 'order-schedule-modal', 'review-modal', 'order-status-modal'];
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
    const bindClick = (id, handler) => {
        const element = document.getElementById(id);
        if (element) element.addEventListener('click', handler);
    };
    const searchInput = document.getElementById('search-input');
    const mobileSearchToggle = document.getElementById('mobile-search-toggle');
    const searchContainer = document.getElementById('search-container');

    window.addEventListener('menzzu-address-selected', async (event) => {
        const address = event.detail?.address || '';
        const result = await calculateDeliveryFee(address, event.detail?.coordinates || null);
        const modal = document.getElementById('restaurant-location-modal');
        const submitButton = modal?.querySelector('button[type="submit"]');
        if (result?.fee !== undefined && submitButton) {
            submitButton.disabled = false;
            submitButton.innerText = 'Confirmar endereço';
        } else if (submitButton) {
            submitButton.disabled = false;
            submitButton.innerText = 'Tentar novamente';
            if (modal) modal.dataset.calculatedAddress = '';
        }
    });

    window.addEventListener('menzzu-address-saved', (event) => {
        const address = String(event.detail?.address || '').trim();
        if (!address) return;
        state.userInfo.address = address;
        state.userInfo.postalCode = event.detail?.addressData?.postalCode || state.userInfo.postalCode || '';
        state.userInfo.addressStreet = event.detail?.addressData?.street || state.userInfo.addressStreet || '';
        state.userInfo.addressNumber = event.detail?.addressData?.number || state.userInfo.addressNumber || '';
        state.userInfo.addressComplement = event.detail?.addressData?.complement || state.userInfo.addressComplement || '';
        if (Number.isFinite(Number(event.detail?.coordinates?.latitude))) state.userInfo.latitude = Number(event.detail.coordinates.latitude);
        if (Number.isFinite(Number(event.detail?.coordinates?.longitude))) state.userInfo.longitude = Number(event.detail.coordinates.longitude);
        localStorage.setItem('menzzu_user', JSON.stringify(state.userInfo));
        const addressDisplay = document.getElementById('delivery-address-display');
        if (addressDisplay) addressDisplay.textContent = address;
    });

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
            if (btn.dataset.tab === 'order' && !isOrderTabVisible()) return;
            document.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.activeTab = btn.dataset.tab;
            persistActiveTab();
            document.body.classList.toggle('theme-order', state.activeTab === 'order');
            updateTheme(); // Muda as cores ao trocar de aba
            renderMenu();
            updateUI();
        });
    });

    document.addEventListener('click', (event) => {
        if (event.target.closest('#qty-plus')) {
            state.currentQty++;
            updateDetailFooter();
        } else if (event.target.closest('#qty-minus')) {
            if (state.currentQty > 1) state.currentQty--;
            updateDetailFooter();
        } else if (event.target.closest('#add-to-cart-btn')) {
            addToCart();
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

    bindClick('history-toggle-btn', () => {
        openModal('history-modal');
        fetchPreviousOrders();
    });

    const trackedOrderId = new URLSearchParams(window.location.search).get('pedido');
    if (/^[a-f0-9-]{16,}$/i.test(String(trackedOrderId || ''))) {
        setTimeout(() => openPublicOrderStatus(trackedOrderId), 0);
    }

    bindClick('view-cart-btn', () => {
        restoreCheckoutState();
        goToStep(getResumeStep());
    });
    bindClick('next-step-btn', handleNextStep);
    bindClick('place-order-btn', handlePlaceOrder);

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
            const earliestDate = getEarliestOrderDate();
            if (dateStr && dateStr < earliestDate) {
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
    }

    document.getElementById('confirm-schedule-btn')?.addEventListener('click', commitScheduleAndMaybeAdd);
    document.getElementById('apply-schedule-coupon')?.addEventListener('click', async () => {
        const input = document.getElementById('schedule-coupon');
        const dateInput = document.getElementById('schedule-date');
        state.couponCode = String(input?.value || '').trim().toUpperCase();
        if (input) input.value = state.couponCode;
        saveCheckoutState();
        await loadOrderAvailability(dateInput?.value || '', false, {
            timeSelectId: 'schedule-time',
            dateInputId: 'schedule-date',
            noteId: 'schedule-availability-note'
        });
    });
    document.getElementById('schedule-time')?.addEventListener('change', async (e) => {
        if (!e.target.value) return;
        const noteEl = document.getElementById('schedule-availability-note');
        if (noteEl) noteEl.innerText = '';
    });

    document.getElementById('user-name').value = state.userInfo.name || '';
    document.getElementById('user-phone').value = state.userInfo.phone || '';
    document.getElementById('user-address').value = state.userInfo.addressStreet || '';

    const phoneInput = document.getElementById('user-phone');
    if (phoneInput) {
        phoneInput.addEventListener('input', (e) => {
            e.target.value = maskPhone(e.target.value);
            state.userInfo.phone = e.target.value;
            localStorage.setItem('menzzu_user', JSON.stringify(state.userInfo));
        });
    }

    ['user-name'].forEach(id => {
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
    if (step === 3 && state.activeTab === 'delivery') {
        step = 4;
    }
    if (step === 3 && state.activeTab === 'order' && !hasCheckoutExtras()) {
        step = 4;
    }

    state.currentStep = step;

    // Persist checkout progress
    saveCheckoutState();

    // Esconde todos os passos explicitamente por ID para não ter erro
    document.getElementById('step-1')?.classList.add('hidden');
    document.getElementById('step-2')?.classList.add('hidden');
    document.getElementById('step-3')?.classList.add('hidden');
    document.getElementById('step-4')?.classList.add('hidden');
    document.getElementById('step-5')?.classList.add('hidden');
    document.getElementById('step-6')?.classList.add('hidden');

    // Mostra apenas o atual
    document.getElementById(`step-${step}`)?.classList.remove('hidden');

    openModal('checkout-modal');

    let title = "Seus dados";
    if (step === 2) title = "Sua sacola";
    if (step === 3) title = "Extras do Pedido";
    if (step === 4) title = "Recebimento";
    if (step === 5) title = "Forma de Pagamento";
    if (step === 6) title = "Confirmar Pedido";

    document.getElementById('checkout-step-title').innerText = title;

    const isLast = step === 6;
    document.getElementById('next-step-btn').classList.toggle('hidden', isLast);
    document.getElementById('place-order-btn').classList.toggle('hidden', !isLast);

    if (step === 1) renderCustomerStep();
    if (step === 2) renderCartStep();
    if (step === 3) renderCheckoutExtraStep();
    if (step === 4) renderReceivingStep();
    if (step === 5) renderPaymentStep();
    if (step === 6) {
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
        cashChangeFor: state.cashChangeFor || null,
        deliveryFee: state.deliveryFee || 0,
        orderSchedule: state.orderSchedule || null,
        couponCode: state.couponCode || '',
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
    if (Number.isFinite(Number(saved.cashChangeFor)) && Number(saved.cashChangeFor) > 0) state.cashChangeFor = Number(saved.cashChangeFor);
    if (typeof saved.deliveryFee === 'number') state.deliveryFee = saved.deliveryFee;
    if (saved.orderSchedule && typeof saved.orderSchedule === 'object') {
        state.orderSchedule = {
            date: saved.orderSchedule.date || '',
            time: saved.orderSchedule.time || ''
        };
    }
    if (saved.couponCode) state.couponCode = String(saved.couponCode).trim().toUpperCase();
    if (saved.orderDetailsInfo) {
        state.orderDetailsInfo = saved.orderDetailsInfo;
    }
}

// Customer details can be skipped once saved, but the cart is always reviewed.
function getResumeStep() {
    if (getActiveCart().length === 0) return 1;
    const phone = state.userInfo.phone || '';
    if (!state.userInfo.name || !phone || phone.length < 14) return 1;
    return 2;
}

document.getElementById('checkout-back-btn')?.addEventListener('click', () => {
    if (state.currentStep > 1) {
        const previousStep = state.currentStep === 4 && (state.activeTab === 'delivery' || !hasCheckoutExtras())
            ? 2
            : state.currentStep - 1;
        goToStep(previousStep);
    } else closeWithAnimation('checkout-modal');
});

function renderCustomerStep() {
    document.getElementById('user-name').value = state.userInfo.name || '';
    document.getElementById('user-phone').value = state.userInfo.phone || '';
    const checkoutCouponInput = document.getElementById('checkout-coupon');
    if (checkoutCouponInput) checkoutCouponInput.value = state.couponCode || '';
    document.getElementById('next-step-btn').disabled = false;
}

async function loadCouponQuote() {
    const code = String(state.couponCode || '').trim().toUpperCase();
    if (!code) {
        state.couponQuote = null;
        return null;
    }

    const response = await fetch(`${API_BASE}/orders/coupon-preview?slug=${encodeURIComponent(STORE_SLUG)}&couponCode=${encodeURIComponent(code)}`);
    let data = null;
    try {
        data = await response.json();
    } catch (error) {
        if (response.status === 404) {
            throw new Error('A validação de cupons está sendo atualizada. Tente novamente em alguns minutos.');
        }
        throw new Error('Não foi possível validar o cupom agora. Tente novamente.');
    }
    if (!response.ok) throw new Error(data.error || 'Cupom inválido.');
    state.couponQuote = data;
    return data;
}

function getCartPriceSummary(cart, deliveryFee = 0) {
    const subtotal = cart.reduce((total, item) => total + (Number(item.price) || 0) * (Number(item.quantity) || 0), 0);
    const fee = Math.max(0, Number(deliveryFee) || 0);
    const quote = state.couponQuote;
    if (!quote || !state.couponCode) return { subtotal, fee, discount: 0, total: subtotal + fee };

    const productDiscount = quote.discountType === 'percent'
        ? subtotal * (Math.min(Math.max(Number(quote.discountValue) || 0, 0), 100) / 100)
        : Number(quote.discountValue) || 0;
    const discount = Math.min(Math.max(productDiscount, 0), subtotal) + (quote.freeDelivery ? fee : 0);
    return { subtotal, fee, discount, total: Math.max(0, subtotal + fee - discount) };
}

function renderCartStep() {
    const cart = getActiveCart();
    const list = document.getElementById('checkout-items-list');
    if (cart.length === 0) {
        list.innerHTML = `<p style="text-align: center; padding: 40px; color: var(--text-gray);">Sua sacola está vazia.</p>`;
        document.getElementById('next-step-btn').disabled = true;
        return;
    }
    document.getElementById('next-step-btn').disabled = false;
    if (state.couponCode && !state.couponQuote) {
        loadCouponQuote()
            .then(() => { if (state.currentStep === 2) renderCartStep(); })
            .catch(() => { state.couponCode = ''; state.couponQuote = null; saveCheckoutState(); });
    }
    const summary = getCartPriceSummary(cart);
    const couponSummary = state.couponQuote ? `
        <div class="cart-price-summary">
            <div><span>Subtotal</span><strong>R$ ${summary.subtotal.toFixed(2)}</strong></div>
            <div class="cart-coupon-discount"><span>Cupom ${state.couponQuote.code || state.couponCode}</span><strong>${summary.discount > 0 ? `- R$ ${summary.discount.toFixed(2)}` : (state.couponQuote.freeDelivery ? 'Frete grátis' : '- R$ 0.00')}</strong></div>
            <div class="cart-price-total"><span>Total</span><strong>R$ ${summary.total.toFixed(2)}</strong></div>
        </div>` : `
        <div class="cart-price-summary cart-price-summary--single">
            <div class="cart-price-total"><span>Total</span><strong>R$ ${summary.total.toFixed(2)}</strong></div>
        </div>`;
    list.innerHTML = cart.map(item => `
                    <div class="checkout-item">
                        <div class="item-name-qty">
                            <div>
                                <strong>${item.name}</strong>
                                ${item.variation ? `<p style="font-size: 0.75rem; color: var(--text-gray);">${item.variation}</p>` : ''}
                                ${getCustomFieldSummaryParts(item).map(({ key, value, isUrl }) => '<p style="font-size:0.7rem;color:var(--text-gray);margin-top:2px;"><b>' + key + ':</b> ' + (isUrl ? '<a href="' + value + '" target="_blank" style="color:var(--primary-color);">Ver Imagem</a>' : String(value)) + '</p>').join('')}
                                ${item.addons ? (() => { try { const ads = JSON.parse(item.addons); return ads.map(a => '<p style="font-size:0.7rem;color:var(--text-gray);margin-top:2px;">- ' + (a.quantity > 1 ? a.quantity + 'x ' : '') + a.name + (a.price > 0 ? ' (R$ ' + (parseFloat(a.price) * (parseInt(a.quantity, 10) || 1)).toFixed(2) + ')' : '') + '</p>').join(''); } catch (e) { return ''; } })() : ''}
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
                `).join('') + couponSummary;
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
    renderCartStep();
    updateUI();
}

function selectPaymentMethod(method) {
    state.paymentMethod = method;
    document.querySelectorAll('.payment-card').forEach(el => {
        const isSelected = el.dataset.method === method;
        el.classList.toggle('selected', isSelected);
        const isCash = el.dataset.method === 'dinheiro';
        el.style.borderColor = isCash ? (isSelected ? '#e11d48' : '#fecdd3') : (isSelected ? 'var(--primary-color)' : '#e5e7eb');
        el.style.backgroundColor = isCash ? '#fff1f2' : (isSelected ? 'var(--primary-color)05' : '#fff');
        const checkIcon = el.querySelector('.payment-check-icon');
        if (checkIcon) checkIcon.style.color = isSelected ? (isCash ? '#e11d48' : 'var(--primary-color)') : '#ccc';
    });
    const cashField = document.getElementById('cash-change-field');
    if (cashField) cashField.style.display = method === 'dinheiro' ? 'block' : 'none';
    updateStep4Summary();
    saveCheckoutState();
}

function updateCashChangeFor(value) {
    const normalized = String(value || '').replace(',', '.').trim();
    state.cashChangeFor = normalized ? Number(normalized) : null;
    saveCheckoutState();
    updateStep4Summary();
}

function renderPaymentStep() {
    const opts = document.getElementById('payment-options');
    if (!opts) return;

    const activeTypeButton = document.querySelector(`#checkout-type-tabs .type-tab[data-method="${state.deliveryType}"]`);
    if (activeTypeButton && !activeTypeButton.querySelector('svg')) {
        setDeliveryType(state.deliveryType);
    }
    const addressDisplay = document.getElementById('delivery-address-display');
    if (addressDisplay) {
        addressDisplay.textContent = state.userInfo.address || 'Informe seu endereço';
    }

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
                                                <div class="payment-card" data-method="dinheiro" onclick="selectPaymentMethod('dinheiro')" style="border:2px solid #fecdd3; border-radius:12px; padding:12px; cursor:pointer; transition:0.2s; background:#fff1f2;">
                                                    <div style="display:flex; align-items:center;">
                                                        <div class="payment-icon" style="background:#ffe4e6; color:#e11d48; width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center; margin-right:12px;">
                                                            <i data-lucide="banknote"></i>
                                                        </div>
                                                        <div class="payment-info" style="flex:1;">
                                                            <h4 style="margin:0; font-size:1rem; color:#9f1239;">Dinheiro</h4>
                                                            <p style="margin:0; font-size:0.8rem; color:#be123c; font-weight:600;">Pagamento na entrega ou retirada.</p>
                                                        </div>
                                                        <div class="payment-check-icon" style="color:#ccc; margin-left:auto;">
                                                            <i data-lucide="check-circle-2"></i>
                                                        </div>
                                                    </div>
                                                    <div id="cash-change-field" onclick="event.stopPropagation()" style="display:${state.paymentMethod === 'dinheiro' ? 'block' : 'none'}; margin-top:12px; padding-top:12px; border-top:1px solid #fecdd3;">
                                                        <label style="display:block; font-size:0.82rem; font-weight:800; color:#9f1239; margin-bottom:6px;">Precisa de troco para qual valor?</label>
                                                        <input type="number" min="0" step="0.01" inputmode="decimal" value="${state.cashChangeFor || ''}" oninput="updateCashChangeFor(this.value)" placeholder="Ex.: 50,00" class="ifood-input" style="border-color:#fda4af; background:#fff;">
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

function renderReceivingStep() {
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

    const isScheduledOrder = state.activeTab === 'order';
    document.querySelectorAll('.receiving-store-hours').forEach((hours) => {
        hours.hidden = isScheduledOrder;
    });
    document.querySelectorAll('.order-schedule-notice').forEach((notice) => {
        const hasSchedule = isScheduledOrder && state.orderSchedule?.date && state.orderSchedule?.time;
        notice.hidden = !hasSchedule;
        notice.innerHTML = hasSchedule
            ? `<strong>${state.deliveryType === 'delivery' ? 'Entrega' : 'Retirada'} agendada</strong><span>${formatOrderSchedule()}</span><small>Compareça neste horário para que possamos atender seu pedido.</small>`
            : '';
    });

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
        const couponCode = String(document.getElementById('checkout-coupon')?.value || '').trim().toUpperCase();
        if (couponCode !== state.couponCode) state.couponQuote = null;
        state.couponCode = couponCode;
        saveCheckoutState();
        if (state.couponCode) {
            try {
                await loadCouponQuote();
            } catch (couponError) {
                state.couponQuote = null;
                return showAlert('Cupom inválido', couponError.message);
            }
        }
        if (state.activeTab === 'delivery' && !state.isOpen) {
            return showAlert('Loja Fechada', isOrderEnabled() ?
                'Estamos fechados para pronta entrega no momento. Por favor, utilize a aba de Encomendas para agendar seu pedido.' :
                'Estamos fechados para pronta entrega no momento.');
        }
        goToStep(2);
    } else if (state.currentStep === 2) {
        if (getActiveCart().length === 0) return showAlert('Sacola vazia', 'Adicione pelo menos um item para continuar.');
        if (state.activeTab === 'order') {
            if (!state.orderSchedule?.date || !state.orderSchedule?.time) {
                openScheduleModal('resume');
                return;
            }
            goToStep(hasCheckoutExtras() ? 3 : 4);
            return;
        }
        goToStep(4);
    } else if (state.currentStep === 3) {
        if (!isOrderEnabled()) return showAlert('Encomendas desativadas', 'No momento não estamos aceitando encomendas.');
        const extrasResult = collectCheckoutExtraStep();
        if (!extrasResult.ok) {
            return showAlert('Atenção', extrasResult.message || 'Preencha os campos extras antes de continuar.');
        }
        goToStep(4);
    } else if (state.currentStep === 4) {
        if (state.activeTab === 'delivery') {
            const hasCoordinates = Number.isFinite(Number(state.userInfo.latitude)) && Number.isFinite(Number(state.userInfo.longitude));
            if (state.deliveryType === 'delivery' && (!state.userInfo.address || !hasCoordinates)) return showAlert('Endereço Ausente', 'Informe CEP, rua e número e confirme a localização no mapa.');
            if (state.deliveryFee === 0 && state.deliveryType === 'delivery' && state.userInfo.address) {
                return showAlert('Taxa Indisponível', 'Por favor, aguarde o cálculo da taxa de entrega ou verifique se o endereço está no raio de entrega.');
            }
        }
        goToStep(5);
    } else if (state.currentStep === 5) {
        if (!state.paymentMethod) return showAlert('Atenção', 'Selecione uma forma de pagamento.');
        goToStep(6);
    }
}

function updateStep4Summary() {
    const cart = getActiveCart();
    const fee = state.deliveryType === 'delivery' ? state.deliveryFee : 0;
    const priceSummary = getCartPriceSummary(cart, fee);

    const subEl = document.getElementById('summary-subtotal');
    const feeEl = document.getElementById('summary-fee');
    const totalEl = document.getElementById('summary-total');
    const lineEl = document.getElementById('delivery-fee-line');
    const couponLineEl = document.getElementById('coupon-discount-line');
    const couponLabelEl = document.getElementById('summary-coupon-label');
    const couponDiscountEl = document.getElementById('summary-coupon-discount');
    const listEl = document.getElementById('review-items-list');
    const paymentSummaryEl = document.getElementById('payment-method-summary');
    const scheduleReviewEl = document.getElementById('order-schedule-review');
    const scheduleReviewValueEl = document.getElementById('order-schedule-review-value');

    if (paymentSummaryEl) {
        if (state.paymentMethod === 'dinheiro') {
            const totalForChange = priceSummary.total;
            const change = Number(state.cashChangeFor) > totalForChange ? Number(state.cashChangeFor) - totalForChange : 0;
            paymentSummaryEl.innerHTML = `<i data-lucide="banknote" style="vertical-align: middle; margin-right: 5px;"></i> Pagamento em Dinheiro${change > 0 ? ` · Troco: R$ ${change.toFixed(2).replace('.', ',')}` : ''}`;
            paymentSummaryEl.style.background = '#ffe4e6';
            paymentSummaryEl.style.color = '#9f1239';
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

    if (subEl) subEl.innerText = `R$ ${priceSummary.subtotal.toFixed(2)}`;
    if (feeEl) feeEl.innerText = `R$ ${priceSummary.fee.toFixed(2)}`;
    if (totalEl) totalEl.innerText = `R$ ${priceSummary.total.toFixed(2)}`;
    if (lineEl) lineEl.classList.toggle('hidden', state.deliveryType !== 'delivery');
    if (couponLineEl) couponLineEl.classList.toggle('hidden', !state.couponQuote);
    if (couponLabelEl) couponLabelEl.innerText = `Cupom ${state.couponQuote?.code || state.couponCode || ''}`.trim();
    if (couponDiscountEl) couponDiscountEl.innerText = priceSummary.discount > 0
        ? `- R$ ${priceSummary.discount.toFixed(2)}`
        : (state.couponQuote?.freeDelivery ? 'Frete grátis' : '- R$ 0.00');

    if (listEl) {
        listEl.innerHTML = cart.map(item => `
                        <div style="margin-bottom: 8px;">
                            <p style="font-size: 0.9rem; margin-bottom: 0;">${item.quantity}x ${item.name} ${item.variation ? `(${item.variation}${item.subItem ? ' - ' + item.subItem : ''})` : ''}</p>
                            ${getCustomFieldSummaryParts(item).map(({ key, value, isUrl }) => '<p style="font-size:0.75rem;color:var(--text-gray);margin-left:15px;margin-bottom:0;">- ' + key + ': ' + (isUrl ? 'Anexo' : String(value)) + '</p>').join('')}
                            ${item.addons ? (() => { try { const ads = JSON.parse(item.addons); return ads.map(a => '<p style="font-size:0.75rem;color:var(--text-gray);margin-left:15px;margin-bottom:0;">- ' + (a.quantity > 1 ? a.quantity + 'x ' : '') + a.name + '</p>').join(''); } catch (e) { return ''; } })() : ''}
                        </div>
                    `).join('');
    }
}

function addToCart() {
    if (areOrdersPaused()) return showOrdersPausedAlert();
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
    if (areOrdersPaused()) return showOrdersPausedAlert();
    if (state.activeTab === 'delivery' && !state.isOpen) {
        return showAlert('Loja Fechada', isOrderEnabled() ?
            'Estamos fechados para pronta entrega no momento. Utilize a aba de Encomendas para agendar!' :
            'Estamos fechados para pronta entrega no momento.');
    }
    const variation = state.currentVariation;
    const variations = JSON.parse(item.variations || '[]').filter(v => !v.hidden);
    if (variations.length > 0 && !variation) return showAlert('Quase lá...', 'Por favor, selecione uma opção para continuar.');
    if (!hasAvailableProductStock(item, variations) || (variation && !hasAvailableVariationStock(item, variation))) {
        return showAlert('Item indisponível', 'Esta opção está sem estoque no momento.');
    }

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
            const quantity = Array.from(document.querySelectorAll(`.addon-input[data-group-id="${g.id}"]`)).reduce((total, input) => total + getAddonQuantity(input), 0);
            if (quantity < g.min) {
                return showAlert('Atenção', `Selecione pelo menos ${g.min} opção em "${g.name}".`);
            }
        }
        const quantity = Array.from(document.querySelectorAll(`.addon-input[data-group-id="${g.id}"]`)).reduce((total, input) => total + getAddonQuantity(input), 0);
        if (quantity > maxAllowed) {
            return showAlert('Atenção', `O grupo "${g.name}" permite no máximo ${maxAllowed} opção(ões).`);
        }
    }

    // Coleta adicionais selecionados
    const {
        addons,
        addonTotal
    } = getSelectedAddons();
    const basePrice = getSelectedItemPrice(item);
    const finalUnitPrice = basePrice + addonTotal;

    const customFieldSchema = getCustomFieldSchema(item);
    const customFieldSchemaJSON = customFieldSchema.length > 0 ? JSON.stringify(customFieldSchema) : null;
    const customAnswersJSON = Object.keys(customAnswers).length > 0 ? JSON.stringify(customAnswers) : null;
    const customFieldItem = { ...item, customFieldSchema: customFieldSchemaJSON, customFieldValues: customAnswersJSON };
    const orderSelections = [...addons, ...getSelectedCustomFields(customFieldItem)];
    const addonsJSON = orderSelections.length > 0 ? JSON.stringify(orderSelections) : null;
    const sigKey = (customAnswersJSON || '') + (addonsJSON || '');
    const itemKeyBase = variation
        ? `${item.id}-${variation.name}${state.currentSubItem ? '-' + state.currentSubItem.name : ''}`
        : item.id;
    const itemKey = sigKey ? `${itemKeyBase}-${btoa(encodeURIComponent(sigKey)).substring(0, 12)}` : itemKeyBase;

    let cart = getActiveCart();
    const existing = cart.find(c => c.itemKey === itemKey);
    if (existing) existing.quantity += state.currentQty;
    else cart.push({
        productId: item.id,
        itemKey,
        name: item.name,
        variation: variation ? variation.name : null,
        subItem: state.currentSubItem ? state.currentSubItem.name : null,
        price: finalUnitPrice,
        quantity: state.currentQty,
        customFieldSchema: customFieldSchemaJSON,
        customFieldValues: customAnswersJSON,
        addons: addonsJSON
    });
    const suggestedSelection = state.suggestedSelection;
    const suggestedItem = suggestedSelection ? state.products.find(product => String(product.id) === String(suggestedSelection.productId)) : null;
    if (suggestedItem) {
        const suggestedVariation = suggestedSelection.variation
            ? JSON.parse(suggestedItem.variations || '[]').find(variation => String(variation?.name || '') === String(suggestedSelection.variation))
            : null;
        if (suggestedItem.active === false || !hasAvailableProductStock(suggestedItem) || (suggestedVariation && !hasAvailableVariationStock(suggestedItem, suggestedVariation))) {
            state.suggestedSelection = null;
            return showAlert('Item indisponível', 'A sugestão ficou sem estoque. Escolha outro item para continuar.');
        }
        const suggestedKey = `${suggestedItem.id}-${suggestedSelection.variation || 'item'}`;
        const existingSuggested = cart.find(cartItem => cartItem.itemKey === suggestedKey);
        if (existingSuggested) {
            existingSuggested.quantity += 1;
        } else {
            cart.push({
                productId: suggestedItem.id,
                itemKey: suggestedKey,
                name: suggestedItem.name,
                variation: suggestedSelection.variation || null,
                subItem: null,
                price: suggestedSelection.price,
                quantity: 1,
                customFieldSchema: null,
                customFieldValues: null,
                addons: null
            });
        }
    }
    setActiveCart(cart);

    // Tracking: AddToCart
    const finalPrice = finalUnitPrice;
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
    let cart = getActiveCart();
    const btn = document.getElementById('place-order-btn');
    if (areOrdersPaused()) return showOrdersPausedAlert();
    btn.disabled = true;
    btn.innerHTML = state.paymentMethod === 'dinheiro' ? 'Enviando Pedido...' : 'Processando Pagamento...';

    // Revalida o horário no último passo para impedir delivery com a loja fechada.
    checkStoreStatus();
    if (state.activeTab === 'delivery' && !state.isOpen) {
        btn.disabled = false;
        btn.innerHTML = 'Fazer pedido';
        return showAlert('Loja Fechada', isOrderEnabled()
            ? 'Estamos fechados para pronta entrega no momento. Utilize a aba de Encomendas para agendar.'
            : 'Estamos fechados para pronta entrega no momento.');
    }

    if (state.activeTab === 'order') {
        if (hasCheckoutExtras()) {
            const extrasResult = collectCheckoutExtraStep();
            if (!extrasResult.ok) {
                btn.disabled = false;
                btn.innerHTML = 'Fazer pedido';
                showAlert('Atenção', extrasResult.message || 'Preencha os campos extras antes de concluir.');
                return;
            }
            cart = extrasResult.cart;
        }
        if (!state.orderSchedule?.date || !state.orderSchedule?.time) {
            btn.disabled = false;
            btn.innerHTML = 'Fazer pedido';
            return showAlert('Agendamento ausente', 'Escolha a data e o horário da encomenda antes de concluir.');
        }
    }

    const totalValue = getCartPriceSummary(cart, state.deliveryType === 'delivery' ? state.deliveryFee : 0).total;
    if (state.paymentMethod === 'dinheiro' && Number(state.cashChangeFor) > 0 && Number(state.cashChangeFor) < totalValue) {
        btn.disabled = false;
        btn.innerHTML = 'Fazer pedido';
        return showAlert('Troco inválido', 'O valor informado para troco deve ser igual ou maior que o total do pedido.');
    }

    const formatItemName = (item) => {
        let base = item.name + (item.variation ? ` (${item.variation})` : '');
        if (item.subItem) base += ` - ${item.subItem}`;
        const extras = [];
        if (item.addons) {
            try {
                const ads = JSON.parse(item.addons);
                ads.forEach(a => {
                    if (!a.isCustomField) extras.push(`${Number(a.quantity) > 1 ? `${a.quantity}x ` : ''}${a.name}`);
                });
            } catch (e) { }
        }
        getCustomFieldSummaryParts(item).forEach(({
            key,
            value,
            isUrl
        }) => extras.push(`${key}: ${value}`));
        if (extras.length > 0) base += ` [${extras.join(', ')}]`;
        return base;
    };

    const payload = {
        clientName: state.userInfo.name,
        clientPhone: state.userInfo.phone,
        productId: cart[0].productId,
        product: formatItemName(cart[0]),
        variation: cart[0].variation,
        subItem: cart[0].subItem || null,
        quantity: cart[0].quantity,
        type: state.activeTab,
        deliveryAddress: state.deliveryType === 'delivery'
            ? state.userInfo.address
            : (state.deliveryType === 'local' ? 'Consumo no Local' : 'Retirada na Loja'),
        deliveryLatitude: state.deliveryType === 'delivery' ? state.userInfo.latitude : null,
        deliveryLongitude: state.deliveryType === 'delivery' ? state.userInfo.longitude : null,
        scheduledDate: state.activeTab === 'order' ? state.orderSchedule?.date || null : null,
        scheduledTime: state.activeTab === 'order' ? state.orderSchedule?.time || null : null,
        couponCode: state.couponCode || null,
        deliveryFee: state.deliveryType === 'delivery' ? state.deliveryFee : 0,
        paymentMethod: String(state.paymentMethod || '').trim().toLowerCase() === 'dinheiro' ? 'dinheiro' : state.paymentMethod,
        cashChangeFor: state.paymentMethod === 'dinheiro' && Number(state.cashChangeFor) > 0 ? Number(state.cashChangeFor) : null,
        totalValue: totalValue,
        addons: getOrderAddonsJSON(cart[0]),
        cartItems: cart.map(item => ({
            productId: item.productId,
            name: formatItemName(item),
            variation: item.variation || null,
            subItem: item.subItem || null,
            price: Number(item.price) || 0,
            quantity: Number(item.quantity) || 1
        })),
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
        if (!response.ok) throw new Error(data.error || 'Não foi possível registrar o pedido.');
        if (data.paymentLink) {
            // Tracking: InitiateCheckout (Meta) & begin_checkout (GA4)
            const totalValue = getCartPriceSummary(cart, state.activeTab === 'delivery' ? state.deliveryFee : 0).total;
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

            clearCompletedCheckout();
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
                    clearCompletedCheckout();
                    openPublicOrderStatus(data.id);
                    fetchPreviousOrders();
                });
            } else {
                btn.disabled = false;
                btn.innerHTML = 'Fazer pedido';
                alert(data.paymentError || 'Pedido registrado, mas houve um problema ao gerar o link de pagamento. Por favor, entre em contato.');
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

function getOrderStatusStages(order) {
    const fulfillment = String(order?.deliveryAddress || '').trim().toLowerCase();
    const isPickup = !fulfillment || /retirada\s+na\s+loja|retirada\s+no\s+local|consumo\s+no\s+local/.test(fulfillment);
    return [
        { id: 'waiting_payment', label: 'Aguardando pagamento' },
        { id: 'pending', label: 'Pagamento confirmado' },
        { id: 'accepted', label: 'Pedido aceito' },
        { id: 'production', label: 'Em preparação' },
        { id: 'ready', label: isPickup ? 'Pronto para retirada' : 'Saiu para entrega' },
        { id: 'completed', label: 'Finalizado' }
    ];
}

function renderPublicOrderStatus(order) {
    const target = document.getElementById('order-status-content');
    if (!target) return;

    const currentStatus = String(order?.status || 'waiting_payment').toLowerCase();
    const isCancelled = currentStatus === 'cancelled' || currentStatus === 'canceled';
    const stages = getOrderStatusStages(order);
    const currentIndex = stages.findIndex(stage => stage.id === currentStatus);
    const shortId = String(order?.shortId || order?.id || '').slice(-4).toUpperCase();
    const paymentConfirmed = ['confirmed', 'paid'].includes(String(order?.paymentStatus || '').toLowerCase());
    const isCashPayment = ['dinheiro', 'cash'].includes(String(order?.paymentMethod || '').trim().toLowerCase());
    const paymentLabel = isCashPayment ? 'Pagamento na entrega' : paymentConfirmed ? 'Pagamento confirmado' : 'Pagamento em análise';
    const paymentColors = isCashPayment ? { background: '#dbeafe', color: '#1d4ed8' } : paymentConfirmed ? { background: '#dcfce7', color: '#166534' } : { background: '#fef3c7', color: '#92400e' };

    if (isCancelled) {
        target.innerHTML = `<div style="padding:22px;text-align:center;background:#fff5f5;border:1px solid #fecaca;border-radius:16px;color:#991b1b;"><strong style="display:block;font-size:18px;">Pedido #${shortId} cancelado</strong><p style="margin:8px 0 0;line-height:1.5;">Entre em contato com a loja se precisar de ajuda.</p></div>`;
        return;
    }

    target.innerHTML = `
        <div style="padding:18px;border-radius:16px;background:#f7faf7;border:1px solid rgba(17,24,39,.08);">
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;"><div><div style="font-size:12px;font-weight:800;color:var(--text-gray);text-transform:uppercase;letter-spacing:.06em;">Pedido #${shortId}</div><strong style="display:block;margin-top:4px;font-size:18px;color:var(--text-main);">${stages[Math.max(0, currentIndex)]?.label || 'Atualizando pedido'}</strong></div><span style="padding:6px 9px;border-radius:999px;background:${paymentColors.background};color:${paymentColors.color};font-size:12px;font-weight:800;">${paymentLabel}</span></div>
            <p style="margin:12px 0 0;color:var(--text-gray);font-size:13px;line-height:1.55;">Esta página é atualizada automaticamente enquanto a loja atualiza seu pedido.</p>
        </div>
        <div style="margin:22px 4px 6px;display:grid;gap:0;">
            ${stages.map((stage, index) => {
                const done = currentIndex >= index;
                const active = currentIndex === index;
                return `<div style="display:grid;grid-template-columns:26px 1fr;gap:10px;min-height:48px;opacity:${done ? 1 : .45};"><div style="display:flex;flex-direction:column;align-items:center;"><span style="width:22px;height:22px;display:grid;place-items:center;border-radius:50%;background:${done ? 'var(--primary-color)' : '#e5e7eb'};color:${done ? '#fff' : '#94a3b8'};font-size:12px;font-weight:900;">${done ? '&#10003;' : index + 1}</span>${index < stages.length - 1 ? `<span style="width:2px;flex:1;min-height:20px;background:${currentIndex > index ? 'var(--primary-color)' : '#e5e7eb'};"></span>` : ''}</div><div style="padding:2px 0 14px;"><strong style="display:block;color:var(--text-main);font-size:14px;">${stage.label}</strong>${active ? '<span style="font-size:12px;color:var(--text-gray);">Status atual</span>' : ''}</div></div>`;
            }).join('')}
        </div>`;
}

async function refreshPublicOrderStatus() {
    if (!state.trackedOrderId) return;
    const target = document.getElementById('order-status-content');
    try {
        const response = await fetch(`${API_BASE}/orders/status/public/${STORE_SLUG}/${encodeURIComponent(state.trackedOrderId)}`);
        const order = await response.json();
        if (!response.ok) throw new Error(order?.error || 'Pedido não encontrado.');
        renderPublicOrderStatus(order);
        if (['completed', 'cancelled', 'canceled'].includes(String(order.status || '').toLowerCase()) && state.orderStatusRefreshTimer) {
            clearInterval(state.orderStatusRefreshTimer);
            state.orderStatusRefreshTimer = null;
        }
    } catch (error) {
        if (target) target.innerHTML = `<p style="padding:22px;text-align:center;color:var(--text-gray);">${error.message || 'Não foi possível atualizar o pedido agora.'}</p>`;
    }
}

function openPublicOrderStatus(orderId) {
    if (!orderId) return;
    state.trackedOrderId = orderId;
    if (state.orderStatusRefreshTimer) clearInterval(state.orderStatusRefreshTimer);
    openModal('order-status-modal');
    const target = document.getElementById('order-status-content');
    if (target) target.innerHTML = '<p style="padding:30px;text-align:center;color:var(--text-gray);">Atualizando pedido...</p>';
    refreshPublicOrderStatus();
    state.orderStatusRefreshTimer = setInterval(refreshPublicOrderStatus, 7000);
}

function closeOrderStatusModal() {
    closeWithAnimation('order-status-modal');
}

window.openPublicOrderStatus = openPublicOrderStatus;
window.closeOrderStatusModal = closeOrderStatusModal;

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

    list.innerHTML = state.previousOrders.slice(0, 10).map(o => {
        const shortId = String(o.id || '').slice(-4).toUpperCase();
        const status = String(o.status || 'waiting_payment').toLowerCase();
        const statusLabel = ({
            waiting_payment: 'Aguardando pagamento', pending: 'Pagamento confirmado', accepted: 'Pedido aceito',
            production: 'Em preparação', ready: o.type === 'delivery' ? 'Saiu para entrega' : 'Pronto para retirada',
            completed: 'Finalizado', cancelled: 'Cancelado', canceled: 'Cancelado'
        })[status] || 'Atualizando';
        return `
                    <div class="history-card" onclick="openPublicOrderStatus('${o.id}')">
                        <div class="history-card-info">
                            <strong>Pedido #${shortId}</strong>
                            <p>${statusLabel}</p>
                        </div>
                        <div class="history-card-action">
                            ${o.reviewed ? '<span class="history-reviewed-badge">Avaliado</span>' : (o.canReview ? `<button type="button" class="history-review-btn" onclick="event.stopPropagation(); openReviewModal('${o.id}')">Avaliar</button>` : '')}
                            <span>Acompanhar</span>
                            <i data-lucide="chevron-right"></i>
                        </div>
                    </div>
                `;
    }).join('');
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
        goToStep(getResumeStep());
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
    const useDarkTheme = data.menuTheme === 'dark';

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
    const storedBackground = String(data.backgroundColor || '').toLowerCase();
    const themeBg = useDarkTheme
        ? (['', '#ffffff', '#fff'].includes(storedBackground) ? '#031614' : data.backgroundColor)
        : (data.backgroundColor || '#ffffff');
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
