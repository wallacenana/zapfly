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

// OpenAI Instance (Lazy initialized)
let openaiInstance = null;
const getOpenAI = async () => {
    if (!openaiInstance) {
        const config = await getSettings();
        if (config?.openaiKey) {
            openaiInstance = new OpenAI({ apiKey: config.openaiKey });
        }
    }
    return openaiInstance;
};

/**
 * Constrói o System Prompt dinâmico da Lily
 */
async function buildLilyPrompt(instanceId, jid, customerContext = "", storeInfo, pushName = "") {
    const { statusLoja, nomeDia, horaAtual, hoje } = storeInfo;
    const settings = await getSettings();
    const { getCachedProducts } = require('./cache');
    const allProducts = await getCachedProducts();
    const instance = await getCachedInstance(instanceId);

    // MEMÓRIA DO CLIENTE: Busca histórico de pedidos/cadastro
    const customer = await prisma.customer.findUnique({ where: { jid } });
    const chat = await prisma.chat.findUnique({ where: { instanceId_jid: { instanceId, jid } } });
    let personalizedContext = "";

    // Nome a ser usado: prioriza DB, senão usa o nome do perfil do WhatsApp
    const nameToUse = customer?.name || pushName || "Cliente";

    if (customer) {
        const feeInfo = customer.lastDeliveryFee ? ` (Taxa fixa: R$ ${customer.lastDeliveryFee.toFixed(2)})` : "";
        
        // BUSCA PEDIDOS ATIVOS PARA DAR CONTEXTO À IA
        const activeOrders = await prisma.order.findMany({
            where: { 
                clientJid: jid, 
                status: { in: ['waiting_payment', 'pending', 'production', 'ready'] } 
            },
            orderBy: { createdAt: 'desc' }
        });

        let ordersContext = "";
        if (activeOrders.length > 0) {
            ordersContext = "\n- PEDIDOS ATIVOS AGORA:\n" + activeOrders.map(o => `  • ID: #${o.id.slice(-5).toUpperCase()}, Produto: ${o.product}, Status: ${o.status}, Entrega/Retirada: ${o.scheduledTime}`).join('\n') + 
            "\n- REGRA DE ALTERAÇÃO: Se o cliente tentar mudar, acrescentar ou cancelar um pedido que já está em 'production' ou 'ready', você está PROIBIDA de confirmar a mudança sozinha. Você deve dizer que precisa consultar a Linda para ver se ainda dá tempo e IMEDIATAMENTE usar a ferramenta 'chamar_gerente' explicando o que o cliente deseja.";
        }

        personalizedContext = `\n### DADOS DO CLIENTE (MEMÓRIA) ###\n- Nome: ${customer.name || nameToUse}\n- Endereço Cadastrado: ${customer.address || 'Não informado'}${feeInfo}${ordersContext}\n- IMPORTANTE: O cliente já está cadastrado. NÃO pergunte o nome ou endereço se já estiverem acima. Apenas confirme: "Posso entregar no mesmo endereço de sempre (${customer.address})?" ou "Ainda é para o(a) ${customer.name || nameToUse}?" para ser mais rápida. Como você já tem a taxa de entrega (${customer.lastDeliveryFee}), não precisa chamar 'get_delivery_fee' se o endereço for o mesmo.`;
    } else {
        personalizedContext = `\n### DADOS DO CLIENTE (PERFIL) ###\n- Nome: ${nameToUse}\n- Como é a primeira vez dele, você pode chamá-lo pelo nome para ser mais gentil!`;
    }

    const pixContext = settings?.pixReceiverName ? `\n### DADOS PARA VALIDAÇÃO DE PIX (GABARITO - CONFIDENCIAL - USO PASSIVO) ###\n- Recebedor Oficial da Loja: ${settings.pixReceiverName}\n- Chave Pix da Loja: ${settings.pixReceiverKey || 'Não informada'}\n- REGRA: Use estes dados APENAS se houver um comprovante na mesa ou se for perguntado. NÃO puxe este assunto se o cliente estiver apenas saudando ou escolhendo produtos.` : "";

    let deliveryCatalog = "";
    let orderCatalog = "";

    allProducts.forEach(p => {
        let variations = [];
        try {
            variations = typeof p.variations === 'string' ? JSON.parse(p.variations || '[]') : (p.variations || []);
        } catch (e) { variations = []; }

        const hasStock = p.stock > 0 || variations.some(v =>
            (v.stock > 0) || (v.subItems && v.subItems.some(si => si.stock > 0))
        );

        if (p.type === 'delivery') {
            if (hasStock) deliveryCatalog += formatProduct(p, variations) + '\n\n';
        } else {
            orderCatalog += formatProduct(p, variations) + '\n\n';
        }
    });

    const finalBasePrompt = instance?.botPrompt || settings?.botPrompt || "Você é a Lily, a alma da Linda Cake! Uma vendedora de elite que ama o que faz.";
    const knowledgeBase = instance?.knowledge ? `--- CONHECIMENTO EXTRA ---\n${instance.knowledge}\n\n` : "";
    const isOpen = statusLoja === "ABERTA";

    return [
        `### REALIDADE ATUAL — LEIA ANTES DE QUALQUER COISA ###`,
        `Data/hora exata agora: ${nomeDia}, ${hoje.toLocaleDateString('pt-BR')} às ${horaAtual}`,
        `Status da loja NESTE MOMENTO: ${statusLoja}`,
        `### ATENÇÃO: ESTE STATUS É O ÚNICO QUE VALE. ###`,
        `Se o status acima for FECHADA, informe que encerramos hoje e pergunte se o cliente quer garantir para AMANHÃ. SE O CLIENTE JÁ DISSE SIM OU QUERO, você está PROIBIDA de repetir o aviso de fechamento; você deve usar o catálogo imediatamente.`,
        ``,
        `### PRODUTOS DE PRONTA ENTREGA (disponivel HOJE, pedidos imediatos) ###`,
        deliveryCatalog || 'Nenhum em estoque no momento',
        ``,
        `### PRODUTOS SOB ENCOMENDA (nao disponivel hoje, requer agendamento previo) ###`,
        orderCatalog || 'Nenhuma',
        ``,
        `REGRA ABSOLUTA: O historico de conversa no final deste prompt são mensagens do passado. O unico status e disponibilidade que valem sao os desta secao acima.`,
        ``,
        `### QUEM VOCE E ###`,
        finalBasePrompt,
        `Voz: objetiva, persuasiva e sutil. Use escassez e exclusividade. Nunca enrole.`,
        ``,
        `### REGRAS DE OURO ###`,
        `4. CONCISAO: Respostas curtas vendem mais, EXCETO quando o cliente pergunta sobre sabores, recheios ou opções. Nesses casos, seja GENEROSA e mostre a LISTA COMPLETA de TODAS as categorias que você conhece (Simples, Gourmet e Especiais). É ESTRITAMENTE PROIBIDO omitir categorias ou resumir a lista. Mostre tudo para encantar o cliente.`,
        `4a. VISÃO: Você TEM CAPACIDADE de ver imagens. Se o cliente enviar um comprovante de Pix ou foto de produto, analise-o detalhadamente e responda com precisão. NUNCA diga que não consegue ver imagens.`,
        `5. VALORES: NUNCA diga que não pode informar valores. Use as ferramentas de catálogo para que o cliente veja os preços.`,
        `6. INTRODUCAO OBRIGATORIA: Escreva apenas UMA frase curta de introdução ao enviar catálogo ou listas.`,
        `7. CTA FINAL: Termine SEMPRE com uma única pergunta curta (ex: "Qual desses posso separar para você?").`,
        `8. FLUXO DE FECHAMENTO: Siga a regra de não repetir aviso de fechamento se o cliente aceitou para amanhã.`,
        `9. AGENDAMENTO: 'check_availability' apenas para Encomendas.`,
        `10. NOME: Se já tiver o nome no contexto (MEMÓRIA/PERFIL), NÃO PERGUNTE. Apenas use o nome dele para ser gentil.`,
        `11. UMA COISA POR VEZ: NUNCA faça duas ou mais perguntas no mesmo balão.`,
        `12. LISTAS: Use listas (bullets) APENAS para mostrar sabores, recheios ou opções do cardápio. É proibido usar para pedir dados.`,
        `13. CONTATO: PROIBIDO pedir telefone ou e-mail. Você já tem o WhatsApp do cliente.`,
        `14. VALIDAÇÃO DE PIX (HABILIDADE PASSIVA): Use esta habilidade APENAS se o cliente enviar um comprovante ou perguntar sobre um pagamento. Seja RIGOROSA na conferência, mas GENTIL na resposta. Se for INVÁLIDO, não diga os motivos técnicos, use fluidez: "Poxa, não consegui identificar esse Pix como válido aqui no meu sistema... você quer que eu chame a Linda para conferir com você?".`,
        `14a. BLOCO TÉCNICO: Somente ao analisar uma IMAGEM, use o bloco [ANALISE: ...]. Proibido usar em mensagens de texto normais.`,
        `15. ALTERAÇÕES EM PEDIDOS ATIVOS: Se o cliente quiser mudar algo em um pedido que já está em 'production' ou 'ready', diga: "Como esse pedido já está sendo preparado, preciso consultar a Linda para ver se ainda dá tempo de alterar". Então use 'chamar_gerente'.`,
        `16. DESCONTOS E NEGOCIAÇÃO: Você está PROIBIDA de dar descontos ou dizer "vou ver o que consigo". Se o cliente pedir desconto ou chorar preço, use este script: "Olha, eu não estou autorizada a dar descontos. Mas antes de falarmos de valores, vamos ver se ainda tem vaga? Você sabe como está nossa agenda ultimamente, né?! Para qual data você precisaria?". Use a escassez para valorizar o produto. Só chame a Linda se o cliente insistir MUITO após você tentar essa abordagem.`,
        `17. DIGITALIZAÇÃO DE LISTAS (SUPER PODER): Se o administrador (você) enviar uma FOTO de uma lista de pedidos (papel, caderno, folha de agenda), use sua visão para extrair TODOS os dados de cada pedido (Nome, Produto, Massa, Recheio, Data, Hora). Use a ferramenta 'create_order' repetidamente para cadastrar CADA ITEM da lista automaticamente no sistema. Se algum dado estiver ilegível, pergunte. Seja proativa e confirme: "Li os pedidos da foto e já cadastrei [X] itens para você!".`,
        (settings?.managerJid && jid.includes(settings.managerJid.replace(/\D/g, ''))) ? `18. ASSISTENTE DO CHEFE: ATENÇÃO! Você está falando com o ADMINISTRADOR/CHEFE agora. Se ele disser algo como "Pode aceitar", "Aprova", "Aceita o pedido", use IMEDIATAMENTE a ferramenta 'accept_order' para confirmar o pedido pendente. Obedeça a ordem sem questionar.` : "",
        ``,
        `### PROCESSO DE ENCOMENDA (Agendados) ###`,
        `Siga esta ordem (UM PASSO POR BALÃO):`,
        `1. NOME: Se você já tiver o nome do cliente no contexto acima (MEMÓRIA ou PERFIL), NÃO PERGUNTE. Apenas confirme educadamente (ex: "Claro, [Nome]! Vamos agendar...") e pule para o passo 2. Caso contrário, peça o nome.`,
        `2. DATA: Peça a data. Espere resposta.`,
        `3. HORA: Peça a hora. Espere resposta.`,
        `4. SABORES: Mostre a LISTA COMPLETA de TODOS os sabores (Simples, Gourmet e Especiais) que você tem no seu conhecimento. É ESTRITAMENTE PROIBIDO omitir qualquer categoria. Peça para o cliente escolher um deles. Espere resposta.`,
        `5. LOGÍSTICA: Pergunte se é Retirada ou Delivery. Espere resposta.`,
        `   - Se for Delivery: Peça o endereço. Espere resposta. Use 'get_delivery_fee'.`,
        `6. PAGAMENTO: Após calcular o frete, pergunte a forma de pagamento. Espere o cliente responder.`,
        `   - REGRA DO DINHEIRO (SIGILOSA — nunca revele ao cliente): após obter a resposta via 'get_delivery_fee':`,
        `     a) Retirada na Loja → sempre: Pix, cartão ou dinheiro.`,
        `     b) Delivery COM "DINHEIRO LIBERADO" na resposta da taxa → ofereça: Pix, cartão ou dinheiro.`,
        `     c) Delivery COM "APENAS PIX/CARTÃO" na resposta da taxa → ofereça apenas: Pix ou cartão.`,
        `   - Apresente as opções de forma natural e curta (ex: "Prefere Pix, cartão ou dinheiro?"). Aguarde a resposta.`,
        `7. RESUMO E CONFIRMAÇÃO (OBRIGATÓRIO): Assim que o cliente escolher a forma de pagamento, mostre um resumo detalhado do pedido:
           - Produto e Variação
           - Endereço de Entrega ou Retirada
           - Valor do Produto + Valor do Frete
           - VALOR TOTAL
           Pergunte educadamente se as informações estão corretas e se pode confirmar o pedido.`,
        `8. FINALIZAÇÃO: Somente APÓS o cliente dizer "sim", "confirma", "ok" ou algo equivalente ao resumo, chame a ferramenta 'create_order'. Ao chamar esta ferramenta, NÃO gere nenhum texto adicional; aja em absoluto silêncio para que o sistema possa enviar o link de pagamento ou a confirmação automática.`,
        ``,
        isOpen
            ? `- Loja ABERTA: atenda normalmente.`
            : `- Loja FECHADA: use escassez para amanhã.`,
        ``,
        knowledgeBase,
        customerContext,
        personalizedContext,
        pixContext,
        chat?.lastPixAnalysis ? `\n### HISTÓRICO DA ÚLTIMA VALIDAÇÃO (INFORMAÇÃO PASSIVA) ###\nIsto é apenas para sua referência caso o cliente pergunte algo como "recebeu?" ou "deu certo?". Se o cliente estiver falando de outro assunto, IGNORE esta seção:\n${chat.lastPixAnalysis}` : ""
    ].join('\n');
}

/**
 * Notifica o gerente sobre um atendimento
 */
async function executeChamarGerente(reason, jid, currentChat, settings, flowAdminPhone, sock, prisma, instanceId) {
    let managerJid = flowAdminPhone || currentChat?.adminJid || settings?.managerJid;
    if (managerJid) {
        if (!managerJid.includes('@')) {
            managerJid = managerJid.replace(/\D/g, '') + '@s.whatsapp.net';
        }
        await prisma.chat.update({
            where: { instanceId_jid: { instanceId, jid } },
            data: { adminJid: managerJid.includes('@') ? managerJid.split('@')[0] : managerJid }
        }).catch(() => { });

        const clientName = currentChat?.name || jid.split('@')[0];
        const host = process.env.PUBLIC_URL || 'http://localhost:5173';
        const alertMsg = `⚠️ *ATENÇÃO GESTOR!* ⚠️\n\nO cliente solicitou ajuda.\n\n👤 *Cliente:* ${clientName}\n❓ *Motivo:* ${reason}\n\n🔗 *Abrir Chat:* ${host}/chat`;

        await sock.sendMessage(managerJid, { text: alertMsg });
        return { success: true, message: "O gerente foi avisado." };
    }
    return { success: false, error: "Gerente não cadastrado." };
}

/**
 * Agente de administração (Lily Executive)
 */
async function handleAdminAgent(sock, instanceId, jid, text, settings, images = []) {
    try {
        const ai = await getOpenAI();
        if (!ai) return;

        const products = await prisma.product.findMany();
        const catalog = products.map(p => {
            const vars = typeof p.variations === 'string' ? JSON.parse(p.variations || '[]') : (p.variations || []);
            const varsStr = vars.map(v => `${v.name} (R$${v.price})`).join(', ');
            return `- ${p.name}: ${varsStr || `R$${p.price}`}`;
        }).join('\n');

        const assets = await prisma.marketingAsset.findMany();
        const galleryContext = assets.length > 0
            ? "\n- GALERIA DE MARKETING DISPONÍVEL:\n" + assets.map(a => `ID: ${a.id}, NOME: ${a.name}`).join('\n')
            : "\n(Galeria de marketing está vazia)";

        const hoje = new Date();
        const systemPrompt = `Você é a Lily Executive, assistente pessoal e braço direito do dono da loja.
Sua missão é agendar pedidos e agora também cuidar do MARKETING no Status do WhatsApp.

TRATAMENTO ESPECIAL:
- Sempre comece suas respostas com "Oi Linda! ✨" ou "Oi Chefe! 🧁".
- Seja carinhosa, mas extremamente eficiente.

CONTEXTO ATUAL:
- Hoje é ${hoje.toLocaleDateString('pt-BR')} às ${hoje.toLocaleTimeString('pt-BR')}.
- CARDÁPIO ATUAL:
${catalog}
${galleryContext}

INSTRUÇÕES:
1. Use 'create_order' para agendar ou 'update_order' para editar.
2. NOVIDADE: Use 'post_status' para publicar no Status do WhatsApp. 
   - Se o dono pedir para postar algo, procure na GALERIA DE MARKETING acima o item que mais combina pelo nome.
   - Se a galeria estiver vazia ou não tiver a foto certa, use assetId='none' e crie uma legenda criativa sozinha.
   - NUNCA deixe de postar: se não tiver foto, posta como texto.
3. NOVIDADE: Use 'manage_products' para ADICIONAR ou ATUALIZAR itens no cardápio.
   - FORMATO OBRIGATÓRIO PARA CADA VARIAÇÃO (dentro do array variations):
     [{"name": "Nome da Variação", "price": 15, "stock": 10, "description": "Descrição da variação", "subItems": [{"name": "", "stock": null}]}]
   - NUNCA esqueça do campo 'subItems'. Se não houver itens extras, envie como [{"name": "", "stock": null}].
   - Cada variação deve ter sua própria 'description' e 'stock' individual.
   - Use type='delivery' para Pronta Entrega e type='encomenda' para Agendados.
   - SEJA CRIATIVA: Se ele não der descrição, crie uma bem persuasiva para o produto e para as variações.
4. Se ele mandar apenas um "Oi", responda com carinho.
5. IMPORTANTE: Você recebe áudios transcritos automaticamente. Se o usuário falar por áudio, o sistema converterá em texto para você. Processe como se fosse um comando escrito.
6. Confirme suas ações de forma curta, fofa e eficiente.`;

        const history = await prisma.message.findMany({
            where: { instanceId, jid },
            orderBy: { timestamp: 'desc' },
            take: 30
        });

        const userMessageContent = [{ type: "text", text: text || "O dono enviou uma imagem." }];
        for (const b64 of images) {
            userMessageContent.push({
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${b64}` }
            });
        }

        const messages = [
            { role: "system", content: systemPrompt },
            ...history.reverse().map(m => ({
                role: m.fromMe ? "assistant" : "user",
                content: m.text
            })),
            { role: "user", content: userMessageContent }
        ];

        const response = await ai.chat.completions.create({
            model: "gpt-4o",
            messages,
            tools: [
                {
                    type: "function",
                    function: {
                        name: "create_order",
                        description: "Cria um novo agendamento no sistema.",
                        parameters: {
                            type: "object",
                            properties: {
                                product: { type: "string" },
                                variation: { type: "string", description: "Nome da variação (ex: P, M, G ou sabor)" },
                                quantity: { type: "string", default: "1" },
                                scheduledDate: { type: "string", description: "YYYY-MM-DD" },
                                scheduledTime: { type: "string", description: "HH:MM" },
                                clientName: { type: "string" },
                                type: { type: "string", enum: ["order", "delivery"] },
                                deliveryAddress: { type: "string" },
                                paymentMethod: { type: "string", default: "Admin" },
                                massa: { type: "string", description: "Tipo da massa do bolo (ex: baunilha, chocolate)" },
                                recheio: { type: "string", description: "Sabor do recheio" },
                                topo: { type: "string", description: "Informações sobre o topo do bolo" },
                                notes: { type: "string" }
                            },
                            required: ["product", "scheduledDate", "scheduledTime", "clientName"]
                        }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "update_order",
                        description: "Atualiza ou edita um pedido já existente.",
                        parameters: {
                            type: "object",
                            properties: {
                                orderId: { type: "string", description: "O código de referência do pedido (ex: #XYZ12)" },
                                product: { type: "string" },
                                variation: { type: "string" },
                                quantity: { type: "string" },
                                scheduledDate: { type: "string" },
                                scheduledTime: { type: "string" },
                                massa: { type: "string" },
                                recheio: { type: "string" },
                                topo: { type: "string" },
                                notes: { type: "string" }
                            },
                            required: ["orderId"]
                        }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "accept_order",
                        description: "Aceita um pedido pendente. Se não for especificado o ID, aceite o pedido pendente mais recente.",
                        parameters: {
                            type: "object",
                            properties: {
                                orderId: { type: "string", description: "Opcional. O ID do pedido." }
                            }
                        }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "post_status",
                        description: "Publica no Status (Stories) do WhatsApp. Pode ser com foto (da galeria) ou só texto.",
                        parameters: {
                            type: "object",
                            properties: {
                                assetId: { type: "string", description: "ID da imagem da galeria de marketing. Use 'none' se não houver foto disponível." },
                                caption: { type: "string", description: "Legenda persuasiva e criativa para o story" }
                            },
                            required: ["caption"]
                        }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "manage_products",
                        description: "Adiciona ou atualiza produtos no cardápio da loja.",
                        parameters: {
                            type: "object",
                            properties: {
                                action: { type: "string", enum: ["create", "update"], description: "Ação a ser realizada" },
                                name: { type: "string", description: "Nome do produto" },
                                price: { type: "number", description: "Preço base do produto" },
                                stock: { type: "number", description: "Quantidade em estoque total do produto" },
                                description: { type: "string", description: "Descrição vendedora do produto" },
                                variations: {
                                    type: "string",
                                    description: "JSON Array OBRIGATÓRIO: [{name: 'M', price: 50, stock: 10, description: '...', subItems: [{name: '', stock: null}]}]"
                                },
                                type: { type: "string", enum: ["encomenda", "delivery"], default: "encomenda" }
                            },
                            required: ["action", "name"]
                        }
                    }
                }
            ]
        });

        const msg = response.choices[0].message;
        if (msg.content) {
            await sock.sendMessage(jid, { text: msg.content });
        }

        if (msg.tool_calls) {
            for (const call of msg.tool_calls) {
                if (call.function.name === "create_order") {
                    const args = JSON.parse(call.function.arguments);
                    try {
                        const res = await axios.post('http://localhost:3001/orders', { ...args, instanceId: instanceId });
                        const ref = res.data.id.slice(-5).toUpperCase();
                        const paymentLink = res.data.paymentLink;

                        if (paymentLink) {
                            await sock.sendMessage(jid, {
                                text: `📦 *Pedido Agendado!* \n\nPara que possamos iniciar a produção, realize o pagamento no link abaixo:\n\n🔗 *Link de Pagamento:* ${paymentLink}\n\n⚠️ *Atenção:* O pedido será confirmado automaticamente pela cozinha assim que o pagamento for aprovado! ✨`
                            });
                        } else {
                            await sock.sendMessage(jid, {
                                text: `✅ *Pedido Confirmado!* \n\n👤 *Cliente:* ${args.clientName}\n🎂 *Item:* ${args.product} ${args.variation || ''}\n📅 *Data:* ${args.scheduledDate}\n⏰ *Hora:* ${args.scheduledTime}\n🆔 *Ref:* #${ref}\n\nJá estamos nos preparativos! 🚀`
                            });
                        }
                    } catch (err) {
                        await sock.sendMessage(jid, { text: `❌ *Erro ao agendar:* ${err.response?.data?.error || err.message}` });
                    }
                } else if (call.function.name === "update_order") {
                    const args = JSON.parse(call.function.arguments);
                    try {
                        const refCode = args.orderId.replace('#', '').toUpperCase();
                        const allOrders = await prisma.order.findMany();
                        const targetOrder = allOrders.find(o => o.id.slice(-5).toUpperCase() === refCode);
                        if (!targetOrder) {
                            await sock.sendMessage(jid, { text: `❌ *Pedido #${refCode} não encontrado.*` });
                            continue;
                        }
                        await axios.patch(`http://localhost:3001/orders/${targetOrder.id}`, args);
                        await sock.sendMessage(jid, { text: `✅ *Pedido #${refCode} atualizado!*` });
                    } catch (err) {
                        await sock.sendMessage(jid, { text: `❌ *Erro ao editar:* ${err.response?.data?.error || err.message}` });
                    }
                } else if (call.function.name === "accept_order") {
                    const args = JSON.parse(call.function.arguments);
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
                            await sock.sendMessage(jid, { text: `❌ *Nenhum pedido pendente encontrado para aceitar.*` });
                        } else {
                            await axios.patch(`http://localhost:3001/orders/${orderId}`, { status: 'accepted' });
                            await sock.sendMessage(jid, { text: `✅ *Feito! O pedido #${orderId.slice(-4).toUpperCase()} foi movido para Aceito e o cliente foi notificado.* ✨` });
                        }
                    } catch (err) {
                        await sock.sendMessage(jid, { text: `❌ *Erro ao aceitar:* ${err.response?.data?.error || err.message}` });
                    }
                } else if (call.function.name === "post_status") {
                    const args = JSON.parse(call.function.arguments);
                    try {
                        if (!args.assetId || args.assetId === 'none') {
                            await sock.sendMessage('status@broadcast', { text: args.caption });
                            await sock.sendMessage(jid, { text: `✅ *Status de texto publicado!* ✨\n\n"${args.caption}"` });
                            continue;
                        }

                        const asset = await prisma.marketingAsset.findUnique({ where: { id: args.assetId } });
                        if (!asset) {
                            await sock.sendMessage('status@broadcast', { text: args.caption });
                            await sock.sendMessage(jid, { text: `⚠️ Foto não encontrada na galeria. Postei como *texto* no status.` });
                            continue;
                        }

                        const fullPath = path.join(process.cwd(), asset.path);
                        if (!fs.existsSync(fullPath)) {
                            await sock.sendMessage('status@broadcast', { text: args.caption });
                            await sock.sendMessage(jid, { text: `⚠️ Arquivo não encontrado no servidor. Postei como *texto* no status.` });
                            continue;
                        }

                        const imageBuffer = fs.readFileSync(fullPath);
                        await sock.sendMessage('status@broadcast', {
                            image: imageBuffer,
                            caption: args.caption
                        });
                        await sock.sendMessage(jid, { text: `✅ *Status publicado!* ✨\n\n📸 Foto: "${asset.name}"\n💬 Legenda: "${args.caption}"` });
                    } catch (err) {
                        await sock.sendMessage(jid, { text: `❌ *Erro ao postar status:* ${err.message}` });
                    }
                } else if (call.function.name === "manage_products") {
                    const args = JSON.parse(call.function.arguments);
                    try {
                        if (args.action === "create") {
                            const existing = await prisma.product.findFirst({
                                where: { name: { contains: args.name } }
                            });
                            if (existing) {
                                await sock.sendMessage(jid, { text: `⚠️ *Atenção:* Já temos um produto chamado "${existing.name}" cadastrado.` });
                                continue;
                            }
                            let finalVariations = args.variations || "[]";
                            const product = await prisma.product.create({
                                data: {
                                    name: args.name,
                                    price: args.price || 0,
                                    stock: args.stock || 0,
                                    description: args.description || "",
                                    variations: finalVariations,
                                    type: args.type || "encomenda"
                                }
                            });
                            invalidateProductCache();
                            await sock.sendMessage(jid, { text: `✅ *Produto cadastrado!* ✨` });
                        } else {
                            const existing = await prisma.product.findFirst({
                                where: { name: { contains: args.name } }
                            });
                            if (!existing) {
                                await sock.sendMessage(jid, { text: `❌ *Erro:* Não encontrei o produto "${args.name}".` });
                                continue;
                            }
                            const updated = await prisma.product.update({
                                where: { id: existing.id },
                                data: {
                                    price: args.price !== undefined ? args.price : existing.price,
                                    stock: args.stock !== undefined ? args.stock : existing.stock,
                                    description: args.description !== undefined ? args.description : existing.description,
                                    variations: args.variations !== undefined ? args.variations : existing.variations,
                                    type: args.type !== undefined ? args.type : existing.type
                                }
                            });
                            invalidateProductCache();
                            await sock.sendMessage(jid, { text: `✅ *Produto atualizado!* ✨` });
                        }
                    } catch (err) {
                        await sock.sendMessage(jid, { text: `❌ *Erro no cardápio:* ${err.message}` });
                    }
                }
            }
        }
    } catch (err) {
        console.error('[Admin Agent Error]', err);
        await sock.sendMessage(jid, { text: "Vixe, tive um probleminha aqui para processar seu comando. 😓" });
    }
}

module.exports = {
    getOpenAI,
    buildLilyPrompt,
    executeChamarGerente,
    handleAdminAgent,
    MODEL_MAP
};
