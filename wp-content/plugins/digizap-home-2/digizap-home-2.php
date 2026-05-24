<?php
/**
 * Plugin Name: DigiZap Home 2
 * Description: Home LP com header e hero em modo endereco -> catalogo.
 * Version: 1.0.0
 * Author: DigiZap
 */

if (!defined('ABSPATH')) {
    exit;
}

define('DIGIZAP_HOME2_VERSION', '1.0.0');
define('DIGIZAP_HOME2_FILE', __FILE__);
define('DIGIZAP_HOME2_DIR', plugin_dir_path(__FILE__));
define('DIGIZAP_HOME2_URL', plugin_dir_url(__FILE__));

require_once DIGIZAP_HOME2_DIR . 'includes/helpers.php';
require_once DIGIZAP_HOME2_DIR . 'shortcodes/home.php';

