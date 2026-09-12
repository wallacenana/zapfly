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
                <span class="menzzu-marketplace-address-modal-kicker">Antes de começar</span>
                <h2 id="menzzu-address-modal-title">Encontre lojas que entregam perto de você</h2>
                <p>Informe seu endereço para mostrar restaurantes e calcular a disponibilidade na sua região.</p>
                <form class="menzzu-marketplace-address-form" data-address-form>
                    <input type="text" data-address-input placeholder="Digite seu endereço de entrega" autocomplete="off" spellcheck="false" inputmode="text">
                    <button type="submit" class="menzzu-marketplace-button menzzu-marketplace-button-primary" data-address-continue disabled>Buscar lojas</button>
                </form>
            </div>
        </div>
        <?php
        return trim((string) ob_get_clean());
    }
}
