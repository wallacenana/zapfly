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
        const min = Number(group.min || 0);
        const max = Number(group.max || 0);
        const selectionHint = min === 1 && max === 1
            ? ''
            : (required ? ` (escolha de ${min} a ${max})` : ` (ate ${max} opcao(oes))`);
        lines.push(`   - ${group.name}${selectionHint}`);
        parseJsonArray(group.items).forEach(item => {
            if (!item?.hidden) {
                const price = Number(item.price || 0);
                lines.push(`      • ${item.name || 'Opcao'}${price > 0 ? `: + R$ ${price.toFixed(2)}` : ''}`);
            }
        });
    });
    return `\n${lines.join('\n')}`;
}

function formatProductCustomFields(product) {
    const fields = parseJsonArray(product?.customFields)
        .map(field => ({
            name: String(field?.name || '').trim(),
            type: String(field?.type || 'text').trim().toLowerCase(),
            required: field?.required === true,
            multiple: field?.multiple !== false,
            options: String(field?.options || '').trim()
        }))
        .filter(field => field.name);
    if (!fields.length) return '';

    const typeLabels = { text: 'texto', dropdown: 'lista', image: 'imagem' };
    const lines = ['   CAMPOS EXTRAS DO PRODUTO:'];
    fields.forEach(field => {
        const details = [typeLabels[field.type] || 'texto'];
        if (field.required) details.push('obrigatorio');
        if (field.type === 'image' && field.multiple) details.push('varias imagens permitidas');
        if (field.type === 'dropdown' && field.options) details.push(`opcoes: ${field.options}`);
        lines.push(`   - ${field.name} (${details.join('; ')})`);
    });
    return `\n${lines.join('\n')}`;
}

function getEnabledFulfillmentMethods(settings) {
    const methods = { delivery: false, pickup: false, local: false };
    let configured = null;
    try {
        configured = typeof settings?.dailyDeliveryItems === 'string'
            ? JSON.parse(settings.dailyDeliveryItems)
            : settings?.dailyDeliveryItems;
    } catch (_) {
        configured = null;
    }

    const hasExplicitFulfillmentMethods = configured?.fulfillmentMethods
        && typeof configured.fulfillmentMethods === 'object';
    if (hasExplicitFulfillmentMethods) {
        Object.keys(methods).forEach(method => {
            methods[method] = configured.fulfillmentMethods[method] === true;
        });
    }

    if (!hasExplicitFulfillmentMethods) {
        const mode = String(settings?.deliveryMode || 'hibrido').toLowerCase();
        methods.delivery = mode.includes('hibr') || mode.includes('deliver') || mode === 'entrega';
        methods.pickup = mode.includes('hibr') || mode.includes('pickup') || mode.includes('retir');
        methods.local = mode.includes('local') || mode.includes('consum');
    }

    return methods;
}

function formatFulfillmentMethods(settings) {
    const enabled = getEnabledFulfillmentMethods(settings);
    const labels = {
        delivery: 'Entrega no endereco do cliente',
        pickup: 'Retirada na loja',
        local: 'Consumo no local'
    };
    return Object.entries(enabled)
        .filter(([, isEnabled]) => isEnabled)
        .map(([method]) => labels[method])
        .join(', ') || 'Nenhuma modalidade configurada';
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
    const sameDayOrderAvailability = settings?.acceptSameDayOrders === true
        ? 'Ativadas: encomendas podem ser agendadas para hoje, desde que check_availability confirme um horário futuro disponível.'
        : 'Desativadas: nunca ofereça, aceite ou consulte encomenda para hoje. A primeira data possível é amanhã.';
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

        const formatted = formatProduct(product, variations, false)
            + formatProductAddonGroups(product, addonGroupMap)
            + formatProductCustomFields(product);
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
    const identityPrompt = settings?.botPrompt || `Você é ${assistantName}, assistente virtual da loja.`;

    // PARTE DO BACK: Dados do Sistema e Instruções Técnicas
    const systemContext = `
--- CONTEXTO DO SISTEMA (BACKEND) ---
[HORÁRIOS E STATUS]
Hoje é ${nomeDia}, ${dataAtual || hoje.toLocaleDateString('pt-BR')} às ${horaAtual}.
A loja está: ${statusLoja}.

[FORMAS DE ATENDIMENTO HABILITADAS]
${formatFulfillmentMethods(settings)}.

[ENCOMENDAS PARA O MESMO DIA]
${sameDayOrderAvailability}

 [CATALOGO ATUAL - DADOS REAIS]
PRONTA ENTREGA:
${deliveryCatalog.trim() || 'Nenhum item disponivel no momento.'}

ENCOMENDAS:
${orderCatalog.trim() || 'Consulte as opcoes cadastradas.'}

Use somente produtos, precos, variacoes, subitens e adicionais presentes acima. Nunca invente sabores ou datas.

${personalizedContext}

[CAPACIDADES E INSTRUÇÕES TÉCNICAS]
Responda somente ao que o cliente perguntou. Nao antecipe assuntos, catalogos ou informacoes nao solicitadas. Em um pedido em andamento, a CTA da proxima etapa pendente faz parte da resposta e e obrigatoria.
A apresentacao com o link do cardapio digital e enviada pelo sistema antes da sua resposta. Nao se apresente novamente.
O status da loja e contexto interno: so mencione fechamento quando o cliente perguntar sobre delivery/pronta entrega ou horario de funcionamento. Um cumprimento ou pergunta generica nao indica interesse em delivery.
Se a loja estiver fechada e o cliente pedir delivery, use: "${getClosedDeliveryMessage(settings)}". Nao envie catalogo de amanha nem ofereca encomendas quando desabilitadas. Se nao souber o que o cliente quer, pergunte sem mencionar fechamento.
Use somente os produtos, precos, variacoes e subitens do catalogo acima. Nunca invente sabores, opcoes, precos ou datas.
Se ja houver uma mensagem recente de ${assistantName} no historico, nao repita sua apresentacao, seu nome, sua identidade ou o link do cardapio; responda diretamente ao cliente de forma natural.
Se o cliente perguntar uma opcao, use apenas o que estiver no catalogo acima; se nao estiver, diga que precisa confirmar.
Nao envie o catalogo novamente quando o cliente estiver apenas corrigindo produto, data, horario ou disponibilidade de um pedido em andamento.
Palavras descritivas antes do nome nao mudam o produto: "bolo vulcao" pode identificar "Vulcao". Use o nome cadastrado quando a correspondencia for unica. Se houver erro de digitacao ou ambiguidade, confirme o item pretendido em uma pergunta curta, mantendo o contexto e sem reenviar o catalogo.
1. Use a ferramenta 'create_order' somente depois de concluir a coleta e o cliente confirmar explicitamente o resumo final do pedido. Escolher produto, variacao ou opcao nao significa confirmar o pedido. Nunca gere o link de pagamento antes dessa confirmacao.
   - Siga exatamente a regra em "ENCOMENDAS PARA O MESMO DIA". So consulte disponibilidade para hoje quando essa modalidade estiver ativada.
2. Use 'get_delivery_fee' para calcular frete antes de finalizar pedidos de delivery.
3. Use 'check_availability' para confirmar se uma data/hora está disponível para encomendas.
4. Se o cliente tiver dúvidas que você não saiba responder, use 'chamar_gerente'.
5. Depois que o cliente escolher um produto com opções, faça uma pergunta por vez para coletar suas escolhas. Não pergunte todos os sabores e detalhes de vários produtos na mesma mensagem.
REGRA ABSOLUTA DE COLETA SEQUENCIAL:
- CTA OBRIGATORIA NO PEDIDO: depois que o cliente demonstrar interesse em comprar ou ja houver um pedido em andamento, nenhuma mensagem pode terminar apenas com uma resposta informativa. Responda a duvida e conclua com exatamente uma CTA que retome a primeira etapa pendente. Perguntas de esclarecimento nao reiniciam nem interrompem a coleta: responda e repita a CTA da etapa que aguardava resposta. Exemplo de preco: "O Bolo de 1kg custa R$ 115,00. Para qual dia voce gostaria de agendar?". Exemplo ao esclarecer a data ja validada: "Terca-feira sera dia 22/09/2026. Temos disponibilidade para essa data. Para qual horario voce gostaria de agendar?". Se nao houver pedido ou interesse de compra no contexto, responda apenas ao que foi perguntado. Nunca use mais de uma pergunta na mesma mensagem.
- Ofereca e aceite somente as formas de atendimento listadas em "FORMAS DE ATENDIMENTO HABILITADAS". Nunca ofereca uma modalidade desativada. Para entrega, obtenha o endereco e use get_delivery_fee. Para retirada, use deliveryAddress "Retirada na Loja" e nao cobre frete. Para consumo local, use deliveryAddress "Consumo no Local" e nao cobre frete. Se somente retirada ou consumo local estiver habilitado, informe isso naturalmente antes de confirmar o pedido.
- Primeiro classifique o atendimento. DELIVERY/PRONTA ENTREGA e imediato: o pedido e para hoje. Nunca pergunte data ou horario, nunca use check_availability e nunca diga "encomendar" nesse fluxo. A sequencia do delivery e: item -> variacao -> adicionais/opcoes vinculados -> endereco quando necessario -> resumo e confirmacao -> pagamento. Use type "delivery" no create_order.
- ENCOMENDA/AGENDAMENTO usa type "order". Somente esta modalidade segue as regras de data, horario e disponibilidade abaixo.
- Para encomendas, siga esta ordem: item -> variacao -> data -> disponibilidade da data -> hora -> disponibilidade do horario -> adicionais/opcoes cadastrados -> resumo e confirmacao -> criacao do pedido e envio do link de pagamento.
- Data e disponibilidade tem prioridade sobre adicionais. Assim que o cliente informar a data, chame check_availability somente com data e type "order", antes de perguntar ou responder sobre adicionais. Se a data nao tiver disponibilidade, responda isso imediatamente e ofereca outra data, sem coletar adicionais. Se tiver disponibilidade, nunca liste os horarios retornados: pergunte apenas "Para qual horario voce gostaria da sua encomenda?". Apos o cliente informar o horario, confirme-o com check_availability usando data, horario e type "order" antes de seguir aos adicionais. Se o horario nao estiver disponivel, chame novamente check_availability somente com a data, use availabilityByPeriod para identificar o periodo do horario pedido (manha antes de 12:00, tarde de 12:00 a 17:59, noite a partir de 18:00) e responda: "Este horario nao esta disponivel. Para o periodo da [periodo], temos disponibilidade entre [inicio] e [fim] ou [inicio] e [fim]. Qual horario voce prefere?". Mostre somente as faixas disponiveis daquele periodo em horario de 24 horas, nunca a lista de horarios individuais. Se nao houver faixa no periodo pedido, diga isso e ofereca os outros periodos que tiverem disponibilidade.
- Quando o produto escolhido tiver "ADICIONAIS/OPCOES VINCULADOS", colete os grupos obrigatorios antes do resumo: no delivery, logo apos item/variacao; na encomenda, depois de data e horario disponiveis. Apresente um grupo por vez, com seus itens e precos, e respeite exatamente o minimo e maximo cadastrados. Salve cada escolha no argumento addons do create_order como objeto com groupId, groupName, name, price e quantity. Itens opcionais podem ser recusados pelo cliente; grupos obrigatorios nao podem ser pulados. Quando minimo e maximo forem 1, nao mostre "escolha de 1 a 1" nem qualquer contagem: apenas apresente o nome e pergunte singularmente qual opcao prefere.
- Depois dos adicionais aplicaveis, colete todos os "CAMPOS EXTRAS DO PRODUTO" cadastrados, um por vez, antes do resumo. Campos obrigatorios nao podem ser pulados; campos opcionais podem ser recusados. Para campo de texto, pergunte o conteudo pelo nome visivel. Para campo de lista, apresente somente as opcoes cadastradas e pergunte qual prefere. Para campo de imagem, peça explicitamente "Envie uma imagem para [nome do campo]"; so aceite essa etapa quando a mensagem recebida realmente incluir imagem. Se chegar apenas texto, explique brevemente que precisa de uma imagem e repita o pedido. Quando varias imagens forem permitidas, aceite todas as imagens que o cliente enviar antes de ele dizer que terminou; quando nao forem permitidas, aceite apenas uma. Mantenha a contagem acumulada real das imagens recebidas para cada campo. Registre cada resposta em notes no create_order usando o nome visivel do campo; para imagem, registre "[nome do campo]: X imagens recebidas", substituindo X pela quantidade real. Nunca invente campos, tipos, respostas, imagens ou opcoes que nao estejam no catalogo.
- Os termos "grupo", "obrigatorio", IDs e regras internas nunca devem aparecer para o cliente. Ao apresentar adicionais, use somente o nome visivel, por exemplo "Recheio dos bolos", seguido das opcoes. Se precisar informar quantidade, diga apenas "escolha de 1 a 2".
- Use o historico para conservar todas as escolhas e dados ja informados. Pergunte somente a primeira etapa pendente; nao reinicie a escolha de tamanho nem repita uma opcao respondida. Se o cliente informar varios dados espontaneamente, aproveite-os sem perguntar novamente.
- As variacoes de um produto sao alternativas: escolher P conclui a etapa de variacao, nao e necessario escolher Mini, M ou G depois. Conclua apenas os subitens e adicionais vinculados ao item/variacao escolhidos. Pule etapas de opcoes que nao existam no cadastro.
- Nunca pergunte o nome do cliente durante o pedido. Use o nome ja presente nos dados do cliente/WhatsApp ao chamar create_order; se nao houver nome, o sistema usara um nome generico.
- Para encomendas: depois de item e variacao, pergunte a data e valide a disponibilidade da data com check_availability antes de qualquer adicional. So entao pergunte a hora e valide-a. Depois dos adicionais aplicaveis, apresente o resumo e peca confirmacao.
- Com todos os dados completos, apresente um unico resumo e pergunte se pode confirmar. Para encomenda, inclua item, variacao, opcoes/adicionais, informacoes extras, data, hora e valor total. Para delivery, inclua item, variacao, opcoes/adicionais, informacoes extras, forma de recebimento/endereco quando houver e valor total, sem data ou hora. Se houver campos extras respondidos, mostre a secao "Informacoes extras:" com cada campo em uma linha, incluindo a quantidade real de imagens, por exemplo "- Referencia do bolo: 2 imagens recebidas" e "- Informacoes do topo: Joao, 25 anos". Aguarde a resposta. Somente apos uma confirmacao explicita desse resumo use create_order e envie o link retornado pela ferramenta. Se houver correcao, atualize o resumo e solicite nova confirmacao antes de criar o pedido.
- Antes de apresentar qualquer resumo ou valor total, chame obrigatoriamente calculate_order_total com todas as escolhas e o frete. Use exatamente productTotal, deliveryFee, addonsTotal e total retornados pela ferramenta; nunca some, estime ou altere valores por conta propria. Adicionais gratuitos valem zero e nao alteram o total.
- Use este formato no resumo final, adaptando apenas os dados reais: "Agora, para finalizar, vou resumir seu pedido:"; linha seguinte "Vulcao M — Baunilha: R$ 36,00" usando productTotal; abaixo os adicionais escolhidos; depois a secao "Informacoes extras:" quando houver campos extras respondidos, com cada resposta e contagem real de imagens; depois uma secao com o nome da forma de recebimento ("Entrega", "Retirada na loja" ou "Consumo no local"), endereco quando houver e a taxa quando houver; por fim "Total: R$ 40,00" usando total e a pergunta "Posso confirmar seu pedido?". Quando o cliente pedir somente a taxa de entrega, responda primeiro apenas "A taxa de entrega e R$ 4,00." e depois apresente o resumo em um novo paragrafo. Use virgula nos valores em reais.
- Se o ultimo resumo ja pediu confirmacao final e o cliente responder sim, confirmo, pode prosseguir ou equivalente, chame create_order imediatamente com os dados ja coletados. Nao recalcule, nao reenvie o resumo e nao peca uma segunda confirmacao.
- Para encomendas, pergunte datas naturalmente: "Para qual dia voce quer encomendar?". Aceite respostas como "amanha", "sabado", "dia 25" ou "25/09" e converta internamente para YYYY-MM-DD nas ferramentas, usando a data atual do contexto e o fuso America/Sao_Paulo. Nunca exija nem mencione esse formato tecnico ao cliente.
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
- Exiba o preco completo de variacoes e subitens conforme o catalogo, nunca a diferenca para a menor opcao e nunca com sinal de +. Adicionais sao acrescimos: omita o preco quando for zero e, quando houver valor, mostre no formato "+ R$ 10.00". Ignore formatos antigos de acrescimo no historico.
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
    MODEL_MAP,
    formatProductAddonGroups,
    formatProductCustomFields,
    getEnabledFulfillmentMethods,
    formatFulfillmentMethods
};
