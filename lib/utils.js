const prisma = require('./prisma');
const { getLinkPreview } = require('link-preview-js');

/**
 * Retorna o status atual da loja (ABERTA/FECHADA) baseado nos horários do banco
 */
async function getStoreStatus() {
    const hoje = new Date();
    const diaSemana = hoje.getDay();
    const horas = hoje.getHours();
    const minutos = hoje.getMinutes();

    // Formato para exibição no prompt (ex: 09:15)
    const horaAtual = horas.toString().padStart(2, '0') + ':' + minutos.toString().padStart(2, '0');

    // Valor numérico total em minutos para comparação segura
    const minutosAtuais = (horas * 60) + minutos;

    const dias = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
    const nomeDia = dias[diaSemana];

    const slots = await prisma.availableSlot.findMany({ where: { dayOfWeek: diaSemana } });
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
        // Verifica se ainda vai abrir hoje (algum slot começa no futuro)
        isBeforeOpening = slots.some(slot => {
            const [startH, startM] = slot.startTime.split(':').map(Number);
            return (startH * 60 + startM) > minutosAtuais;
        });
    }

    return { statusLoja, nomeDia, horaAtual, hoje, isBeforeOpening };
}

/**
 * Formata um produto e suas variações para exibição no catálogo da IA
 */
function formatProduct(prod, vars) {
    let text = `*${prod.name.toUpperCase()}* [ID: ${prod.id}]`;
    if (prod.description) text += `\n_${prod.description}_`;

    if (vars.length > 0) {
        const varLines = vars.map(v => {
            let vText = `   * *${v.name}* - R$ ${v.price.toFixed(2)}`;
            if (v.stock === 0) vText += " (ESGOTADO)";
            return vText;
        }).join('\n');
        return text + '\n' + varLines;
    } else {
        return text + ` - R$ ${prod.price.toFixed(2)}`;
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
    formatProduct,
    sendRichMessage
};
