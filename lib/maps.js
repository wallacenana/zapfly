const { Client } = require("@googlemaps/google-maps-services-js");
const { getSettings } = require('./cache');

const mapsClient = new Client({});

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
async function calculateFee(clientAddress) {
    const settings = await getSettings();

    if (!settings?.googleApiKey) {
        console.error('[Maps Error] Google API Key não configurada no banco!');
        return { error: 'Chave não configurada.' };
    }
    if (!settings?.businessAddress) {
        console.error('[Maps Error] Endereço da empresa (origem) não configurado!');
        return { error: 'Origem não configurada.' };
    }

    try {
        const response = await mapsClient.distancematrix({
            params: {
                origins: [settings.businessAddress],
                destinations: [clientAddress],
                key: settings.googleApiKey,
                mode: 'driving'
            }
        });

        const data = response.data.rows[0].elements[0];
        if (!data || data.status !== 'OK') {
            console.error(`[Maps Error] Google retornou status: ${data?.status || 'UNKNOWN'}`);
            return { error: 'Endereço não localizado.' };
        }

        const distanceKm = data.distance.value / 1000;

        // Verifica limite máximo de entrega
        if (distanceKm > (settings.maxDeliveryKm || 15)) {
            return { error: `Limite excedido (${distanceKm.toFixed(1)}km).`, distance: distanceKm.toFixed(1) };
        }

        // Busca regras de frete fixo no banco
        const rules = JSON.parse(settings.deliveryRules || '[]').sort((a, b) => a.maxKm - b.maxKm);
        const matchingRule = rules.find(r => distanceKm <= r.maxKm);

        if (matchingRule) {
            return { fee: matchingRule.fee, distance: distanceKm.toFixed(1), type: 'fixed' };
        }

        // Se não houver regra fixa, usa estimativa de moto
        const estimation = estimateMotoPrice(distanceKm);
        return { 
            ...estimation, 
            fee: estimation.estimated, 
            distance: distanceKm.toFixed(1), 
            type: 'estimated' 
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
