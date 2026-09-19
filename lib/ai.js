const OpenAI = require('openai');
const prisma = require('./prisma');
const { getSettings, getCachedProducts } = require('./cache');
const { formatProduct, hasAvailableProductStock, getClosedDeliveryMessage } = require('./utils');
const axios = require('axios');
const { getStatusImage } = require('./status-media');
const { calculateFee } = require('./maps');

function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

function formatProductAddonGroups(product, addonGroupMap) {
    const groupIds = parseJsonArray(product.addonGroups);
    const groups = groupIds.map(id => addonGroupMap.get(String(id))).filter(Boolean);
    if (!groups.length) return '';

    const lines = ['   ADICIONAIS/OPCOES VINCULADOS:'];
    groups.forEach(group => {
        const required = Number(group.min || 0) > 0;
        lines.push(`   - Grupo: ${group.name} (${required ? `OBRIGATORIO: escolha de ${group.min} a ${group.max}` : `opcional: ate ${group.max}`})`);
        parseJsonArray(group.items).forEach(item => {
            if (!item?.hidden) {
                const price = Number(item.price || 0);
                lines.push(`      • ${item.name || 'Opcao'}${price > 0 ? `: R$ ${price.toFixed(2)}` : ''}`);
            }
        });
    });
    return `\n${lines.join('\n')}`;
}

// Mapa de modelos de IA: chave salva no banco -> nome real da API
const MODEL_MAP = { 'openai': 'gpt-4o', 'openai-mini': 'gpt-4o-mini', 'openai-gpt5-mini': 'gpt-5-mini', 'openai-nano': 'gpt-4.1-nano', 'claude': 'gpt-4o' };

const getStatusSendOptions = async (sock) => {
    const statusJidList = typeof sock.__getStatusJidList === 'function'
        ? await sock.__getStatusJidList()
        : [];
    console.log(`[Status] Conta conectada: ${sock.user?.id || 'desconhecida'}.`);
    console.log(`[Status] Audiência calculada: ${Array.isArray(statusJidList) ? statusJidList.length : 0} destinatários. Amostra: ${Array.isArray(statusJidList) ? statusJidList.slice(0, 3).join(', ') : 'nenhuma'}`);
    if (!Array.isArray(statusJidList) || statusJidList.length === 0) {
        console.error('[Status] Bloqueado: audiência vazia ou inválida.');
        throw new Error('STATUS_AUDIENCE_EMPTY: nenhuma audiência válida para o Status.');
    }
    return { broadcast: true, statusJidList };
};

const sendStatusMessage = async (sock, content) => {
    const contentType = content?.image ? 'imagem' : content?.video ? 'vídeo' : 'texto';
    console.log(`[Status] Iniciando envio de ${contentType}.`);
    const options = await getStatusSendOptions(sock);
    console.log('[Status] Chamando Baileys para status@broadcast.');
    try {
        const result = await sock.sendMessage('status@broadcast', content, options);
        console.log(`[Status] Baileys aceitou o envio: ${result?.key?.id || 'sem id retornado'}.`);
        return result;
    } catch (err) {
        console.error('[Status] Falha no sendMessage:', err);
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
    const { statusLoja, nomeDia, horaAtual, dataAtual, hoje } = storeInfo;
    const settings = await getSettings(userId);
    const instance = await prisma.instance.findUnique({ where: { id: instanceId }, select: { assistantName: true } });
    const assistantName = instance?.assistantName || "Lily";
    const [allProducts, addonGroups] = await Promise.all([
        getCachedProducts(userId),
        prisma.addonGroup.findMany({
            where: { userId },
            select: { id: true, name: true, min: true, max: true, items: true }
        })
    ]);
    const addonGroupMap = new Map(addonGroups.map(group => [String(group.id), group]));
    let deliveryCatalog = '';
    let orderCatalog = '';

    allProducts.filter(product => product.active !== false).forEach(product => {
        let variations = [];
        try {
            variations = typeof product.variations === 'string'
                ? JSON.parse(product.variations || '[]')
                : (product.variations || []);
        } catch (_) {
            variations = [];
        }

        const formatted = formatProduct(product, variations, false) + formatProductAddonGroups(product, addonGroupMap);
        if ((product.type === 'delivery' || product.type === 'combo_delivery') && hasAvailableProductStock(product, variations)) {
            deliveryCatalog += formatted + '\n\n';
        }
        if (product.type === 'encomenda' || product.type === 'addon' || String(product.type || '').startsWith('combo_')) {
            orderCatalog += formatted + '\n\n';
        }
    });
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

    // PARTE DO FRONT: Identidade e Tonalidade
    const identityPrompt = settings?.botPrompt || "Você é a Lily, a alma da Linda Cake!";

    // PARTE DO BACK: Dados do Sistema e Instruções Técnicas
    const systemContext = `
--- CONTEXTO DO SISTEMA (BACKEND) ---
[HORÁRIOS E STATUS]
Hoje é ${nomeDia}, ${dataAtual || hoje.toLocaleDateString('pt-BR')} às ${horaAtual}.
A loja está: ${statusLoja}.

 [CATALOGO ATUAL - DADOS REAIS]
PRONTA ENTREGA:
${deliveryCatalog.trim() || 'Nenhum item disponivel no momento.'}

ENCOMENDAS:
${orderCatalog.trim() || 'Consulte as opcoes cadastradas.'}

Use somente produtos, precos, variacoes, subitens e adicionais presentes acima. Nunca invente sabores ou datas.

${personalizedContext}

[CAPACIDADES E INSTRUÇÕES TÉCNICAS]
Responda somente ao que o cliente perguntou. Nao antecipe assuntos, catalogos ou informacoes nao solicitadas.
A apresentacao com o link do cardapio digital e enviada pelo sistema antes da sua resposta. Nao se apresente novamente.
O status da loja e contexto interno: so mencione fechamento quando o cliente perguntar sobre delivery/pronta entrega ou horario de funcionamento. Um cumprimento ou pergunta generica nao indica interesse em delivery.
Se a loja estiver fechada e o cliente pedir delivery, use: "${getClosedDeliveryMessage(settings)}". Nao envie catalogo de amanha nem ofereca encomendas quando desabilitadas. Se nao souber o que o cliente quer, pergunte sem mencionar fechamento.
Use somente os produtos, precos, variacoes e subitens do catalogo acima. Nunca invente sabores, opcoes, precos ou datas.
Se ja houver uma mensagem recente da Lily no historico, nao repita sua apresentacao, seu nome, sua identidade ou o link do cardapio; responda diretamente ao cliente de forma natural.
Se o cliente perguntar uma opcao, use apenas o que estiver no catalogo acima; se nao estiver, diga que precisa confirmar.
Nao envie o catalogo novamente quando o cliente estiver apenas corrigindo produto, data, horario ou disponibilidade de um pedido em andamento.
Palavras descritivas antes do nome nao mudam o produto: "bolo vulcao" pode identificar "Vulcao". Use o nome cadastrado quando a correspondencia for unica. Se houver erro de digitacao ou ambiguidade, confirme o item pretendido em uma pergunta curta, mantendo o contexto e sem reenviar o catalogo.
1. Use a ferramenta 'create_order' somente depois de concluir a coleta e o cliente confirmar explicitamente o resumo final do pedido. Escolher produto, variacao ou opcao nao significa confirmar o pedido. Nunca gere o link de pagamento antes dessa confirmacao.
   - Encomendas podem ser agendadas para hoje se 'check_availability' confirmar um horário futuro disponível.
2. Use 'get_delivery_fee' para calcular frete antes de finalizar pedidos de delivery.
3. Use 'check_availability' para confirmar se uma data/hora está disponível para encomendas.
4. Se o cliente tiver dúvidas que você não saiba responder, use 'chamar_gerente'.
5. Depois que o cliente escolher um produto com opções, faça uma pergunta por vez para coletar suas escolhas. Não pergunte todos os sabores e detalhes de vários produtos na mesma mensagem.
REGRA ABSOLUTA DE COLETA SEQUENCIAL:
- Para encomendas, siga esta ordem: item -> variacao -> data -> disponibilidade da data -> hora -> disponibilidade do horario -> adicionais/opcoes cadastrados -> nome do cliente -> resumo e confirmacao -> criacao do pedido e envio do link de pagamento.
- Data e disponibilidade tem prioridade sobre adicionais. Assim que o cliente informar a data, chame check_availability com a data e type "order", antes de perguntar ou responder sobre adicionais. Se a data nao tiver disponibilidade, responda isso imediatamente e ofereca outra data, sem coletar adicionais. Se tiver disponibilidade, apresente os horarios retornados e pergunte a hora. Apos o horario informado, confirme-o com check_availability antes de seguir aos adicionais.
- Quando o produto escolhido tiver "ADICIONAIS/OPCOES VINCULADOS", colete os grupos obrigatorios somente depois de data e horario disponiveis. Apresente um grupo por vez, com seus itens e precos, e respeite exatamente o minimo e maximo cadastrados. Salve cada escolha no argumento addons do create_order como objeto com groupId, groupName, name, price e quantity. Itens opcionais podem ser recusados pelo cliente; grupos obrigatorios nao podem ser pulados.
- Use o historico para conservar todas as escolhas e dados ja informados. Pergunte somente a primeira etapa pendente; nao reinicie a escolha de tamanho nem repita uma opcao respondida. Se o cliente informar varios dados espontaneamente, aproveite-os sem perguntar novamente.
- As variacoes de um produto sao alternativas: escolher P conclui a etapa de variacao, nao e necessario escolher Mini, M ou G depois. Conclua apenas os subitens e adicionais vinculados ao item/variacao escolhidos. Pule etapas de opcoes que nao existam no cadastro.
- Depois de item e variacao, pergunte a data e valide a disponibilidade da data com check_availability antes de qualquer adicional. So entao pergunte a hora e valide-a. Depois dos adicionais aplicaveis, obtenha o nome do cliente, sem inventar nem assumir o nome de perfil como nome informado para o pedido.
- Com todos os dados completos, apresente um unico resumo com item, variacao, opcoes/adicionais, data, hora, nome e valor total e pergunte se pode confirmar. Aguarde a resposta. Somente apos uma confirmacao explicita desse resumo use create_order e envie o link retornado pela ferramenta. Se houver correcao, atualize o resumo e solicite nova confirmacao antes de criar o pedido.
- Pergunte datas naturalmente: "Para qual dia voce quer encomendar?". Aceite respostas como "amanha", "sabado", "dia 25" ou "25/09" e converta internamente para YYYY-MM-DD nas ferramentas, usando a data atual do contexto e o fuso America/Sao_Paulo. Nunca exija nem mencione esse formato tecnico ao cliente.
- Se a data for ambigua, confirme o dia e o mes em linguagem natural antes de agendar. Nao escolha silenciosamente entre datas possiveis. Consulte a disponibilidade antes de confirmar.
- Na conversa, use os nomes das escolhas sem rotulos tecnicos como "subitem". Exemplo: "Vulcao P com Chocolate. Para qual dia voce quer encomendar?". Nao repita o resumo do pedido a cada resposta.
- Faça exatamente uma pergunta por mensagem e aguarde a resposta antes de continuar.
- Nunca escreva duas perguntas na mesma mensagem. É proibido juntar tamanho e massa, massa e recheio ou duas variações usando "e qual...".
- Nunca crie etapas fixas de massa, recheio ou topo. Pergunte esses detalhes somente se forem campos/opcoes realmente cadastrados para o produto escolhido e ainda nao respondidos. Chocolate como subitem ja escolhido nao autoriza perguntar outra massa ou outro recheio.
- Pergunte somente a próxima opção ainda não respondida. Após a resposta, faça a próxima pergunta em uma nova mensagem.
- Se houver varios grupos de adicionais/opcoes cadastrados para o item escolhido, avance um grupo por vez ate concluir os aplicaveis. Nunca antecipe a proxima etapa na pergunta atual.
- Quando a variação escolhida tiver subitens no catálogo (por exemplo, P com Baunilha e Chocolate), trate o subitem como uma escolha obrigatória separada. Nunca assuma o sabor e nunca finalize sem perguntar qual subitem o cliente quer.
- Variações e subitens genéricos devem ser chamados de "opção". Nunca chame uma opção de massa ou recheio apenas porque o nome parece ser um sabor.
- Só use os termos massa, recheio ou topo quando o catálogo ou o cliente identificar explicitamente esse tipo. Para subitens genéricos, use sempre o campo subItem.
- Exiba o preco completo de variacoes e subitens conforme o catalogo, nunca a diferenca para a menor opcao e nunca com sinal de +. Para adicionais, omita o preco quando for zero; so mostre valor quando houver acrescimo. Ignore formatos antigos de acrescimo no historico.
- Ao apresentar tamanhos, variacoes ou subitens, use sempre uma lista vertical: titulo em negrito com o nome do produto e, se ja escolhida, a variacao; abaixo, uma opcao por linha com seu preco total. Nunca junte as opcoes em uma frase com "ou". Para tamanhos, use "*Vulcao*" seguido de linhas como "- Mini: R$ 18.00" e "- P: R$ 25.00". Depois de escolhido P, use "*Vulcao P*" seguido de "- Chocolate: R$ 30.00" e "- Baunilha: R$ 25.00", cada um em sua propria linha. Esses nomes e valores sao apenas exemplos de formato: use os dados reais do catalogo. Nao reapresente tamanhos ja escolhidos; liste somente as opcoes da etapa atual. Se fizer uma pergunta, mantenha-a separada da lista.
- Nunca ofereça ou confirme uma variação/subitem marcado como [ESGOTADO HOJE]. Se apenas uma opção estiver disponível, ofereça somente essa opção.
--- FIM DO CONTEXTO ---
`;

    return [`Seu nome é ${assistantName}.`, identityPrompt, systemContext].join('\n');
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
- A galeria pode ser consultada para enviar imagens diretamente em mensagens.
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

        const response = await ai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "system", content: `${systemPrompt}\n${productRegistrationRule}\n${toolVisibilityRule}` }, { role: "user", content: userMessageContent }],
            tools: [
                { type: "function", function: { name: "create_order", parameters: { type: "object", properties: { product: { type: "string" }, scheduledDate: { type: "string" }, scheduledTime: { type: "string" }, clientName: { type: "string" } }, required: ["product", "scheduledDate", "scheduledTime", "clientName"] } } },
                { type: "function", function: { name: "create_product", description: "Cadastra um produto e suas variações. Cada item de variations DEVE conter somente name, price, stock, description, subItems e hidden.", parameters: { type: "object", properties: { name: { type: "string" }, price: { type: "number" }, description: { type: "string" }, type: { type: "string", enum: ["delivery", "order"] }, variations: { type: "array", items: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, price: { type: "number" }, stock: { type: "number" }, description: { type: "string" }, subItems: { type: "array" }, hidden: { type: "boolean" } }, required: ["name", "price", "stock", "description", "subItems", "hidden"] } } }, required: ["name", "price", "description", "variations"] } } },
                { type: "function", function: { name: "get_delivery_fee", description: "Calcula o valor do frete para um endereço informado pelo administrador.", parameters: { type: "object", properties: { address: { type: "string", description: "Endereço completo para calcular a entrega." } }, required: ["address"] } } },
                { type: "function", function: { name: "get_marketing_media", description: "Consulta as imagens da galeria da loja para escolher uma foto.", parameters: { type: "object", properties: { search: { type: "string" } } } } },
                { type: "function", function: { name: "send_marketing_media", description: "Envia uma imagem da galeria para o administrador ou cliente atual.", parameters: { type: "object", properties: { assetId: { type: "string" }, caption: { type: "string" } }, required: ["assetId"] } } }
            ],
        });

        const msg = response.choices[0].message;
        if (msg.content) await sock.sendMessage(jid, { text: msg.content });

        if (msg.tool_calls) {
            const internalSecret = process.env.INTERNAL_TOKEN || 'menzzu-internal-bypass-key';
            for (const call of msg.tool_calls) {
                const args = JSON.parse(call.function.arguments);
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
                } else if (call.function.name === "get_delivery_fee") {
                    try {
                        const address = String(args.address || '').trim();
                        console.log(`[Admin Tool] get_delivery_fee iniciado para: ${address}`);
                        const feeRes = await calculateFee(address, userId);
                        if (feeRes.error) {
                            console.warn(`[Admin Tool] get_delivery_fee falhou: ${feeRes.error}`);
                            await sock.sendMessage(jid, { text: 'Humm, o endereço que encontrei parece mais longe do que o esperado. Poderia me passar mais informações ou referências sobre o endereço para eu conferir o cálculo?' });
                        } else {
                            const rules = JSON.parse(settings?.deliveryRules || '[]');
                            const maxCashKm = rules.length > 0 ? parseFloat(rules[0].maxKm) : 2.0;
                            const feeValue = feeRes.type === 'fixed' ? feeRes.fee : feeRes.estimated;
                            const feeLabel = feeRes.type === 'fixed' ? 'Valor do frete' : 'Valor do frete (estimado)';
                            const paymentNote = parseFloat(feeRes.distance) <= maxCashKm
                                ? 'Pagamento em dinheiro disponível.'
                                : 'Para essa distância, use Pix ou cartão.';
                            console.log(`[Admin Tool] get_delivery_fee sucesso: R$ ${Number(feeValue).toFixed(2)} (${feeRes.distance}km).`);
                            await sock.sendMessage(jid, { text: `🚚 ${feeLabel}: R$ ${Number(feeValue).toFixed(2)}\n${paymentNote}` });
                        }
                    } catch (error) {
                        console.warn(`[Admin Tool] get_delivery_fee erro: ${error.message}`);
                        await sock.sendMessage(jid, { text: 'Humm, não consegui confirmar esse endereço com segurança. Poderia me passar mais informações ou referências para eu conferir o cálculo do frete?' });
                    }
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
                    await sock.sendMessage(jid, { image: await getStatusImage(asset.url), caption: args.caption || '' });
                    await sock.sendMessage(jid, { text: "✅ Imagem enviada!" });
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
