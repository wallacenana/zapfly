const prisma = require('./prisma');
const { getStoreStatus } = require('./utils');
const { MODEL_MAP } = require('./ai');

// Variável para armazenar o socket.io (setado via init)
let io;

/**
 * Inicializa o módulo de fluxos com o socket.io
 */
function initFlows(socketIo) {
    io = socketIo;
}

/**
 * Motor de Fluxos: Verifica gatilhos e processa estados ativos
 */
async function handleFlows(sock, instanceId, jid, text, msg, buildLilyPrompt, getOpenAI, executeChamarGerente, settings, pushName = "", images = []) {
    try {
        // 1. Verificar se já existe um fluxo ativo para este JID
        const state = await prisma.flowState.findUnique({
            where: { instanceId_jid: { instanceId, jid } }
        });

        if (state && state.currentNodeId) {
            // Se houver um resumeAt no futuro, ignora (está esperando)
            if (state.resumeAt && state.resumeAt > new Date()) {
                return false;
            }

            const flow = await prisma.flow.findUnique({ where: { id: state.flowId } });
            if (flow && flow.status === 'Ativo') {
                const flowData = JSON.parse(flow.data);

                // Se o nó atual for um gatilho ou nó de texto, e o cliente respondeu, busca o próximo nó
                const nextEdges = (flowData.edges || []).filter(e => e.source === state.currentNodeId);
                if (nextEdges.length > 0) {
                    // Por simplicidade, pega a primeira conexão. 
                    // Logica de botões/respostas específicas pode ser adicionada aqui.
                    await runFlowNode(sock, instanceId, jid, flow, nextEdges[0].target, null, buildLilyPrompt, getOpenAI, executeChamarGerente, settings, pushName, images, text);
                    return true;
                } else {
                    // Fim do fluxo
                    await prisma.flowState.deleteMany({ where: { instanceId, jid } }).catch(() => { });
                    if (io) io.emit('chat_update', { instanceId, jid, inFlow: false });
                }
            }
        }

        if (state) {
            return false;
        }

        // 2. Verificar Gatilhos (Início de fluxo)
        if (!text) return false;

        const flows = await prisma.flow.findMany({
            where: {
                status: 'Ativo',
                OR: [{ instanceId: instanceId }, { instanceId: null }]
            }
        });

        for (const flow of flows) {
            try {
                const flowData = JSON.parse(flow.data);
                const triggerNode = flowData.nodes.find(n => n.type === 'triggerNode');
                if (!triggerNode) continue;

                const config = triggerNode.data;
                const msgLower = text.toLowerCase();
                let match = false;

                // VERIFICAÇÃO DE NÚMERO DE TESTE (Inteligente para LID e Telefone)
                if (config.testNumber && config.testNumber.trim() !== '') {
                    const cleanSender = jid.split('@')[0];
                    const cleanTest = config.testNumber.replace(/\D/g, '');

                    // Tenta bater por ID direto ou por uma busca no JID
                    const isMatch = (cleanSender === cleanTest) || jid.includes(cleanTest) || cleanTest.includes(cleanSender);

                    if (!isMatch) {
                        continue;
                    }
                }

                if (config.configuracao === 'Mensagem personalizada') {
                    if (msgLower === (config.mensagemPersonalizada || '').toLowerCase()) match = true;
                } else if (config.configuracao === 'Mensagem semelhante') {
                    if (msgLower.includes((config.mensagemPersonalizada || '').toLowerCase())) match = true;
                } else if (config.configuracao === 'Qualquer mensagem') {
                    match = true;
                }

                if (match) {
                    // Bloqueia gatilhos futuros criando o estado imediatamente no nó de gatilho
                    await prisma.flowState.upsert({
                        where: { instanceId_jid: { instanceId, jid } },
                        update: { flowId: flow.id, currentNodeId: triggerNode.id, updatedAt: new Date() },
                        create: { instanceId, jid, flowId: flow.id, currentNodeId: triggerNode.id }
                    });

                    await runFlowNode(sock, instanceId, jid, flow, triggerNode.id, null, buildLilyPrompt, getOpenAI, executeChamarGerente, settings, pushName, images, text);
                    return true;
                }
            } catch (e) {
                console.error(`[Flow Error] Falha ao processar gatilhos do fluxo ${flow.id}:`, e.message);
            }
        }
    } catch (err) {
        console.error(`[Flow Critical Error]`, err.message);
    }

    return false;
}

/**
 * Executa um nó específico do fluxo
 */
async function runFlowNode(sock, instanceId, jid, flow, nodeId, sourceHandle = null, buildLilyPrompt, getOpenAI, executeChamarGerente, settings, pushName = "", images = [], currentText = "") {
    try {
        const flowData = JSON.parse(flow.data);
        const node = flowData.nodes.find(n => n.id === nodeId);
        if (!node) return;

        // 1. Atualiza o estado atual no banco
        await prisma.flowState.upsert({
            where: { instanceId_jid: { instanceId, jid } },
            update: { currentNodeId: node.id, updatedAt: new Date() },
            create: { instanceId, jid, flowId: flow.id, currentNodeId: node.id }
        }).catch(() => { });

        let pendingCatalogMessage = null;

        // 2. Executa a ação do nó
        switch (node.type) {
            case 'textNode': {
                await sock.sendPresenceUpdate('composing', jid).catch(() => { });
                await new Promise(r => setTimeout(r, 1500));
                await sock.sendMessage(jid, { text: node.data.message });
                break;
            }
            case 'waitNode': {
                const minutes = parseInt(node.data?.minutes) || 0;
                const resumeAt = new Date(Date.now() + minutes * 60000);
                await prisma.flowState.updateMany({
                    where: { instanceId, jid },
                    data: { resumeAt }
                });
                console.log(`[Flow] Nó de espera ativado para ${jid}. Retomando em ${minutes} min.`);
                return; // Para a execução aqui
            }
            case 'aiNode': {
                const ai = await getOpenAI();
                if (!ai) return;

                const nodePrompt = node.data?.prompt || node.data?.instruction || "";
                const storeInfo = await getStoreStatus();
                const finalSystemPrompt = await buildLilyPrompt(instanceId, jid, nodePrompt, storeInfo, pushName);
                await sock.sendPresenceUpdate('composing', jid).catch(() => { });

                // Busca o histórico diretamente via Prisma
                const history = await prisma.message.findMany({
                    where: { instanceId, jid },
                    orderBy: { timestamp: 'desc' },
                    take: 40
                });

                let promptText = (currentText ? `Mensagem do cliente: ${currentText}` : "");
                if (images && images.length > 0) {
                    const isManager = settings?.managerJid && jid.includes(settings.managerJid.replace(/\D/g, ''));

                    if (isManager) {
                        promptText += (promptText ? "\n\n" : "") + "ATENÇÃO: Esta é uma imagem enviada pelo ADMINISTRADOR. É uma lista de pedidos (caderno, folha de agenda). Use o seu SUPER PODER de digitalização para extrair os dados e use a ferramenta 'create_order' para CADA pedido encontrado na folha.";
                    }
                }

                const userMessageContent = [{ type: "text", text: promptText }];
                if (images && images.length > 0) {
                    for (const b64 of images) {
                        userMessageContent.push({
                            type: "image_url",
                            image_url: { url: `data:image/jpeg;base64,${b64}` }
                        });
                    }
                }

                const messages = [
                    { role: 'system', content: finalSystemPrompt },
                    ...history.reverse().slice(0, -1).map(m => ({
                        role: m.fromMe ? 'assistant' : 'user',
                        content: m.text || (m.fromMe ? 'Mensagem da Lily' : 'Mensagem do Cliente')
                    })),
                    { role: 'user', content: userMessageContent }
                ];

                const tools = [
                    {
                        type: "function",
                        function: {
                            name: "create_order",
                            description: "Cria um novo pedido. REGRAS CRÍTICAS: 1. Extraia o nome exato do produto do catálogo. 2. Nunca crie se o cliente estiver apenas testando.",
                            parameters: {
                                type: "object",
                                properties: {
                                    productId: { type: "string", description: "ID do produto (se disponível)" },
                                    product: { type: "string", description: "Nome do produto (Obrigatório, EXATAMENTE como no catálogo)" },
                                    variation: { type: "string", description: "Variação exata (ex: 'P', 'M', 'Mini')" },
                                    quantity: { type: "string", description: "Peso ou quantidade" },
                                    scheduledDate: { type: "string", description: "Data no formato YYYY-MM-DD" },
                                    scheduledTime: { type: "string", description: "Horário HH:MM" },
                                    clientName: { type: "string", description: "Nome do cliente (Obrigatório)" },
                                    paymentMethod: { type: "string", description: "Forma de pagamento (Pix, Cartão, Dinheiro)" },
                                    deliveryAddress: { type: "string", description: "Endereço completo (se for delivery)" },
                                    type: { type: "string", enum: ["order", "delivery"], description: "'delivery' para hoje, 'order' para agendamentos futuros." },
                                    massa: { type: "string" },
                                    recheio: { type: "string" },
                                    topo: { type: "string" },
                                    notes: { type: "string" }
                                },
                                required: ["product", "paymentMethod", "clientName"]
                            }
                        }
                    },
                    {
                        type: "function",
                        function: {
                            name: "chamar_gerente",
                            description: "Chama um atendente humano.",
                            parameters: { type: "object", properties: { reason: { type: "string" } } }
                        }
                    },
                    {
                        type: "function",
                        function: {
                            name: "accept_order",
                            description: "APENAS PARA O ADMINISTRADOR: Aceita um pedido pendente. Se não for especificado o ID, aceite o pedido pendente mais recente.",
                            parameters: { type: "object", properties: { orderId: { type: "string", description: "Opcional. O ID do pedido." } } }
                        }
                    },
                    {
                        type: "function",
                        function: {
                            name: "check_availability",
                            description: "Verifica se há vagas para data e hora.",
                            parameters: { type: "object", properties: { date: { type: "string" }, time: { type: "string" } }, required: ["date", "time"] }
                        }
                    },
                    {
                        type: "function",
                        function: {
                            name: "get_delivery_fee",
                            description: "Calcula o valor da entrega.",
                            parameters: { type: "object", properties: { address: { type: "string", description: "Endereço do cliente" } }, required: ["address"] }
                        }
                    },
                    {
                        type: "function",
                        function: {
                            name: "get_delivery_catalog",
                            description: "OBRIGATÓRIO: Chame SEMPRE que o cliente perguntar o que tem para hoje, pronta entrega, opções disponíveis ou preços. NUNCA liste produtos manualmente.",
                            parameters: { type: "object", properties: {} }
                        }
                    },
                    {
                        type: "function",
                        function: {
                            name: "solicitar_cancelamento",
                            description: "Solicita o cancelamento do pedido ao administrador.",
                            parameters: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] }
                        }
                    }
                ];

                const modelToUse = (settings && settings.activeModel && MODEL_MAP) ? (MODEL_MAP[settings.activeModel] || 'gpt-4o-mini') : 'gpt-4o-mini';

                const completion = await ai.chat.completions.create({
                    model: modelToUse,
                    messages,
                    tools,
                    tool_choice: "auto"
                });

                let responseMessage = completion.choices[0].message;
                let initialAIText = responseMessage.content;

                // Interceptador de Memória de Imagem
                if (initialAIText && initialAIText.includes('[ANALISE:')) {
                    const match = initialAIText.match(/\[ANALISE: (.*?)\]/s);
                    if (match) {
                        const analysisContent = match[1];
                        console.log(`[Flow AI Memory] Salvando análise técnica...`);
                        await prisma.chat.update({
                            where: { instanceId_jid: { instanceId, jid } },
                            data: { lastPixAnalysis: analysisContent }
                        }).catch(e => console.error("Erro ao salvar memória AI (Flow):", e));

                        initialAIText = initialAIText.replace(/\[ANALISE: .*?\]/s, '').trim();
                        responseMessage.content = initialAIText;
                    }
                }

                if (responseMessage.tool_calls) {
                    messages.push(responseMessage);
                    let lastDeliveryFee = 0; // Fallback para taxa de entrega
                    for (const toolCall of responseMessage.tool_calls) {
                        const functionName = toolCall.function.name;
                        const args = JSON.parse(toolCall.function.arguments);
                        if (functionName === "get_delivery_catalog") {
                            // ─── SISTEMA ENVIA OS 3 BALÕES DIRETAMENTE ───
                            const { getCachedProducts } = require('./cache');
                            const { statusLoja } = storeInfo;
                            const prods = await getCachedProducts();
                            let deliveryStr = '';
                            prods.filter(p => p.type === 'delivery').forEach(p => {
                                const vars = typeof p.variations === 'string' ? JSON.parse(p.variations || '[]') : (p.variations || []);
                                let line = `*${p.name}*`;
                                if (vars.length > 0) {
                                    line += '\n' + vars.map(v => `   - ${v.name}: R$ ${v.price.toFixed(2)}`).join('\n');
                                } else {
                                    line += ` - R$ ${p.price.toFixed(2)}`;
                                }
                                deliveryStr += line + '\n\n';
                            });
                            const catalogText = deliveryStr.trim() || 'Nenhum item de pronta entrega no momento.';
                            const { isBeforeOpening } = storeInfo;
                            let introMsg;
                            if (!statusLoja.includes('FECHADA')) {
                                introMsg = 'Hoje temos os seguintes produtos de pronta entrega:';
                            } else if (isBeforeOpening) {
                                // Ainda não abrimos hoje — pode entregar hoje mesmo
                                introMsg = 'Ainda não estamos funcionando, mas hoje teremos estes produtos a pronta entrega:';
                            } else {
                                // Já encerramos — só conseguimos para amanhã
                                introMsg = 'Essas são as delicias que teremos:';
                            }

                            // Balão 1: Intro
                            await sock.sendPresenceUpdate('composing', jid).catch(() => { });
                            await new Promise(r => setTimeout(r, 1200));
                            await sock.sendPresenceUpdate('paused', jid).catch(() => { });
                            await sock.sendMessage(jid, { text: introMsg });

                            // Balão 2: Catálogo
                            await sock.sendPresenceUpdate('composing', jid).catch(() => { });
                            await new Promise(r => setTimeout(r, Math.min(catalogText.length * 8, 4000)));
                            await sock.sendPresenceUpdate('paused', jid).catch(() => { });
                            await sock.sendMessage(jid, { text: catalogText });

                            // Balão 3: CTA
                            await sock.sendPresenceUpdate('composing', jid).catch(() => { });
                            await new Promise(r => setTimeout(r, 1500));
                            await sock.sendPresenceUpdate('paused', jid).catch(() => { });
                            const ctaMsg = isBeforeOpening
                                ? 'Qual destes posso garantir pra você hoje? As unidades são limitadas e costumam voar! 🔥'
                                : 'Qual desses posso separar para você? 😊';
                            await sock.sendMessage(jid, { text: ctaMsg });

                            // Ativa o agente se necessário e encerra
                            if (node.data?.activateAgent) {
                                const updateData = { aiEnabled: true };
                                if (node.data.adminPhone && node.data.adminPhone.trim() !== '') {
                                    updateData.adminJid = node.data.adminPhone.replace(/\D/g, '');
                                }
                                await prisma.chat.update({ where: { instanceId_jid: { instanceId, jid } }, data: updateData });
                                await prisma.flowState.deleteMany({ where: { instanceId, jid } }).catch(() => { });
                                console.log(`[Flow AI] Agente IA ativado para ${jid} após catálogo. Fluxo encerrado.`);
                                if (io) io.emit('chat_update', { instanceId, jid, aiEnabled: true, inFlow: false });
                            }
                            return; // Encerra aqui — sem segunda chamada à IA

                        } else if (functionName === "get_order_catalog") {
                            try {
                                const { formatProduct } = require('./utils');
                                // Busca direta no banco para evitar cache "detonado"
                                const allProducts = await prisma.product.findMany();

                                let catalogStr = "";
                                allProducts.filter(p => p.type === 'encomenda').forEach(p => {
                                    const vars = typeof p.variations === 'string' ? JSON.parse(p.variations || '[]') : (p.variations || []);
                                    catalogStr += formatProduct(p, vars) + "\n\n";
                                });
                                pendingCatalogMessage = catalogStr.trim() || "Poxa, não encontrei itens no momento.";
                                result = { success: true, message: "Catálogo preparado. Agora gere a introdução e o CTA separados por '---'." };
                            } catch (err) {
                                console.error('[Flow Catalog Error]', err);
                                result = { success: false, error: "Erro ao buscar catálogo." };
                            }
                        } else if (functionName === "chamar_gerente") {
                            const { reason } = args;
                            result = await executeChamarGerente(reason, jid, null, settings, node.data.adminPhone, sock, prisma, instanceId);
                        } else if (functionName === "check_availability") {
                            const { checkAvailability } = require('../routes/orders');
                            result = await checkAvailability(args.date, args.time);
                        } else if (functionName === "get_delivery_fee") {
                            const { calculateFee } = require('./maps');
                            const feeRes = await calculateFee(args.address);
                            if (feeRes.type === 'fixed') lastDeliveryFee = feeRes.fee;
                            else if (feeRes.estimated) lastDeliveryFee = feeRes.estimated;

                            if (lastDeliveryFee > 0) {
                                await prisma.customer.update({
                                    where: { jid },
                                    data: { address: args.address, lastDeliveryFee: lastDeliveryFee }
                                }).catch(() => { });
                            }

                            result = feeRes;
                        } else if (functionName === "create_order") {
                            const axios = require('axios');
                            try {
                                console.log('[DEBUG CREATE_ORDER ARGS]', JSON.stringify(args, null, 2));
                                const res = await axios.post('http://localhost:3001/orders', {
                                    ...args,
                                    deliveryFee: args.deliveryFee || lastDeliveryFee, // Fallback
                                    clientJid: jid,
                                    instanceId: instanceId
                                });
                                result = { success: true, id: res.data.id, paymentLink: res.data.paymentLink };

                                // Se gerou link, envia os 3 balões agora e encerra o fluxo
                                if (res.data.paymentLink) {
                                    await sock.sendMessage(jid, { text: 'Vou gerar o link do seu pagamento logo abaixo:' });
                                    await new Promise(r => setTimeout(r, 800));
                                    await sock.sendMessage(jid, { text: res.data.paymentLink });
                                    await new Promise(r => setTimeout(r, 1000));
                                    await sock.sendMessage(jid, { text: 'O pedido será confirmado após o pagamento.' });

                                    await prisma.flowState.deleteMany({ where: { instanceId, jid } }).catch(() => { });
                                    return; // Mata o fluxo e a IA
                                }
                            } catch (err) {
                                result = { success: false, error: err.response?.data?.error || err.message };
                            }
                        } else if (functionName === "accept_order") {
                            const axios = require('axios');
                            try {
                                let orderId = args.orderId;
                                if (!orderId) {
                                    const latestPending = await prisma.order.findFirst({
                                        where: { status: 'pending' },
                                        orderBy: { createdAt: 'desc' }
                                    });
                                    if (latestPending) orderId = latestPending.id;
                                }

                                if (!orderId) {
                                    result = { success: false, error: "Nenhum pedido pendente encontrado." };
                                } else {
                                    await axios.patch(`http://localhost:3001/orders/${orderId}`, { status: 'accepted' });
                                    result = { success: true, message: `Pedido ${orderId.slice(-4).toUpperCase()} aceito com sucesso! O cliente já foi notificado.` };
                                }
                            } catch (err) {
                                result = { success: false, error: err.message };
                            }
                        } else if (functionName === "solicitar_cancelamento") {
                            const { reason } = args;
                            const alertMsg = `🚨 *SOLICITAÇÃO DE CANCELAMENTO (FLUXO)* 🚨\n\n📱 *WhatsApp:* ${jid.split('@')[0]}\n📝 *Motivo:* ${reason}\n\nLily já avisou o cliente que o gerente foi notificado.`;

                            await sock.sendMessage(settings.managerJid, { text: alertMsg });
                            result = { success: true, message: "O gerente foi notificado sobre o seu pedido de cancelamento e entrará em contato em breve." };
                        }

                        console.log(`[Flow AI] Executando função: ${functionName}`, args);
                        messages.push({
                            tool_call_id: toolCall.id,
                            role: "tool",
                            name: functionName,
                            content: JSON.stringify(result || { error: "Função não implementada ou erro no retorno." }),
                        });
                    }

                    const secondResponse = await ai.chat.completions.create({
                        model: 'gpt-4o-mini',
                        messages,
                    });
                    responseMessage = secondResponse.choices[0].message;
                }

                let replyText = responseMessage.content;
                if (pendingCatalogMessage) {
                    let introText = "Temos essas delícias:";
                    let ctaText = "Qual desses posso separar para você? 😊";

                    if (replyText && replyText.includes('---')) {
                        const parts = replyText.split('---');
                        introText = parts[0].trim();
                        ctaText = parts[1].trim();
                    } else if (replyText) {
                        const sentences = replyText.split(/[.!?\n]/).filter(s => s.trim().length > 5);
                        if (sentences.length >= 2) {
                            introText = sentences[0].trim() + (replyText.includes(':') ? '' : ':');
                            ctaText = sentences[sentences.length - 1].trim();
                        }
                    }

                    // Envia Intro (IA)
                    await sock.sendPresenceUpdate('composing', jid).catch(() => { });
                    await new Promise(r => setTimeout(r, 1200));
                    await sock.sendMessage(jid, { text: introText });

                    // Envia Catálogo (SISTEMA)
                    await new Promise(r => setTimeout(r, 1500));
                    await sock.sendMessage(jid, { text: pendingCatalogMessage });

                    // Envia CTA (IA)
                    await new Promise(r => setTimeout(r, 2000));
                    await sock.sendMessage(jid, { text: ctaText });
                } else {
                    if (replyText) {
                        replyText = replyText.replace(/\*/g, '');
                        replyText = replyText.replace(/[•·]/g, '-');
                        replyText = replyText.replace(/[#*_`]/g, '');
                    }
                    await new Promise(r => setTimeout(r, 1000));
                    await sock.sendMessage(jid, { text: replyText });
                }

                if (node.data?.activateAgent) {
                    const updateData = { aiEnabled: true };
                    if (node.data.adminPhone && node.data.adminPhone.trim() !== '') {
                        updateData.adminJid = node.data.adminPhone.replace(/\D/g, '');
                    }

                    await prisma.chat.update({
                        where: { instanceId_jid: { instanceId, jid } },
                        data: updateData
                    });
                    await prisma.flowState.deleteMany({ where: { instanceId, jid } }).catch(() => { });
                    console.log(`[Flow AI] Agente IA ativado para ${jid} após resposta. Fluxo encerrado.`);
                    if (io) io.emit('chat_update', { instanceId, jid, aiEnabled: true, inFlow: false });
                    return; // Encerra o fluxo aqui
                }
                break;
            }
            case 'tagNode': {
                // Lógica de tag (opcional)
                break;
            }
            case 'notifyNode': {
                let adminPhone = node.data.phone || process.env.MANAGER_PHONE;
                if (adminPhone) {
                    const cleanPhone = adminPhone.replace(/\D/g, '');
                    const adminJid = adminPhone.includes('@') ? adminPhone : `${cleanPhone}@s.whatsapp.net`;

                    await prisma.chat.update({
                        where: { instanceId_jid: { instanceId, jid } },
                        data: { adminJid: cleanPhone }
                    }).catch(() => { });

                    const chatInfo = await prisma.chat.findUnique({ where: { instanceId_jid: { instanceId, jid } } });
                    const clientName = chatInfo?.name || jid.split('@')[0];

                    await sock.sendMessage(adminJid, { text: `🔔 *ALERTA DE FLUXO*\n\nUsuário: ${clientName}\n\n${node.data.message}` })
                        .catch(err => console.error(`[Flow Notify Error] Erro ao notificar ${adminJid}:`, err.message));
                }
                break;
            }
        }

        // 3. Busca próximas conexões
        const outgoingEdges = (flowData.edges || []).filter(e => e.source === node.id && (!sourceHandle || e.sourceHandle === sourceHandle));

        if (outgoingEdges.length > 0) {
            for (const edge of outgoingEdges) {
                await runFlowNode(sock, instanceId, jid, flow, edge.target, edge.sourceHandle, buildLilyPrompt, getOpenAI, executeChamarGerente, settings, pushName, images, currentText);
            }
        } else {
            console.log(`[Flow Debug] Fluxo finalizado para ${jid}.`);
            await prisma.flowState.deleteMany({ where: { instanceId, jid } }).catch(() => { });
            if (io) io.emit('chat_update', { instanceId, jid, inFlow: false });
        }

    } catch (err) {
        console.error(`[Flow Error] Falha ao processar nó ${nodeId}:`, err.message);
        // Limpa o estado para não travar o usuário no nó quebrado
        await prisma.flowState.deleteMany({ where: { instanceId, jid } }).catch(() => { });
        if (io) io.emit('chat_update', { instanceId, jid, inFlow: false });
    }
}

/**
 * Inicia o monitor de retomada de fluxos (Follow-up)
 */
function startFlowMonitor(sessions) {
    setInterval(async () => {
        try {
            const agora = new Date();
            const expired = await prisma.flowState.findMany({
                where: {
                    resumeAt: { lte: agora },
                    NOT: { resumeAt: null }
                }
            });

            for (const state of expired) {
                const sock = sessions.get(state.instanceId);
                if (!sock) continue;

                const flow = await prisma.flow.findUnique({ where: { id: state.flowId } });
                if (!flow || flow.status !== 'Ativo') continue;

                await prisma.flowState.update({
                    where: { id: state.id },
                    data: { resumeAt: null }
                });

                const flowData = JSON.parse(flow.data);
                const outgoingEdges = (flowData.edges || []).filter(e => e.source === state.currentNodeId);

                for (const edge of outgoingEdges) {
                    // Nota: Aqui precisaríamos de acesso às funções de buildLilyPrompt etc.
                    // Por simplificação, esse monitor só retoma nós de Texto por enquanto ou precisa de injeção.
                }
            }
        } catch (err) {
            console.error('[Flow Cron Error]:', err.message);
        }
    }, 10000);
}

module.exports = {
    initFlows,
    handleFlows,
    runFlowNode,
    startFlowMonitor
};
