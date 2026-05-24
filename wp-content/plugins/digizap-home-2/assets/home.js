(function () {
  const config = window.dzHome2Config || {};
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

  function normalizeText(value) {
    return String(value ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function placeholderLogo(name, accent = '#e11d48') {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    let initials = 'DZ';
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

  function formatAddress(address) {
    const clean = String(address || '').trim();
    if (!clean) {
      return ['', ''];
    }

    const parts = clean.split(/[,|-]/).map((part) => part.trim()).filter(Boolean);
    const first = parts[0] || clean;
    let second = parts.slice(1).join(' - ');

    if (!second) {
      const match = clean.match(/\b\d+[A-Za-z]?\b/);
      if (match) {
        second = `Nº ${match[0]}`;
      }
    }

    return [first, second];
  }

  function getStorageKey(root) {
    return root.dataset.storageKey || 'dz_home2_address';
  }

  function readAddress(root) {
    try {
      const raw = window.localStorage.getItem(getStorageKey(root)) || '';
      if (!raw) {
        return {
          address: '',
          placeId: '',
          lat: null,
          lng: null
        };
      }

      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return {
            address: String(parsed.address || parsed.formatted_address || ''),
            placeId: String(parsed.placeId || parsed.place_id || ''),
            lat: parsed.lat ?? null,
            lng: parsed.lng ?? null
          };
        }
      } catch (error) {
        // fall back to plain string
      }

      return {
        address: String(raw),
        placeId: '',
        lat: null,
        lng: null
      };
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
    } catch (error) {
      // ignore
    }
  }

  function stateFor(root) {
    if (!stateByRoot.has(root)) {
      stateByRoot.set(root, {
        search: '',
        address: '',
        selectedAddress: null,
        addressSelected: false,
        abortController: null,
        timer: null
      });
    }
    return stateByRoot.get(root);
  }

  function updateContinueState(root) {
    const state = stateFor(root);
    const button = root.querySelector('[data-address-continue]');
    const input = root.querySelector('[data-address-input]');
    const hint = root.querySelector('[data-address-hint]');
    const hasText = Boolean(input && input.value.trim());

    if (button) {
      button.disabled = !state.addressSelected;
    }

    if (hint) {
      if (state.addressSelected) {
        hint.hidden = true;
        hint.textContent = '';
      } else if (hasText) {
        hint.hidden = false;
        hint.textContent = 'Escolha uma sugestão do Google para continuar.';
      } else {
        hint.hidden = true;
        hint.textContent = '';
      }
    }
  }

  function setMode(root, mode) {
    root.dataset.mode = mode;

    const landing = root.querySelector('[data-landing]');
    const catalog = root.querySelector('[data-catalog]');
    const guestActions = root.querySelector('[data-guest-actions]');
    const appActions = root.querySelector('[data-app-actions]');

    if (landing) landing.hidden = mode !== 'landing';
    if (catalog) catalog.hidden = mode !== 'app';
    if (guestActions) guestActions.hidden = mode !== 'landing';
    if (appActions) appActions.hidden = mode !== 'app';
  }

  function renderFeaturedCards(restaurants) {
    if (!Array.isArray(restaurants) || restaurants.length === 0) {
      return '<div class="dz-home2-empty">Sem destaques por enquanto.</div>';
    }

    return restaurants.slice(0, 8).map((store) => {
      const name = String(store?.name || 'Restaurante');
      const slug = String(store?.slug || '');
      const category = String(store?.category || '');
      const image = store?.logoUrl || placeholderLogo(name, store?.accentColor || '#e11d48');

      return `
        <a class="dz-home2-featured-card" href="${storeUrl(slug)}">
          <span class="dz-home2-featured-media"><img src="${escapeHtml(image)}" alt="${escapeHtml(name)}" loading="lazy" decoding="async"></span>
          <span class="dz-home2-featured-copy">
            <strong>${escapeHtml(name)}</strong>
            <small>${escapeHtml(category)}</small>
          </span>
        </a>
      `;
    }).join('');
  }

  function renderRestaurantCards(restaurants) {
    if (!Array.isArray(restaurants) || restaurants.length === 0) {
      return '<div class="dz-home2-empty-results">Nenhum restaurante encontrado.</div>';
    }

    return restaurants.map((store) => {
      const name = String(store?.name || 'Restaurante');
      const slug = String(store?.slug || '');
      const category = String(store?.category || '');
      const address = String(store?.address || 'Endereco nao informado');
      const image = store?.logoUrl || placeholderLogo(name, store?.accentColor || '#e11d48');
      const featuredLine = Array.isArray(store?.featuredProducts) && store.featuredProducts.length > 0
        ? store.featuredProducts.map((item) => String(item?.name || '')).filter(Boolean).join(' · ')
        : 'Sem destaques cadastrados';
      const isOpen = !!store?.acceptOrders;
      const count = Number(store?.productsCount || 0);

      return `
        <article class="dz-home2-restaurant-card">
          <a class="dz-home2-restaurant-link" href="${storeUrl(slug)}">
            <span class="dz-home2-restaurant-media"><img src="${escapeHtml(image)}" alt="${escapeHtml(name)}" loading="lazy" decoding="async"></span>
            <span class="dz-home2-restaurant-body">
              <span class="dz-home2-restaurant-head">
                <strong>${escapeHtml(name)}</strong>
                <span class="dz-home2-restaurant-status ${isOpen ? 'open' : 'closed'}">${isOpen ? 'Aberto' : 'Fechado'}</span>
              </span>
              <span class="dz-home2-restaurant-category">${escapeHtml(category)}</span>
              <span class="dz-home2-restaurant-address">${escapeHtml(address)}</span>
              <span class="dz-home2-restaurant-meta">${count} item${count === 1 ? '' : 's'} · ${escapeHtml(featuredLine)}</span>
            </span>
          </a>
        </article>
      `;
    }).join('');
  }

  function updateView(root, data) {
    const catalog = root.querySelector('[data-catalog]');
    const featuredTrack = root.querySelector('[data-featured-track]');
    const restaurantsGrid = root.querySelector('[data-restaurants-grid]');
    const emptyResults = root.querySelector('[data-empty-results]');
    const catalogSummary = root.querySelector('[data-catalog-summary]');
    const catalogCount = root.querySelector('[data-catalog-count]');
    const total = Number(data?.total || 0);
    const search = stateFor(root).search || '';

    if (featuredTrack) {
      featuredTrack.innerHTML = renderFeaturedCards(data?.featuredStores || []);
    }
    if (restaurantsGrid) {
      restaurantsGrid.innerHTML = renderRestaurantCards(data?.restaurants || []);
    }
    if (emptyResults) {
      emptyResults.hidden = total > 0;
    }
    if (catalogSummary) {
      catalogSummary.textContent = search
        ? `${total} resultado${total === 1 ? '' : 's'} para "${search}"`
        : (total > 0 ? `${total} restaurante${total === 1 ? '' : 's'} cadastrado${total === 1 ? '' : 's'}` : 'Nenhum restaurante cadastrado');
    }
    if (catalogCount) {
      catalogCount.textContent = String(total);
    }
    if (catalog && root.dataset.mode !== 'app') {
      catalog.hidden = true;
    }
  }

  async function fetchDirectory(root, search = '') {
    const state = stateFor(root);
    state.search = search;

    if (state.abortController) {
      state.abortController.abort();
    }

    const controller = new AbortController();
    state.abortController = controller;

    const params = new URLSearchParams();
    params.set('search', search || '');
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
      updateView(root, { total: 0, featuredStores: [], restaurants: [] });
    }
  }

  function syncAddressUI(root) {
    const address = readAddress(root);
    const state = stateFor(root);
    state.address = address.address || '';
    state.selectedAddress = address.placeId || address.lat !== null || address.lng !== null
      ? address
      : null;
    state.addressSelected = Boolean(state.selectedAddress);

    const [line1, line2] = formatAddress(address.address);
    const line1Node = root.querySelector('[data-address-line1]');
    const line2Node = root.querySelector('[data-address-line2]');
    const input = root.querySelector('[data-address-input]');
    const searchInput = root.querySelector('[data-search-input]');

    if (line1Node) {
      line1Node.textContent = line1 || 'Digite seu endereço';
    }
    if (line2Node) {
      line2Node.textContent = line2 || 'para ver os restaurantes';
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
      fetchDirectory(root, searchInput ? searchInput.value.trim() : '');
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
      const callbackName = `dzHome2GoogleMapsReady_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
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
    const state = stateFor(root);

    syncAddressUI(root);

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
        if (!state.addressSelected || !state.selectedAddress) {
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

        window.clearTimeout(state.timer);
        state.timer = window.setTimeout(() => {
          fetchDirectory(root, searchInput.value.trim());
        }, 220);
      });
    }

    if (editButton) {
      editButton.addEventListener('click', () => {
        const current = readAddress(root);
        const target = root.querySelector('[data-address-input]');
        if (target) {
          target.value = current.address || '';
          target.focus();
          target.select();
        }
        const state = stateFor(root);
        state.addressSelected = Boolean(current.placeId || current.lat !== null || current.lng !== null);
        state.selectedAddress = state.addressSelected ? current : null;
        updateContinueState(root);
        setMode(root, 'landing');
        const landing = root.querySelector('[data-landing]');
        if (landing) {
          landing.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    }
  }

  function init() {
    document.querySelectorAll('[data-dz-home2-root]').forEach((root) => {
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
