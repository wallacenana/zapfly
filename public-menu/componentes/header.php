<!-- componentes/menu/header.php -->
<header class="top-nav">
    <div class="container nav-wrapper">
        <div class="store-info">
            <div class="store-logo">
                <img id="store-logo-img" src="<?php echo $store['logoUrl']; ?>" alt="Logo - <?php echo $businessName; ?>" style="width: 100%; height: 100%; object-fit: contain;">
            </div>
            <div class="store-details">
                <h1 id="store-name"><?php echo $businessName; ?></h1>
                <div class="store-status">
                    <span class="status-badge" id="store-status-badge">Carregando...</span>
                </div>
            </div>
        </div>
        <div class="nav-actions">
            <button id="history-toggle-btn" class="icon-btn" aria-label="Ver Histórico"><i data-lucide="history"></i></button>
        </div>
    </div>
</header>
