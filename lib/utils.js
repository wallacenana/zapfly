const prisma = require('./prisma');

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
function formatProduct(prod, vars, showHidden = false, includeSubItems = true, includeDescription = true) {
    let text = `*${prod.name}*`;
    if (includeDescription && prod.description) text += `\n_${prod.description}_`;

    const effectivePrice = (item, fallback = 0) => {
        const base = Number(item?.price);
        const price = Number.isFinite(base) && base > 0 ? base : fallback;
        const promo = Number(item?.promoPrice);
        return Number.isFinite(promo) && promo > 0 && promo < price ? promo : price;
    };
    const formatPrice = (value) => {
        return Number.isFinite(value) && value > 0 ? `: R$ ${value.toFixed(2)}` : '';
    };

    if (vars.length > 0) {
        const productPrice = effectivePrice(prod);
        const varLines = vars
            .filter(v => showHidden || !v.hidden)
            .map(v => {
                const variationPrice = effectivePrice(v, productPrice);
                const subItems = Array.isArray(v.subItems) ? v.subItems : [];
                const hasSubItemStock = subItems.some(item => Number(item?.stock) > 0);
                const isEsgotado = prod.trackStock && ((subItems.length === 0 && Number(v.stock) <= 0) || (subItems.length > 0 && !hasSubItemStock))
                    ? " [ESGOTADO HOJE]"
                    : "";
                const hiddenLabel = (showHidden && v.hidden) ? " [INVISÍVEL]" : "";
                let line = `   - ${v.name || 'Opção'}${formatPrice(variationPrice)}${isEsgotado}${hiddenLabel}`;

                if (includeSubItems && subItems.length > 0) {
                    const subItemLines = subItems
                        .filter(item => showHidden || !item?.hidden)
                        .map(item => {
                            const subItemOut = prod.trackStock && Number(item?.stock) <= 0 ? " [ESGOTADO HOJE]" : '';
                            return `      • ${item?.name || 'Opção'}${formatPrice(effectivePrice(item, variationPrice))}${subItemOut}`;
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

function isDeliveryOrderFollowUp(messages, currentText) {
    const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const current = normalize(currentText);
    if (/festa|aniversario|personaliz|catalogo completo|todos os (?:itens|produtos)/.test(current)) return false;
    const recent = messages.filter(message => message.role !== 'system');
    for (let i = recent.length - 1; i >= 0; i--) {
        const message = recent[i];
        const content = Array.isArray(message.content) ? message.content.map(part => part.text || '').join(' ') : message.content;
        const text = normalize(content);
        if (/festa|aniversario|personaliz|catalogo completo|todos os (?:itens|produtos)/.test(text) && message.role === 'user') return false;
        if (message.role === 'assistant' && /fechad.*delivery|itens (?:do|de) delivery/.test(text)) return true;
        if (message.role === 'user' && /delivery|pronta entrega|o que tem.*hoje/.test(text)) return true;
    }
    return false;
}

function isCatalogRequest(text) {
    const normalized = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return /cardapio|catalogo|lista|quais|o que (?:tem|temos|posso|pode)|opcoes/.test(normalized);
}

function isFinalOrderConfirmation(messages, currentText) {
    const normalize = value => String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
    const answer = normalize(currentText);
    if (!/^(sim|confirmo|pode prosseguir|pode confirmar|confirmar|isso mesmo|ok|pode ser)$/.test(answer)) {
        return false;
    }

    const lastAssistant = [...messages].reverse().find(message => message.role === 'assistant');
    const content = Array.isArray(lastAssistant?.content)
        ? lastAssistant.content.map(part => part.text || '').join(' ')
        : lastAssistant?.content;
    return /confirme se posso prosseguir|posso prosseguir com o pedido|voce confirma (?:o )?pedido|gostaria de confirmar|confirmar (?:o )?pedido/.test(normalize(content));
}

async function findSelectedProduct(userId, text, deliveryOnly = false, messages = []) {
    const { getCachedProducts } = require('./cache');
    const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const input = ` ${normalize(text)} `;
    const products = (await getCachedProducts(userId)).filter(product => {
        if (product.active === false || product.type === 'addon') return false;
        if (deliveryOnly && !['delivery', 'combo_delivery'].includes(product.type)) return false;
        return true;
    });
    const matches = products.filter(product => {
        const name = normalize(product.name);
        return name && input.includes(` ${name} `);
    });
    if (matches.length) return matches.length === 1 ? matches[0] : null;

    // A short option reply belongs to the product in the last assistant question.
    const lastAssistant = messages.filter(message => message.role === 'assistant' && message.content).pop();
    const previousText = Array.isArray(lastAssistant?.content)
        ? lastAssistant.content.map(part => part.text || '').join(' ')
        : lastAssistant?.content;
    const previous = ` ${normalize(previousText)} `;
    const contextualProducts = products.filter(product => {
        const name = normalize(product.name);
        return name && previous.includes(` ${name} `);
    });
    if (contextualProducts.length !== 1) return null;
    const product = contextualProducts[0];
    let variations;
    try {
        variations = typeof product.variations === 'string' ? JSON.parse(product.variations) : product.variations;
    } catch { return null; }
    if (!Array.isArray(variations)) return null;
    const options = variations.filter(variation => !variation.hidden).flatMap(variation => [
        variation,
        ...(Array.isArray(variation.subItems) ? variation.subItems.filter(item => !item.hidden) : [])
    ]);
    const selection = normalize(text).replace(/^(?:eu quero|quero|prefiro|pode ser|tamanho|opcao) /, '').replace(/^(?:o|a) /, '').replace(/^(?:tamanho|opcao) /, '');
    return options.some(option => normalize(option.name) === selection) ? product : null;
}

async function getOrderCatalog(userId, { deliveryOnly = false } = {}) {
    const { getCachedProducts } = require('./cache');
    const products = await getCachedProducts(userId);
    const orderable = products.filter(product => {
        if (product.active === false) return false;
        if (deliveryOnly) return product.type === 'delivery' || product.type === 'combo_delivery';
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

const pendingGreetings = new Map();

async function ensureRestaurantGreeting(sock, instanceId, jid, userId) {
    const key = `${instanceId}:${jid}`;
    if (pendingGreetings.has(key)) {
        await pendingGreetings.get(key);
        return false;
    }
    const pending = (async () => {
        if (!(await shouldSendRestaurantGreeting(instanceId, jid))) return false;
        const text = await getRestaurantGreeting(instanceId, userId);
        const sent = await sendRichMessage(sock, jid, text);
        // Persist before another flow checks history; the socket event may arrive later.
        await prisma.message.upsert({
            where: { msgId: sent.key.id },
            update: {},
            create: {
                msgId: sent.key.id, instanceId, jid, text, fromMe: true,
                timestamp: new Date(), status: 'sent'
            }
        });
        return true;
    })();
    pendingGreetings.set(key, pending);
    try {
        return await pending;
    } finally {
        pendingGreetings.delete(key);
    }
}

function getClosedDeliveryMessage(settings) {
    let options = settings?.dailyDeliveryItems;
    if (typeof options === 'string') {
        try { options = JSON.parse(options); } catch { options = {}; }
    }
    const acceptsOrders = settings?.acceptOrders !== false && options?.orderTypes?.order !== false;
    return 'Infelizmente, estamos fechados para delivery no momento.'
        + (acceptsOrders ? ' Estamos aceitando apenas encomendas.' : '');
}

function isSimpleGreeting(text) {
    return /^(oi+|ol[aá]+|bom dia|boa tarde|boa noite|hey|hello)[!,.\s]*$/i.test(String(text || '').trim());
}

async function shouldSendRestaurantGreeting(instanceId, jid) {
    const recentOutgoingMessages = await prisma.message.findMany({
        where: {
            instanceId,
            jid,
            fromMe: true,
            timestamp: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        },
        orderBy: { timestamp: 'desc' },
        select: { timestamp: true, text: true }
    });

    const lastGreeting = recentOutgoingMessages.find(message => {
        const normalizedText = String(message.text || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
        return /^(ola|oi)[!,\s]+eu sou/.test(normalizedText)
            && normalizedText.includes('https://menzzu.com');
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
            const { getUrlInfo } = await import('@whiskeysockets/baileys');
            const preview = await getUrlInfo(match[0], {
                thumbnailWidth: 192,
                fetchOpts: {
                    timeout: 10000,
                    headers: { 'user-agent': 'WhatsApp/2.21.11.17' }
                }
            });
            return await sock.sendMessage(jid, { text, linkPreview: preview });
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
    isDeliveryOrderFollowUp,
    isCatalogRequest,
    isFinalOrderConfirmation,
    findSelectedProduct,
    getRestaurantGreeting,
    shouldSendRestaurantGreeting,
    ensureRestaurantGreeting,
    getClosedDeliveryMessage,
    isSimpleGreeting,
    sendRichMessage
};
