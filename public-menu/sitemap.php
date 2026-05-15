<?php
header("Content-Type: text/plain; charset=utf-8");

// --- CONFIGURAÇÃO DO BANCO ---
$host = '192.185.211.125';
$db   = 'monte814_zapfly';
$user = 'monte814_zapfly';
$pass = 'Wa76855867.';

try {
    $pdo = new PDO("mysql:host=$host;dbname=$db;charset=utf8", $user, $pass);
    
    // Link da Home
    echo "https://digizap.com.br/\n";

    // Busca todos os slugs das lojas ativas
    $stmt = $pdo->query("SELECT slug FROM user WHERE active = 1");
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        echo "https://digizap.com.br/" . strtolower($row['slug']) . "\n";
    }

} catch (Exception $e) {
    echo "Erro ao gerar links.";
}
