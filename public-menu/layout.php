<!-- layout.php -->
<!DOCTYPE html>
<html lang="pt-BR">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?php echo $title ?? 'DigiZap | Cardápio Digital'; ?></title>
    <link rel="icon" type="image/x-icon" href="<?php echo $faviconUrl ?? '/favicon.ico'; ?>">
    <link
        href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
        rel="stylesheet">
    <link rel="stylesheet" href="/style.css?v=1.68">
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
    <script src="https://unpkg.com/lucide@latest"></script>
    <style>
        :root {
            --accent:
                <?php echo $accentColor ?? '#ff4d6d'; ?>
            ;
            --btn:
                <?php echo $buttonColor ?? '#ff4d6d'; ?>
            ;
            --btn-text:
                <?php echo $buttonTextColor ?? '#ffffff'; ?>
            ;
            --primary: #ff4d6d;
            --dark: #0f0f0f;
        }

        body {
            font-family: 'Plus Jakarta Sans', 'Outfit', sans-serif;
            background:
                <?php echo $backgroundColor ?? '#0f0f0f'; ?>
            ;
            color:
                <?php echo $textColor ?? 'white'; ?>
            ;
            margin: 0;
        }

        .page-content {
            min-height: 70vh;
        }
    </style>
    <?php echo $extraHead ?? ''; ?>
</head>

<body>
    <div id="app">
        <?php if ($showHeader !== false)
            include 'componentes/header.php'; ?>

        <main class="page-content">
            <?php echo $content; ?>
        </main>

        <?php if ($showFooter !== false)
            include 'componentes/footer.php'; ?>
    </div>

    <script>
        const API_BASE = 'https://api.digizap.com.br';
        lucide.createIcons();
    </script>
    <?php echo $extraScripts ?? ''; ?>
</body>

</html>