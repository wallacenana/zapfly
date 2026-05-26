(function () {
  const config = window.dzHome2BlogConfig || {};
  const storageKey = String(config.storageKey || 'dz_home2_reading_progress');
  const restBase = String(config.restBase || '').replace(/\/+$/, '');

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function normalizeProgress(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return 0;
    }
    return Math.max(0, Math.min(100, Math.round(number)));
  }

  function readSavedProgress() {
    if (!window.localStorage) {
      return null;
    }

    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        return null;
      }

      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') {
        return null;
      }

      const postId = Number(data.postId || 0);
      if (!Number.isFinite(postId) || postId < 1) {
        return null;
      }

      return {
        postId,
        title: String(data.title || ''),
        url: String(data.url || ''),
        progress: normalizeProgress(data.progress),
        updatedAt: Number(data.updatedAt || 0) || Date.now()
      };
    } catch (error) {
      return null;
    }
  }

  function saveProgress(data) {
    if (!window.localStorage || !data) {
      return;
    }

    try {
      localStorage.setItem(storageKey, JSON.stringify(data));
    } catch (error) {
      // Ignore storage quota or privacy exceptions.
    }
  }

  function getScrollProgress() {
    const doc = document.documentElement;
    const maxScroll = Math.max(1, (doc.scrollHeight || 0) - window.innerHeight);
    const current = Math.max(0, window.scrollY || window.pageYOffset || 0);
    return normalizeProgress((current / maxScroll) * 100);
  }

  function renderEmptyState(container) {
    if (!container) {
      return;
    }

    const section = container.closest('[data-dz-home2-continue-reading]');
    const emptyTitle = section?.dataset.emptyTitle || 'Nenhuma leitura salva ainda.';
    const emptyDescription = section?.dataset.emptyDescription || 'Abra um post para retomar de onde parou.';

    container.innerHTML = `
      <div class="dz-blog-empty-state">
        <strong>${escapeHtml(emptyTitle)}</strong>
        <p>${escapeHtml(emptyDescription)}</p>
      </div>
    `;
  }

  function renderContinueCard(container, payload) {
    if (!container) {
      return;
    }

    if (!payload || !payload.post) {
      renderEmptyState(container);
      return;
    }

    const post = payload.post;
    const image = String(post.image || '');
    const excerpt = String(post.excerpt || '');
    const badgeLabel = String(payload.badgeLabel || (payload.mode === 'next' ? 'Destaque' : 'Continue lendo'));
    const ctaLabel = String(payload.ctaLabel || 'Ler artigo completo');
    const readingTime = String(post.readingTimeLabel || '');
    const dateHuman = String(post.dateHuman || '');
    const mediaMarkup = image
      ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(post.title)}" loading="lazy" decoding="async">`
      : `<span class="dz-blog-continue-media-fallback" aria-hidden="true">Blog</span>`;

    container.innerHTML = `
      <a class="dz-blog-continue-card" href="${escapeHtml(post.url)}">
        <span class="dz-blog-continue-media">
          ${mediaMarkup}
        </span>
        <span class="dz-blog-continue-copy">
          <span class="dz-blog-continue-badge">${escapeHtml(badgeLabel)}</span>
          <h3>${escapeHtml(post.title)}</h3>
          ${excerpt ? `<p>${escapeHtml(excerpt)}</p>` : ''}
          <span class="dz-blog-continue-meta">
            ${readingTime ? `
              <span class="dz-blog-continue-meta-item">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"></circle>
                  <path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                </svg>
                <span>${escapeHtml(readingTime)}</span>
              </span>
            ` : ''}
            ${dateHuman ? `
              <span class="dz-blog-continue-meta-item">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <rect x="3" y="5" width="18" height="16" rx="3" ry="3" fill="none" stroke="currentColor" stroke-width="2"></rect>
                  <path d="M8 3v4M16 3v4M3 10h18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
                </svg>
                <span>${escapeHtml(dateHuman)}</span>
              </span>
            ` : ''}
          </span>
          <span class="dz-blog-continue-cta">
            <span>${escapeHtml(ctaLabel)}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M5 12h12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"></path>
              <path d="M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
          </span>
        </span>
      </a>
    `;
  }

  async function fetchContinuePayload(saved) {
    if (!restBase || !saved) {
      return null;
    }

    const url = new URL(`${restBase}/blog/continue`, window.location.origin);
    url.searchParams.set('post_id', String(Number(saved.postId || 0)));
    url.searchParams.set('progress', String(saved.progress || 0));

    const response = await fetch(url.toString(), {
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json'
      }
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || !data.post) {
      return null;
    }

    return data;
  }

  async function hydrateContinueWidgets() {
    const widgets = document.querySelectorAll('[data-dz-home2-continue-reading]');
    if (!widgets.length) {
      return;
    }

    const saved = readSavedProgress();
    const payload = await fetchContinuePayload(saved || { postId: 0, progress: 0 }).catch(() => null);

    for (const widget of widgets) {
      const body = widget.querySelector('[data-dz-home2-continue-body]') || widget;

      if (!restBase) {
        if (!saved) {
          renderEmptyState(body);
          continue;
        }

        renderContinueCard(body, {
          mode: 'continue',
          progress: saved.progress,
          progressLabel: saved.progress > 0 ? `${saved.progress}% lido` : 'Leitura salva no navegador',
          post: {
            title: saved.title || 'Post salvo',
            url: saved.url || '#',
            excerpt: ''
          }
        });
        continue;
      }

      if (!payload) {
        if (!saved) {
          renderEmptyState(body);
          continue;
        }

        renderContinueCard(body, {
          mode: 'continue',
          progress: saved.progress,
          progressLabel: saved.progress > 0 ? `${saved.progress}% lido` : 'Leitura salva no navegador',
          post: {
            title: saved.title || 'Post salvo',
            url: saved.url || '#',
            excerpt: ''
          }
        });
        continue;
      }

      renderContinueCard(body, payload);
    }
  }

  function initSinglePostTracking() {
    const singlePost = config.singlePost || null;
    if (!singlePost || !singlePost.id || !singlePost.url) {
      return;
    }

    let highestProgress = 0;
    let ticking = false;

    const persist = () => {
      const progress = getScrollProgress();
      if (progress < 5) {
        return;
      }
      if (progress < highestProgress) {
        return;
      }

      highestProgress = progress;
      saveProgress({
        postId: Number(singlePost.id),
        title: String(singlePost.title || document.title || ''),
        url: String(singlePost.url || window.location.href),
        progress,
        updatedAt: Date.now()
      });
    };

    const onScroll = () => {
      if (ticking) {
        return;
      }

      ticking = true;
      window.requestAnimationFrame(() => {
        persist();
        ticking = false;
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        persist();
      }
    });
    window.addEventListener('beforeunload', persist);
    persist();
  }

  document.addEventListener('DOMContentLoaded', () => {
    hydrateContinueWidgets();
    initSinglePostTracking();
  });
})();
