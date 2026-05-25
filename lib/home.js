const prisma = require('./prisma');

const DEFAULT_LIMIT = 18;
const BRAZIL_TIME_ZONE = 'America/Sao_Paulo';

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function initialsFromName(name) {
  const words = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'DZ';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] || ''}${words[1][0] || ''}`.toUpperCase();
}

function makePlaceholderLogo(name, accent = '#e11d48') {
  const initials = initialsFromName(name);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${accent}"/>
          <stop offset="100%" stop-color="#111827"/>
        </linearGradient>
      </defs>
      <rect width="256" height="256" rx="64" fill="url(#g)"/>
      <circle cx="128" cy="128" r="92" fill="rgba(255,255,255,0.12)"/>
      <text x="128" y="146" text-anchor="middle" font-family="Arial, sans-serif" font-size="78" font-weight="800" fill="#fff">${initials}</text>
    </svg>
  `.trim();
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function pickLogo(settings, name) {
  return settings?.logoUrl || makePlaceholderLogo(name, settings?.accentColor || '#e11d48');
}

function safeCategory(value) {
  return String(value || 'Geral').trim() || 'Geral';
}

function parseLocationMeta(value) {
  if (!value) {
    return {
      address: '',
      placeId: '',
      lat: null,
      lng: null,
      mapsUrl: ''
    };
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return {
      address: String(value.address || value.formatted_address || ''),
      placeId: String(value.placeId || value.place_id || ''),
      lat: value.lat !== undefined && value.lat !== null ? Number(value.lat) : null,
      lng: value.lng !== undefined && value.lng !== null ? Number(value.lng) : null,
      mapsUrl: String(value.mapsUrl || value.locationLink || '')
    };
  }

  const raw = String(value).trim();
  if (!raw) {
    return {
      address: '',
      placeId: '',
      lat: null,
      lng: null,
      mapsUrl: ''
    };
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        address: String(parsed.address || parsed.formatted_address || ''),
        placeId: String(parsed.placeId || parsed.place_id || ''),
        lat: parsed.lat !== undefined && parsed.lat !== null ? Number(parsed.lat) : null,
        lng: parsed.lng !== undefined && parsed.lng !== null ? Number(parsed.lng) : null,
        mapsUrl: String(parsed.mapsUrl || parsed.locationLink || '')
      };
    }
  } catch (error) {
    // fallback to plain string
  }

  return {
    address: raw,
    placeId: '',
    lat: null,
    lng: null,
    mapsUrl: ''
  };
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTimeToMinutes(time) {
  const [hours = 0, minutes = 0] = String(time || '')
    .split(':')
    .map((part) => Number(part));

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }

  return (hours * 60) + minutes;
}

function getBrazilTimeSnapshot() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BRAZIL_TIME_ZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date());

  const data = parts.reduce((acc, part) => {
    if (part.type !== 'literal') {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});

  const weekdayMap = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6
  };

  const weekdayKey = String(data.weekday || '').slice(0, 3).toLowerCase();
  const dayOfWeek = weekdayMap[weekdayKey] ?? new Date().getDay();
  const hour = Number(data.hour || 0);
  const minute = Number(data.minute || 0);

  return {
    dayOfWeek,
    minutes: (hour * 60) + minute,
    timeLabel: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  };
}

function timeFitsSlot(minutes, slot) {
  const start = parseTimeToMinutes(slot?.startTime);
  const end = parseTimeToMinutes(slot?.endTime);

  if (start === null || end === null) {
    return false;
  }

  if (start <= end) {
    return minutes >= start && minutes <= end;
  }

  return minutes >= start || minutes <= end;
}

function groupSlotsByUser(slots = []) {
  const map = new Map();

  for (const slot of slots) {
    if (!slot?.userId) continue;
    if (!map.has(slot.userId)) {
      map.set(slot.userId, []);
    }
    map.get(slot.userId).push(slot);
  }

  return map;
}

function buildScheduleState(slots = []) {
  const normalizedSlots = Array.isArray(slots) ? slots : [];

  if (normalizedSlots.length === 0) {
    return {
      hasSchedule: false,
      isOpenNow: true,
      statusLabel: 'Aberto',
      statusClass: 'open'
    };
  }

  const now = getBrazilTimeSnapshot();
  const matchingSlots = normalizedSlots.filter((slot) => Number(slot?.dayOfWeek) === now.dayOfWeek);
  const isOpenNow = matchingSlots.some((slot) => timeFitsSlot(now.minutes, slot));

  return {
    hasSchedule: true,
    isOpenNow,
    statusLabel: isOpenNow ? 'Aberto' : 'Apenas encomendas',
    statusClass: isOpenNow ? 'open' : 'closed'
  };
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const r = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}

function locationTextMatches(searchBlob, locationQuery) {
  if (!locationQuery) {
    return true;
  }

  if (searchBlob.includes(locationQuery)) {
    return true;
  }

  const fragments = locationQuery
    .split(/[,|-]/)
    .map((fragment) => normalizeText(fragment))
    .filter((fragment) => fragment.length >= 4 && !/^\d/.test(fragment));

  return fragments.some((fragment) => searchBlob.includes(fragment));
}

function storeMatchesSearch(store, query) {
  if (!query) {
    return true;
  }

  if (query.length < 2) {
    return true;
  }

  const blob = String(store?.searchBlob || '');
  if (blob.includes(query)) {
    return true;
  }

  const tokens = query
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);

  if (!tokens.length) {
    return blob.includes(query);
  }

  return tokens.every((token) => blob.includes(token));
}

function buildStoreSummary(store, scheduleState = {}, reviewSummary = {}) {
  const settings = store.settings || {};
  const businessName = settings.businessName || store.name || 'Restaurante';
  const businessCategory = safeCategory(settings.businessCategory);
  const logoUrl = pickLogo(settings, businessName);
  const locationMeta = parseLocationMeta(settings.businessLocation);
  const address = settings.businessAddress || locationMeta.address || '';
  const accentColor = settings.accentColor || '#e11d48';
  const locationLat = toFiniteNumber(settings.businessLat) ?? toFiniteNumber(locationMeta.lat);
  const locationLng = toFiniteNumber(settings.businessLng) ?? toFiniteNumber(locationMeta.lng);
  const businessPlaceId = settings.businessPlaceId || locationMeta.placeId || '';
  const businessMapsUrl = settings.businessMapsUrl || locationMeta.mapsUrl || '';
  const maxDeliveryKm = toFiniteNumber(settings.maxDeliveryKm) ?? 15;
  const ratingCount = Math.max(parseInt(reviewSummary.reviewCount, 10) || 0, 0);
  const ratingAverageRaw = toFiniteNumber(reviewSummary.averageRating);
  const ratingAverage = ratingCount > 0 && ratingAverageRaw !== null ? ratingAverageRaw : 5;
  const ratingLabel = ratingAverage.toFixed(1).replace('.', ',');
  const products = Array.isArray(store.products) ? store.products : [];
  const activeProducts = products.filter((product) => product && product.active !== false);
  const visibleProducts = activeProducts.filter((product) => String(product.type || '').toLowerCase() !== 'addon');
  const featuredProducts = visibleProducts
    .filter((product) => !!product.featured)
    .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
    .slice(0, 3)
    .map((product) => ({
      id: product.id,
      name: product.name,
      price: Number(product.price || 0),
      imageUrl: product.imageUrl || product.image || null
    }));

  const searchBlob = normalizeText([
    businessName,
    businessCategory,
    address,
    businessMapsUrl,
    businessPlaceId,
    locationMeta.mapsUrl,
    ...visibleProducts.flatMap((product) => [product.name, product.description || ''])
  ].join(' '));

  return {
    id: store.id,
    slug: store.slug,
    name: businessName,
    category: businessCategory,
    address,
    logoUrl,
    accentColor,
    active: store.active !== false,
    acceptOrders: settings.acceptOrders !== false,
    isOpenNow: scheduleState.isOpenNow !== false,
    hasSchedule: !!scheduleState.hasSchedule,
    scheduleLabel: scheduleState.statusLabel || 'Aberto',
    scheduleClass: scheduleState.statusClass || 'open',
    maxDeliveryKm,
    ratingAverage,
    ratingCount,
    ratingLabel,
    location: {
      address,
      placeId: businessPlaceId,
      lat: locationLat,
      lng: locationLng,
      mapsUrl: businessMapsUrl
    },
    productsCount: visibleProducts.length,
    featuredProducts,
    searchBlob,
    original: store
  };
}

function buildCategorySummaries(stores) {
  const categoryMap = new Map();

  stores.forEach((store) => {
    const key = safeCategory(store.category);
    const current = categoryMap.get(key) || {
      name: key,
      count: 0,
      logoUrl: store.logoUrl,
      accentColor: store.accentColor,
      representativeSlug: store.slug
    };

    current.count += 1;
    if (!current.logoUrl && store.logoUrl) current.logoUrl = store.logoUrl;
    if (!current.accentColor && store.accentColor) current.accentColor = store.accentColor;
    if (!current.representativeSlug && store.slug) current.representativeSlug = store.slug;

    categoryMap.set(key, current);
  });

  return Array.from(categoryMap.values())
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pt-BR'));
}

async function loadDirectoryStoresRaw() {
  const baseColumns = `
    u.id,
    u.slug,
    u.name,
    COALESCE(sp.active, u.active) AS active,
    COALESCE(sp.businessName, s.businessName) AS businessName,
    COALESCE(sp.businessCategory, s.businessCategory) AS businessCategory,
    COALESCE(sp.businessAddress, s.businessAddress) AS businessAddress,
    sp.businessPlaceId,
    sp.businessLat,
    sp.businessLng,
    sp.businessMapsUrl,
    COALESCE(sp.logoUrl, s.logoUrl) AS logoUrl,
    COALESCE(sp.accentColor, s.accentColor) AS accentColor,
    COALESCE(sp.acceptOrders, s.acceptOrders) AS acceptOrders,
    COALESCE(sp.maxDeliveryKm, s.maxDeliveryKm) AS maxDeliveryKm,
    s.businessLocation AS legacyBusinessLocation
  `;

  const sqlWithActive = `
    SELECT ${baseColumns}
    FROM \`user\` u
    LEFT JOIN \`setting\` s ON u.id = s.userId
    LEFT JOIN \`store_profile\` sp ON u.id = sp.userId
    ORDER BY u.name ASC
  `;

  const sqlWithoutActive = `
    SELECT
      u.id,
      u.slug,
      u.name,
      COALESCE(sp.active, 1) AS active,
      COALESCE(sp.businessName, s.businessName) AS businessName,
      COALESCE(sp.businessCategory, s.businessCategory) AS businessCategory,
      COALESCE(sp.businessAddress, s.businessAddress) AS businessAddress,
      sp.businessPlaceId,
      sp.businessLat,
      sp.businessLng,
      sp.businessMapsUrl,
      COALESCE(sp.logoUrl, s.logoUrl) AS logoUrl,
      COALESCE(sp.accentColor, s.accentColor) AS accentColor,
      COALESCE(sp.acceptOrders, s.acceptOrders) AS acceptOrders,
      COALESCE(sp.maxDeliveryKm, s.maxDeliveryKm) AS maxDeliveryKm,
      s.businessLocation AS legacyBusinessLocation
    FROM \`user\` u
    LEFT JOIN \`setting\` s ON u.id = s.userId
    LEFT JOIN \`store_profile\` sp ON u.id = sp.userId
    ORDER BY u.name ASC
  `;

  try {
    return await prisma.$queryRawUnsafe(sqlWithActive);
  } catch (error) {
    console.warn('[Home Directory] Falling back without user.active:', error?.message || error);
    return prisma.$queryRawUnsafe(sqlWithoutActive);
  }
}

function groupProductsByUser(products = []) {
  const map = new Map();
  for (const product of products) {
    const userId = product?.userId;
    if (!userId) continue;
    if (!map.has(userId)) {
      map.set(userId, []);
    }
    map.get(userId).push(product);
  }
  return map;
}

async function buildHomeDirectoryData({ search = '', category = '', location = '', locationLat = null, locationLng = null, limit = DEFAULT_LIMIT } = {}) {
  const [rawStores, products] = await Promise.all([
    loadDirectoryStoresRaw(),
    prisma.product.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        featured: true,
        displayOrder: true,
        imageUrl: true,
        image: true,
        type: true,
        userId: true
      }
    })
  ]);

  const reviewStatsByUser = new Map(
    rawStores.length > 0
      ? (await prisma.storeReview.groupBy({
          by: ['userId'],
          where: {
            userId: {
              in: rawStores.map((row) => row.id).filter(Boolean)
            }
          },
          _avg: {
            rating: true
          },
          _count: {
            _all: true
          }
        })).map((row) => [
          row.userId,
          {
            averageRating: row._avg.rating !== null && row._avg.rating !== undefined ? Number(row._avg.rating) : null,
            reviewCount: Number(row._count._all || 0)
          }
        ])
      : []
  );

  const slotsByUser = groupSlotsByUser(
    rawStores.length > 0
      ? await prisma.availableSlot.findMany({
          where: {
            userId: {
              in: rawStores.map((row) => row.id).filter(Boolean)
            }
          },
          select: {
            userId: true,
            dayOfWeek: true,
            startTime: true,
            endTime: true
          },
          orderBy: [
            { dayOfWeek: 'asc' },
            { startTime: 'asc' }
          ]
        })
      : []
  );

  const productsByUser = groupProductsByUser(products);
  const stores = rawStores.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    active: row.active !== undefined && row.active !== null ? Number(row.active) !== 0 : true,
    settings: {
      businessName: row.businessName,
      businessCategory: row.businessCategory,
      businessAddress: row.businessAddress,
      businessLocation: row.legacyBusinessLocation,
      businessPlaceId: row.businessPlaceId,
      businessLat: row.businessLat,
      businessLng: row.businessLng,
      businessMapsUrl: row.businessMapsUrl,
      logoUrl: row.logoUrl,
      accentColor: row.accentColor,
      acceptOrders: row.acceptOrders,
      maxDeliveryKm: row.maxDeliveryKm
    },
    products: productsByUser.get(row.id) || []
  }));

  const query = normalizeText(search);
  const selectedCategory = normalizeText(category);
  const locationQuery = normalizeText(location);
  const queryLat = toFiniteNumber(locationLat);
  const queryLng = toFiniteNumber(locationLng);

  const summaries = stores
    .map((store) => buildStoreSummary(
      store,
      buildScheduleState(slotsByUser.get(store.id) || []),
      reviewStatsByUser.get(store.id) || { averageRating: null, reviewCount: 0 }
    ))
    .filter((store) => {
      if (store.active === false) return false;
      if (store.acceptOrders === false) return false;
      if (selectedCategory && normalizeText(store.category) !== selectedCategory) return false;
      if (!storeMatchesSearch(store, query)) return false;
      if (Number.isFinite(queryLat) && Number.isFinite(queryLng)) {
        if (Number.isFinite(store.location?.lat) && Number.isFinite(store.location?.lng)) {
          const distance = haversineKm(queryLat, queryLng, store.location.lat, store.location.lng);
          if (Number.isFinite(distance) && distance > (store.maxDeliveryKm ?? 15)) return false;
        } else if (locationQuery && !locationTextMatches(store.searchBlob || '', locationQuery)) {
          return false;
        }
      } else if (locationQuery && !locationTextMatches(store.searchBlob || '', locationQuery)) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const scoreA = (a.featuredProducts.length * 10) + a.productsCount;
      const scoreB = (b.featuredProducts.length * 10) + b.productsCount;
      return scoreB - scoreA || a.name.localeCompare(b.name, 'pt-BR');
    });

  const categories = buildCategorySummaries(summaries);
  const featuredStores = summaries
    .filter((store) => store.featuredProducts.length > 0)
    .slice(0, 8);
  const restaurants = summaries.slice(0, limit);

  return {
    search,
    category,
    location,
    locationLat: queryLat,
    locationLng: queryLng,
    total: summaries.length,
    categories,
    featuredStores,
    restaurants
  };
}

function renderCategoryCards(categories = []) {
  if (!categories.length) {
    return `
      <div class="home-empty-state">
        Nenhuma categoria cadastrada ainda.
      </div>
    `;
  }

  return categories.map((category) => {
    const logoUrl = category.logoUrl || makePlaceholderLogo(category.name, category.accentColor || '#e11d48');
    return `
      <a class="home-category-card" href="#restaurantes" data-category="${escapeAttr(category.name)}">
        <div class="home-category-thumb">
          <img src="${escapeAttr(logoUrl)}" alt="${escapeAttr(category.name)}" loading="lazy" decoding="async">
        </div>
        <div class="home-category-label">
          <strong>${escapeHtml(category.name)}</strong>
          <span>${category.count} restaurante${category.count === 1 ? '' : 's'}</span>
        </div>
      </a>
    `;
  }).join('');
}

function renderHeroRestaurants(restaurants = []) {
  if (!restaurants.length) {
    return `
      <div class="hero-featured-empty">
        Cadastre restaurantes destacados para exibir promoções aqui.
      </div>
    `;
  }

  return restaurants.slice(0, 4).map((store) => {
    const image = store.logoUrl || makePlaceholderLogo(store.name, store.accentColor);
    const featuredName = store.featuredProducts[0]?.name || 'Destaque da loja';
    const isOpenNow = store.isOpenNow !== false;
    const statusLabel = isOpenNow ? 'Aberto' : 'Apenas encomendas';
    const statusClass = isOpenNow ? 'open' : 'closed';
    const ratingText = `★ ${store.ratingLabel}${store.ratingCount > 0 ? ` (${store.ratingCount})` : ''}`;
    return `
      <a class="hero-promo-card ${isOpenNow ? '' : 'is-closed'}" href="/${escapeAttr(store.slug)}">
        <div class="hero-promo-media">
          <img src="${escapeAttr(image)}" alt="${escapeAttr(store.name)}" loading="lazy" decoding="async">
        </div>
        <div class="hero-promo-copy">
          <div class="hero-promo-tag">Destaque</div>
          <strong>${escapeHtml(store.name)}</strong>
          <span>${escapeHtml(store.category)}</span>
          <span class="hero-rating">${escapeHtml(ratingText)}</span>
          ${isOpenNow ? '' : `<span class="dz-home2-restaurant-status ${statusClass} dz-home2-featured-status">${escapeHtml(statusLabel)}</span>`}
          <p>${escapeHtml(featuredName)}</p>
        </div>
      </a>
    `;
  }).join('');
}

function renderRestaurantCards(restaurants = []) {
  if (!restaurants.length) {
    return `
      <div class="home-empty-results">
        Nenhum restaurante encontrado.
      </div>
    `;
  }

  return restaurants.map((store) => {
    const image = store.logoUrl || makePlaceholderLogo(store.name, store.accentColor);
    const featuredLine = store.featuredProducts.length
      ? store.featuredProducts.map((item) => escapeHtml(item.name)).join(' · ')
      : 'Sem destaques cadastrados';
    const ratingText = `★ ${store.ratingLabel}${store.ratingCount > 0 ? ` (${store.ratingCount})` : ''}`;
    return `
      <article class="restaurant-card ${store.isOpenNow !== false ? '' : 'is-closed'}">
        <a href="/${escapeAttr(store.slug)}" class="restaurant-card-link ${store.isOpenNow !== false ? '' : 'is-closed'}">
          <div class="restaurant-card-media">
            <img src="${escapeAttr(image)}" alt="${escapeAttr(store.name)}" loading="lazy" decoding="async">
          </div>
          <div class="restaurant-card-content">
            <div class="restaurant-card-head">
              <div>
                <h3>${escapeHtml(store.name)}</h3>
                <p>${escapeHtml(store.category)}</p>
              </div>
              <span class="restaurant-status ${store.isOpenNow !== false ? 'open' : 'closed'}">${store.isOpenNow !== false ? 'Aberto' : 'Apenas encomendas'}</span>
            </div>
            <div class="restaurant-address">${escapeHtml(store.address || 'Endereço não informado')}</div>
            <div class="restaurant-meta">
              <span>${store.productsCount} item${store.productsCount === 1 ? '' : 's'}</span>
              <span class="store-rating-chip">${escapeHtml(ratingText)}</span>
              <span>${featuredLine}</span>
            </div>
          </div>
        </a>
      </article>
    `;
  }).join('');
}

module.exports = {
  buildHomeDirectoryData,
  renderCategoryCards,
  renderHeroRestaurants,
  renderRestaurantCards,
  makePlaceholderLogo,
  escapeHtml,
  escapeAttr,
  normalizeText
};
