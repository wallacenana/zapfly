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

/**
 * Calcula o valor do frete baseado no endereço do cliente e nas regras da loja
 */
async function calculateFee(clientAddress, userId) {
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
        const response = await mapsClient.distancematrix({
            params: {
                origins: [origin],
                destinations: [clientAddress],
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

        const freeDeliveryEnabled = settings.freeDeliveryEnabled === true;
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
        const rules = JSON.parse(settings.deliveryRules || '[]').sort((a, b) => a.maxKm - b.maxKm);
        const maxKm = settings.maxDeliveryKm || 15;
        const mode = settings.deliveryMode || 'hibrido';

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
                fee: matchingRule.fee,
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
