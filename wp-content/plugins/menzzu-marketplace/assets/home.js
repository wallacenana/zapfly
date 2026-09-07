(function () {
  const config = window.menzzuMarketplaceConfig || {};
  const categoryImageBaseUrl = String(config.categoryImageBaseUrl || '');
  const categoryImageRules = Array.isArray(config.categoryImageRules) ? config.categoryImageRules : [];
  const roots = new Set();
  const stateByRoot = new WeakMap();
  let googleLoaderPromise = null;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function ratingStarSvg(filled = true) {
    return `
      <svg class="menzzu-marketplace-rating-icon ${filled ? 'filled' : 'outline'}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9L12 2.5z" fill="${filled ? 'currentColor' : 'none'}" stroke="${filled ? 'none' : 'currentColor'}" stroke-width="1.8"></path>
      </svg>
    `;
  }

  function slugify(value) {
    return String(value ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function storeUrl(slug) {
    const clean = slugify(slug);
    const base = String(config.homeUrl || '/');
    const normalizedBase = base.endsWith('/') ? base : `${base}/`;
    return new URL(clean ? `${clean}/` : '', normalizedBase).toString();
  }

  function restaurantsUrl(categorySlug = '') {
    const base = String(config.restaurantsUrl || `${config.homeUrl || '/'}restaurantes/`);
    const normalizedBase = base.endsWith('/') ? base : `${base}/`;
    const url = new URL(normalizedBase);
    const clean = slugify(categorySlug);
    if (clean) {
      url.searchParams.set('cat', clean);
    }
    return url.toString();
  }

  function normalizeText(value) {
    return String(value ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeCategoryKey(value) {
    return normalizeText(value)
      .replace(/[&/_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function categorySlug(value) {
    return normalizeCategoryKey(value)
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function placeholderLogo(name, accent = '#e11d48') {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    let initials = 'MZ';
    if (words.length === 1) {
      initials = words[0].slice(0, 2).toUpperCase();
    } else if (words.length > 1) {
      initials = `${words[0][0] || ''}${words[1][0] || ''}`.toUpperCase();
    }
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
    `;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg.trim())}`;
  }

  function resolveCategoryImage(name) {
    const key = normalizeCategoryKey(name);
    if (!key) {
      return '';
    }

    for (const rule of categoryImageRules) {
      const match = normalizeCategoryKey(rule?.match || '');
      const file = String(rule?.file || '').trim();
      if (match && file && key.includes(match)) {
        return categoryImageBaseUrl ? `${categoryImageBaseUrl}${encodeURIComponent(file)}` : '';
      }
    }

    return '';
  }

  function formatAddress(address) {
    const clean = String(address || '').trim();
    if (!clean) {
      return ['', ''];
    }

    const parts = clean.split(/[,|-]/).map((part) => part.trim()).filter(Boolean);
    const street = parts[0] || clean;
    const streetMap = {
      travessa: 'Tv.',
      avenida: 'Av.',
      rua: 'R.',
      estrada: 'Est.',
      alameda: 'Al.',
      rodovia: 'Rod.',
      praça: 'Pç.',
      praca: 'Pç.',
      viela: 'Vl.',
      beco: 'Bc.',
      ladeira: 'Ld.',
      conjunto: 'Cj.',
      loteamento: 'Lot.'
    };
    const numberMatch = clean.match(/\b\d+[A-Za-z]?\b/);
    const number = numberMatch ? numberMatch[0] : '';
    const normalizedStreet = street.replace(/\b\d+[A-Za-z]?\b/g, '').replace(/\s+/g, ' ').trim();
    const streetWords = normalizedStreet.split(/\s+/).filter(Boolean);
    let prefix = '';

    if (streetWords.length > 0) {
      const firstWordKey = normalizeText(streetWords[0]);
      if (streetMap[firstWordKey]) {
        prefix = streetMap[firstWordKey];
        streetWords.shift();
      }
    }

    const prettyWord = (word) => {
      const value = String(word || '').trim();
      if (!value) return '';
      return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
    };

    const line1Parts = [];
    if (prefix) {
      line1Parts.push(prefix);
    }
    if (streetWords.length > 0) {
      line1Parts.push(prettyWord(streetWords[0]));
      if (streetWords[1]) {
        line1Parts.push(streetWords[1].charAt(0).toUpperCase());
      }
    } else if (normalizedStreet) {
      line1Parts.push(prettyWord(normalizedStreet));
    }

    let line1 = line1Parts.join(' ').replace(/\s+/g, ' ').trim();
    if (number) {
      line1 = line1 ? `${line1}, ${number}` : number;
    }
    if (Array.from(line1).length > 16) {
      line1 = Array.from(line1).slice(0, 16).join('').replace(/[ ,.-]+$/g, '');
    }

    const line2Parts = parts.slice(1).filter((part) => {
      const normalized = normalizeText(part);
      if (!normalized) return false;
      if (normalized === 'brasil' || normalized === 'brazil') return false;
      if (/^\d+$/.test(normalized)) return false;
      if (/^\d{5,}$/.test(normalized)) return false;
      return true;
    });
    const line2 = line2Parts.slice(0, 3).join(' - ');

    return [line1, line2];
  }

  function getStorageKey(root) {
    return root.dataset.storageKey || config.storageKey || 'menzzu_home_address';
  }

  function getAddressCookie(root) {
    const key = `${getStorageKey(root)}=`;
    const cookie = String(document.cookie || '')
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(key));

    if (!cookie) {
      return '';
    }

    const value = cookie.slice(key.length);
    try {
      return decodeURIComponent(value);
    } catch (error) {
      return value;
    }
  }

  function setAddressCookie(root, payload) {
    try {
      const key = getStorageKey(root);
      const value = encodeURIComponent(JSON.stringify(payload));
      document.cookie = `${key}=${value}; path=/; max-age=2592000; samesite=lax`;
    } catch (error) {
      // ignore
    }
  }

  function parseAddressPayload(raw) {
    const value = String(raw || '').trim();
    if (!value) {
      return null;
    }

    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') {
        return {
          address: String(parsed.address || parsed.formatted_address || ''),
          placeId: String(parsed.placeId || parsed.place_id || ''),
          lat: parsed.lat ?? null,
          lng: parsed.lng ?? null
        };
      }
    } catch (error) {
      // fall through to plain string
    }

    return {
      address: value,
      placeId: '',
      lat: null,
      lng: null
    };
  }

  function readAddress(root) {
    try {
      const storageRaw = window.localStorage.getItem(getStorageKey(root)) || '';
      const cookieRaw = getAddressCookie(root) || '';
      const candidates = [parseAddressPayload(storageRaw), parseAddressPayload(cookieRaw)]
        .filter(Boolean);

      if (candidates.length === 0) {
        return {
          address: '',
          placeId: '',
          lat: null,
          lng: null
        };
      }

      const score = (payload) => {
        let total = payload.address ? 1 : 0;
        if (payload.placeId) total += 10;
        if (payload.lat !== null || payload.lng !== null) total += 5;
        return total;
      };

      return candidates.sort((a, b) => score(b) - score(a))[0];
    } catch (error) {
      return {
        address: '',
        placeId: '',
        lat: null,
        lng: null
      };
    }
  }

  function saveAddress(root, address) {
    try {
      const payload = typeof address === 'string'
        ? {
          address,
          placeId: '',
          lat: null,
          lng: null
        }
        : {
          address: String(address?.address || address?.formatted_address || ''),
          placeId: String(address?.placeId || address?.place_id || ''),
          lat: address?.lat ?? null,
          lng: address?.lng ?? null
        };
      window.localStorage.setItem(getStorageKey(root), JSON.stringify(payload));
      setAddressCookie(root, payload);
    } catch (error) {
      // ignore
    }
  }

  function clearAddress(root) {
    const key = getStorageKey(root);
    const legacyKey = String(config.legacyStorageKey || 'dz_home2_address');

    try {
      window.localStorage.removeItem(key);
      if (legacyKey && legacyKey !== key) {
        window.localStorage.removeItem(legacyKey);
      }
    } catch (error) {
      // ignore
    }

    try {
      document.cookie = `${key}=; path=/; max-age=0; samesite=lax`;
      if (legacyKey && legacyKey !== key) {
        document.cookie = `${legacyKey}=; path=/; max-age=0; samesite=lax`;
      }
    } catch (error) {
      // ignore
    }
  }

  function stateFor(root) {
    if (!stateByRoot.has(root)) {
      stateByRoot.set(root, {
        search: '',
        categorySlug: String(root.dataset.categorySlug || ''),
        filter: 'all',
        sort: 'recommended',
        page: 1,
        address: '',
        selectedAddress: null,
        addressSelected: false,
        abortController: null,
        timer: null,
        lastData: null,
        scrollBound: false,
        scrollTicking: false,
        lastScrollY: window.scrollY || window.pageYOffset || 0
      });
    }
    return stateByRoot.get(root);
  }

  function updateContinueState(root) {
    const state = stateFor(root);
    const button = root.querySelector('[data-address-continue]');
    const input = root.querySelector('[data-address-input]');

    if (button) {
      button.disabled = !state.addressSelected && !(input && input.value.trim());
    }

    if (input && !state.addressSelected) {
      input.setAttribute('aria-invalid', input.value.trim() ? 'true' : 'false');
    } else if (input) {
      input.removeAttribute('aria-invalid');
    }
  }

  function setMode(root, mode) {
    root.dataset.mode = mode;

    const landing = root.querySelector('[data-landing]');
    const catalog = root.querySelector('[data-catalog]');
    const appActions = root.querySelector('[data-app-actions]');
    const keepHomeShell = root.dataset.homeShell === '1';

    if (keepHomeShell && mode === 'app' && landing) {
      landing.remove();
    } else if (landing) {
      landing.hidden = mode !== 'landing';
    }
    if (catalog) catalog.hidden = mode !== 'app';
    if (appActions) appActions.hidden = mode !== 'app';
  }

  function bindThemeToggle(root) {
    const button = root.querySelector('[data-theme-toggle]');
    if (!button || button.dataset.bound === '1') {
      return;
    }

    const storageKey = 'menzzu_marketplace_theme';
    const applyTheme = (theme) => {
      const isDark = theme === 'dark';
      root.dataset.theme = isDark ? 'dark' : 'light';
      button.setAttribute('aria-pressed', isDark ? 'true' : 'false');
      button.setAttribute('aria-label', isDark ? 'Ativar modo claro' : 'Ativar modo escuro');
    };

    let savedTheme = 'light';
    try {
      savedTheme = window.localStorage.getItem(storageKey) === 'dark' ? 'dark' : 'light';
    } catch (error) {
      savedTheme = 'light';
    }
    applyTheme(savedTheme);
    button.dataset.bound = '1';
    button.addEventListener('click', () => {
      const nextTheme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme(nextTheme);
      try {
        window.localStorage.setItem(storageKey, nextTheme);
      } catch (error) {
        // Theme still applies for the current page when storage is unavailable.
      }
    });
  }

  function setLoading(root, isLoading) {
    const itemTargets = root.querySelectorAll('[data-restaurants-grid], [data-rail-track]');

    if (isLoading) {
      root.dataset.loading = '1';
      itemTargets.forEach((target) => {
        target.classList.add('is-loading');
        if (target.children.length === 0) {
          target.innerHTML = Array.from({ length: 4 }, () => '<span class="menzzu-marketplace-item-skeleton" aria-hidden="true"></span>').join('');
        }
      });
    } else {
      delete root.dataset.loading;
      itemTargets.forEach((target) => target.classList.remove('is-loading'));
    }
  }

  function toNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatCurrencyBRL(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) {
      return '';
    }
    return amount.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    });
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

  function bindHeaderScroll(root) {
    const header = root.querySelector('.menzzu-marketplace-header');
    if (!header) return;

    const state = stateFor(root);
    if (state.scrollBound) return;
    state.scrollBound = true;
    state.lastScrollY = window.scrollY || window.pageYOffset || 0;

    const update = () => {
      const currentY = window.scrollY || window.pageYOffset || 0;
      const delta = currentY - state.lastScrollY;
      if (currentY <= 24 || delta < -8) {
        header.classList.remove('is-hidden');
      } else if (delta > 8) {
        header.classList.add('is-hidden');
      }
      state.lastScrollY = currentY;
    };

    update();

    window.addEventListener('scroll', () => {
      if (state.scrollTicking) return;
      state.scrollTicking = true;
      window.requestAnimationFrame(() => {
        update();
        state.scrollTicking = false;
      });
    }, { passive: true });
  }

  function bindFooterNav(root) {
    const searchButton = root.querySelector('[data-menzzu-marketplace-nav-search]');
    const searchModal = root.querySelector('[data-search-modal]');
    const searchModalInput = root.querySelector('[data-search-modal-input]');
    const closeButtons = root.querySelectorAll('[data-search-modal-close]');
    const state = stateFor(root);

    if (!searchButton) {
      return;
    }

    const openSearchModal = () => {
      if (!searchModal || !searchModalInput) {
        return;
      }

      const currentValue = root.dataset.mode === 'app'
        ? (root.querySelector('[data-search-input]')?.value || state.search || '')
        : (root.querySelector('[data-address-input]')?.value || state.address || '');

      searchModal.hidden = false;
      root.dataset.searchModalOpen = '1';
      searchModalInput.value = currentValue;
      window.requestAnimationFrame(() => {
        searchModalInput.focus({ preventScroll: true });
        searchModalInput.select();
      });
    };

    const closeSearchModal = () => {
      if (!searchModal || !searchModalInput) {
        return;
      }

      searchModal.hidden = true;
      delete root.dataset.searchModalOpen;
    };

    searchButton.addEventListener('click', (event) => {
      event.preventDefault();
      if (!searchModal || !searchModalInput) {
        const searchInput = root.querySelector('[data-search-input]');
        const addressInput = root.querySelector('[data-address-input]');
        const target = root.dataset.mode === 'app' ? searchInput : addressInput;
        if (target) {
          target.focus({ preventScroll: true });
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
      }

      if (searchModal.hidden) {
        openSearchModal();
      } else {
        closeSearchModal();
      }
    });

    closeButtons.forEach((button) => {
      button.addEventListener('click', closeSearchModal);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && root.dataset.searchModalOpen === '1') {
        closeSearchModal();
      }
    });

    searchModalInput?.addEventListener('input', () => {
      const value = searchModalInput.value.trim();
      state.search = value;
      window.clearTimeout(state.timer);
      state.timer = window.setTimeout(() => {
        if (root.dataset.mode === 'app') {
          fetchDirectory(root, value, state.address || '');
        }
      }, 220);
    });

    searchModalInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        closeSearchModal();
      }
    });

    root.addEventListener('click', (event) => {
      if (event.target?.matches?.('[data-search-modal-close]')) {
        closeSearchModal();
      }
    });
  }

  function renderFeaturedCards(restaurants) {
    if (!Array.isArray(restaurants) || restaurants.length === 0) {
      return '';
    }

    return restaurants.slice(0, 10).map((store) => {
      const name = String(store?.name || 'Restaurante');
      const slug = String(store?.slug || '');
      const category = String(store?.category || '');
      const image = store?.logoUrl || placeholderLogo(name, '#64748b');
      const schedule = getStoreScheduleState(store);
      const ratingVisible = Number(store?.orderCount || 0) > 0;
      const ratingLabel = String(store?.ratingLabel || '');
      const ratingCount = Number(store?.ratingCount || 0);
      const ratingText = ratingVisible
        ? `${ratingLabel || '5,0'}${ratingCount > 0 ? ` (${ratingCount})` : ''}`
        : '';
      const promoBadge = store?.hasPromotion ? '<span class="menzzu-marketplace-store-badge menzzu-marketplace-store-badge-promo">Promo</span>' : '';
      const freeBadge = store?.freeDeliveryEnabled ? '<span class="menzzu-marketplace-store-badge menzzu-marketplace-store-badge-free">Frete gratis</span>' : '';

      return `
        <a class="menzzu-marketplace-featured-card ${schedule.isOpenNow ? '' : 'is-closed'}" href="${storeUrl(slug)}" data-store-link>
          <span class="menzzu-marketplace-featured-media"><img src="${escapeHtml(image)}" alt="${escapeHtml(name)}" loading="lazy" decoding="async"></span>
          <span class="menzzu-marketplace-featured-copy">
            ${promoBadge}${freeBadge}
            <strong>${escapeHtml(name)}</strong>
            <small>${escapeHtml(category)}</small>
            ${ratingVisible ? `<span class="menzzu-marketplace-hero-rating">${ratingStarSvg(true)}<span class="menzzu-marketplace-rating-text">${escapeHtml(ratingText)}</span></span>` : ''}
            ${schedule.isOpenNow ? '' : `<span class="menzzu-marketplace-restaurant-status ${schedule.statusClass} menzzu-marketplace-featured-status">${escapeHtml(schedule.statusLabel)}</span>`}
          </span>
        </a>
      `;
    }).join('');
  }

  function renderStoreRailCards(restaurants) {
    return renderFeaturedCards(restaurants);
  }

  function renderCategoryCards(categories) {
    if (!Array.isArray(categories) || categories.length === 0) {
      return '<div class="menzzu-marketplace-empty">Nenhuma categoria encontrada.</div>';
    }

    return categories.slice(0, 12).map((category) => {
      const name = String(category?.name || 'Categoria');
      const count = Number(category?.count || 0);
      const slug = String(category?.slug || categorySlug(name));
      const image = resolveCategoryImage(name) || placeholderLogo(name, category?.accentColor || '#2dbd30');

      return `
        <a class="menzzu-marketplace-category-card" href="${escapeHtml(restaurantsUrl(slug))}" data-category="${escapeHtml(slug)}">
          <span class="menzzu-marketplace-category-thumb">
            <img src="${escapeHtml(image)}" alt="${escapeHtml(name)}" loading="lazy" decoding="async">
          </span>
          <span class="menzzu-marketplace-category-label">
            <strong>${escapeHtml(name)}</strong>
            <small>${count} restaurante${count === 1 ? '' : 's'}</small>
          </span>
        </a>
      `;
    }).join('');
  }

  function getStoreScheduleState(store) {
    const isOpenNow = store?.isOpenNow !== undefined
      ? !!store.isOpenNow
      : !!store?.acceptOrders;

    return {
      isOpenNow,
      statusLabel: isOpenNow ? 'Aberto' : 'Apenas encomendas',
      statusClass: isOpenNow ? 'open' : 'closed'
    };
  }

  function getStoreCategories(store) {
    const source = Array.isArray(store?.categories) && store.categories.length > 0
      ? store.categories
      : String(store?.category || '').split(/[·,|]/);

    return [...new Set(source.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 2);
  }

  function getStoreFulfillmentMethods(store) {
    const methods = store?.fulfillmentMethods && typeof store.fulfillmentMethods === 'object'
      ? store.fulfillmentMethods
      : {};
    const mode = String(store?.deliveryMode || '').toLowerCase();
    const labels = [];
    if (methods.delivery || (!Object.keys(methods).length && ['hibrido', 'delivery', 'entrega'].includes(mode))) labels.push('Entrega');
    if (methods.pickup || (!Object.keys(methods).length && ['hibrido', 'pickup', 'retirada'].includes(mode))) labels.push('Retirada');
    if (methods.local || (!Object.keys(methods).length && ['local', 'consumo'].includes(mode))) labels.push('Consumo no local');
    return labels;
  }

  function formatDistance(distanceKm) {
    const distance = Number(distanceKm);
    if (!Number.isFinite(distance) || distance < 0) return '';
    if (distance < 1) return `${Math.round(distance * 1000)} m`;
    return `${distance.toFixed(1).replace('.', ',')} km`;
  }

  function renderRestaurantCards(restaurants) {
    if (!Array.isArray(restaurants) || restaurants.length === 0) {
      return '<div class="menzzu-marketplace-empty-results">Nenhum restaurante encontrado.</div>';
    }

    return restaurants.map((store) => {
      const name = String(store?.name || 'Restaurante');
      const slug = String(store?.slug || '');
      const categories = getStoreCategories(store);
      const image = store?.logoUrl || placeholderLogo(name, '#64748b');
      const featuredLine = Array.isArray(store?.featuredProducts) && store.featuredProducts.length > 0
        ? store.featuredProducts.map((item) => String(item?.name || '')).filter(Boolean).join(' · ')
        : 'Sem destaques cadastrados';
      const schedule = getStoreScheduleState(store);
      const fulfillmentMethods = getStoreFulfillmentMethods(store);
      const prepTime = String(store?.prepTime || '').trim();
      const distance = formatDistance(store?.distanceKm);
      const ratingVisible = Number(store?.orderCount || 0) > 0;
      const ratingLabel = String(store?.ratingLabel || '');
      const ratingCount = Number(store?.ratingCount || 0);
      const ratingText = ratingVisible
        ? `${ratingLabel || '5,0'}${ratingCount > 0 ? ` (${ratingCount})` : ''}`
        : '';
      return `
        <article class="menzzu-marketplace-restaurant-card ${schedule.isOpenNow ? '' : 'is-closed'}">
          <a class="menzzu-marketplace-restaurant-link ${schedule.isOpenNow ? '' : 'is-closed'}" href="${storeUrl(slug)}" data-store-link>
            <span class="menzzu-marketplace-restaurant-media"><img src="${escapeHtml(image)}" alt="${escapeHtml(name)}" loading="lazy" decoding="async"></span>
            <span class="menzzu-marketplace-restaurant-body">
              <span class="menzzu-marketplace-restaurant-head">
                <strong>${escapeHtml(name)}</strong>
              </span>
              <span class="menzzu-marketplace-restaurant-category">${escapeHtml(categories.join(' · '))}</span>
              <span class="menzzu-marketplace-restaurant-meta">
                ${ratingVisible ? `<span class="menzzu-marketplace-rating-chip">${ratingStarSvg(true)}<span class="menzzu-marketplace-rating-text">${escapeHtml(ratingText)}</span></span>` : ''}
                ${prepTime ? `<span>${escapeHtml(prepTime)}</span>` : ''}
                ${distance ? `<span>${escapeHtml(distance)}</span>` : ''}
              </span>
              ${fulfillmentMethods.length ? `<span class="menzzu-marketplace-restaurant-badges">${fulfillmentMethods.map((method) => `<span class="menzzu-marketplace-store-badge">${escapeHtml(method)}</span>`).join('')}</span>` : ''}
            </span>
          </a>
        </article>
      `;
    }).join('');
  }

  function getStoreScore(store) {
    const featuredCount = Array.isArray(store?.featuredProducts) ? store.featuredProducts.length : 0;
    const promoCount = Number(store?.promotionProductsCount || 0);
    const freeDeliveryScore = store?.freeDeliveryEnabled ? 5 : 0;
    const productsCount = Number(store?.productsCount || 0);
    const orderCount = Number(store?.orderCount || 0);
    const ratingAverage = Number(store?.ratingAverage || 0);
    return (featuredCount * 10)
      + (promoCount * 8)
      + freeDeliveryScore
      + productsCount
      + (orderCount * 0.2)
      + (ratingAverage * 1.5);
  }

  function compareStores(a, b, sort = 'recommended') {
    const nameA = String(a?.name || '');
    const nameB = String(b?.name || '');

    if (sort === 'orders') {
      return (Number(b?.orderCount || 0) - Number(a?.orderCount || 0))
        || (Number(b?.ratingAverage || 0) - Number(a?.ratingAverage || 0))
        || nameA.localeCompare(nameB, 'pt-BR');
    }

    if (sort === 'rating') {
      return (Number(b?.ratingAverage || 0) - Number(a?.ratingAverage || 0))
        || (Number(b?.orderCount || 0) - Number(a?.orderCount || 0))
        || nameA.localeCompare(nameB, 'pt-BR');
    }

    if (sort === 'az') {
      return nameA.localeCompare(nameB, 'pt-BR');
    }

    return getStoreScore(b) - getStoreScore(a) || nameA.localeCompare(nameB, 'pt-BR');
  }

  function matchesFilter(store, filter) {
    switch (filter) {
      case 'featured':
        return !!store?.isFeatured || (Array.isArray(store?.featuredProducts) && store.featuredProducts.length > 0);
      case 'freeDelivery':
        return !!store?.freeDeliveryEnabled;
      case 'promo':
        return !!store?.hasPromotion;
      case 'open':
        return !!store?.isOpenNow;
      case 'closed':
        return !store?.isOpenNow;
      default:
        return true;
    }
  }

  function filterAndSortStores(stores, filter, sort) {
    return (Array.isArray(stores) ? stores : [])
      .filter((store) => matchesFilter(store, filter))
      .sort((a, b) => compareStores(a, b, sort));
  }

  function updateControlState(root) {
    const state = stateFor(root);
    root.querySelectorAll('[data-filter-pill]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.filterPill === state.filter);
    });
    const sortSelect = root.querySelector('[data-sort-select]');
    if (sortSelect && sortSelect.value !== state.sort) {
      sortSelect.value = state.sort;
    }
  }

  function renderPagination(root, total, page, pageSize) {
    const pagination = root.querySelector('[data-pagination]');
    if (!pagination) {
      return;
    }

    const pageCount = Math.ceil(total / pageSize);
    pagination.hidden = pageCount <= 1;
    if (pageCount <= 1) {
      pagination.innerHTML = '';
      return;
    }

    const buttons = [`<button type="button" class="menzzu-marketplace-pagination-button" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Página anterior">‹</button>`];
    for (let index = 1; index <= pageCount; index += 1) {
      buttons.push(`<button type="button" class="menzzu-marketplace-pagination-button${index === page ? ' is-active' : ''}" data-page="${index}" aria-current="${index === page ? 'page' : 'false'}">${index}</button>`);
    }
    buttons.push(`<button type="button" class="menzzu-marketplace-pagination-button" data-page="${page + 1}" ${page >= pageCount ? 'disabled' : ''} aria-label="Próxima página">›</button>`);
    pagination.innerHTML = buttons.join('');
  }

  function updateView(root, data) {
    const state = stateFor(root);
    state.lastData = data || state.lastData || {};
    const catalog = root.querySelector('[data-catalog]');
    const categoriesTrack = root.querySelector('[data-categories-track]');
    const restaurantsGrid = root.querySelector('[data-restaurants-grid]');
    const emptyResults = root.querySelector('[data-empty-results]');
    const catalogSummary = root.querySelector('[data-catalog-summary]');
    const sourceStores = Array.isArray(state.lastData?.stores) && state.lastData.stores.length > 0
      ? state.lastData.stores
      : (Array.isArray(state.lastData?.restaurants) ? state.lastData.restaurants : []);
    const visibleStores = filterAndSortStores(sourceStores, state.filter, state.sort);
    const total = visibleStores.length;
    const search = state.search || '';
    if (categoriesTrack) {
      categoriesTrack.innerHTML = renderCategoryCards(state.lastData?.categories || []);
    }
    const pageSize = Math.max(1, Number(root.dataset.limit || 18));
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    state.page = Math.min(Math.max(1, Number(state.page) || 1), pageCount);
    const pageStart = (state.page - 1) * pageSize;
    if (restaurantsGrid) {
      restaurantsGrid.innerHTML = renderRestaurantCards(visibleStores.slice(pageStart, pageStart + pageSize));
    }
    renderPagination(root, total, state.page, pageSize);
    if (emptyResults) {
      emptyResults.hidden = total > 0;
    }
    if (catalogSummary) {
      catalogSummary.textContent = search
        ? `${total} resultado${total === 1 ? '' : 's'} para "${search}"`
        : (total > 0 ? `${total} restaurante${total === 1 ? '' : 's'} cadastrado${total === 1 ? '' : 's'}` : 'Nenhum restaurante cadastrado');
    }
    updateControlState(root);
    if (catalog && root.dataset.mode !== 'app') {
      catalog.hidden = true;
    }

    setLoading(root, false);
  }

  async function fetchDirectory(root, search = '', location = '') {
    const state = stateFor(root);
    state.search = search;
    setLoading(root, true);

    if (state.abortController) {
      state.abortController.abort();
    }

    const controller = new AbortController();
    state.abortController = controller;

    const params = new URLSearchParams();
    params.set('search', search || '');
    params.set('location', location || '');
    if (state.categorySlug) {
      params.set('category', state.categorySlug);
    }
    if (state.selectedAddress?.lat !== null && state.selectedAddress?.lat !== undefined) {
      params.set('locationLat', String(state.selectedAddress.lat));
    }
    if (state.selectedAddress?.lng !== null && state.selectedAddress?.lng !== undefined) {
      params.set('locationLng', String(state.selectedAddress.lng));
    }
    params.set('limit', String(Number(root.dataset.limit || 18)));

    try {
      const response = await fetch(`${root.dataset.apiBase}/public/restaurants?${params.toString()}`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      updateView(root, data);

    } catch (error) {
      if (error.name === 'AbortError') {
        return;
      }
      setLoading(root, false);
      updateView(root, { total: 0, categories: [], stores: [], featuredStores: [], freeDeliveryStores: [], promoStores: [], restaurants: [] });
    }
  }

  function syncAddressUI(root) {
    const address = readAddress(root);
    const state = stateFor(root);
    state.address = address.address || '';
    state.selectedAddress = address.address ? address : null;
    state.addressSelected = Boolean(state.selectedAddress);

    const [line1, line2] = formatAddress(address.address);
    const line1Node = root.querySelector('[data-address-line1]');
    const input = root.querySelector('[data-address-input]');
    const searchInput = root.querySelector('[data-search-input]');
    const locationPill = root.querySelector('[data-edit-address]');

    if (locationPill) {
      locationPill.hidden = !address.address;
    }

    if (line1Node) {
      line1Node.textContent = line1 || 'Digite seu endereço';
    }
    if (input && !address.address) {
      input.value = '';
    }
    if (input && address.address && document.activeElement !== input) {
      input.value = address.address;
    }
    if (searchInput && root.dataset.mode !== 'app') {
      searchInput.value = '';
    }

    updateContinueState(root);

    if (state.addressSelected && address.address) {
      setMode(root, 'app');
      fetchDirectory(root, searchInput ? searchInput.value.trim() : '', address.address || state.address || '');
    } else {
      setMode(root, 'landing');
    }
  }

  function loadGoogleMaps(apiKey) {
    if (window.google?.maps?.places?.Autocomplete) {
      return Promise.resolve(window.google.maps.places);
    }

    if (googleLoaderPromise) {
      return googleLoaderPromise;
    }

    if (!apiKey) {
      return Promise.reject(new Error('missing-maps-key'));
    }

    googleLoaderPromise = new Promise((resolve, reject) => {
      const callbackName = `menzzuMarketplaceGoogleMapsReady_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const script = document.createElement('script');

      window[callbackName] = () => {
        try {
          delete window[callbackName];
        } catch (error) {
          window[callbackName] = undefined;
        }
        resolve(window.google?.maps?.places || null);
      };

      script.async = true;
      script.defer = true;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&libraries=places&callback=${callbackName}`;
      script.onerror = () => {
        try {
          delete window[callbackName];
        } catch (error) {
          window[callbackName] = undefined;
        }
        reject(new Error('google-maps-load-failed'));
      };
      document.head.appendChild(script);
    });

    return googleLoaderPromise;
  }

  function attachAutocomplete(root) {
    const input = root.querySelector('[data-address-input]');
    if (!input || input.dataset.autocompleteReady === '1' || input.dataset.autocompleteReady === 'loading') {
      return;
    }

    const apiKey = root.dataset.mapsKey || config.mapsKey || '';
    if (!apiKey) {
      return;
    }

    input.dataset.autocompleteReady = 'loading';

    loadGoogleMaps(apiKey)
      .then(() => {
        if (!window.google?.maps?.places?.Autocomplete) {
          input.dataset.autocompleteReady = 'error';
          return;
        }

        const autocomplete = new window.google.maps.places.Autocomplete(input, {
          types: ['address'],
          componentRestrictions: { country: 'br' }
        });

        if (typeof autocomplete.setFields === 'function') {
          autocomplete.setFields(['place_id', 'formatted_address', 'geometry', 'name']);
        }

        autocomplete.addListener('place_changed', () => {
          const place = autocomplete.getPlace ? autocomplete.getPlace() : null;
          const formatted = place?.formatted_address || place?.name || input.value.trim();
          const lat = place?.geometry?.location && typeof place.geometry.location.lat === 'function'
            ? place.geometry.location.lat()
            : null;
          const lng = place?.geometry?.location && typeof place.geometry.location.lng === 'function'
            ? place.geometry.location.lng()
            : null;

          const selectedAddress = {
            address: formatted,
            placeId: place?.place_id || '',
            lat,
            lng
          };

          const state = stateFor(root);
          state.selectedAddress = selectedAddress;
          state.addressSelected = true;
          state.address = formatted;

          input.value = formatted;
          updateContinueState(root);
        });

        input.dataset.autocompleteReady = '1';
      })
      .catch(() => {
        input.dataset.autocompleteReady = 'error';
      });
  }

  function bindRoot(root) {
    const form = root.querySelector('[data-address-form]');
    const input = root.querySelector('[data-address-input]');
    const searchInput = root.querySelector('[data-search-input]');
    const editButton = root.querySelector('[data-edit-address]');
    const controls = root.querySelector('[data-directory-controls]');
    const state = stateFor(root);

    syncAddressUI(root);
    bindHeaderScroll(root);
    bindFooterNav(root);
    bindThemeToggle(root);

    root.addEventListener('click', (event) => {
      const link = event.target?.closest?.('[data-store-link]');
      if (!link) {
        return;
      }

      try {
        window.localStorage.setItem('menzzu_marketplace_store_entry', String(Date.now()));
      } catch (error) {
        // ignore
      }
    });

    if (form && input) {
      input.addEventListener('focus', () => {
        attachAutocomplete(root);
      }, { passive: true });

      input.addEventListener('input', () => {
        if (input.dataset.autocompleteReady !== '1') {
          attachAutocomplete(root);
        }
        const state = stateFor(root);
        state.addressSelected = false;
        state.selectedAddress = null;
        updateContinueState(root);
      });

      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const state = stateFor(root);
        const typedAddress = input.value.trim();
        if (!state.addressSelected || !state.selectedAddress) {
          if (typedAddress.length < 5) {
            updateContinueState(root);
            return;
          }

          state.selectedAddress = {
            address: typedAddress,
            placeId: '',
            lat: null,
            lng: null
          };
          state.addressSelected = true;
          state.address = typedAddress;
        }

        if (!state.selectedAddress.address) {
          return;
        }

        saveAddress(root, state.selectedAddress);
        syncAddressUI(root);
        if (searchInput) {
          searchInput.focus();
        }
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        if (root.dataset.mode !== 'app') {
          return;
        }

        state.page = 1;
        window.clearTimeout(state.timer);
        state.timer = window.setTimeout(() => {
          fetchDirectory(root, searchInput.value.trim(), state.address || '');
        }, 220);
      });
    }

    if (controls) {
      controls.addEventListener('click', (event) => {
        const button = event.target?.closest?.('[data-filter-pill]');
        if (!button) {
          return;
        }
        const nextFilter = String(button.dataset.filterPill || 'all');
        if (state.filter === nextFilter) {
          return;
        }
        state.filter = nextFilter;
        state.page = 1;
        updateControlState(root);
        updateView(root, state.lastData || {});
      });

      controls.addEventListener('change', (event) => {
        const sortSelect = event.target?.matches?.('[data-sort-select]') ? event.target : null;
        if (!sortSelect) {
          return;
        }
        const nextSort = String(sortSelect.value || 'recommended');
        if (state.sort === nextSort) {
          return;
        }
        state.sort = nextSort;
        state.page = 1;
        updateControlState(root);
        updateView(root, state.lastData || {});
      });
    }

    const pagination = root.querySelector('[data-pagination]');
    if (pagination) {
      pagination.addEventListener('click', (event) => {
        const button = event.target?.closest?.('[data-page]');
        if (!button || button.disabled) {
          return;
        }
        state.page = Number(button.dataset.page) || 1;
        updateView(root, state.lastData || {});
        root.querySelector('[data-restaurants-grid]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    if (editButton) {
      editButton.addEventListener('click', () => {
        clearAddress(root);
        window.location.reload();
      });
    }
  }

  function init() {
    document.querySelectorAll('[data-menzzu-marketplace-root]').forEach((root) => {
      if (roots.has(root)) {
        return;
      }
      roots.add(root);
      bindRoot(root);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
