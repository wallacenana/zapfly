const prisma = require('./prisma');

let _settingsCache = {}; // userId -> { data, timestamp }
let _productsCache = {}; // userId -> { data, timestamp }
let _instanceCache = {}; // instanceId -> { data, timestamp }

async function getSettings(userId) {
    if (!userId) {
        // Fallback or error? For now, let's try to find any setting or return null
        return null;
    }
    const now = Date.now();
    if (_settingsCache[userId] && (now - _settingsCache[userId].timestamp) < 10000) {
        return _settingsCache[userId].data;
    }
    const data = await prisma.setting.findUnique({ where: { userId } });
    _settingsCache[userId] = { data, timestamp: now };
    return data;
}

function invalidateSettingsCache(userId) {
    if (userId) delete _settingsCache[userId];
    else _settingsCache = {};
}

async function getCachedProducts(userId) {
    if (!userId) return [];
    const now = Date.now();
    if (_productsCache[userId] && (now - _productsCache[userId].timestamp) < 5000) {
        return _productsCache[userId].data;
    }
    const data = await prisma.product.findMany({ where: { userId } });
    _productsCache[userId] = { data, timestamp: now };
    return data;
}

async function getCachedInstance(instanceId) {
    const now = Date.now();
    if (_instanceCache[instanceId] && (now - _instanceCache[instanceId].timestamp) < 10000) {
        return _instanceCache[instanceId].data;
    }
    const data = await prisma.instance.findUnique({ where: { id: instanceId } });
    _instanceCache[instanceId] = { data, timestamp: now };
    return data;
}

function invalidateProductCache(userId) {
    if (userId) delete _productsCache[userId];
    else _productsCache = {};
}

module.exports = {
    getSettings,
    invalidateSettingsCache,
    getCachedProducts,
    getCachedInstance,
    invalidateProductCache
};

