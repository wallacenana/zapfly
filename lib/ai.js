const OpenAI = require('openai');
const prisma = require('./prisma');
const { getSettings } = require('./cache');
const { formatProduct, hasAvailableProductStock } = require('./utils');
const axios = require('axios');

// Mapa de modelos de IA: chave salva no banco -> nome real da API
const MODEL_MAP = { 'openai': 'gpt-4o', 'openai-mini': 'gpt-4o-mini', 'openai-nano': 'gpt-4.1-nano', 'claude': 'gpt-4o' };

const getStatusSendOptions = (sock) => {
    const statusJidList = typeof sock.__getStatusJidList === 'function'
        ? sock.__getStatusJidList()
        : [];
    console.log(`[WhatsApp] Status audience: ${statusJidList.length} destinatarios.`);
    return { broadcast: true, ...(statusJidList.length ? { statusJidList } : {}) };
};

const sendStatusMessage = async (sock, content) => {
    try {
        return await sock.sendMessage('status@broadcast', content, getStatusSendOptions(sock));
    } catch (err) {
        const message = String(err?.message || err);
        console.error(`[WhatsApp] Status não publicado (${message}). A conexão precisa ter sessões dos destinatários.`);
        throw err;
    }
};

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
    const instance = await prisma.instance.findUnique({ where: { id: instanceId }, select: { assistantName: true } });
    const assistantName = instance?.assistantName || "Lily";
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
        const hasStock = hasAvailableProductStock(p, variations);
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

REGRAS DE OPÇÕES DO CATÁLOGO:
- Cada grupo de variação e cada linha em "Subitens disponíveis" é uma opção real cadastrada.
- Nunca omita, resuma ou invente subitens. Liste as opções quando o cliente perguntar pelos sabores.
- "Sabor da massa" e "sabor do recheio" são escolhas separadas. Mantenha cada grupo separado e, ao criar o pedido, envie a massa no campo 'massa' e o recheio no campo 'recheio'.

${personalizedContext}

[CAPACIDADES E INSTRUÇÕES TÉCNICAS]
1. Use a ferramenta 'create_order' sempre que o cliente decidir o que quer comprar.
2. Use 'get_delivery_fee' para calcular frete antes de finalizar pedidos de delivery.
3. Use 'check_availability' para confirmar se uma data/hora está disponível para encomendas.
4. Se o cliente tiver dúvidas que você não saiba responder, use 'chamar_gerente'.
--- FIM DO CONTEXTO ---
`;

    return [`Seu nome é ${assistantName}. Sempre se identifique e responda usando esse nome quando fizer sentido.`, identityPrompt, systemContext].join('\n');
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
        const instance = await prisma.instance.findUnique({ where: { id: instanceId }, select: { assistantName: true } });
        const assistantName = instance?.assistantName || 'Lily';

        // Identidade (Front) + Capacidades (Back)
        const identity = settings?.botPrompt || "Você é a Lily Executive, assistente de gestão da loja.";
        const capabilities = `
[DADOS DO SISTEMA - BACKEND]
- Cardápio: ${catalog}
- Galeria: ${gallery}
- Instruções: Use ferramentas para gerenciar a loja conforme solicitado pelo administrador.
- Para publicar uma imagem no Status, use post_status com o ID correto da Galeria de Mídias.
`;

        const systemPrompt = `Seu nome é ${assistantName}.\n\n${identity}\n\n${capabilities}`;
        const toolVisibilityRule = `
REGRA DE COMUNICAÇÃO:
- Nunca revele ao usuário os nomes técnicos das ferramentas, JSON, funções ou detalhes internos do sistema.
- Se perguntarem o que você pode fazer, explique em linguagem natural: gerenciar pedidos e produtos, publicar Status e enviar imagens da galeria.
`;

        const productRegistrationRule = `
REGRA OBRIGATORIA PARA CADASTRO DE PRODUTOS:
- Sempre use a ferramenta create_product quando o administrador pedir para cadastrar um produto.
- variations deve ser um array JSON.
- Cada item de variations deve ter exatamente estas chaves: name, price, stock, description, subItems, hidden.
- Use subItems como [] quando nao houver subitens e hidden como true ou false. Nao adicione outras chaves.
`;
        const userMessageContent = [{ type: "text", text: text || "Imagem enviada." }];
        for (const b64 of images) userMessageContent.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } });

        const requestsStatus = /\b(status|story|stories|public(?:a|ar|ação|acao)?|post(?:a|ar|agem)?)\b/i.test(String(text || ''));
        const response = await ai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "system", content: `${systemPrompt}\n${productRegistrationRule}\n${toolVisibilityRule}` }, { role: "user", content: userMessageContent }],
            tools: [
                { type: "function", function: { name: "create_order", parameters: { type: "object", properties: { product: { type: "string" }, scheduledDate: { type: "string" }, scheduledTime: { type: "string" }, clientName: { type: "string" } }, required: ["product", "scheduledDate", "scheduledTime", "clientName"] } } },
                { type: "function", function: { name: "create_product", description: "Cadastra um produto e suas variações. Cada item de variations DEVE conter somente name, price, stock, description, subItems e hidden.", parameters: { type: "object", properties: { name: { type: "string" }, price: { type: "number" }, description: { type: "string" }, type: { type: "string", enum: ["delivery", "order"] }, variations: { type: "array", items: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, price: { type: "number" }, stock: { type: "number" }, description: { type: "string" }, subItems: { type: "array" }, hidden: { type: "boolean" } }, required: ["name", "price", "stock", "description", "subItems", "hidden"] } } }, required: ["name", "price", "description", "variations"] } } },
                { type: "function", function: { name: "get_marketing_media", description: "Consulta as imagens da galeria da loja para escolher uma foto.", parameters: { type: "object", properties: { search: { type: "string" } } } } },
                { type: "function", function: { name: "send_marketing_media", description: "Envia uma imagem da galeria para o administrador ou cliente atual.", parameters: { type: "object", properties: { assetId: { type: "string" }, caption: { type: "string" } }, required: ["assetId"] } } },
                { type: "function", function: { name: "post_status", description: "OBRIGATORIO para publicar texto ou imagem no Status do WhatsApp. Use o assetId da Galeria quando o administrador citar um produto ou pedir uma imagem.", parameters: { type: "object", properties: { assetId: { type: "string" }, caption: { type: "string" } }, required: ["caption"] } } }
            ],
            ...(requestsStatus ? { tool_choice: { type: "function", function: { name: "post_status" } } } : {})
        });

        const msg = response.choices[0].message;
        if (msg.content) await sock.sendMessage(jid, { text: msg.content });

        if (msg.tool_calls) {
            const internalSecret = process.env.INTERNAL_TOKEN || 'menzzu-internal-bypass-key';
            for (const call of msg.tool_calls) {
                const args = JSON.parse(call.function.arguments);
                console.log(`[Admin Tool] Iniciando ${call.function.name}:`, JSON.stringify(args));
                if (call.function.name === "create_order") {
                    const internalBase = `http://127.0.0.1:${process.env.PORT || 3001}`;
                    const res = await axios.post(`${internalBase}/orders`, args, {
                        headers: { 'x-internal-token': internalSecret, 'x-user-id': userId }
                    });
                    await sock.sendMessage(jid, { text: `✅ Pedido #${res.data.id.slice(-5).toUpperCase()} criado!` });
                } else if (call.function.name === "create_product") {
                    const normalizedVariations = (Array.isArray(args.variations) ? args.variations : []).map((variation) => ({
                        name: String(variation?.name || '').trim(),
                        price: Number(variation?.price) || 0,
                        stock: Number(variation?.stock) || 0,
                        description: String(variation?.description || ''),
                        subItems: Array.isArray(variation?.subItems) ? variation.subItems : [],
                        hidden: variation?.hidden === true
                    })).filter(variation => variation.name);
                    if (!normalizedVariations.length) throw new Error('O cadastro precisa ter pelo menos uma variação válida.');

                    const product = await prisma.product.create({ data: {
                        userId,
                        name: String(args.name || '').trim(),
                        price: Number(args.price) || 0,
                        description: String(args.description || ''),
                        type: args.type === 'delivery' ? 'delivery' : 'order',
                        stock: 0,
                        variations: JSON.stringify(normalizedVariations),
                        customFields: '[]',
                        comboItems: '[]'
                    } });
                    await sock.sendMessage(jid, { text: `✅ Produto *${product.name}* cadastrado com ${normalizedVariations.length} variação(ões).` });
                } else if (call.function.name === "get_marketing_media") {
                    const search = String(args.search || '').trim();
                    const galleryAssets = await prisma.marketingAsset.findMany({
                        where: { userId, ...(search ? { name: { contains: search } } : {}) },
                        select: { id: true, name: true }
                    });
                    await sock.sendMessage(jid, { text: galleryAssets.length
                        ? `Encontrei estas imagens: ${galleryAssets.map(asset => `${asset.name} (${asset.id})`).join(', ')}`
                        : 'Não encontrei imagens correspondentes na galeria.' });
                } else if (call.function.name === "send_marketing_media") {
                    const asset = await prisma.marketingAsset.findFirst({ where: { id: args.assetId, userId } });
                    if (!asset) throw new Error('Imagem não encontrada na galeria.');
                    await sock.sendMessage(jid, { image: { url: asset.url }, caption: args.caption || '' });
                    await sock.sendMessage(jid, { text: "✅ Imagem enviada!" });
                } else if (call.function.name === "post_status") {
                    const caption = String(args.caption || args.text || '').trim();
                    if (args.assetId) {
                        const asset = await prisma.marketingAsset.findFirst({ where: { id: args.assetId, userId } });
                        if (!asset) throw new Error('Imagem não encontrada para o status.');
                        await sendStatusMessage(sock, { image: { url: asset.url }, caption });
                    } else {
                        if (!caption) throw new Error('Informe o texto do status.');
                        await sendStatusMessage(sock, { text: caption });
                    }
                    console.log(`[WhatsApp] Status publicado com sucesso pela Lily${args.assetId ? ` com imagem ${args.assetId}` : ' com texto'}.`);
                    await sock.sendMessage(jid, { text: "✅ Status publicado!" });
                }
                console.log(`[Admin Tool] Sucesso ${call.function.name}.`);
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
