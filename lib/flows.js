const prisma = require('./prisma');
const { getStoreStatus, formatProduct } = require('./utils');

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
async function handleFlows(sock, instanceId, jid, text, msg, buildLilyPrompt, getOpenAI, executeChamarGerente, settings) {
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
                const currentNode = flowData.nodes.find(n => n.id === state.currentNodeId);

                // Se o nó atual for um gatilho ou nó de texto, e o cliente respondeu, busca o próximo nó
                const nextEdges = (flowData.edges || []).filter(e => e.source === state.currentNodeId);
                if (nextEdges.length > 0) {
                    // Por simplicidade, pega a primeira conexão. 
                    // Logica de botões/respostas específicas pode ser adicionada aqui.
                    await runFlowNode(sock, instanceId, jid, flow, nextEdges[0].target, null, buildLilyPrompt, getOpenAI, executeChamarGerente, settings);
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

                    await runFlowNode(sock, instanceId, jid, flow, triggerNode.id, null, buildLilyPrompt, getOpenAI, executeChamarGerente, settings);
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
async function runFlowNode(sock, instanceId, jid, flow, nodeId, sourceHandle = null, buildLilyPrompt, getOpenAI, executeChamarGerente, settings) {
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
                const finalSystemPrompt = await buildLilyPrompt(instanceId, jid, nodePrompt, storeInfo);
                await sock.sendPresenceUpdate('composing', jid).catch(() => { });

                // Busca o histórico diretamente via Prisma
                const history = await prisma.message.findMany({
                    where: { instanceId, jid },
                    orderBy: { timestamp: 'desc' },
                    take: 40
                });

                const messages = [
                    { role: 'system', content: finalSystemPrompt },
                    ...history.reverse().map(m => ({
                        role: m.fromMe ? 'assistant' : 'user',
                        content: m.text || 'O cliente enviou uma mídia.'
                    }))
                ];

                const tools = [
                    {
                        type: "function",
                        function: {
                            name: "chamar_gerente",
                            description: "Avisa o gerente sobre dúvidas complexas.",
                            parameters: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] }
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
                    }
                ];

                const completion = await ai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages,
                    tools,
                    tool_choice: "auto"
                });

                let responseMessage = completion.choices[0].message;

                if (responseMessage.tool_calls) {
                    messages.push(responseMessage);
                    for (const toolCall of responseMessage.tool_calls) {
                        const functionName = toolCall.function.name;
                        const args = JSON.parse(toolCall.function.arguments);
                        let result;

                        if (functionName === "chamar_gerente") {
                            const { reason } = args;
                            result = await executeChamarGerente(reason, jid, null, settings, node.data.adminPhone, sock, prisma, instanceId);
                        } else if (functionName === "check_availability") {
                            const { checkAvailability } = require('../routes/orders');
                            result = await checkAvailability(args.date, args.time);
                        } else if (functionName === "get_delivery_fee") {
                            const { calculateFee } = require('./maps');
                            result = await calculateFee(args.address);
                        }

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
                if (replyText) {
                    replyText = replyText.replace(/\*/g, '');
                    replyText = replyText.replace(/[•·]/g, '-');
                    replyText = replyText.replace(/[#*_`]/g, '');
                }
                await new Promise(r => setTimeout(r, 1000));
                await sock.sendMessage(jid, { text: replyText });

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
                await runFlowNode(sock, instanceId, jid, flow, edge.target, edge.sourceHandle, buildLilyPrompt, getOpenAI, executeChamarGerente, settings);
            }
        } else {
            console.log(`[Flow Debug] Fluxo finalizado para ${jid}.`);
            await prisma.flowState.deleteMany({ where: { instanceId, jid } }).catch(() => { });
            if (io) io.emit('chat_update', { instanceId, jid, inFlow: false });
        }

    } catch (err) {
        console.error(`[Flow Error] Falha ao processar nó ${nodeId}:`, err.message);
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
