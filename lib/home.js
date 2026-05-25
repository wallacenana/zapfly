const prisma = require('./prisma');

const DEFAULT_LIMIT = 18;

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

function buildStoreSummary(store) {
  const settings = store.settings || {};
  const businessName = settings.businessName || store.name || 'Restaurante';
  const businessCategory = safeCategory(settings.businessCategory);
  const logoUrl = pickLogo(settings, businessName);
  const locationMeta = parseLocationMeta(settings.businessLocation);
  const address = locationMeta.address || settings.businessAddress || '';
  const accentColor = settings.accentColor || '#e11d48';
  const locationLat = toFiniteNumber(locationMeta.lat);
  const locationLng = toFiniteNumber(locationMeta.lng);
  const maxDeliveryKm = toFiniteNumber(settings.maxDeliveryKm) ?? 15;
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
    acceptOrders: settings.acceptOrders !== false,
    maxDeliveryKm,
    location: {
      address,
      placeId: locationMeta.placeId,
      lat: locationLat,
      lng: locationLng,
      mapsUrl: locationMeta.mapsUrl
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

async function buildHomeDirectoryData({ search = '', category = '', location = '', locationLat = null, locationLng = null, limit = DEFAULT_LIMIT } = {}) {
  const stores = await prisma.user.findMany({
    where: { active: true },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      slug: true,
      name: true,
      settings: {
        select: {
          businessName: true,
          businessCategory: true,
          businessAddress: true,
          businessLocation: true,
          logoUrl: true,
          accentColor: true,
          acceptOrders: true,
          maxDeliveryKm: true
        }
      },
      products: {
        select: {
          id: true,
          name: true,
          description: true,
          price: true,
          featured: true,
          displayOrder: true,
          imageUrl: true,
          image: true,
          type: true
        }
      }
    }
  });

  const query = normalizeText(search);
  const selectedCategory = normalizeText(category);
  const locationQuery = normalizeText(location);
  const queryLat = toFiniteNumber(locationLat);
  const queryLng = toFiniteNumber(locationLng);

  const summaries = stores
    .map(buildStoreSummary)
    .filter((store) => {
      if (selectedCategory && normalizeText(store.category) !== selectedCategory) return false;
      if (queryLat !== null && queryLng !== null) {
        if (store.location?.lat !== null && store.location?.lng !== null) {
          const distance = haversineKm(queryLat, queryLng, store.location.lat, store.location.lng);
          const radius = Number.isFinite(store.maxDeliveryKm) ? store.maxDeliveryKm : 15;
          if (!Number.isFinite(distance) || distance > radius) return false;
        } else if (!locationTextMatches(store.searchBlob, locationQuery)) {
          return false;
        }
      } else if (!locationTextMatches(store.searchBlob, locationQuery)) {
        return false;
      }
      if (!query) return true;
      return store.searchBlob.includes(query);
    })
    .sort((a, b) => {
      const scoreA = (a.featuredProducts.length * 10) + a.productsCount;
      const scoreB = (b.featuredProducts.length * 10) + b.productsCount;
      if (query) {
        const queryHitA = a.searchBlob.includes(query) ? 1 : 0;
        const queryHitB = b.searchBlob.includes(query) ? 1 : 0;
        if (queryHitA !== queryHitB) return queryHitB - queryHitA;
      }
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
    return `
      <a class="hero-promo-card" href="/${escapeAttr(store.slug)}">
        <div class="hero-promo-media">
          <img src="${escapeAttr(image)}" alt="${escapeAttr(store.name)}" loading="lazy" decoding="async">
        </div>
        <div class="hero-promo-copy">
          <div class="hero-promo-tag">Destaque</div>
          <strong>${escapeHtml(store.name)}</strong>
          <span>${escapeHtml(store.category)}</span>
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
    return `
      <article class="restaurant-card">
        <a href="/${escapeAttr(store.slug)}" class="restaurant-card-link">
          <div class="restaurant-card-media">
            <img src="${escapeAttr(image)}" alt="${escapeAttr(store.name)}" loading="lazy" decoding="async">
          </div>
          <div class="restaurant-card-content">
            <div class="restaurant-card-head">
              <div>
                <h3>${escapeHtml(store.name)}</h3>
                <p>${escapeHtml(store.category)}</p>
              </div>
              <span class="restaurant-status ${store.acceptOrders ? 'open' : 'closed'}">${store.acceptOrders ? 'Aberto' : 'Fechado'}</span>
            </div>
            <div class="restaurant-address">${escapeHtml(store.address || 'Endereço não informado')}</div>
            <div class="restaurant-meta">
              <span>${store.productsCount} item${store.productsCount === 1 ? '' : 's'}</span>
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
