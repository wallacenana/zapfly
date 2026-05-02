require('dotenv').config();
const { google } = require('googleapis');
const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, makeInMemoryStore } = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const prisma = require('./lib/prisma');
const { calculateFee } = require('./lib/maps');
const { getStoreStatus, formatProduct, sendRichMessage } = require('./lib/utils');
const { initFlows, handleFlows, runFlowNode, startFlowMonitor } = require('./lib/flows');
const { getOpenAI, buildLilyPrompt, executeChamarGerente, handleAdminAgent, MODEL_MAP } = require('./lib/ai');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const multer = require('multer');
const axios = require('axios');
const { MercadoPagoConfig, Payment: MercadoPagoPayment } = require('mercadopago');


// Configuração do Multer para Marketing Assets
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'assets/marketing'),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const uploadMarketing = multer({ storage });

// Prisma singleton is now loaded from lib/prisma.js

const {
    getSettings,
    invalidateSettingsCache,
    getCachedInstance,
    invalidateProductCache
} = require('./lib/cache');

const { router: ordersRouter, setupCronJobs, checkAvailability, updateCalendarEvent } = require('./routes/orders');
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});
initFlows(io);
const sessions = new Map();
const stores = new Map();
startFlowMonitor(sessions);

const aiDebounceTimers = {};
const aiProcessingTokens = {};
const aiMessageBuffer = {};


app.use(cors({ origin: "*" }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.json());
app.use('/orders', (req, res, next) => {
    req.sockGetter = (instId) => {
        if (instId) return sessions.get(instId);
        if (sessions.size > 0) return Array.from(sessions.values())[0];
        return null;
    };
    next();
}, ordersRouter);

// Redirecionamento de Sucesso do Google Agenda ou Raiz
app.get('/', (req, res) => {
    // Se vier do Google Agenda, volta para as configurações
    if (req.query.gcal_success) {
        return res.send(`
            <script>
                if (window.opener) {
                    window.opener.location.reload();
                    window.close();
                } else {
                    window.location.href = 'http://localhost:5173/settings';
                }
            </script>
        `);
    }
    res.send('Zapfly Backend is running!');
});

// ─── WEBHOOK MERCADO PAGO ───────────────────────────────────────────────
app.post('/mercadopago/webhook', async (req, res) => {
    try {
        const { type, data } = req.body;
        console.log(`[MercadoPago Webhook] Tipo: ${type}`, data);

        if (type === 'payment' || req.query.topic === 'payment') {
            const paymentId = data?.id || req.query.id;

            // Busca detalhes do pagamento no MP
            const settings = await getSettings();
            if (!settings?.mercadopagoToken) return res.sendStatus(200);

            const client = new MercadoPagoConfig({ accessToken: settings.mercadopagoToken });
            const payment = new MercadoPagoPayment(client);

            const p = await payment.get({ id: paymentId });
            const orderId = p.external_reference;

            if (p.status === 'approved' && orderId) {
                const order = await prisma.order.findUnique({ where: { id: orderId } });

                // Trava de segurança: Se já foi confirmado, ignora as repetições do MP
                if (order && order.paymentStatus !== 'confirmed') {
                    console.log(`[MercadoPago] Pagamento APROVADO para o pedido: ${orderId}`);

                    const updatedOrder = await prisma.order.update({
                        where: { id: orderId },
                        data: {
                            status: 'pending',
                            paymentStatus: 'confirmed'
                        }
                    });

                    // Notifica o frontend e dispara o DING
                    io.emit('order_confirmed', updatedOrder);
                    io.emit('new_order_pending', { orderId: updatedOrder.id });

                    // Sincroniza com Google Agenda agora que está confirmado
                    await updateCalendarEvent(updatedOrder).catch(e => console.error('[GCal Sync Error]', e.message));

                    const settings = await getSettings();
                    if (settings?.managerJid) {
                        const sock = sessions.get(updatedOrder.instanceId || 'global') || Array.from(sessions.values())[0];
                        if (sock) {
                            const avisoPago = `💰 *PAGAMENTO CONFIRMADO!* 💰\n\n👤 *Cliente:* ${updatedOrder.clientName}\n🎂 *Pedido:* ${updatedOrder.product}\n\nO pedido já está na aba *PENDENTES* do seu painel. Aceite-o para iniciar a produção! ✨`;
                            await sock.sendMessage(settings.managerJid, { text: avisoPago }).catch(() => { });
                        }
                    }

                    if (updatedOrder.clientJid) {
                        const sock = sessions.get(updatedOrder.instanceId || 'global') || Array.from(sessions.values())[0];
                        if (sock) {
                            const msg = `✅ *PAGAMENTO CONFIRMADO!* 🎉\n\nOi, *${updatedOrder.clientName}*! Seu pagamento foi aprovado e seu pedido já está na nossa fila de produção. 🧑‍🍳✨\n\nAvisaremos você assim que estiver pronto! ❤️`;
                            await sock.sendMessage(updatedOrder.clientJid, { text: msg }).catch(() => { });
                        }
                    }
                } // Fim da trava de segurança do MP
            }
        }
        res.sendStatus(200);
    } catch (err) {
        console.error('[MercadoPago Webhook Error]', err.message);
        res.sendStatus(200); // MP exige 200 sempre para não ficar tentando
    }
});

app.use('/assets', express.static(path.join(__dirname, 'assets')));

// ─── ROTAS — MARKETING ASSETS (STORIES) ──────────────────────────────────
app.get('/marketing-assets', async (req, res) => {
    try {
        const assets = await prisma.marketingAsset.findMany({ orderBy: { createdAt: 'desc' } });
        res.json(assets);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/marketing-assets', uploadMarketing.single('file'), async (req, res) => {
    try {
        const { name } = req.body;
        const asset = await prisma.marketingAsset.create({
            data: {
                name: name || 'Sem nome',
                path: `/assets/marketing/${req.file.filename}`
            }
        });
        res.json(asset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/marketing-assets/:id', async (req, res) => {
    try {
        const asset = await prisma.marketingAsset.findUnique({ where: { id: req.params.id } });
        if (asset) {
            const fullPath = path.join(__dirname, asset.path);
            if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
            await prisma.marketingAsset.delete({ where: { id: req.params.id } });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── GOOGLE CALENDAR OAUTH ────────────────────────────────────────────────────

const GCAL_SCOPES = ['https://www.googleapis.com/auth/calendar'];

function getOAuth2Client(req) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    // Constrói a URL de redirecionamento baseada em quem chamou (localhost ou IP)
    // Proteção contra req indefinido
    const protocol = (req && req.protocol) ? req.protocol : 'http';
    const host = (req && typeof req.get === 'function') ? req.get('host') : 'localhost:3001';
    const redirectUri = `${protocol}://${host}/auth/google/callback`;

    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// Inicia o fluxo OAuth — redireciona para o consent screen do Google
app.get('/auth/google', async (req, res) => {
    const oauth2Client = getOAuth2Client(req);
    const origin = req.get('referer') || `http://${req.get('host')}`;
    if (!oauth2Client) {
        return res.redirect(`${origin.split('?')[0]}?gcal_error=missing_env_credentials`);
    }
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: GCAL_SCOPES,
        prompt: 'consent', // força refresh_token sempre
    });
    res.redirect(url);
});

// Callback do Google com o código de autorização
app.get('/auth/google/callback', async (req, res) => {
    const { code, error } = req.query;
    const origin = req.get('referer') || `http://${req.get('host')}`;
    if (error) return res.redirect(`${origin.split('?')[0]}?gcal_error=${error}`);

    try {
        const oauth2Client = getOAuth2Client(req);
        const { tokens } = await oauth2Client.getToken(code);
        console.log('[GCal OAuth] Tokens recebidos do Google.');

        const updateData = {
            gcalAccessToken: tokens.access_token,
            gcalTokenExpiry: tokens.expiry_date?.toString(),
            gcalEnabled: true,
        };

        // Só atualiza o refresh_token se o Google enviou um novo (geralmente só no primeiro consentimento ou com prompt=consent)
        if (tokens.refresh_token) {
            console.log('[GCal OAuth] Novo Refresh Token recebido.');
            updateData.gcalRefreshToken = tokens.refresh_token;
        } else {
            console.warn('[GCal OAuth] Refresh Token NÃO recebido. Usando o existente.');
        }

        await prisma.setting.upsert({
            where: { id: 'global' },
            update: updateData,
            create: { id: 'global', ...updateData },
        });

        const origin = req.get('referer') || `http://${req.get('host')}`;
        res.redirect(`${origin.split('?')[0]}?gcal_success=1`);
    } catch (e) {
        console.error('[GCal OAuth]', e.message);
        const origin = req.get('referer') || `http://${req.get('host')}`;
        res.redirect(`${origin.split('?')[0]}?gcal_error=token_exchange_failed`);
    }
});

// Status da conexão com o Google Calendar
app.get('/auth/google/status', async (req, res) => {
    const settings = await getSettings();
    const connected = !!(settings?.gcalRefreshToken);
    const hasCredentials = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    res.json({ connected, calendarId: settings?.gcalCalendarId, hasCredentials });
});

// Lista os calendários disponíveis na conta conectada
app.get('/auth/google/calendars', async (req, res) => {
    try {
        const settings = await getSettings();
        if (!settings?.gcalRefreshToken) return res.status(401).json({ error: 'Não conectado' });

        const oauth2Client = getOAuth2Client(req);
        oauth2Client.setCredentials({ refresh_token: settings.gcalRefreshToken, access_token: settings.gcalAccessToken });
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        const list = await calendar.calendarList.list();

        console.log(`[GCal] Buscando calendários... Encontrados: ${list.data.items?.length || 0}`);

        const calendars = (list.data.items || [])
            .map(c => ({ id: c.id, name: c.summaryOverride || c.summary, primary: c.primary }))
            .filter(c => c.name); // Remove itens sem nome

        res.json(calendars);
    } catch (e) {
        console.error('[GCal Error] Falha ao listar calendários:', e);
        res.status(500).json({ error: e.message });
    }
});

// Salva o calendário selecionado
app.patch('/auth/google/calendar', async (req, res) => {
    const { calendarId } = req.body;
    await prisma.setting.update({ where: { id: 'global' }, data: { gcalCalendarId: calendarId } });
    res.json({ ok: true });
});

// Desconectar o Google Calendar
app.post('/auth/google/disconnect', async (req, res) => {
    await prisma.setting.update({
        where: { id: 'global' },
        data: { gcalEnabled: false, gcalAccessToken: null, gcalRefreshToken: null, gcalTokenExpiry: null },
    });
    res.json({ ok: true });
});







async function initInstance(instanceId) {
    const sessionDir = path.join(__dirname, 'sessions', instanceId);
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const store = makeInMemoryStore({ logger: pino({ level: 'silent' }) });
    const storePath = path.join(sessionDir, 'store.json');

    try {
        if (fs.existsSync(storePath)) {
            store.readFromFile(storePath);
        }
    } catch (e) { }

    const saveInterval = setInterval(() => {
        try {
            store.writeToFile(storePath);
        } catch (e) { }
    }, 10000);

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: ['ZAP Fly', 'Chrome', '1.0.0'],
        logger: pino({ level: 'silent' }),
        syncFullHistory: true
    });

    store.bind(sock.ev);

    // PERSISTENCE LOGIC
    sock.ev.on('contacts.upsert', async (contacts) => {
        for (const contact of contacts) {
            try {
                const jid = contact.id;
                const isGroup = jid.endsWith('@g.us');
                const name = contact.name || contact.verifiedName || contact.notify || (isGroup ? 'Grupo' : jid.split('@')[0]);

                // Apenas atualiza o nome se o chat já existir. Não cria chats vazios para cada pessoa de um grupo.
                await prisma.chat.updateMany({
                    where: { instanceId, jid },
                    data: { name: name }
                });
            } catch (e) { }
        }
    });

    sock.ev.on('contacts.update', async (updates) => {
        for (const update of updates) {
            try {
                if (update.name || update.verifiedName) {
                    await prisma.chat.update({
                        where: { instanceId_jid: { instanceId, jid: update.id } },
                        data: { name: update.name || update.verifiedName }
                    });
                }
            } catch (e) { }
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message) return;
        const jid = msg.key.remoteJid;
        const pushName = msg.pushName || 'Desconhecido';

        console.log(`\n📩 [Nova Mensagem] de: ${pushName} (${jid})`);

        // BLOQUEIO DE STATUS E GRUPOS (OPCIONAL)
        if (jid === 'status@broadcast' || jid.includes('@g.us')) return;

        let text = msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption ||
            msg.message?.documentMessage?.caption || '';

        // TRANSCRIPÇÃO DE ÁUDIO (Lily ou Clientes)
        if (!text && msg.message?.audioMessage) {
            try {
                const ai = await getOpenAI();
                if (ai) {
                    const stream = await downloadContentFromMessage(msg.message.audioMessage, 'audio');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }

                    const transcription = await ai.audio.transcriptions.create({
                        file: await OpenAI.toFile(buffer, 'audio.ogg'),
                        model: 'whisper-1',
                    });
                    // Salva apenas o texto para a IA não se confundir
                    text = transcription.text;
                    console.log(`[Whisper] Transcrição: ${text}`);
                }
            } catch (err) {
                console.error('[Audio Error]', err.message);
                text = "🎤 [Áudio (Erro na transcrição)]";
            }
        }

        const isMedia = !!(msg.message?.imageMessage || msg.message?.videoMessage || msg.message?.audioMessage || msg.message?.documentMessage);

        if (text || isMedia) {
            // Se for mídia sem texto, define um placeholder para o banco de dados
            if (!text && isMedia) {
                if (msg.message?.imageMessage) text = "📷 [Imagem]";
                else if (msg.message?.videoMessage) text = "🎥 [Vídeo]";
                else if (msg.message?.audioMessage) text = "🎤 [Áudio]";
                else if (msg.message?.documentMessage) text = "📄 [Documento]";
            }


            try {
                const isGroup = jid.endsWith('@g.us');
                const chat = await prisma.chat.upsert({
                    where: { instanceId_jid: { instanceId, jid } },
                    update: {
                        lastMsg: text,
                        lastMsgTime: new Date(msg.messageTimestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        unreadCount: { increment: msg.key.fromMe ? 0 : 1 },
                        updatedAt: new Date(),
                        isGroup: isGroup,
                        ...((!isGroup && msg.pushName) ? { name: msg.pushName } : {})
                    },
                    create: {
                        instanceId,
                        jid,
                        name: (!isGroup && msg.pushName) ? msg.pushName : null,
                        lastMsg: text,
                        lastMsgTime: new Date(msg.messageTimestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        unreadCount: msg.key.fromMe ? 0 : 1,
                        isGroup: isGroup
                    }
                });

                const data = {
                    msgId: msg.key.id,
                    instanceId,
                    jid,
                    text,
                    fromMe: msg.key.fromMe,
                    participant: msg.key.participant || null,
                    senderName: msg.pushName || null,
                    quotedText: msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation ||
                        msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.text || null,
                    quotedParticipant: msg.message?.extendedTextMessage?.contextInfo?.participant || null,
                    timestamp: new Date(msg.messageTimestamp * 1000),
                    status: msg.key.fromMe ? 'sent' : 'received'
                };

                const messageRecord = await prisma.message.upsert({
                    where: { msgId: msg.key.id },
                    update: data,
                    create: data
                });

                // ─── COMANDOS DE ADMINISTRADOR (MANAGER) ──────────────────────────
                const settings = await getSettings();
                if (!msg.key.fromMe && settings?.managerJid && jid === settings.managerJid) {
                    console.log(`[Admin Command] Processando comando do gerente: ${text}`);
                    // Chama o agente específico para o administrador
                    await handleAdminAgent(sock, instanceId, jid, text, settings);
                    return;
                }

                // AI AGENT LOGIC (CLIENTES)
                if (aiProcessingTokens[jid]) {
                    aiProcessingTokens[jid].cancelled = true;
                }

                // Adiciona a mensagem atual ao buffer do cliente
                if (!aiMessageBuffer[jid]) aiMessageBuffer[jid] = [];
                aiMessageBuffer[jid].push({ text, msg });

                if (aiDebounceTimers[jid]) {
                    clearTimeout(aiDebounceTimers[jid]);
                }
                aiDebounceTimers[jid] = setTimeout(async () => {
                    try {
                        const messagesToProcess = aiMessageBuffer[jid] || [];
                        delete aiDebounceTimers[jid];
                        delete aiMessageBuffer[jid];

                        const currentToken = { cancelled: false };
                        aiProcessingTokens[jid] = currentToken;

                        // Re-buscamos o chat para garantir que pegamos o status de aiEnabled atualizado (caso um fluxo tenha acabado de ligar)
                        const currentChat = await prisma.chat.findUnique({
                            where: { instanceId_jid: { instanceId, jid } }
                        });

                        // ─── MOTOR DE FLUXOS (Agrupado) ──────────────────────────────
                        // Juntamos o texto primeiro para passar para o motor de fluxos
                        const textForFlow = messagesToProcess.map(m => m.text).filter(t => t).join('\n');

                        let flowHandled = false;
                        if (!msg.key.fromMe) {
                            flowHandled = await handleFlows(sock, instanceId, jid, textForFlow, messagesToProcess[messagesToProcess.length - 1].msg, buildLilyPrompt, getOpenAI, executeChamarGerente, settings);
                        }
                        if (flowHandled) return;

                        if (!msg.key.fromMe && currentChat?.aiEnabled) {
                            // COMMAND AGENT (Experimental)
                            if (text.toLowerCase().includes('crie um story')) {
                                const storyText = text.replace(/crie um story/i, '').trim();
                                if (storyText) {
                                    await sock.sendMessage('status@broadcast', { text: storyText });
                                    await sendRichMessage(sock, jid, "✅ Comando executado! Acabei de publicar seu Story.");
                                    return;
                                }
                            }

                            const ai = await getOpenAI();
                            if (ai) {
                                const settings = await getSettings();

                                // Agrupa todos os textos e imagens do buffer
                                let combinedText = "";
                                let combinedImages = [];

                                for (const m of messagesToProcess) {
                                    if (m.text) combinedText += (combinedText ? "\n" : "") + m.text;
                                    const isImg = !!m.msg.message?.imageMessage || (m.msg.message?.documentMessage?.mimetype?.startsWith('image/'));
                                    if (isImg) {
                                        try {
                                            const { downloadMediaMessage } = require('@whiskeysockets/baileys');
                                            const buffer = await downloadMediaMessage(m.msg, 'buffer', {});
                                            combinedImages.push(buffer.toString('base64'));
                                        } catch (e) { console.error("Erro imagem buffer:", e); }
                                    }
                                }

                                let userMessageContent = [{ type: "text", text: combinedText || "O cliente enviou uma imagem." }];
                                for (const b64 of combinedImages) {
                                    userMessageContent.push({
                                        type: "image_url",
                                        image_url: { url: `data:image/jpeg;base64,${b64}` }
                                    });
                                }

                                const storeInfo = await getStoreStatus();
                                const { statusLoja } = storeInfo;

                                const history = await prisma.message.findMany({
                                    where: { instanceId, jid },
                                    orderBy: { timestamp: 'desc' },
                                    take: 30
                                });

                                // Formata o histórico como texto para injetar no final do prompt do sistema
                                const formattedHistory = history.reverse().map(m =>
                                    `${m.fromMe ? 'Lily' : 'Cliente'}: ${m.text || '[Imagem/Arquivo]'}`
                                ).join('\n');

                                const finalSystemPrompt = await buildLilyPrompt(instanceId, jid, formattedHistory, storeInfo);
                                console.log("\n--- DEBUG LILY PROMPT (DIRETO) ---\n", finalSystemPrompt, "\n-----------------------------------\n");

                                console.log(`[AI] Gerando resposta para ${jid}...`);
                                const messages = [
                                    { role: 'system', content: finalSystemPrompt },
                                    { role: 'user', content: userMessageContent }
                                ];


                                // --- TOOLS DEFINITION ---
                                const tools = [
                                    {
                                        type: "function",
                                        function: {
                                            name: "chamar_gerente",
                                            description: "Avisa o dono/gerente da loja que existe uma dúvida que a IA não sabe responder ou um pedido especial.",
                                            parameters: {
                                                type: "object",
                                                properties: {
                                                    reason: { type: "string", description: "O motivo do chamado ou a pergunta do cliente" }
                                                },
                                                required: ["reason"]
                                            }
                                        }
                                    },
                                    {
                                        type: "function",
                                        function: {
                                            name: "get_delivery_fee",
                                            description: "Calcula o valor da entrega baseado no endereço do cliente usando Google Maps e as regras da loja.",
                                            parameters: {
                                                type: "object",
                                                properties: {
                                                    address: { type: "string", description: "Endereço completo do cliente" }
                                                },
                                                required: ["address"]
                                            }
                                        }
                                    },
                                    {
                                        type: "function",
                                        function: {
                                            name: "check_availability",
                                            description: "Verifica se há horários disponíveis para agendamento em uma data e hora específica.",
                                            parameters: {
                                                type: "object",
                                                properties: {
                                                    date: { type: "string", description: "A data no formato YYYY-MM-DD" },
                                                    time: { type: "string", description: "O horário no formato HH:MM" },
                                                },
                                                required: ["date", "time"],
                                            },
                                        },
                                    },
                                    {
                                        type: "function",
                                        function: {
                                            name: "create_order",
                                            description: "Cria um novo pedido ou agendamento. ATENÇÃO: Se o cliente acabou de fazer um pedido e quer mudar algo, use 'update_order'. NÃO crie pedidos duplicados para a mesma pessoa seguidamente.",
                                            parameters: {
                                                type: "object",
                                                properties: {
                                                    productId: { type: "string", description: "ID do produto (ex: cmo...) encontrado entre [ID:...] no catálogo." },
                                                    product: { type: "string", description: "Nome do produto" },
                                                    variation: { type: "string", description: "Nome da variação EXACTA (ex: 'P', 'M', 'Mini'). Não coloque sabores aqui." },
                                                    quantity: { type: "string", description: "Peso do bolo (ex: 2kg) ou Quantidade" },
                                                    scheduledDate: { type: "string", description: "Data do agendamento YYYY-MM-DD" },
                                                    scheduledTime: { type: "string", description: "Horário do agendamento HH:MM" },
                                                    clientName: { type: "string", description: "Nome do cliente" },
                                                    paymentMethod: { type: "string", description: "Forma de pagamento (ex: Pix com comprovante, Dinheiro, Cartão/Link)" },
                                                    type: { type: "string", enum: ["order", "delivery"], description: "Tipo: order (encomenda) ou delivery (entrega)" },
                                                    deliveryAddress: { type: "string", description: "Endereço se for delivery" },
                                                    deliveryFee: { type: "number", description: "Valor da entrega calculado por get_delivery_fee" },
                                                    massa: { type: "string", description: "Sabor da massa escolhida" },
                                                    recheio: { type: "string", description: "Sabor do recheio escolhido" },
                                                    topo: { type: "string", description: "Informações sobre o topo do bolo" },
                                                    notes: { type: "string", description: "Outras observações gerais" }
                                                },
                                                required: ["product", "variation", "quantity", "scheduledDate", "scheduledTime", "clientName", "paymentMethod", "notes"],
                                            },
                                        },
                                    },
                                    {
                                        type: "function",
                                        function: {
                                            name: "update_order",
                                            description: "Atualiza informações de um pedido ou agendamento já existente. Só use se o cliente pedir para corrigir algo.",
                                            parameters: {
                                                type: "object",
                                                properties: {
                                                    orderId: { type: "string", description: "Código de referência curto do pedido (ex: FJBIR)" },
                                                    product: { type: "string", description: "Novo produto (opcional)" },
                                                    quantity: { type: "string", description: "Novo peso ou quantidade (opcional)" },
                                                    scheduledDate: { type: "string", description: "Nova data YYYY-MM-DD (opcional)" },
                                                    scheduledTime: { type: "string", description: "Novo horário HH:MM (opcional)" },
                                                    notes: { type: "string", description: "Novas observações ou mudanças nos sabores (opcional)" }
                                                },
                                                required: ["orderId"]
                                            }
                                        }
                                    },
                                    {
                                        type: "function",
                                        function: {
                                            name: "get_order_status",
                                            description: "Verifica se o pedido do cliente atual está pronto para retirada ou entrega.",
                                            parameters: { type: "object", properties: {} }
                                        }
                                    },
                                    {
                                        type: "function",
                                        function: {
                                            name: "get_store_location",
                                            description: "Retorna o endereço físico da loja e o link do Google Maps para retirada.",
                                            parameters: { type: "object", properties: {} }
                                        }
                                    },
                                    {
                                        type: "function",
                                        function: {
                                            name: "get_delivery_catalog",
                                            description: "OBRIGATÓRIO: Chame SEMPRE que o cliente perguntar o que tem para hoje, pronta entrega, ou pedir opções imediatas. Proibido listar produtos manualmente, quando estiver fechado e o cliente pedir informações \"sobre o que tem hoje\".",
                                            parameters: { type: "object", properties: {} }
                                        }
                                    },
                                    {
                                        type: "function",
                                        function: {
                                            name: "get_order_catalog",
                                            description: "OBRIGATÓRIO: Chame SEMPRE que o cliente pedir cardápio de encomendas, bolos de festa, personalizados ou agendamentos futuros. Proibido listar produtos manualmente.",
                                            parameters: { type: "object", properties: {} }
                                        }
                                    }
                                ];

                                let responseMessage;
                                let pendingPaymentLink = null;
                                let pendingCatalogMessage = null;
                                let pendingCatalogCTA = null; // 3ª mensagem: CTA da Lily após o catálogo
                                try {
                                    // Detecta se o usuário está pedindo o cardápio e força a ferramenta correta
                                    const lastUserMsgObj = messages.filter(m => m.role === 'user').pop();
                                    const lastUserMsgContent = Array.isArray(lastUserMsgObj?.content)
                                        ? lastUserMsgObj.content.map(c => c.text || '').join(' ')
                                        : (lastUserMsgObj?.content || '');
                                    const lastUserMsg = lastUserMsgContent.toLowerCase();

                                    const isDeliveryRequest = /card[aá]pio|o que tem|pronta entrega|o que voc[eê] tem|tem hoje|tem pra hoje|disponível|disponivel|preço|preco|o que vende/i.test(lastUserMsg);
                                    const isOrderRequest = /encomenda|bolo de festa|personalizado|encomendar|quero encomendar/i.test(lastUserMsg);

                                    let forcedToolChoice = "auto";

                                    if (statusLoja.includes("FECHADA")) {
                                        // Detecta se é um "SIM" genérico ou se já é o nome de um produto
                                        const isGenericAcceptance = /^(sim|quero|pode|manda|veja|vê|ok|agendar|amanhã|pode ser|com certeza|claro|uhum)$/i.test(lastUserMsg.trim());
                                        const isAskingOptions = /o que tem|opções|cardapio|catalogo|vê ai/i.test(combinedText);

                                        if (isGenericAcceptance || isAskingOptions) {
                                            forcedToolChoice = { type: "function", function: { name: "get_delivery_catalog" } };
                                        } else {
                                            // Se ele já falou o nome de um produto (ex: "quero um vulcão"), deixa o fluxo seguir normal
                                            forcedToolChoice = "auto";
                                        }
                                    } else if (statusLoja.includes("ABERTA")) {
                                        if (isDeliveryRequest && !isOrderRequest) {
                                            forcedToolChoice = { type: "function", function: { name: "get_delivery_catalog" } };
                                        } else if (isOrderRequest) {
                                            forcedToolChoice = { type: "function", function: { name: "get_order_catalog" } };
                                        }
                                    }

                                    const completion = await ai.chat.completions.create({
                                        model: MODEL_MAP[settings?.activeModel] || 'gpt-4o',
                                        messages,
                                        tools,
                                        tool_choice: forcedToolChoice
                                    });

                                    responseMessage = completion.choices[0].message;
                                    let initialAIText = responseMessage.content;

                                    // FUNCTION CALLING LOOP
                                    if (responseMessage.tool_calls) {
                                        console.log(`[AI] IA solicitou execução de ${responseMessage.tool_calls.length} ferramentas.`);
                                        messages.push(responseMessage);

                                        for (const toolCall of responseMessage.tool_calls) {
                                            const functionName = toolCall.function.name;
                                            const args = JSON.parse(toolCall.function.arguments);
                                            let result;

                                            console.log(`[AI] Executando função: ${functionName}`, args);

                                            if (functionName === "chamar_gerente") {
                                                const { reason } = args;
                                                result = await executeChamarGerente(reason, jid, currentChat, settings, null, sock, prisma, instanceId);
                                            }
                                            else if (functionName === "get_delivery_catalog" || functionName === "get_order_catalog") {
                                                try {
                                                    const { getCachedProducts } = require('./lib/cache');
                                                    const prods = await getCachedProducts();
                                                    let deliveryStr = '';
                                                    let orderStr = '';
                                                    prods.forEach(p => {
                                                        const vars = typeof p.variations === 'string' ? JSON.parse(p.variations || '[]') : (p.variations || []);
                                                        let text = `*${p.name.toUpperCase()}*`;
                                                        if (vars.length > 0) {
                                                            text += '\n' + vars.map(v => `   * *${v.name}* - R$ ${v.price.toFixed(2)}`).join('\n');
                                                        } else {
                                                            text += ` - R$ ${p.price.toFixed(2)}`;
                                                        }
                                                        if (p.type === 'delivery') deliveryStr += text + '\n\n';
                                                        else orderStr += text + '\n\n';
                                                    });

                                                    if (functionName === "get_delivery_catalog") {
                                                        // BLOQUEIO DE SEGURANÇA: Só permite ver o catálogo se estiver aberta OU se o cliente já aceitou ver para amanhã.
                                                        // Se a loja está fechada e a IA tenta chamar a ferramenta sem o cliente ter aceitado, bloqueamos para forçar a conversa.
                                                        const hasAccepted = /sim|quero|pode|manda|veja|vê|veja|ok|agendar|amanhã/i.test(lastUserMsg);

                                                        if (statusLoja.includes("FECHADA") && !hasAccepted) {
                                                            result = { success: false, error: "ACESSO NEGADO: A loja está FECHADA. Você é PROIBIDA de mostrar o catálogo agora. Primeiro, responda ao cliente informando que a produção encerrou hoje e pergunte se ele quer garantir o pedido para AMANHÃ. Só chame esta ferramenta se ele disser 'Sim'." };
                                                            pendingCatalogMessage = null; // Garante que não envie o balão do catálogo
                                                        } else {
                                                            pendingCatalogMessage = `${deliveryStr.trim() || 'Nenhum item de pronta entrega no momento.'}`;
                                                            pendingCatalogCTA = "delivery";
                                                            if (statusLoja.includes("FECHADA")) {
                                                                result = { success: true, message: "O catálogo de delivery foi injetado. AVISO: A loja está FECHADA AGORA. Informe ao cliente que ele pode garantir esses itens para AMANHÃ." };
                                                            } else {
                                                                result = { success: true, message: "O catálogo JÁ FOI ENVIADO para o cliente em um balão separado. Agora a Lily deve enviar APENAS UM CTA final, curto e persuasivo (pergunta de fechamento). PROIBIDO repetir o cardápio ou a introdução." };
                                                            }
                                                        }
                                                    } else {
                                                        pendingCatalogMessage = `${orderStr.trim() || 'Nenhuma encomenda disponível.'}`;
                                                        pendingCatalogCTA = "order";
                                                        result = { success: true, message: "O catálogo de encomendas já foi enviado. Agora a Lily deve enviar APENAS UM CTA final, curto e humano. PROIBIDO listar preços ou produtos agora." };
                                                    }
                                                } catch (err) {
                                                    console.error('[Catalog Error]', err);
                                                    result = { success: false, error: "Falha ao buscar cardápio." };
                                                }
                                            }
                                            else if (functionName === "check_availability") {
                                                result = await checkAvailability(args.date, args.time);
                                            }
                                            else if (functionName === "get_delivery_fee") {
                                                const feeRes = await calculateFee(args.address);
                                                if (feeRes.error) result = "Erro: " + feeRes.error;
                                                else if (feeRes.type === 'fixed') {
                                                    const canCash = feeRes.fee <= 4.0;
                                                    result = `VALOR DO FRETE: R$ ${feeRes.fee.toFixed(2)}. ${canCash ? 'DINHEIRO LIBERADO' : 'APENAS PIX/CARTÃO (Link)'}`;
                                                } else {
                                                    const canCash = feeRes.estimated <= 4.0;
                                                    result = `VALOR DO FRETE (ESTIMADO): R$ ${feeRes.estimated.toFixed(2)}. ${canCash ? 'DINHEIRO LIBERADO' : 'APENAS PIX/CARTÃO (Link)'}`;
                                                }
                                            }
                                            else if (functionName === "create_order") {
                                                // Notes are now kept clean, cake details passed as separate fields
                                                let finalNotes = args.notes || '';

                                                try {
                                                    // TRAVA DE SEGURANÇA: Evita duplicatas em curto espaço de tempo
                                                    const recentOrder = await prisma.order.findFirst({
                                                        where: {
                                                            clientJid: jid,
                                                            createdAt: { gte: new Date(Date.now() - 15 * 60000) },
                                                            status: { in: ['pending', 'waiting_payment'] }
                                                        },
                                                        orderBy: { createdAt: 'desc' }
                                                    });

                                                    if (recentOrder) {
                                                        // Se a IA não estiver explicitamente tentando criar um NOVO item diferente
                                                        result = {
                                                            success: false,
                                                            error: `ALERTA: Já existe um pedido recente (#${recentOrder.id.slice(-5).toUpperCase()}) para este cliente. NÃO DUPLIQUE o pedido. Se o cliente está mudando de ideia, use 'update_order' com este código. Só crie um novo se forem produtos diferentes.`
                                                        };
                                                    } else {
                                                        const res = await axios.post('http://localhost:3001/orders', {
                                                            ...args,
                                                            notes: finalNotes.trim(),
                                                            clientJid: jid,
                                                            instanceId: instanceId
                                                        });
                                                        result = {
                                                            success: true,
                                                            referenceCode: res.data.id.slice(-5).toUpperCase(),
                                                            calendarEvent: !!res.data.calendarEventId,
                                                            paymentLinkSent: !!res.data.paymentLink
                                                        };
                                                        if (res.data.paymentLink) pendingPaymentLink = res.data.paymentLink;

                                                        // Se for dinheiro, já cai como pending, então dispara o DING agora
                                                        if (args.paymentMethod === 'Dinheiro') {
                                                            io.emit('new_order_pending', { orderId: res.data.id });
                                                        }
                                                    }
                                                } catch (err) {
                                                    result = { success: false, error: err.response?.data?.error || err.message };
                                                }
                                            }
                                            else if (functionName === "update_order") {
                                                try {
                                                    const allOrders = await prisma.order.findMany({ where: { clientJid: jid } });
                                                    const targetOrder = allOrders.find(o => o.id.slice(-5).toUpperCase() === args.orderId.toUpperCase());
                                                    if (!targetOrder) {
                                                        result = { success: false, error: "Pedido não encontrado com esse código de referência." };
                                                    } else {
                                                        const updateData = {};
                                                        if (args.product) updateData.product = args.product;
                                                        if (args.quantity) updateData.quantity = args.quantity;
                                                        if (args.scheduledDate) updateData.scheduledDate = args.scheduledDate;
                                                        if (args.scheduledTime) updateData.scheduledTime = args.scheduledTime;
                                                        if (args.notes) updateData.notes = args.notes;

                                                        await axios.patch(`http://localhost:3001/orders/${targetOrder.id}`, updateData);

                                                        result = { success: true, message: "Pedido atualizado com sucesso." };
                                                    }
                                                } catch (err) {
                                                    result = { success: false, error: err.response?.data?.error || err.message };
                                                }
                                            }

                                            else if (functionName === "get_order_status") {
                                                const order = await prisma.order.findFirst({
                                                    where: { clientJid: jid, status: { not: "completed" } },
                                                    orderBy: { createdAt: 'desc' }
                                                });
                                                if (order) {
                                                    result = {
                                                        status: order.status === "ready" ? "PRONTO" : "EM PRODUÇÃO",
                                                        product: order.product,
                                                        canOfferLocation: order.status === "ready"
                                                    };
                                                } else {
                                                    result = { error: "Nenhum pedido ativo encontrado para este número." };
                                                }
                                            }
                                            else if (functionName === "get_store_location") {
                                                result = {
                                                    address: settings?.businessAddress || "Endereço não configurado.",
                                                    locationLink: settings?.businessLocation || "Link não disponível."
                                                };
                                            }

                                            messages.push({
                                                tool_call_id: toolCall.id,
                                                role: "tool",
                                                name: functionName,
                                                content: JSON.stringify(result),
                                            });
                                        }

                                        if (currentToken.cancelled) return;
                                        const secondResponse = await ai.chat.completions.create({
                                            model: MODEL_MAP[settings?.activeModel] || 'gpt-4o',
                                            messages,
                                        });

                                        if (currentToken.cancelled) return;
                                        let aiFinalText = secondResponse.choices[0].message.content || "";

                                        // Se houver um catálogo pendente, vamos dividir a resposta da IA em Intro e CTA
                                        if (pendingCatalogMessage) {
                                            // 1ª MENSAGEM: INTRODUÇÃO (Pega a primeira frase)
                                            let introText = aiFinalText.split(/[.!?\n]/)[0].trim();
                                            if (!introText || introText.length < 5) introText = "Aqui estão as nossas delícias de delivery:";
                                            if (introText.endsWith(':')) introText = introText.slice(0, -1);
                                            introText += ":";

                                            // CTA FINAL (Pega a última frase se houver, ou usa a padrão)
                                            let ctaText = "Qual desses posso separar para você?";
                                            const lines = aiFinalText.split('\n').filter(l => l.trim().length > 0);
                                            if (lines.length > 1) {
                                                const lastLine = lines[lines.length - 1].trim();
                                                if (lastLine.includes('?') && lastLine.length < 60) ctaText = lastLine;
                                            }

                                            // Envia Intro
                                            await sendRichMessage(sock, jid, introText);

                                            // Envia Catálogo
                                            await new Promise(resolve => setTimeout(resolve, 1500));
                                            await sock.sendMessage(jid, { text: pendingCatalogMessage });

                                            // Envia CTA
                                            await new Promise(resolve => setTimeout(resolve, 2000));
                                            await sendRichMessage(sock, jid, ctaText);
                                        } else {
                                            // Se não for catálogo, envia a resposta normal
                                            await sendRichMessage(sock, jid, aiFinalText);
                                        }

                                        return;
                                    }
                                } catch (err) {
                                    console.error('[AI Completion Error]', err);
                                    return;
                                }

                                let replyText = responseMessage.content;
                                if (replyText) {
                                    if (currentToken.cancelled) return;
                                    // LIMPEZA AGRESSIVA DE FORMATAÇÃO
                                    replyText = replyText.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$2'); // links markdown -> URL pura
                                    replyText = replyText.replace(/\*/g, ''); // Remove negrito/itálico
                                    replyText = replyText.replace(/#/g, '');  // Remove hashtags
                                    replyText = replyText.replace(/•/g, '-'); // Troca bullet por traço
                                    replyText = replyText.replace(/·/g, '-'); // Troca bullet médio por traço
                                    replyText = replyText.replace(/·/g, '-'); // Repetindo para garantir
                                    replyText = replyText.replace(/_/g, '');  // Remove underlines
                                    replyText = replyText.replace(/`/g, '');  // Remove backticks
                                    replyText = replyText.trim();

                                    // TRAVA DE SEGURANÇA: Se o catálogo vai ser enviado em seguida,
                                    // força o replyText a ser APENAS a primeira frase da IA (a introdução).
                                    if (pendingCatalogMessage) {
                                        const firstSentence = replyText.split(/[\n!?]/)[0].trim();
                                        replyText = firstSentence || replyText;
                                    }
                                }

                                // 1ª MENSAGEM: INTRODUÇÃO DA LILY
                                if (currentToken.cancelled) return;
                                const typingSpeed = 50;
                                const introDelay = Math.min(Math.max(replyText.length * typingSpeed, 2000), 10000);

                                await sock.sendPresenceUpdate('composing', jid);
                                await new Promise(resolve => setTimeout(resolve, introDelay));
                                await sock.sendPresenceUpdate('paused', jid);

                                await sendRichMessage(sock, jid, replyText);
                                console.log(`[AI] Intro enviada para ${jid}`);

                                // Envia o link de pagamento se houver
                                if (pendingPaymentLink) {
                                    await new Promise(resolve => setTimeout(resolve, 1000));
                                    await sock.sendMessage(jid, { text: pendingPaymentLink });
                                }

                                // 2ª MENSAGEM: CARDÁPIO (SISTEMA)
                                if (pendingCatalogMessage) {
                                    // Pausa mínima para respiro
                                    await new Promise(resolve => setTimeout(resolve, 500));

                                    // Digitação rápida para o catálogo
                                    const catalogDelay = Math.min(Math.max(pendingCatalogMessage.length * 5, 800), 3000);
                                    await sock.sendPresenceUpdate('composing', jid);
                                    await new Promise(resolve => setTimeout(resolve, catalogDelay));
                                    await sock.sendPresenceUpdate('paused', jid);

                                    await sock.sendMessage(jid, { text: pendingCatalogMessage });
                                    console.log(`[AI] Cardápio injetado para ${jid}`);

                                    // 3ª MENSAGEM: CTA DA LILY (DINÂMICO)
                                    if (pendingCatalogCTA) {
                                        // Pausa mínima para o CTA
                                        await new Promise(resolve => setTimeout(resolve, 800));

                                        const ctaPrompt = pendingCatalogCTA === "delivery"
                                            ? "O cardápio de hoje foi enviado. Agora, como Lily (vendedora sutil e ótima), envie UM CTA final (1 frase) perfeito para fechar a venda. Seja natural e direta, sem formalidades. Ex: 'Dê uma olhadinha nas opções e me diz qual dessas posso separar para você?'"
                                            : "O cardápio de encomendas foi enviado. Agora, como Lily, envie UM CTA final (1 frase) humano e simpático para entender o desejo do cliente. Ex: 'Qual dessas combina mais com o que você está imaginando?'";
                                        try {
                                            const ctaResponse = await ai.chat.completions.create({
                                                model: MODEL_MAP[settings?.activeModel] || 'gpt-4o',
                                                messages: [...messages, { role: 'user', content: ctaPrompt }],
                                                max_tokens: 60
                                            });
                                            let ctaText = ctaResponse.choices[0].message.content?.trim();
                                            if (ctaText) {
                                                ctaText = ctaText.replace(/\*/g, '').replace(/#/g, '').replace(/_/g, '').trim();

                                                // Digitação rápida para o CTA
                                                const ctaDelay = Math.min(Math.max(ctaText.length * 20, 1000), 2500);
                                                await sock.sendPresenceUpdate('composing', jid);
                                                await new Promise(resolve => setTimeout(resolve, ctaDelay));
                                                await sock.sendPresenceUpdate('paused', jid);

                                                await sock.sendMessage(jid, { text: ctaText });
                                                console.log(`[AI] CTA enviado para ${jid}: ${ctaText}`);
                                            }
                                        } catch (e) {
                                            console.error('[AI CTA Error]', e.message);
                                        }
                                    }
                                }
                                // PONTE ROBUSTA: Busca o fluxo tentando bater o número (prefixo) se o JID exato falhar
                                const cleanJid = jid.split('@')[0];
                                console.log(`[Flow Debug] Lily buscando fluxo: Instância=${instanceId} | Número=${cleanJid}`);

                                let flowState = await prisma.flowState.findFirst({
                                    where: {
                                        instanceId,
                                        jid: { contains: cleanJid }
                                    }
                                });

                                if (flowState) {
                                    const flow = await prisma.flow.findUnique({ where: { id: flowState.flowId } });
                                    if (flow && flow.status === 'Ativo') {
                                        await runFlowNode(sock, instanceId, jid, flow, flowState.currentNodeId);

                                        // Verificação de agendamento
                                        const updatedState = await prisma.flowState.findUnique({ where: { id: flowState.id } });

                                    }
                                }
                            } else {
                                console.warn(`[AI] Agente está ligado para ${jid}, mas a OpenAI API Key não está configurada.`);
                            }
                        }
                    } catch (errDbnc) {
                        console.error('[AI Debounce Error]', errDbnc);
                    }
                }, 4000); // 4 SEGUNDOS DE ESPERA (Otimizado para UX humana)
            } catch (e) {
                console.error('Erro na persistência/AI:', e.message);
            }
        }
        io.emit('new_message', { instanceId, message: msg });
    });

    sock.ev.on('messages.update', async (updates) => {
        for (const update of updates) {
            if (!update.update?.status) continue;

            const statusMap = { 1: 'pending', 2: 'sent', 3: 'delivered', 4: 'read' };
            const newStatus = statusMap[update.update.status] || 'sent';

            try {
                await prisma.message.updateMany({
                    where: { msgId: update.key.id },
                    data: { status: newStatus }
                });
                io.emit('message_status_update', {
                    instanceId,
                    msgId: update.key.id,
                    status: newStatus
                });
            } catch (e) { /* mensagem pode não estar no banco ainda */ }
        }
    });

    sock.ev.on('messages.delete', async (item) => {
        console.log('[WhatsApp Delete Debug] Evento recebido:', JSON.stringify(item));
        try {
            if ('all' in item) {
                const deleted = await prisma.message.deleteMany({
                    where: { instanceId, clientJid: item.jid }
                });
                io.emit('messages_deleted', { instanceId, jid: item.jid, all: true });
                console.log(`[WhatsApp] Todas as mensagens do chat ${item.jid} foram deletadas do DB. Quantidade: ${deleted.count}`);
            } else {
                for (const key of item.keys) {
                    const deleted = await prisma.message.deleteMany({
                        where: { instanceId, msgId: key.id }
                    });
                    io.emit('message_deleted', { instanceId, msgId: key.id });
                    console.log(`[WhatsApp] Mensagem deletada do DB: ${key.id}. Quantidade: ${deleted.count}`);
                }
            }
        } catch (err) {
            console.error('[WhatsApp Delete Error]', err);
        }
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) io.emit('qr', { instanceId, qr });
        if (connection === 'open') {
            // Conexão bem-sucedida
            await prisma.instance.update({ where: { id: instanceId }, data: { status: 'connected' } }).catch(() => { });
            io.emit('connection_update', { instanceId, status: 'connected' });
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            clearInterval(saveInterval);
            await prisma.instance.update({ where: { id: instanceId }, data: { status: 'disconnected' } }).catch(() => { });
            io.emit('connection_update', { instanceId, status: 'disconnected' });
            if (shouldReconnect) initInstance(instanceId);
        }
    });

    sock.ev.on('presence.update', ({ id, presences: pres }) => {
        const jid = id;
        const presenceData = pres[jid] || Object.values(pres)[0];
        if (presenceData) {
            io.emit('presence_update', {
                instanceId,
                jid,
                status: presenceData.lastKnownPresence || 'unavailable',
                lastSeen: presenceData.lastSeen || null,
            });
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sessions.set(instanceId, sock);
    stores.set(instanceId, store);
}

// AI Test Route for Training
app.post('/instances/:id/ai-test', async (req, res) => {
    try {
        const { id } = req.params;
        const { question, botPrompt, knowledge } = req.body;

        const ai = await getOpenAI();
        if (!ai) return res.status(400).json({ error: 'OpenAI não configurada' });

        const kb = JSON.parse(knowledge || '[]');
        const kbContext = kb.length > 0
            ? "\n\nUse as seguintes informações específicas da empresa para responder se relevante:\n" +
            kb.map(k => `Pergunta: ${k.q}\nResposta: ${k.a}`).join('\n---\n')
            : "";

        const messages = [
            { role: 'system', content: (botPrompt || 'Você é um assistente prestativo.') + kbContext },
            { role: 'user', content: question }
        ];

        const settings = await getSettings();
        const completion = await ai.chat.completions.create({
            model: MODEL_MAP[settings?.activeModel] || 'gpt-4o',
            messages
        });

        res.json({ answer: completion.choices[0].message.content });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API Routes
app.get('/config/keys', async (req, res) => {
    let config = await getSettings();
    if (!config) config = await prisma.setting.create({ data: { id: 'global', activeModel: 'openai' } });
    res.json({
        openai: config.openaiKey,
        claude: config.claudeKey,
        activeModel: config.activeModel,
        gcalConfigured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
        gcalCalendarId: config.gcalCalendarId,
        gcalSyncHour: config.gcalSyncHour,
        businessName: config.businessName,
        businessAddress: config.businessAddress,
        businessLocation: config.businessLocation,
        dailyMaxOrders: config.dailyMaxOrders,
        managerJid: config.managerJid,
        deliveryJid: config.deliveryJid,
        reportEnabled: config.reportEnabled,
        reportHour: config.reportHour,
        googleApiKey: config.googleApiKey,
        deliveryRules: config.deliveryRules,
        gcalRefreshToken: config.gcalRefreshToken,
        mercadopagoPublicKey: config.mercadopagoPublicKey,
        mercadopagoToken: config.mercadopagoToken
    });
});

app.post('/config/keys', async (req, res) => {
    const {
        openai, claude, activeModel, gcalSyncHour,
        businessName, businessAddress, businessLocation,
        dailyMaxOrders, dailyDeliveryItems, managerJid,
        deliveryJid, reportEnabled, reportHour,
        googleApiKey, deliveryRules, gcalCalendarId,
        mercadopagoToken, mercadopagoPublicKey
    } = req.body;

    const currentConfig = await getSettings();

    const updateData = {
        openaiKey: openai,
        claudeKey: claude,
        mercadopagoToken,
        mercadopagoPublicKey,
        activeModel,
        gcalSyncHour: gcalSyncHour ?? (currentConfig?.gcalSyncHour || 6),
        businessName,
        businessAddress,
        businessLocation,
        dailyMaxOrders: parseInt(dailyMaxOrders || 10),
        managerJid,
        deliveryJid,
        reportEnabled: !!reportEnabled,
        reportHour: reportHour ?? (currentConfig?.reportHour || 7),
        googleApiKey: googleApiKey || "",
        deliveryRules: typeof deliveryRules === 'string' ? deliveryRules : JSON.stringify(deliveryRules || []),
        gcalCalendarId: gcalCalendarId || ""
    };

    console.log(`[Config Save] Atualizando configurações globais...`);

    const config = await prisma.setting.upsert({
        where: { id: 'global' },
        update: updateData,
        create: { id: 'global', ...updateData, gcalEnabled: false }
    });

    openaiInstance = null;
    invalidateSettingsCache(); // força reload das configurações no próximo uso
    res.json(config);
});

app.get('/config/slots', async (req, res) => {
    try {
        const slots = await prisma.availableSlot.findMany({ orderBy: { dayOfWeek: 'asc' } });
        res.json(slots);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/config/slots', async (req, res) => {
    try {
        const { slots } = req.body; // Array de { dayOfWeek, startTime, endTime }

        // Limpa slots atuais e recria
        await prisma.availableSlot.deleteMany({});
        const created = await prisma.availableSlot.createMany({
            data: slots.map(s => ({
                dayOfWeek: parseInt(s.dayOfWeek),
                startTime: s.startTime,
                endTime: s.endTime,
                maxOrders: 10
            }))
        });
        res.json(created);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Rotas de Google Auth duplicadas removidas

app.get('/instances', async (req, res) => {
    const instances = await prisma.instance.findMany();
    res.json(instances);
});

app.post('/instances', async (req, res) => {
    try {
        const { name, color } = req.body;
        const instance = await prisma.instance.create({ data: { name, color: color || '#3b82f6' } });
        await initInstance(instance.id);
        res.json(instance);
    } catch (err) {
        console.error('[Instance Create Error]', err);
        res.status(500).json({ error: err.message });
    }
});

app.patch('/instances/:id', async (req, res) => {
    const { id } = req.params;
    const { name, color, botPrompt, knowledge } = req.body;
    const instance = await prisma.instance.update({
        where: { id },
        data: { name, color, botPrompt, knowledge }
    });
    res.json(instance);
});

app.post('/instances/:id/logout', async (req, res) => {
    const { id } = req.params;
    const sock = sessions.get(id);
    if (sock) {
        try {
            await sock.logout();
        } catch (e) {
            sock.end();
        }
        sessions.delete(id);
    }
    const sessionDir = path.join(__dirname, 'sessions', id);
    if (fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive: true, force: true });
    await prisma.instance.update({ where: { id }, data: { status: 'disconnected' } });
    res.json({ success: true });
});

app.post('/instances/:id/restart', async (req, res) => {
    try {
        const { id } = req.params;
        const sock = sessions.get(id);
        if (sock) {
            try { sock.end(); } catch (e) { }
            sessions.delete(id);
        }
        await initInstance(id);
        res.json({ success: true });
    } catch (err) {
        console.error('[Instance Restart Error]', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/instances/:id', async (req, res) => {
    const { id } = req.params;
    const sock = sessions.get(id);
    if (sock) {
        sock.end();
        sessions.delete(id);
    }
    stores.delete(id);
    const sessionDir = path.join(__dirname, 'sessions', id);
    if (fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive: true, force: true });
    await prisma.instance.delete({ where: { id } });
    res.json({ success: true });
});

app.get('/instances/:id/chats', async (req, res) => {
    const skip = parseInt(req.query.skip) || 0;
    const take = parseInt(req.query.take) || 40;
    const isGroup = req.query.group === 'true' ? true : req.query.group === 'false' ? false : undefined;
    const search = req.query.search || '';

    const where = {
        instanceId: req.params.id,
        ...(isGroup !== undefined && { isGroup }),
        ...(search && {
            OR: [
                { name: { contains: search } },
                { jid: { contains: search } },
                { lastMsg: { contains: search } }
            ]
        })
    };

    const [chats, total, flowStates] = await Promise.all([
        prisma.chat.findMany({ where, orderBy: { updatedAt: 'desc' }, skip, take }),
        prisma.chat.count({ where }),
        prisma.flowState.findMany({ where: { instanceId: req.params.id } })
    ]);

    // Mapeia quais chats estão em fluxo
    const chatsWithFlow = chats.map(chat => ({
        ...chat,
        inFlow: flowStates.some(fs => fs.jid === chat.jid)
    }));

    res.json({ chats: chatsWithFlow, total, hasMore: skip + take < total });
});

app.patch('/instances/:id/chats/:jid', async (req, res) => {
    const { id, jid } = req.params;
    const { aiEnabled } = req.body;
    const chat = await prisma.chat.update({
        where: { instanceId_jid: { instanceId: id, jid } },
        data: { aiEnabled }
    });
    res.json(chat);
});

app.get('/instances/:id/messages/:jid', async (req, res) => {
    const { id, jid } = req.params;
    // Carrega apenas as últimas 20 mensagens para manter o carregamento instantâneo
    let messages = await prisma.message.findMany({
        where: { instanceId: id, jid },
        orderBy: { timestamp: 'desc' },
        take: 20
    });

    // Inverte o array para a ordem cronológica correta no frontend (antigas em cima, novas embaixo)
    messages = messages.reverse();

    const formatted = messages.map(m => ({
        id: m.msgId,
        text: m.text,
        fromMe: m.fromMe,
        participant: m.participant,
        senderName: m.senderName,
        quotedText: m.quotedText,
        quotedParticipant: m.quotedParticipant,
        time: new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: m.status
    }));
    res.json(formatted);
    await prisma.chat.updateMany({ where: { instanceId: id, jid }, data: { unreadCount: 0 } }).catch(() => { });
});

app.get('/instances/:id/profile-pic/:jid', async (req, res) => {
    try {
        const { id, jid } = req.params;
        const sock = sessions.get(id);
        if (!sock) return res.status(404).json({ error: 'Sessão não encontrada' });

        const urlPromise = sock.profilePictureUrl(jid, 'image');
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000));

        const url = await Promise.race([urlPromise, timeoutPromise]).catch(() => null);
        res.json({ url });
    } catch (err) {
        res.json({ url: null });
    }
});

// Apagar mensagem
app.post('/instances/:id/messages/delete', async (req, res) => {
    const { id } = req.params;
    const { jid, msgId, fromMe, forEveryone } = req.body;
    const sock = sessions.get(id);
    if (!sock) return res.status(404).json({ error: 'Instância não conectada' });

    try {
        if (forEveryone && fromMe) {
            // Apaga para todos (apenas se for minha mensagem)
            await sock.sendMessage(jid, { delete: { remoteJid: jid, fromMe: true, id: msgId } });
        } else {
            // Apenas remove do banco local (simula "apagar para mim")
            await prisma.message.deleteMany({ where: { msgId } });
        }
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Marcar conversa como lida (Visto)
app.post('/instances/:id/chats/read', async (req, res) => {
    const { id, jid, msgId } = req.body;
    const sock = sessions.get(id);
    if (!sock) return res.status(404).json({ error: 'Instância não conectada' });

    try {
        // Emite o check azul no WhatsApp
        await sock.readMessages([{ remoteJid: jid, id: msgId, fromMe: false }]);
        // Zera o contador local
        await prisma.chat.updateMany({
            where: { instanceId: id, jid },
            data: { unreadCount: 0 }
        });
        res.json({ ok: true });
    } catch (err) {
        res.json({ ok: false, error: err.message });
    }
});

// Marcar como não lido (Manual)
app.patch('/instances/:id/chats/:jid/unread', async (req, res) => {
    const { id, jid } = req.params;
    try {
        await prisma.chat.updateMany({
            where: { instanceId: id, jid },
            data: { unreadCount: 1 }
        });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Apagar conversa inteira
app.delete('/instances/:id/chats/:jid', async (req, res) => {
    const { id, jid } = req.params;
    try {
        console.log(`[Delete Chat] Removendo dados para ${jid} na instância ${id}`);
        // Remove do banco local as mensagens, o chat e o ESTADO DO FLUXO
        const mDel = await prisma.message.deleteMany({ where: { instanceId: id, jid } });
        const cDel = await prisma.chat.deleteMany({ where: { instanceId: id, jid } });
        const fDel = await prisma.flowState.deleteMany({ where: { instanceId: id, jid } }).catch(() => { });

        console.log(`[Delete Chat] Resultado: ${mDel.count} msgs, ${cDel.count} chats, ${fDel?.count || 0} flows removidos.`);

        // Avisa o front-end para limpar o indicador visual
        io.emit('chat_update', { instanceId: id, jid, inFlow: false });

        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/instances/:id/send', async (req, res) => {
    try {
        const { id } = req.params;
        let { jid, text } = req.body;
        const sock = sessions.get(id);

        if (!sock) return res.status(404).json({ error: 'Sessão não encontrada' });
        if (!jid || typeof jid !== 'string' || !text) {
            return res.status(400).json({ error: 'JID (string) e texto são obrigatórios' });
        }

        // Clean and fix JID
        let finalJid = jid.trim();
        if (!finalJid.includes('@')) {
            finalJid = finalJid.includes(':') ? finalJid.split(':')[0] + '@s.whatsapp.net' : finalJid + '@s.whatsapp.net';
        }

        console.log(`[${id}] JID Final Formatado: ${finalJid}`);

        let result;
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
            try {
                result = await sendRichMessage(sock, finalJid, text);
                break;
            } catch (err) {
                attempts++;
                const isSessionError = err.message.includes('SessionError') || err.message.includes('No sessions');

                if (isSessionError && attempts < maxAttempts) {
                    console.warn(`[${id}] Erro de sessão detectado. Tentando recuperar metadados e reenviar (${attempts}/${maxAttempts})...`);

                    if (finalJid.endsWith('@g.us')) {
                        try {
                            await sock.groupMetadata(finalJid);
                            await sock.groupFetchAllParticipating();
                        } catch (e) { console.error('Falha ao atualizar metadados do grupo:', e.message); }
                    }

                    await new Promise(resolve => setTimeout(resolve, 1500 * attempts));
                    continue;
                }
                throw err;
            }
        }

        // Save outgoing message to DB
        await prisma.message.create({
            data: {
                msgId: result.key.id,
                instanceId: id,
                jid: finalJid,
                text,
                fromMe: true,
                timestamp: new Date(),
                status: 'sent'
            }
        });

        // Tenta pegar o nome do contato no store do Baileys
        const store = stores.get(id);
        const contactInfo = store?.contacts?.[finalJid];
        const contactName = contactInfo?.name || contactInfo?.verifiedName || contactInfo?.notify || null;

        // Update Chat
        await prisma.chat.upsert({
            where: { instanceId_jid: { instanceId: id, jid: finalJid } },
            update: {
                lastMsg: text,
                lastMsgTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                updatedAt: new Date(),
                ...(contactName && { name: contactName }),
            },
            create: {
                instanceId: id,
                jid: finalJid,
                name: contactName,
                lastMsg: text,
                lastMsgTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            }
        });

        res.json(result);
    } catch (err) {
        console.error('ERRO FATAL NO ENVIO:', err);
        res.status(500).json({ error: 'Erro ao enviar: ' + err.message });
    }
});

// ─── ROTAS — FLUXOS (FLOW BUILDER) ──────────────────────────────────────────

app.get('/flows', async (req, res) => {
    try {
        const flows = await prisma.flow.findMany({
            orderBy: { updatedAt: 'desc' }
        });
        res.json(flows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/flows/:id', async (req, res) => {
    try {
        const flow = await prisma.flow.findUnique({
            where: { id: req.params.id }
        });
        if (!flow) return res.status(404).json({ error: 'Flow não encontrado' });
        res.json(flow);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/flows', async (req, res) => {
    try {
        const { id, name, trigger, status, data, instanceId } = req.body;
        const flowPayload = {
            name: name || 'Novo Fluxo',
            trigger: trigger || 'whatsapp.inbound',
            status: status || 'Rascunho',
            data: typeof data === 'string' ? data : JSON.stringify(data || { nodes: [], edges: [] }),
            instanceId: instanceId || null
        };

        if (id) {
            const flow = await prisma.flow.update({
                where: { id },
                data: flowPayload
            });
            return res.json(flow);
        }

        const flow = await prisma.flow.create({
            data: flowPayload
        });
        res.json(flow);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/flows/:id', async (req, res) => {
    try {
        const { name, trigger, status, data, instanceId } = req.body;
        const flow = await prisma.flow.update({
            where: { id: req.params.id },
            data: {
                name,
                trigger,
                status,
                data: typeof data === 'string' ? data : JSON.stringify(data || { nodes: [], edges: [] }),
                instanceId
            }
        });
        res.json(flow);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/flows/:id', async (req, res) => {
    try {
        const { id } = req.params;
        // Limpa todos os estados de conversa ativos deste fluxo antes de deletar o fluxo
        await prisma.flowState.deleteMany({ where: { flowId: id } }).catch(() => { });

        await prisma.flow.delete({
            where: { id }
        });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// ─── AGENTE DE ADMINISTRADOR (LILY EXECUTIVE) ──────────────────────────

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception thrown:', err);
});

const PORT = 3001;
server.listen(PORT, async () => {
    console.log(`Backend rodando em http://localhost:${PORT}`);
    const instances = await prisma.instance.findMany();
    for (const inst of instances) {
        initInstance(inst.id);
    }
    // Inicia os cron jobs (GCal sync + relatório)
    await setupCronJobs((instanceId) => sessions.get(instanceId));
});
