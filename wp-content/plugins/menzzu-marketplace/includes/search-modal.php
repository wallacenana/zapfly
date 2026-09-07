<?php

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('menzzu_marketplace_render_search_modal')) {
    function menzzu_marketplace_render_search_modal()
    {
        ob_start();
        ?>
        <div class="menzzu-marketplace-search-modal" data-search-modal hidden>
            <div class="menzzu-marketplace-search-modal-backdrop" data-search-modal-close></div>
            <div class="menzzu-marketplace-search-modal-panel" role="dialog" aria-modal="true" aria-label="Pesquisar">
                <div class="menzzu-marketplace-search-modal-head">
                    <strong>Pesquisar</strong>
                    <button type="button" class="menzzu-marketplace-search-modal-close" data-search-modal-close aria-label="Fechar pesquisa">
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path>
                        </svg>
                    </button>
                </div>
                <div class="menzzu-marketplace-search-modal-body">
                    <div class="menzzu-marketplace-search-modal-field">
                        <span class="menzzu-marketplace-search-modal-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="11" cy="11" r="7"></circle>
                                <path d="M20 20l-3.5-3.5"></path>
                            </svg>
                        </span>
                        <input type="search" data-search-modal-input placeholder="Buscar loja ou item" autocomplete="off" spellcheck="false">
                    </div>
                    <p class="menzzu-marketplace-search-modal-note">Digite para filtrar lojas e itens próximos.</p>
                </div>
            </div>
        </div>
        <?php
        return trim((string) ob_get_clean());
    }
}
