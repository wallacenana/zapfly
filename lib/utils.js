const prisma = require('./prisma');
const { getLinkPreview } = require('link-preview-js');

/**
 * Retorna o status atual da loja (ABERTA/FECHADA) baseado nos horários do banco
 */
async function getStoreStatus(userId) {
    if (!userId) return { statusLoja: "FECHADA", nomeDia: "", horaAtual: "", hoje: new Date(), isBeforeOpening: false, resumoHorarios: "" };
    
    const hoje = new Date();
    const timeZone = 'America/Sao_Paulo';
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(hoje).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(hoje);
    const diaSemana = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
    const horas = Number(parts.hour);
    const minutos = Number(parts.minute);
    const dataAtual = `${parts.day}/${parts.month}/${parts.year}`;

    const horaAtual = parts.hour + ':' + parts.minute;
    const minutosAtuais = (horas * 60) + minutos;

    const dias = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
    const nomeDia = dias[diaSemana];

    const allSlots = await prisma.availableSlot.findMany({ 
        where: { userId },
        orderBy: { dayOfWeek: 'asc' } 
    });

    let resumoHorarios = dias.map((dia, idx) => {
        const slotsDoDia = allSlots.filter(s => s.dayOfWeek === idx);
        if (slotsDoDia.length === 0) return `${dia}: FECHADO`;
        const periodos = slotsDoDia.map(s => `${s.startTime} às ${s.endTime}`).join(', ');
        return `${dia}: Aberto das ${periodos}`;
    }).join('\n');

    const slots = allSlots.filter(s => s.dayOfWeek === diaSemana);
    let statusLoja = "FECHADA";

    if (slots.length > 0) {
        for (const slot of slots) {
            const [startH, startM] = slot.startTime.split(':').map(Number);
            const [endH, endM] = slot.endTime.split(':').map(Number);
            const minutosInicio = (startH * 60) + startM;
            const minutosFim = (endH * 60) + endM;

            if (minutosAtuais >= minutosInicio && minutosAtuais <= minutosFim) {
                statusLoja = "ABERTA";
                break;
            }
        }
    }
    let isBeforeOpening = false;

    if (statusLoja === "FECHADA" && slots.length > 0) {
        isBeforeOpening = slots.some(slot => {
            const [startH, startM] = slot.startTime.split(':').map(Number);
            return (startH * 60 + startM) > minutosAtuais;
        });
    }

    return { statusLoja, nomeDia, horaAtual, dataAtual, hoje, isBeforeOpening, resumoHorarios };
}

function hasAvailableProductStock(prod, vars = []) {
    if (!prod.trackStock) return true;
    if (Number(prod.stock) > 0) return true;
    return vars.some(v => {
        if (Number(v?.stock) > 0) return true;
        return Array.isArray(v?.subItems) && v.subItems.some(item => Number(item?.stock) > 0);
    });
}

/**
 * Formata um produto e suas variações para exibição no catálogo da IA
 */
function formatProduct(prod, vars, showHidden = false) {
    let text = `*${prod.name}*`;
    if (prod.description) text += `\n_${prod.description}_`;

    const formatPrice = (value) => {
        const price = Number(value);
        return Number.isFinite(price) ? `: R$ ${price.toFixed(2)}` : '';
    };

    if (vars.length > 0) {
        const varLines = vars
            .filter(v => showHidden || !v.hidden)
            .map(v => {
                const subItems = Array.isArray(v.subItems) ? v.subItems : [];
                const hasSubItemStock = subItems.some(item => Number(item?.stock) > 0);
                const isEsgotado = prod.trackStock && ((subItems.length === 0 && Number(v.stock) <= 0) || (subItems.length > 0 && !hasSubItemStock))
                    ? " [ESGOTADO HOJE]"
                    : "";
                const hiddenLabel = (showHidden && v.hidden) ? " [INVISÍVEL]" : "";
                let line = `   - ${v.name || 'Opção'}${formatPrice(v.price)}${isEsgotado}${hiddenLabel}`;

                if (subItems.length > 0) {
                    const subItemLines = subItems
                        .filter(item => showHidden || !item?.hidden)
                        .map(item => {
                            const subItemOut = prod.trackStock && Number(item?.stock) <= 0 ? " [ESGOTADO HOJE]" : '';
                            return `      • ${item?.name || 'Opção'}${formatPrice(item?.promoPrice || item?.price)}${subItemOut}`;
                        });
                    if (subItemLines.length > 0) {
                        line += '\n      Subitens disponíveis:\n' + subItemLines.join('\n');
                    }
                }

                return line;
            }).join('\n');
        return text + '\n' + varLines;
    } else {
        const isEsgotado = (prod.trackStock && prod.stock <= 0) ? " [ESGOTADO HOJE]" : "";
        return text + ` - R$ ${Number(prod.price || 0).toFixed(2)}${isEsgotado}`;
    }
}

async function getDeliveryCatalog(userId) {
    const { getCachedProducts } = require('./cache');
    const products = await getCachedProducts(userId);
    const available = products.filter(product => {
        if (product.active === false) return false;
        if (product.type !== 'delivery' && product.type !== 'combo_delivery') return false;

        let variations = [];
        try {
            variations = typeof product.variations === 'string'
                ? JSON.parse(product.variations || '[]')
                : (product.variations || []);
        } catch (_) {
            variations = [];
        }
        return hasAvailableProductStock(product, variations);
    });

    const text = available.map(product => {
        let variations = [];
        try {
            variations = typeof product.variations === 'string'
                ? JSON.parse(product.variations || '[]')
                : (product.variations || []);
        } catch (_) {
            variations = [];
        }
        const visibleVariations = variations.filter(variation => !variation.hidden);
        const lines = [`*${product.name}*`];

        if (visibleVariations.length > 0) {
            lines.push(visibleVariations.map(variation => {
                const price = Number(variation.promoPrice || variation.price || 0).toFixed(2);
                return `   - ${variation.name}: R$ ${price}`;
            }).join('\n'));
        } else {
            lines.push(`- R$ ${Number(product.promoPrice || product.price || 0).toFixed(2)}`);
        }

        return lines.join('\n');
    }).join('\n\n');

    return {
        text: text || 'Nenhum item de pronta entrega no momento.',
        count: available.length
    };
}

async function getOrderCatalog(userId) {
    const { getCachedProducts } = require('./cache');
    const products = await getCachedProducts(userId);
    const orderable = products.filter(product => {
        if (product.active === false) return false;
        return product.type === 'delivery'
            || product.type === 'combo_delivery'
            || product.type === 'encomenda'
            || String(product.type || '').startsWith('combo_');
    });

    const text = orderable.map(product => {
        let variations = [];
        try {
            variations = typeof product.variations === 'string'
                ? JSON.parse(product.variations || '[]')
                : (product.variations || []);
        } catch (_) {
            variations = [];
        }

        const visibleVariations = variations.filter(variation => !variation.hidden);
        const lines = [`*${product.name}*`];
        if (visibleVariations.length > 0) {
            lines.push(visibleVariations.map(variation => {
                const price = Number(variation.promoPrice || variation.price || 0).toFixed(2);
                return `   - ${variation.name}: R$ ${price}`;
            }).join('\n'));
        } else {
            lines.push(`- R$ ${Number(product.promoPrice || product.price || 0).toFixed(2)}`);
        }
        return lines.join('\n');
    }).join('\n\n');

    return {
        text: text || 'Nenhum item disponível para encomenda no momento.',
        count: orderable.length
    };
}

async function getRestaurantGreeting(instanceId, userId) {
    const { getSettings } = require('./cache');
    const [settings, instance, user] = await Promise.all([
        getSettings(userId),
        prisma.instance.findUnique({ where: { id: instanceId }, select: { assistantName: true } }),
        prisma.user.findUnique({ where: { id: userId }, select: { name: true, slug: true } })
    ]);

    const assistantName = instance?.assistantName || 'Lily';
    const restaurantName = settings?.businessName || user?.name || settings?.name || 'nosso restaurante';
    const slug = String(user?.slug || settings?.slug || '').trim().replace(/^\/+|\/+$/g, '');
    const menuUrl = slug ? `https://menzzu.com/${slug}` : 'https://menzzu.com';

    return `Olá! Eu sou a ${assistantName}, assistente virtual da ${restaurantName}. Estou aqui pra tirar suas dúvidas e ajudar com seu pedido. Se quiser agilizar, acesse diretamente nosso cardápio: ${menuUrl}`;
}

function getSaoPauloDateKey(date) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(date);
}

async function shouldSendRestaurantGreeting(instanceId, jid) {
    const recentOutgoingMessages = await prisma.message.findMany({
        where: {
            instanceId,
            jid,
            fromMe: true
        },
        orderBy: { timestamp: 'desc' },
        take: 50,
        select: { timestamp: true, text: true }
    });

    const lastGreeting = recentOutgoingMessages.find(message => {
        const normalizedText = String(message.text || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
        return normalizedText.startsWith('ola! eu sou') || normalizedText.startsWith('ola, eu sou');
    });

    if (!lastGreeting?.timestamp) return true;

    return getSaoPauloDateKey(new Date(lastGreeting.timestamp)) !== getSaoPauloDateKey(new Date());
}

/**
 * Envia uma mensagem com preview de link se houver URL
 */
async function sendRichMessage(sock, jid, text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const match = text.match(urlRegex);

    if (match) {
        try {
            const preview = await getLinkPreview(match[0], {
                imagesPropertyType: "og",
                headers: { "user-agent": "WhatsApp/2.21.11.17" }
            });

            return await sock.sendMessage(jid, {
                text: text,
                linkPreview: {
                    title: preview.title,
                    description: preview.description,
                    canonicalUrl: preview.url,
                    matchedText: match[0],
                }
            });
        } catch (e) {
            console.error('[Preview Error]', e.message);
            return await sock.sendMessage(jid, { text });
        }
    }
    return await sock.sendMessage(jid, { text });
}

module.exports = {
    getStoreStatus,
    hasAvailableProductStock,
    formatProduct,
    getDeliveryCatalog,
    getOrderCatalog,
    getRestaurantGreeting,
    shouldSendRestaurantGreeting,
    sendRichMessage
};
