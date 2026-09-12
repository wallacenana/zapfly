<?php

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('menzzu_marketplace_render_address_modal')) {
    function menzzu_marketplace_render_address_modal()
    {
        ob_start();
        ?>
        <div class="menzzu-marketplace-address-modal" data-address-modal hidden>
            <div class="menzzu-marketplace-address-modal-backdrop"></div>
            <div class="menzzu-marketplace-address-modal-panel" role="dialog" aria-modal="true" aria-labelledby="menzzu-address-modal-title">
                <div class="menzzu-marketplace-address-modal-illustration" aria-hidden="true">
                    <svg viewBox="0 0 260 130" focusable="false">
                        <path class="city" d="M36 108h188M55 108V72h27v36m9 0V49h29v59m11 0V66h29v42m11 0V38h28v70" />
                        <path class="pin-shadow" d="M129 111c-23 0-43-4-43-9s20-9 43-9 43 4 43 9-20 9-43 9Z" />
                        <path class="pin" d="M129 18c-20 0-36 16-36 36 0 28 36 57 36 57s36-29 36-57c0-20-16-36-36-36Z" />
                        <circle class="pin-hole" cx="129" cy="54" r="11" />
                        <path class="spark" d="m65 27 4 8 8 4-8 4-4 8-4-8-8-4 8-4 4-8Zm132 6 3 6 6 3-6 3-3 6-3-6-6-3 6-3 3-6Z" />
                    </svg>
                </div>
                <h2 id="menzzu-address-modal-title">Onde você quer receber seu pedido?</h2>
                <form class="menzzu-marketplace-address-form" data-address-form>
                    <span class="menzzu-marketplace-address-modal-search-icon" aria-hidden="true">⌕</span>
                    <input type="text" data-address-input placeholder="Buscar endereço e número" autocomplete="off" spellcheck="false" inputmode="text" aria-label="Endereço de entrega">
                    <button type="submit" class="menzzu-marketplace-button menzzu-marketplace-button-primary" data-address-continue disabled>Continuar</button>
                </form>
                <span class="menzzu-marketplace-address-modal-powered">powered by <strong>Google</strong></span>
            </div>
        </div>
        <?php
        return trim((string) ob_get_clean());
    }
}
