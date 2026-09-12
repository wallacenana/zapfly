const { Client } = require("@googlemaps/google-maps-services-js");
const { getSettings } = require('./cache');

const mapsClient = new Client({});

function getGoogleMapsApiKey(settings = {}) {
    return (
        process.env.GOOGLE_MAPS_API_KEY ||
        process.env.GOOGLE_MAPS_KEY ||
        process.env.GOOGLE_API_KEY ||
        settings?.googleApiKey ||
        ''
    ).trim();
}

function getStoreOrigin(settings = {}) {
    const lat = Number(settings?.businessLat);
    const lng = Number(settings?.businessLng);
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) {
        return `${lat},${lng}`;
    }

    const address = String(settings?.businessAddress || '').trim();
    return address || '';
}

/**
 * Calcula a estimativa de preço de moto baseado na quilometragem
 */
function estimateMotoPrice(km) {
    let price = 0;
    if (km <= 1.0) {
        price = 4.70;
    } else if (km <= 5.5) {
        price = 4.70 + ((km - 1.0) * 0.50);
    } else {
        price = 6.95 + ((km - 5.5) * 1.05);
    }

    const estimated = Math.round(price * 100) / 100;
    const min = Math.round(estimated * 0.95 * 100) / 100;
    const max = Math.round(estimated * 1.08 * 100) / 100;

    return { estimated, min, max };
}

function parseDeliveryRules(value) {
    let parsed = value;
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        } catch (error) {
            parsed = [];
        }
    }

    if (!Array.isArray(parsed)) return [];

    return parsed
        .map((rule) => ({
            maxKm: Number(rule?.maxKm),
            fee: Number(rule?.fee),
            allowCash: rule?.allowCash !== false
        }))
        .filter((rule) => Number.isFinite(rule.maxKm) && rule.maxKm > 0 && Number.isFinite(rule.fee) && rule.fee >= 0)
        .sort((a, b) => a.maxKm - b.maxKm);
}

/**
 * Calcula o valor do frete baseado no endereço do cliente e nas regras da loja
 */
async function calculateFee(clientAddress, userId, clientCoordinates = null) {
    const settings = await getSettings(userId);
    const apiKey = getGoogleMapsApiKey(settings);
    const origin = getStoreOrigin(settings);

    if (!apiKey) {
        console.error('[Maps Error] Google Maps API Key não configurada no ambiente!');
        return { error: 'Chave não configurada.' };
    }
    if (!origin) {
        console.error('[Maps Error] Endereço da empresa (origem) não configurado!');
        return { error: 'Origem não configurada.' };
    }

    try {
        const hasClientCoordinates = clientCoordinates
            && Number.isFinite(Number(clientCoordinates.lat))
            && Number.isFinite(Number(clientCoordinates.lng));
        const destination = hasClientCoordinates
            ? `${Number(clientCoordinates.lat)},${Number(clientCoordinates.lng)}`
            : clientAddress;
        const response = await mapsClient.distancematrix({
            params: {
                origins: [origin],
                destinations: [destination],
                key: apiKey,
                mode: 'driving'
            }
        });

        const data = response.data.rows[0].elements[0];
        if (!data || data.status !== 'OK') {
            console.error(`[Maps Error] Google retornou status: ${data?.status || 'UNKNOWN'}`);
            return { error: 'Endereço não localizado.' };
        }

        const distanceKm = data.distance.value / 1000;

        // Fixed rules take precedence over automatic/free fallbacks.
        const fixedRules = parseDeliveryRules(settings.deliveryRules);
        const fixedRule = fixedRules.find(rule => distanceKm <= rule.maxKm);
        if (fixedRule) {
            return {
                fee: Number(fixedRule.fee),
                distance: distanceKm.toFixed(1),
                type: 'fixed',
                allowCash: fixedRule.allowCash !== false
            };
        }

        const freeDeliveryEnabled = settings.freeDeliveryEnabled === true
            || settings.freeDeliveryEnabled === 1
            || String(settings.freeDeliveryEnabled).toLowerCase() === 'true';
        const freeDeliveryKm = Number(settings.freeDeliveryKm);

        if (freeDeliveryEnabled && Number.isFinite(freeDeliveryKm) && freeDeliveryKm > 0 && distanceKm <= freeDeliveryKm) {
            return {
                fee: 0,
                distance: distanceKm.toFixed(1),
                type: 'free',
                label: `Frete grátis até ${freeDeliveryKm.toFixed(1)}km`,
                allowCash: settings.allowCashOnDelivery !== false
            };
        }

        // Busca regras de frete fixo no banco para calcular limite dinâmico
        const rules = parseDeliveryRules(settings.deliveryRules);
        const configuredMaxKm = Number(settings.maxDeliveryKm);
        const maxKm = Number.isFinite(configuredMaxKm) && configuredMaxKm > 0 ? configuredMaxKm : 15;
        const mode = String(settings.deliveryMode || 'hibrido').trim().toLowerCase();

        // Verifica limite máximo de entrega absoluto (configuração geral)
        if (distanceKm > maxKm) {
            return { error: `Fora do raio de entrega permitido de ${maxKm.toFixed(1)}km (distância atual: ${distanceKm.toFixed(1)}km).`, distance: distanceKm.toFixed(1) };
        }

        if (mode === 'automatico') {
            const estimation = estimateMotoPrice(distanceKm);
            return {
                ...estimation,
                fee: estimation.estimated,
                distance: distanceKm.toFixed(1),
                type: 'estimated',
                allowCash: settings.allowCashOnDelivery !== false
            };
        }

        const matchingRule = rules.find(r => distanceKm <= r.maxKm);

        if (matchingRule) {
            return {
                fee: Number(matchingRule.fee),
                distance: distanceKm.toFixed(1),
                type: 'fixed',
                allowCash: matchingRule.allowCash !== false
            };
        }

        if (mode === 'manual') {
            const maxRule = rules.length > 0 ? rules[rules.length - 1].maxKm : 0;
            return { error: `Fora do raio manual de entrega. O limite cadastrado é ${maxRule}km.`, distance: distanceKm.toFixed(1) };
        }

        // Se não houver regra fixa e for 'hibrido', usa estimativa de moto
        const estimation = estimateMotoPrice(distanceKm);
        return {
            ...estimation,
            fee: estimation.estimated,
            distance: distanceKm.toFixed(1),
            type: 'estimated',
            allowCash: settings.allowCashOnDelivery !== false
        };

    } catch (e) {
        console.error('[Maps Error] Falha na requisição:', e.message);
        return { error: 'Erro ao calcular frete. Tente novamente.' };
    }
}

module.exports = {
    calculateFee,
    estimateMotoPrice
};
