const OpenAI = require('openai');
const prisma = require('./prisma');
const { getSettings } = require('./cache');
const { formatProduct } = require('./utils');
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
    const { statusLoja, nomeDia, horaAtual, hoje } = storeInfo;
    const settings = await getSettings(userId);
    const { getCachedProducts } = require('./cache');
    const allProducts = await getCachedProducts(userId);

    const customer = await prisma.customer.findUnique({ where: { jid_userId: { jid, userId } } });
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

    // PARTE DO FRONT: Identidade e Tonalidade
    const identityPrompt = settings?.botPrompt || "Você é a Lily, a alma da Linda Cake!";

    // PARTE DO BACK: Dados do Sistema e Instruções Técnicas
    const systemContext = `
--- CONTEXTO DO SISTEMA (BACKEND) ---
[HORÁRIOS E STATUS]
Hoje é ${nomeDia}, ${hoje.toLocaleDateString('pt-BR')} às ${horaAtual}.
A loja está: ${statusLoja}.

[CARDÁPIO ATUALIZADO]
PRONTA ENTREGA:
${deliveryCatalog || "Nenhum item disponível no momento."}

ENCOMENDAS:
${orderCatalog || "Consulte o atendente."}

${personalizedContext}

[CAPACIDADES E INSTRUÇÕES TÉCNICAS]
1. Use a ferramenta 'create_order' sempre que o cliente decidir o que quer comprar.
2. Use 'get_delivery_fee' para calcular frete antes de finalizar pedidos de delivery.
3. Use 'check_availability' para confirmar se uma data/hora está disponível para encomendas.
4. Se o cliente tiver dúvidas que você não saiba responder, use 'chamar_gerente'.
--- FIM DO CONTEXTO ---
`;

    return [identityPrompt, systemContext].join('\n');
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

        // Identidade (Front) + Capacidades (Back)
        const identity = settings?.botPrompt || "Você é a Lily Executive, assistente de gestão da loja.";
        const capabilities = `
[DADOS DO SISTEMA - BACKEND]
- Cardápio: ${catalog}
- Galeria: ${gallery}
- Instruções: Use ferramentas para gerenciar a loja conforme solicitado pelo administrador.
`;

        const systemPrompt = `${identity}\n\n${capabilities}`;

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
                    const internalBase = `http://127.0.0.1:${process.env.PORT || 3001}`;
                    const res = await axios.post(`${internalBase}/orders`, args, {
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
