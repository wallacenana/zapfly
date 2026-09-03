const prisma = require('./prisma');
const { getLinkPreview } = require('link-preview-js');

/**
 * Retorna o status atual da loja (ABERTA/FECHADA) baseado nos horários do banco
 */
async function getStoreStatus(userId) {
    if (!userId) return { statusLoja: "FECHADA", nomeDia: "", horaAtual: "", hoje: new Date(), isBeforeOpening: false, resumoHorarios: "" };
    
    const hoje = new Date();
    const diaSemana = hoje.getDay();
    const horas = hoje.getHours();
    const minutos = hoje.getMinutes();

    const horaAtual = horas.toString().padStart(2, '0') + ':' + minutos.toString().padStart(2, '0');
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

    return { statusLoja, nomeDia, horaAtual, hoje, isBeforeOpening, resumoHorarios };
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
    sendRichMessage
};
