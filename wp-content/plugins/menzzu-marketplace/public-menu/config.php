<?php

if (!defined('ABSPATH')) {
    exit;
}

function menzzu_marketplace_external_db_config()
{
    $config = [
        'host' => defined('MENZZU_EXTERNAL_DB_HOST') ? MENZZU_EXTERNAL_DB_HOST : getenv('MENZZU_EXTERNAL_DB_HOST'),
        'db' => defined('MENZZU_EXTERNAL_DB_NAME') ? MENZZU_EXTERNAL_DB_NAME : getenv('MENZZU_EXTERNAL_DB_NAME'),
        'user' => defined('MENZZU_EXTERNAL_DB_USER') ? MENZZU_EXTERNAL_DB_USER : getenv('MENZZU_EXTERNAL_DB_USER'),
        'pass' => defined('MENZZU_EXTERNAL_DB_PASSWORD') ? MENZZU_EXTERNAL_DB_PASSWORD : getenv('MENZZU_EXTERNAL_DB_PASSWORD'),
    ];

    if (in_array('', array_map('strval', $config), true)) {
        throw new RuntimeException('As credenciais do banco externo do Menzzu não foram configuradas.');
    }

    return $config;
}

$externalDb = menzzu_marketplace_external_db_config();
$host = $externalDb['host'];
$db = $externalDb['db'];
$user = $externalDb['user'];
$pass = $externalDb['pass'];
