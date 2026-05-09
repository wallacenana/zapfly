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
    const { statusLoja, nomeDia, horaAtual, hoje, isBeforeOpening } = storeInfo;
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
            ordersContext = "\n- PEDIDOS ATIVOS AGORA:\n" + activeOrders.map(o => `  • ID: #${o.id.slice(-5).toUpperCase()}, Produto: ${o.product}${o.variation ? ` (${o.variation})` : ""}, TOTAL ATUAL: R$ ${o.totalValue.toFixed(2)}, Status: ${o.status}, Entrega/Retirada: ${o.scheduledTime}`).join('\n') +
                "\n- REGRA DE ALTERAÇÃO:\n" +
                "  1. 'waiting_payment': O preparo ainda não começou. Você PODE incluir mais itens ou alterar o pedido livremente.\n" +
                "  2. 'pending', 'production' ou 'ready': Você está PROIBIDA de confirmar mudanças sozinha. Diga que precisa consultar a Linda e use 'chamar_gerente'.";
        }

        personalizedContext = `\n### DADOS DO CLIENTE (MEMÓRIA) ###\n- Nome: ${customer.name || nameToUse}\n- Endereço Cadastrado: ${customer.address || 'Não informado'}${feeInfo}${ordersContext}\n- IMPORTANTE: O cliente já está cadastrado. NÃO pergunte o nome ou endereço se já estiverem acima. Apenas confirme: "Posso entregar no mesmo endereço de sempre (${customer.address})?" ou "Ainda é para o(a) ${customer.name || nameToUse}?". Como você já tem a taxa de entrega (${customer.lastDeliveryFee}), se este valor for MAIOR QUE ZERO, você não precisa chamar 'get_delivery_fee' se o endereço for o mesmo. Caso contrário (se for 0 ou nulo), VOCÊ DEVE chamar a ferramenta para calcular o valor correto.
- REUSO DE PEDIDO: Se você vir acima um pedido em 'waiting_payment' que seja IGUAL ao que o cliente está pedindo agora (ou se ele pedir apenas para pagar), não crie um novo. Apenas confirme: "Vi que você já tem esse pedido aguardando pagamento. Vou gerar o link novamente para você, tá bom?".`;
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
            if (hasStock) {
                deliveryCatalog += formatProduct(p, variations, true) + '\n\n';
            } else {
                deliveryCatalog += formatProduct(p, variations, true) + ' [ESGOTADO HOJE]\n\n';
            }
        } else {
            orderCatalog += formatProduct(p, variations, true) + '\n\n';
        }
    });

    // Mini-calendário de referência para evitar alucinações de data
    let calendarRef = "";
    const daysArr = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
    for (let i = 0; i < 15; i++) {
        const d = new Date(hoje);
        d.setDate(hoje.getDate() + i);
        const dayName = i === 0 ? `HOJE (${daysArr[d.getDay()]})` : daysArr[d.getDay()];
        calendarRef += `  - ${dayName}: ${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}\n`;
    }

    // ─── CATÁLOGOS SAZONAIS (DIFERENCIAIS) ───
    const seasonalCatalogs = await prisma.seasonalCatalog.findMany({ where: { active: true } });
    let seasonalContext = "";

    for (const cat of seasonalCatalogs) {
        const [y, m, d_] = cat.eventDate.split('-').map(Number);
        const eventDate = new Date(y, m - 1, d_, 12, 0, 0);

        const startDisplay = new Date(eventDate);
        startDisplay.setDate(eventDate.getDate() - cat.preStartDays);
        startDisplay.setHours(0, 0, 0, 0);

        const endDisplay = new Date(eventDate);
        endDisplay.setDate(eventDate.getDate() + cat.postEndDays);
        endDisplay.setHours(23, 59, 59, 999);

        if (hoje >= startDisplay && hoje <= endDisplay) {
            const isAfter = hoje > eventDate;
            const items = JSON.parse(cat.items || '[]');
            const itemsText = items.map(i => `  • ${i.name}: R$ ${parseFloat(i.price).toFixed(2)}${i.description ? ` (${i.description})` : ""}`).join('\n');

            let catHeader = isAfter
                ? `### CATÁLOGO ESPECIAL (PÓS-EVENTO): Ainda dá tempo de presentear! (${cat.name}) ###`
                : `### CATÁLOGO ESPECIAL (VIGENTE): Já temos o nosso catálogo do ${cat.name}! ###`;

            seasonalContext += `\n${catHeader}\n${cat.description || ""}\n${itemsText}\n`;

            if (cat.onlySeasonalOnEventDay) {
                seasonalContext += `- RESTRIÇÃO DE DATA: Se o cliente tentar agendar uma encomenda para o dia ${cat.eventDate}, informe que para ESTA DATA ESPECÍFICA estamos aceitando apenas os itens do catálogo de ${cat.name} acima. Não aceite outros produtos para esta data.\n`;
            }

            if (cat.maxOrders > 0) {
                const ordersOnDay = await prisma.order.count({ where: { scheduledDate: cat.eventDate, status: { not: 'cancelled' } } });
                if (ordersOnDay >= cat.maxOrders) {
                    seasonalContext += `- ATENÇÃO: As vagas para encomendas no dia ${cat.eventDate} estão ESGOTADAS.\n`;
                }
            }
        }
    }

    const finalBasePrompt = instance?.botPrompt || settings?.botPrompt || "Você é a Lily, a alma da Linda Cake! Uma vendedora de elite que ama o que faz.";
    const knowledgeBase = instance?.knowledge ? `\n--- CONHECIMENTO EXTRA ---\n${instance.knowledge}\n` : "";
    return [
        `### PERSONA E OBJETIVO ###`,
        finalBasePrompt,
        `Voz: Extremamente carinhosa, humana e encantadora. Você é a alma da Linda Cake! Sua missão é encantar o cliente e tornar o processo de compra um prazer. Use emojis com moderação e seja sempre muito educada.`,
        ``,
        `### CONTEXTO DA LOJA ###`,
        `Data/Hora: ${nomeDia}, ${hoje.toLocaleDateString('pt-BR')} às ${horaAtual}`,
        `Horários da Semana:\n${storeInfo.resumoHorarios}`,
        `Calendário de Referência (USE ESTA LISTA PARA NÃO ERRAR O DIA DA SEMANA):\n${calendarRef}`,
        `Status Atual: A loja está ${statusLoja}.`,
        statusLoja === "FECHADA" ? (isBeforeOpening ? "Informe que abrimos mais tarde e ofereça para agendar." : "Informe que encerramos e ofereça para garantir para AMANHÃ.") : "",
        seasonalContext,
        ``,
        `### CARDÁPIO ATUAL (Para sua consulta) ###`,
        `[PRONTA ENTREGA - HOJE]`,
        deliveryCatalog || 'Nenhum item disponível para hoje.',
        `[ENCOMENDAS - AGENDAMENTOS]`,
        orderCatalog || 'Nenhum item disponível para encomenda.',
        ``,
        `### DIRETRIZES DE CONVERSA (NATURALIDADE) ###`,
        `1. ENTENDA O CLIENTE: Seja versátil. Se o cliente quer apenas tirar uma dúvida, responda. Se ele quer ver o cardápio, de a ele o cardápio. Não force o funil de venda se ele não estiver pronto.`,
        `2. ESCOLHA DO CATÁLOGO: MUITO IMPORTANTE!`,
        `   - É impossivel definir respostas padrão para cada caso, então você precisa entender se está sendo pedido algo sobre encomendas ou delivery.`,
        `   - Se o cliente falar sobre bolos, provavelmente é sobre encomendas, então manda pra ela o catalogo acima de bolos como está escrito, mas sem os itens marcados como 'invisiveis', para catalogo de bolos e kits, proibido chamar ferramentas, se falar sobre doces, disponibilidade, "hoje", é provavel que seja sobre delivery, dai é obrigatório usar a ferramenta 'get_delivery_catalog'.`,
        `   - Lembre-se vai existir momentos, quando a loja estver fechada que você vai fazer encomenda de doces de delivery, entenda a intenção do usuário quando isso acontecer`,
        `   - Sempre gere uma introdução fofa (ex: "Claro! Vou te mostrar nossas opções maravilhosas...") e termine com uma pergunta aberta. O sistema enviará o catálogo visual em seguida.`,
        `3. UMA COISA POR VEZ: Mantenha a conversa fluida. Faça apenas uma pergunta por vez para não sobrecarregar o cliente.`,
        ``,
        `### PIPELINE 1: DELIVERY (IMEDIATO) ###`,
        `Focado em agilidade para itens disponíveis hoje.`,
        `- Passo A: Confirme o produto e derivados (não é sugestivo, é obrigatório): `,
        `     Peça em mensagens separadas cada item (obrigatório coletar tudo o que é necessário para cada produto):
                variação (mais importante que sabor da massa, pois tem q verificar a disponilidade da massa para o tamanho); 
                sabor da massa (não aplicavel aos brownies, mas aplicavel a "vulcão"); 
                sabor do recheio; 
                quantidade.`,
        `- Passo B (CROSS-SELL OBRIGATÓRIO): ANTES de fechar, ofereça um item adicional (ex: Refrigerante, Água ou Brownie). Seja criativo, pode ser qualquer coisa que esteja em estoque. Obrigatório que seja apenas uma sugestão.`,
        `- Passo C: Pergunte se é para entrega ou retirada na loja (obrigatório).`,
        `- Passo D: Peça o endereço e use 'get_delivery_fee'.`,
        `- Passo E: Apresente o Resumo com valores reais (Todos os itens + Frete), não invente informações. Utilize os produtos e os valores fornecidos na conversa, produto e variação. Após isso peça autorização para o link.`,
        ``,
        `### PIPELINE 2: ENCOMENDAS E AGENDAMENTOS (DATAS FUTURAS) ###`,
        `Focado em organização para datas futuras.`,
        `- Passo A: Garanta a DATA e a HORA.`,
        `   - Peça a data e a hora.`,
        `   - Assim que tiver ambos, use IMEDIATAMENTE a ferramenta 'check_availability'.`,
        `   - Se estiver disponível, responda confirmando o dia da semana, dia/mês e horário (Ex: "Disponível! Agendado para quarta-feira, 20/05 às 15h").`,
        `- Passo B: Escolha do Produto, Massa e Recheios.`,
        `- Passo C (VENDA ADICIONAL): Sugira Salgados, Docinhos ou Cupcakes para acompanhar o bolo.`,
        `- Passo D (OBRIGATÓRIO): Coleta da IMAGEM DE REFERÊNCIA do bolo.`,
        `- Passo E (TOPO): Coleta de foto do TOPO ou das informações (Nome/Idade/Tema).`,
        `- Passo F (OBRIGATÓRIO): Informe que a RETIRADA NA LOJA é o padrão (Não pergunte, apenas informe).`,
        `- Passo G: Resumo Final e link.`,
        ``,
        `### ESTRATÉGIA DE VENDA (CARRINHO) ###`,
        `- MÚLTIPLOS ITENS: O 'carrinho_itens_extras' é sua ferramenta de poder. Use-a para acumular tudo que o cliente quer.`,
        `- SEJA PROATIVA: "Para acompanhar seu Vulcão, que tal um refrigerante geladinho por R$ 7,00?" ou "Temos Brownies recheados por R$ 6,00, aceita um?"`,
        `- SEGUNDO ITEM: Se o cliente já tem um pedido aberto e pede "Adicione um refrigerante", chame 'update_order' incluindo o refrigerante na lista 'carrinho_itens_extras'.`,
        ``,
        `### REGRAS PARA KIT FESTAS (COMBOS) ###`,
        `- Se no histórico o cliente ainda não tiver recebido cardápio de kits, então deve ser enviado. Não sugira um kit festa sem fazer parte do contexto da conversa ou o cliente não tiver confirmado o que quer.`,
        `- CONTEÚDO DO KIT: Todo 'Kit Festa' (Especial, Prático, etc.) contém obrigatoriamente um BOLO DECORADO e um TOPPER.`,
        `- FLUXO OBRIGATÓRIO (PASSO A PASSO): Você está PROIBIDA de fechar o resumo de um Kit sem antes ter coletado em balões separados: `,
        `       1. Sabor da Massa e Sabor do Recheio.`,
        `       2. Imagem de referência do BOLO (OBRIGATÓRIO): O cliente DEVE enviar uma foto do modelo de bolo que deseja. Se ele disser que não tem, peça para ele procurar uma ou descrever detalhadamente, mas insista na foto pois é vital para a Linda.`,
        `       3. Informação do TOPPER: Use exatamente esta abordagem: "Agora preciso que me passe a informação do topper". `,
        `          - Identifique se o cliente quer passar apenas uma informação (ex: Nome) ou várias (ex: Nome, idade, tema).`,
        `          - Se o cliente tiver foto do modelo de topo que deseja, ele envia.`,
        `          - Apenas pule esta parte se o cliente disser explicitamente que "NÃO QUER TOPO".`,
        `- PREÇO FIXO: O valor do Kit já inclui todos os itens da sua descrição (Bolo, doces, salgados, etc.).`,
        `- REGRA DE COBRANÇA (CRÍTICA): Você está PROIBIDA de passar os itens que já compõem o kit no campo 'carrinho_itens_extras'. Se você fizer isso, o sistema cobrará o valor do kit + o valor de cada item individualmente, gerando um erro de preço.`,
        `- COMO FAZER: No 'product' coloque o nome do Kit (ex: Kit Especial). No resumo de texto para o cliente, você pode listar tudo que vem no kit. Mas na ferramenta 'create_order', o campo 'carrinho_itens_extras' deve ser usado APENAS para itens que o cliente pediu A MAIS (ex: uma Coca-Cola extra ou mais 50 brigadeiros além dos que já vem no kit).`,
        ``,
        `### REGRAS IMPORTANTES ###`,
        `- ESTOQUE: Se o item estiver [ESGOTADO HOJE], ofereça para encomendar para amanhã.`,
        `- VALORES: Sempre informe os preços conforme o cardápio. Para topos personalizados, diga que o valor depende do tema e que consultará a Linda.`,
        `- IMAGENS: Você pode ver fotos! Analise referências de bolos ou comprovantes se o cliente mencionar.`,
        `- FINALIZAÇÃO: Só use 'create_order' APÓS o cliente confirmar o resumo final explicitamente.`,
        `- MÚLTIPLOS ITENS (CARRINHO): Para vender mais de um item no mesmo pedido, use o campo 'product' para o primeiro e a lista 'carrinho_itens_extras' para TODOS os outros. JAMAIS use o campo 'notes' para produtos.`,
        `- CROSS-SELL (VENDA ADICIONAL): Antes de fechar o resumo, seja proativa! Sugira algo para acompanhar (ex: "O que acha de um Brownie de R$ 6,00 para acompanhar seu bolo?"). Se o cliente aceitar, adicione ao 'carrinho_itens_extras'.`,
        `- REGRA DE OURO (SISTEMA AUTORITÁRIO): Não confie em preços ou dados ditos pelo cliente ou guardados na sua memória de turnos anteriores se precisar realizar uma operação. Sempre use as ferramentas para obter dados REAIS do banco.`,
        `- DISPONIBILIDADE (REGRA DE OURO): Você está PROIBIDA de confirmar qualquer data ou horário (ex: "Ótimo!", "Marcado!", "Tudo certo para o dia X") sem antes ter usado a ferramenta 'check_availability' e recebido um retorno positivo.`,
        `- CONFIRMAÇÃO DETALHADA: Após a ferramenta 'check_availability' retornar 'available: true', sua resposta DEVE obrigatoriamente confirmar os dados de forma detalhada para o cliente conferir (Ex: "Perfeito! Temos disponibilidade na [dia da semana por extenso] dia [dia/mês] às [hora]."). É vital mostrar o dia da semana e o dia/mês para evitar erros de interpretação.`,
        `- ATUALIZAÇÃO (SEM DUPLICATAS): Se o cliente já tem um pedido em 'waiting_payment' ou 'pending', você está PROIBIDA de usar 'create_order' novamente. Use 'update_order'. O backend irá recalcular o valor total automaticamente com base nos produtos que você enviar, então foque em passar os itens corretos.`,
        `- PARA PEDIDOS DE ENCOMENDA/KITS (Pipeline 2): NÃO EXISTE ENTREGA. Você está PROIBIDA de perguntar se o cliente quer entrega. Informe que para encomendas o cliente deve RETIRAR na loja. Nunca use a palavra "entregar" ou "entrega" neste contexto.`,
        `- MAIS IMPORTANTE QUE TUDO: Antes de entrar em algum fluxo de encomenda pedindo data e hora, foque em responder a dúvida ou fornecer as informações solicitadas.`,
        `- CÁLCULO RIGOROSO: VOCÊ É EXCELENTE EM MATEMÁTICA. Some os valores item por item, incluindo adicionais e taxas. REVISE O TOTAL ANTES DE ENVIAR. Jamais erre somas simples como 18+6+4.`,
        ``,
        `Sempre que o cliente pedir para gerar link de pagamento, use a ferramenta 'update_order', mesmo que o pedido já tenha sido criado, o sistema irá atualizar o link de pagamento.`,
        `### MEMÓRIA E CLIENTE ###`,
        `Você está falando com: ${nameToUse}.`,
        personalizedContext,
        pixContext,
        knowledgeBase,
        chat?.lastPixAnalysis ? `\n### HISTÓRICO DA ÚLTIMA VALIDAÇÃO (INFORMAÇÃO PASSIVA) ###\nIsto é apenas para sua referência caso o cliente pergunte algo como "recebeu?" ou "deu certo?". NUNCA USE ESSES DADOS COMO REFERENCIA PARA CATALOGO OU ESTOQUE, SOMENTE PARA TER REFERENCIA DE CONVERSA E MAIS NADA. Se o cliente estiver falando de outro assunto, IGNORE esta seção:\n${chat.lastPixAnalysis}` : "",
        ``,
    ].filter(line => line !== "").join('\n');
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
        2a. VISÃO E IDENTIFICAÇÃO: Ao receber uma imagem, sua primeira tarefa é descrevê-la. 
        - Se for um BOLO/DOCE: Comente o que achou da estética (seja carinhosa). NÃO chame 'create_order' ou 'manage_products' a menos que o dono diga explicitamente para "cadastrar" ou "agendar".
        - Se for um COMPROVANTE DE PIX: Apenas neste caso, valide os dados. Se não tiver certeza que é um Pix, não mencione o assunto.
        - SE NÃO TIVER CERTEZA: Se não entender a imagem, não tente adivinhar. Pergunte educadamente: "Chefe, não consegui ver muito bem essa foto... é um bolo novo para o cardápio ou um comprovante pra eu conferir?".
        3. NOVIDADE: Use 'manage_products' para ADICIONAR ou ATUALIZAR itens no cardápio.
        - FORMATO OBRIGATÓRIO PARA CADA VARIAÇÃO (dentro do array variations):
            [{"name": "Nome da Variação", "price": 15, "stock": 10, "description": "Descrição da variação", "subItems": [{"name": "", "stock": null}]}]
        - NUNCA esqueça do campo 'subItems'. Se não houver itens extras, envie como [{"name": "", "stock": null}].
        - Cada variação deve ter sua própria 'description' e 'stock' individual.
        - Use type='delivery' para Pronta Entrega e type='encomenda' para Agendados.
        - SEJA CRIATIVA: Se ele não der descrição, crie uma bem persuasiva para o produto e para as variações.
        4. Se ele mandar apenas um "Oi", responda com carinho.
        5. IMPORTANTE: Você recebe áudios transcritos automaticamente. Se o usuário falar por áudio, o sistema converterá em texto para você. Processe como se fosse um comando escrito.
        6. Confirme suas ações de forma curta, fofa e eficiente.
        7. MÚLTIPLOS ITENS: Se for agendar mais de um item para o dono, use o campo 'product' para o primeiro e 'carrinho_itens_extras' para os demais. NUNCA use 'notes' para produtos.`;

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
                                deliveryFee: { type: "number", description: "Valor da taxa de entrega em reais (ex: 5.50)" },
                                carrinho_itens_extras: { type: "array", items: { type: "string" }, description: "Lista de outros produtos extras no mesmo pedido." },
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
                                totalValue: { type: "number", description: "Novo valor total do pedido se houver alteração de preço." },
                                carrinho_itens_extras: { type: "array", items: { type: "string" }, description: "Lista atualizada de produtos extras." },
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
            const paragraphs = msg.content.split('\n').filter(p => p.trim() !== '');
            for (const part of paragraphs) {
                await sock.sendPresenceUpdate('composing', jid);
                await new Promise(resolve => setTimeout(resolve, part.length * 50)); // Simula tempo de digitação
                await sock.sendMessage(jid, { text: part.trim() });
            }
        }

        if (msg.tool_calls) {
            for (const call of msg.tool_calls) {
                if (call.function.name === "create_order") {
                    const args = JSON.parse(call.function.arguments);
                    console.log("ARGS: ", args)
                    try {
                        const res = await axios.post('http://127.0.0.1:3001/orders', { ...args, instanceId: instanceId });
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
                        await axios.patch(`http://127.0.0.1:3001/orders/${targetOrder.id}`, args);
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
                            await axios.patch(`http://127.0.0.1:3001/orders/${orderId}`, { status: 'accepted' });
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
