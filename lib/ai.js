const OpenAI = require('openai');
const prisma = require('./prisma');
const { getSettings, getCachedInstance, invalidateProductCache } = require('./cache');
const { getStoreStatus, formatProduct } = require('./utils');
const { calculateFee } = require('./maps');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

// Mapa de modelos de IA: chave salva no banco -> nome real da API
const MODEL_MAP = { 'openai': 'gpt-4o', 'openai-mini': 'gpt-4o-mini', 'openai-nano': 'gpt-4.1-nano', 'claude': 'gpt-4o' };

// OpenAI Instances map (userId -> instance)
let openaiInstances = {};

const getOpenAI = async (userId) => {
    if (!userId) return null;
    if (openaiInstances[userId]) return openaiInstances[userId];

    const config = await getSettings(userId);
    if (config?.openaiKey) {
        openaiInstances[userId] = new OpenAI({ apiKey: config.openaiKey });
        return openaiInstances[userId];
    }
    return null;
};

/**
 * Constrói o System Prompt dinâmico da Lily
 */
async function buildLilyPrompt(instanceId, jid, customerContext = "", storeInfo, pushName = "", userId) {
    const { statusLoja, nomeDia, horaAtual, hoje, isBeforeOpening } = storeInfo;
    const settings = await getSettings(userId);
    const { getCachedProducts } = require('./cache');
    const allProducts = await getCachedProducts(userId);

    const customer = await prisma.customer.findUnique({ where: { jid_userId: { jid, userId } } });
    const chat = await prisma.chat.findUnique({ where: { instanceId_jid: { instanceId, jid } } });
    let personalizedContext = "";

    const nameToUse = customer?.name || pushName || "Cliente";

    if (customer) {
        const feeInfo = customer.lastDeliveryFee ? ` (Taxa fixa: R$ ${customer.lastDeliveryFee.toFixed(2)})` : "";
        const activeOrders = await prisma.order.findMany({
            where: {
                userId,
                clientJid: jid,
                status: { in: ['waiting_payment', 'pending', 'production', 'ready'] }
            },
            orderBy: { createdAt: 'desc' }
        });

        let ordersContext = "";
        if (activeOrders.length > 0) {
            ordersContext = "\n- PEDIDOS ATIVOS AGORA:\n" + activeOrders.map(o => `  • ID: #${o.id.slice(-5).toUpperCase()}, Produto: ${o.product}, TOTAL: R$ ${o.totalValue.toFixed(2)}, Status: ${o.status}`).join('\n');
        }

        personalizedContext = `\n### DADOS DO CLIENTE ###\n- Nome: ${customer.name || nameToUse}\n- Endereço: ${customer.address || 'Não informado'}${feeInfo}${ordersContext}`;
    } else {
        personalizedContext = `\n### DADOS DO CLIENTE ###\n- Nome: ${nameToUse} (Primeira vez)`;
    }

    let deliveryCatalog = "";
    let orderCatalog = "";

    allProducts.forEach(p => {
        let variations = [];
        try {
            variations = typeof p.variations === 'string' ? JSON.parse(p.variations || '[]') : (p.variations || []);
        } catch (e) { variations = []; }
        const hasStock = p.stock > 0 || variations.some(v => v.stock > 0);
        if (p.type === 'delivery') {
            deliveryCatalog += formatProduct(p, variations, true) + (hasStock ? "" : " [ESGOTADO]") + '\n\n';
        } else {
            orderCatalog += formatProduct(p, variations, true) + '\n\n';
        }
    });

    const finalBasePrompt = settings?.botPrompt || "Você é a Lily, a alma da Linda Cake!";
    
    return [
        `### PERSONA ###`,
        finalBasePrompt,
        `### CONTEXTO ###`,
        `Data/Hora: ${nomeDia}, ${hoje.toLocaleDateString('pt-BR')} às ${horaAtual}`,
        `Status: ${statusLoja}`,
        `### CARDÁPIO ###`,
        `[PRONTA ENTREGA]\n${deliveryCatalog}`,
        `[ENCOMENDAS]\n${orderCatalog}`,
        personalizedContext
    ].join('\n');
}

async function executeChamarGerente(reason, jid, currentChat, settings, flowAdminPhone, sock, prisma, instanceId) {
    let managerJid = flowAdminPhone || currentChat?.adminJid || settings?.managerJid;
    if (managerJid) {
        if (!managerJid.includes('@')) managerJid = managerJid.replace(/\D/g, '') + '@s.whatsapp.net';
        const clientName = currentChat?.name || jid.split('@')[0];
        const host = process.env.PUBLIC_URL || 'http://localhost:5173';
        const alertMsg = `⚠️ *ATENÇÃO GESTOR!* \n\nO cliente solicitou ajuda.\n👤 *Cliente:* ${clientName}\n❓ *Motivo:* ${reason}\n🔗 *Chat:* ${host}/chat`;
        await sock.sendMessage(managerJid, { text: alertMsg });
        return { success: true };
    }
    return { success: false };
}

async function handleAdminAgent(sock, instanceId, jid, text, settings, images = [], userId) {
    try {
        const ai = await getOpenAI(userId);
        if (!ai) return;

        const products = await prisma.product.findMany({ where: { userId } });
        const catalog = products.map(p => `- ${p.name}: R$${p.price}`).join('\n');
        const assets = await prisma.marketingAsset.findMany({ where: { userId } });
        const gallery = assets.map(a => `ID: ${a.id}, Nome: ${a.name}`).join('\n');

        const systemPrompt = `Você é a Lily Executive. Gerencie a loja de userId: ${userId}.
        Cardápio: ${catalog}
        Galeria: ${gallery}
        Use ferramentas para criar pedidos, postar status ou gerenciar produtos.`;

        const userMessageContent = [{ type: "text", text: text || "Imagem enviada." }];
        for (const b64 of images) userMessageContent.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } });

        const response = await ai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMessageContent }],
            tools: [
                { type: "function", function: { name: "create_order", parameters: { type: "object", properties: { product: { type: "string" }, scheduledDate: { type: "string" }, scheduledTime: { type: "string" }, clientName: { type: "string" } }, required: ["product", "scheduledDate", "scheduledTime", "clientName"] } } },
                { type: "function", function: { name: "post_status", parameters: { type: "object", properties: { assetId: { type: "string" }, caption: { type: "string" } }, required: ["caption"] } } }
            ]
        });

        const msg = response.choices[0].message;
        if (msg.content) await sock.sendMessage(jid, { text: msg.content });

        if (msg.tool_calls) {
            const internalSecret = process.env.INTERNAL_TOKEN || 'zapfly-internal-bypass-key';
            for (const call of msg.tool_calls) {
                const args = JSON.parse(call.function.arguments);
                if (call.function.name === "create_order") {
                    const res = await axios.post('http://127.0.0.1:3001/orders', args, {
                        headers: { 'x-internal-token': internalSecret, 'x-user-id': userId }
                    });
                    await sock.sendMessage(jid, { text: `✅ Pedido #${res.data.id.slice(-5).toUpperCase()} criado!` });
                } else if (call.function.name === "post_status") {
                    await sock.sendMessage('status@broadcast', { text: args.caption });
                    await sock.sendMessage(jid, { text: "✅ Status publicado!" });
                }
            }
        }
    } catch (err) { console.error('[Admin Agent Error]', err); }
}

module.exports = {
    getOpenAI,
    buildLilyPrompt,
    executeChamarGerente,
    handleAdminAgent,
    MODEL_MAP
};
