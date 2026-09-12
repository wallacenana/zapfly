<?php

if (!defined('ABSPATH')) {
    exit;
}

if (!class_exists('Menzzu_Marketplace_Updater')) {
    final class Menzzu_Marketplace_Updater
    {
        private $plugin_file;
        private $plugin_basename;
        private $manifest_url = 'https://cdn.jsdelivr.net/gh/wallacenana/menzzu-marketplace@main/update.json';
        private $cache_key = 'menzzu_marketplace_update_manifest';

        public function __construct($plugin_file)
        {
            $this->plugin_file = $plugin_file;
            $this->plugin_basename = plugin_basename($plugin_file);
            add_filter('site_transient_update_plugins', [$this, 'inject_update']);
            add_filter('plugins_api', [$this, 'plugin_information'], 20, 3);
            add_filter('upgrader_source_selection', [$this, 'normalize_package_source'], 10, 4);
            add_filter('upgrader_source_selection', [$this, 'recover_package_validation'], 99, 4);
        }

        private function is_target_update($hook_extra)
        {
            $requested = is_array($hook_extra) ? (string) ($hook_extra['plugin'] ?? '') : '';
            return $requested !== '' && ($requested === $this->plugin_basename || basename($requested) === basename($this->plugin_basename));
        }

        public function normalize_package_source($source, $remote_source, $upgrader, $hook_extra)
        {
            if (!$this->is_target_update($hook_extra) || is_wp_error($source)) {
                return $source;
            }

            $source = untrailingslashit((string) $source);
            if (basename($source) === 'menzzu-marketplace') {
                return $source;
            }

            $target = trailingslashit(dirname($source)) . 'menzzu-marketplace';
            global $wp_filesystem;
            if (!is_object($wp_filesystem)) {
                return $source;
            }

            // Reaproveita uma pasta válida deixada por uma tentativa anterior.
            if ($wp_filesystem->is_dir($target) && $wp_filesystem->exists($target . '/menzzu-marketplace.php')) {
                return $target;
            }

            if (function_exists('move_dir')) {
                $moved = move_dir($source, $target, true);
                if (!is_wp_error($moved) && $moved) {
                    return $target;
                }
            }

            $moved = $wp_filesystem->move($source, $target, true);
            if ($moved) {
                return $target;
            }

            return new WP_Error('menzzu_marketplace_update_folder', 'Não foi possível preparar a pasta do plugin Menzzu Marketplace.');
        }

        public function recover_package_validation($source, $remote_source, $upgrader, $hook_extra)
        {
            if (!$this->is_target_update($hook_extra) || !is_wp_error($source) || $source->get_error_code() !== 'incompatible_archive_no_plugins') {
                return $source;
            }

            global $wp_filesystem;
            if (!is_object($wp_filesystem)) return $source;
            $entries = $wp_filesystem->dirlist(untrailingslashit((string) $remote_source));
            if (!is_array($entries)) return $source;

            foreach ($entries as $name => $entry) {
                if (!is_array($entry) || (($entry['type'] ?? 'd') !== 'd')) continue;
                $candidate = trailingslashit($remote_source) . trim((string) $name, '/');
                $pluginFile = trailingslashit($candidate) . 'menzzu-marketplace.php';
                if ($wp_filesystem->exists($pluginFile)) {
                    return trailingslashit($candidate);
                }
            }

            return $source;
        }

        private function manifest($force = false)
        {
            if (!$force) {
                $cached = get_transient($this->cache_key);
                if (is_array($cached)) return $cached;
            }

            $response = wp_remote_get($this->manifest_url, [
                'timeout' => 10,
                'headers' => ['Accept' => 'application/json', 'Cache-Control' => 'no-cache']
            ]);
            if (is_wp_error($response) || wp_remote_retrieve_response_code($response) !== 200) {
                set_transient($this->cache_key, [], 15 * MINUTE_IN_SECONDS);
                return [];
            }

            $manifest = json_decode(wp_remote_retrieve_body($response), true);
            if (!is_array($manifest) || empty($manifest['version']) || empty($manifest['download_url'])) return [];
            set_transient($this->cache_key, $manifest, MINUTE_IN_SECONDS);
            return $manifest;
        }

        public function inject_update($transient)
        {
            if (!is_object($transient) || empty($transient->checked)) return $transient;
            $manifest = $this->manifest(isset($_GET['force-check']));
            $current = $transient->checked[$this->plugin_basename] ?? MENZZU_MARKETPLACE_VERSION;
            if (!empty($manifest['version']) && version_compare($manifest['version'], $current, '>')) {
                $transient->response[$this->plugin_basename] = (object) [
                    'slug' => $manifest['slug'],
                    'plugin' => $this->plugin_basename,
                    'new_version' => $manifest['version'],
                    'url' => $manifest['homepage'] ?? home_url('/'),
                    'package' => $manifest['download_url'],
                    'icons' => $manifest['icons'] ?? []
                ];
            }
            return $transient;
        }

        public function plugin_information($result, $action, $args)
        {
            if ($action !== 'plugin_information' || empty($args->slug) || $args->slug !== 'menzzu-marketplace') return $result;
            $manifest = $this->manifest();
            if (empty($manifest)) return $result;
            return (object) [
                'name' => $manifest['name'], 'slug' => $manifest['slug'], 'version' => $manifest['version'],
                'author' => $manifest['author'], 'homepage' => $manifest['homepage'],
                'download_link' => $manifest['download_url'], 'requires' => $manifest['requires'],
                'tested' => $manifest['tested'], 'requires_php' => $manifest['requires_php'],
                'last_updated' => $manifest['last_updated'], 'sections' => $manifest['sections'],
                'icons' => $manifest['icons'] ?? []
            ];
        }
    }
}

new Menzzu_Marketplace_Updater(MENZZU_MARKETPLACE_FILE);
