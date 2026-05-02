const prisma = require('./prisma');

let _settingsCache = null;
let _settingsCacheAt = 0;

async function getSettings() {
    const now = Date.now();
    // Cache de apenas 10 segundos para permitir atualizações rápidas do painel.
    if (_settingsCache && (now - _settingsCacheAt) < 10000) return _settingsCache;
    _settingsCache = await prisma.setting.findUnique({ where: { id: 'global' } });
    _settingsCacheAt = now;
    return _settingsCache;
}

function invalidateSettingsCache() { _settingsCache = null; }

let _productsCache = null;
let _productsCacheAt = 0;
let _instanceCache = {}; 

async function getCachedProducts() {
    const now = Date.now();
    // Cache de apenas 5 segundos (Atualização praticamente em tempo real)
    if (_productsCache && (now - _productsCacheAt) < 5000) return _productsCache;
    _productsCache = await prisma.product.findMany();
    _productsCacheAt = now;
    return _productsCache;
}

async function getCachedInstance(instanceId) {
    const now = Date.now();
    // Cache de apenas 10 segundos para permitir trocas de prompt rápidas.
    if (_instanceCache[instanceId] && (now - _instanceCache[instanceId].timestamp) < 10000) {
        return _instanceCache[instanceId].data;
    }
    const data = await prisma.instance.findUnique({ where: { id: instanceId } });
    _instanceCache[instanceId] = { data, timestamp: now };
    return data;
}

function invalidateProductCache() {
    _productsCache = null;
    _productsCacheAt = 0;
}

module.exports = {
    getSettings,
    invalidateSettingsCache,
    getCachedProducts,
    getCachedInstance,
    invalidateProductCache
};
