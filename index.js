require('dotenv').config();
const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, makeInMemoryStore } = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { getLinkPreview } = require('link-preview-js');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

const prisma = new PrismaClient();
const { router: ordersRouter, setupCronJobs } = require('./routes/orders');
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "http://localhost:5173", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json());
app.use('/orders', ordersRouter);

// ─── GOOGLE CALENDAR OAUTH ────────────────────────────────────────────────────

const { google } = require('googleapis');
const GCAL_SCOPES = ['https://www.googleapis.com/auth/calendar'];
const GCAL_REDIRECT = 'http://localhost:3001/auth/google/callback';

function getOAuth2Client(clientId, clientSecret) {
    return new google.auth.OAuth2(clientId, clientSecret, GCAL_REDIRECT);
}

// Inicia o fluxo OAuth — redireciona para o consent screen do Google
app.get('/auth/google', async (req, res) => {
    const settings = await prisma.setting.findUnique({ where: { id: 'global' } });
    if (!settings?.gcalClientId || !settings?.gcalClientSecret) {
        return res.redirect(`http://localhost:5173/settings?gcal_error=missing_credentials`);
    }
    const oauth2Client = getOAuth2Client(settings.gcalClientId, settings.gcalClientSecret);
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
    if (error) return res.redirect(`http://localhost:5173/settings?gcal_error=${error}`);

    try {
        const settings = await prisma.setting.findUnique({ where: { id: 'global' } });
        const oauth2Client = getOAuth2Client(settings.gcalClientId, settings.gcalClientSecret);
        const { tokens } = await oauth2Client.getToken(code);

        await prisma.setting.upsert({
            where: { id: 'global' },
            update: {
                gcalAccessToken: tokens.access_token,
                gcalRefreshToken: tokens.refresh_token,
                gcalTokenExpiry: tokens.expiry_date?.toString(),
                gcalEnabled: true,
            },
            create: {
                id: 'global',
                gcalAccessToken: tokens.access_token,
                gcalRefreshToken: tokens.refresh_token,
                gcalTokenExpiry: tokens.expiry_date?.toString(),
                gcalEnabled: true,
            },
        });

        res.redirect(`http://localhost:5173/settings?gcal_success=1`);
    } catch (e) {
        console.error('[GCal OAuth]', e.message);
        res.redirect(`http://localhost:5173/settings?gcal_error=token_exchange_failed`);
    }
});

// Status da conexão com o Google Calendar
app.get('/auth/google/status', async (req, res) => {
    const settings = await prisma.setting.findUnique({ where: { id: 'global' } });
    const connected = !!(settings?.gcalRefreshToken);
    res.json({ connected, calendarId: settings?.gcalCalendarId, hasCredentials: !!(settings?.gcalClientId && settings?.gcalClientSecret) });
});

// Lista os calendários disponíveis na conta conectada
app.get('/auth/google/calendars', async (req, res) => {
    try {
        const settings = await prisma.setting.findUnique({ where: { id: 'global' } });
        if (!settings?.gcalRefreshToken) return res.status(401).json({ error: 'Não conectado' });

        const oauth2Client = getOAuth2Client(settings.gcalClientId, settings.gcalClientSecret);
        oauth2Client.setCredentials({ refresh_token: settings.gcalRefreshToken, access_token: settings.gcalAccessToken });
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        const list = await calendar.calendarList.list();
        const calendars = list.data.items.map(c => ({ id: c.id, name: c.summary, primary: c.primary }));
        res.json(calendars);
    } catch (e) {
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



// OpenAI Instance (Lazy initialized)
let openaiInstance = null;
const getOpenAI = async () => {
    if (!openaiInstance) {
        const config = await prisma.setting.findUnique({ where: { id: 'global' } });
        if (config?.openaiKey) {
            openaiInstance = new OpenAI({ apiKey: config.openaiKey });
        }
    }
    return openaiInstance;
};

// Baileys Instances Manager
const sessions = new Map();
const stores = new Map();

async function sendRichMessage(sock, jid, text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const match = text.match(urlRegex);

    if (match) {
        try {
            const preview = await getLinkPreview(match[0], {
                imagesPropertyType: "og",
                headers: { "user-agent": "WhatsApp/2.21.11.17" }
            });

            return await sock.sendMessage(jid, {
                text: text,
                linkPreview: {
                    title: preview.title,
                    description: preview.description,
                    canonicalUrl: preview.url,
                    matchedText: match[0],
                }
            });
        } catch (e) {
            console.error('[Preview Error]', e.message);
            return await sock.sendMessage(jid, { text });
        }
    }
    return await sock.sendMessage(jid, { text });
}

async function initInstance(instanceId) {
    const sessionDir = path.join(__dirname, 'sessions', instanceId);
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

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
                await prisma.chat.upsert({
                    where: { instanceId_jid: { instanceId, jid } },
                    update: { name: name, isGroup: isGroup },
                    create: { instanceId, jid, name: name, isGroup: isGroup }
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
        let text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';

        // TRANSCRIPÇÃO DE ÁUDIO
        if (!text && msg.message?.audioMessage && !msg.key.fromMe) {
            try {
                const ai = await getOpenAI();
                if (ai) {
                    console.log(`[Audio] Baixando áudio de ${jid}...`);
                    const stream = await downloadContentFromMessage(msg.message.audioMessage, 'audio');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }

                    const transcription = await ai.audio.transcriptions.create({
                        file: await OpenAI.toFile(buffer, 'audio.ogg'),
                        model: 'whisper-1',
                    });
                    text = `🎤 [Áudio]: ${transcription.text}`;
                    console.log(`[Audio] Transcrição concluída: "${text}"`);
                }
            } catch (err) {
                console.error('[Audio Error]', err.message);
            }
        }

        if (text) {
            try {
                const isGroup = jid.endsWith('@g.us');
                const chat = await prisma.chat.upsert({
                    where: { instanceId_jid: { instanceId, jid } },
                    update: {
                        lastMsg: text,
                        lastMsgTime: new Date(msg.messageTimestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        unreadCount: { increment: msg.key.fromMe ? 0 : 1 },
                        updatedAt: new Date(),
                        isGroup: isGroup
                    },
                    create: {
                        instanceId,
                        jid,
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

                // AI AGENT LOGIC
                if (!msg.key.fromMe && chat.aiEnabled) {
                    // COMMAND AGENT (Experimental)
                    if (text.toLowerCase().includes('crie um story')) {
                        const storyText = text.replace(/crie um story/i, '').trim();
                        if (storyText) {
                            await sock.sendMessage('status@broadcast', { text: storyText });
                            await sendRichMessage(sock, jid, "✅ Comando executado! Acabei de publicar seu Story.");
                            return;
                        }
                    }

                    console.log(`[AI] Agente ativado para o chat ${jid}. Buscando resposta...`);
                    const ai = await getOpenAI();
                    if (ai) {
                        const settings = await prisma.setting.findUnique({ where: { id: 'global' } });
                        const instance = await prisma.instance.findUnique({ where: { id: instanceId } });
                        const history = await prisma.message.findMany({
                            where: { instanceId, jid },
                            orderBy: { timestamp: 'desc' },
                            take: 20
                        });

                        const kb = JSON.parse(instance.knowledge || '[]');
                        const kbContext = kb.length > 0
                            ? "\n\nUse as seguintes informações específicas da empresa para responder se relevante:\n" +
                            kb.map(k => `Pergunta: ${k.q}\nResposta: ${k.a}`).join('\n---\n')
                            : "";

                        const messages = [
                            { role: 'system', content: (instance.botPrompt || 'Você é um assistente prestativo.') + kbContext },
                            ...history.reverse().map(m => ({
                                role: m.fromMe ? 'assistant' : 'user',
                                content: m.text
                            }))
                        ];

                        // --- TOOLS DEFINITION ---
                        const tools = [
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
                                    description: "Cria um novo pedido ou agendamento (bolo, doce, delivery, etc).",
                                    parameters: {
                                        type: "object",
                                        properties: {
                                            product: { type: "string", description: "Nome do produto ou serviço" },
                                            quantity: { type: "string", description: "Quantidade (ex: 2kg, 10 unidades)" },
                                            scheduledDate: { type: "string", description: "Data do agendamento YYYY-MM-DD" },
                                            scheduledTime: { type: "string", description: "Horário do agendamento HH:MM" },
                                            clientName: { type: "string", description: "Nome do cliente" },
                                            type: { type: "string", enum: ["order", "delivery"], description: "Tipo: order (encomenda) ou delivery (entrega)" },
                                            deliveryAddress: { type: "string", description: "Endereço se for delivery" },
                                            notes: { type: "string", description: "Observações adicionais" }
                                        },
                                        required: ["product", "scheduledDate", "scheduledTime"],
                                    },
                                },
                            },
                            {
                                type: "function",
                                function: {
                                    name: "check_stock",
                                    description: "Verifica a quantidade disponível de um item no estoque.",
                                    parameters: {
                                        type: "object",
                                        properties: {
                                            itemName: { type: "string", description: "Nome do ingrediente ou produto no estoque" },
                                        },
                                        required: ["itemName"],
                                    },
                                },
                            }
                        ];

                        console.log(`[AI] Enviando ${messages.length} mensagens de contexto para o modelo...`);
                        const modelMap = { 'openai': 'gpt-4o', 'openai-mini': 'gpt-4o-mini', 'openai-nano': 'gpt-4.1-nano', 'claude': 'gpt-4o' };
                        
                        let responseMessage;
                        try {
                            const completion = await ai.chat.completions.create({
                                model: modelMap[settings?.activeModel] || 'gpt-4o',
                                messages,
                                tools,
                                tool_choice: "auto"
                            });

                            responseMessage = completion.choices[0].message;

                            // FUNCTION CALLING LOOP
                            if (responseMessage.tool_calls) {
                                console.log(`[AI] IA solicitou execução de ${responseMessage.tool_calls.length} ferramentas.`);
                                messages.push(responseMessage);

                                for (const toolCall of responseMessage.tool_calls) {
                                    const functionName = toolCall.function.name;
                                    const args = JSON.parse(toolCall.function.arguments);
                                    let result;

                                    console.log(`[AI] Executando função: ${functionName}`, args);

                                    if (functionName === "check_availability") {
                                        const { checkAvailability } = require('./routes/orders');
                                        result = await checkAvailability(args.date, args.time);
                                    } 
                                    else if (functionName === "create_order") {
                                        const axios = require('axios');
                                        // Usamos a rota interna via POST para garantir que toda a lógica (GCal, Estoque) seja executada
                                        try {
                                            const res = await axios.post('http://localhost:3001/orders', {
                                                ...args,
                                                clientJid: jid,
                                                instanceId: instanceId
                                            });
                                            result = { success: true, orderId: res.data.id, calendarEvent: !!res.data.calendarEventId };
                                        } catch (err) {
                                            result = { success: false, error: err.response?.data?.error || err.message };
                                        }
                                    }
                                    else if (functionName === "check_stock") {
                                        const stockItem = await prisma.stockItem.findFirst({
                                            where: { name: { contains: args.itemName } }
                                        });
                                        result = stockItem ? { name: stockItem.name, quantity: stockItem.quantity, unit: stockItem.unit, low: stockItem.quantity <= stockItem.minQuantity } : { error: "Item não encontrado no estoque." };
                                    }

                                    messages.push({
                                        tool_call_id: toolCall.id,
                                        role: "tool",
                                        name: functionName,
                                        content: JSON.stringify(result),
                                    });
                                }

                                // Get final response from AI after tools
                                const secondResponse = await ai.chat.completions.create({
                                    model: modelMap[settings?.activeModel] || 'gpt-4o',
                                    messages,
                                });
                                responseMessage = secondResponse.choices[0].message;
                            }
                        } catch (err) {
                            console.error('[AI Completion Error]', err);
                            return;
                        }

                        const replyText = responseMessage.content;

                        // SIMULATE HUMAN TYPING
                        const typingSpeed = 50; // ms per character
                        const delay = Math.min(Math.max(replyText.length * typingSpeed, 2000), 10000);

                        console.log(`[AI] Simulando digitação por ${delay}ms...`);
                        await sock.sendPresenceUpdate('composing', jid);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        await sock.sendPresenceUpdate('paused', jid);

                        await sendRichMessage(sock, jid, replyText);
                        console.log(`[AI] Resposta enviada com sucesso para ${jid}`);
                    } else {
                        console.warn(`[AI] Agente está ligado para ${jid}, mas a OpenAI API Key não está configurada.`);
                    }
                }
            } catch (e) {
                console.error('Erro na persistência/AI:', e.message);
            }
        }
        io.emit('new_message', { instanceId, message: msg });
    });

    // Atualiza status das mensagens (entregue / lido)
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

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) io.emit('qr', { instanceId, qr });
        if (connection === 'open') {
            console.log(`[${instanceId}] Conectado!`);
            await prisma.instance.update({ where: { id: instanceId }, data: { status: 'connected' } });
            io.emit('connection_update', { instanceId, status: 'connected' });
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            clearInterval(saveInterval);
            await prisma.instance.update({ where: { id: instanceId }, data: { status: 'disconnected' } });
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

        const settings = await prisma.setting.findUnique({ where: { id: 'global' } });
        const modelMap = { 'openai': 'gpt-4o', 'openai-mini': 'gpt-4o-mini', 'openai-nano': 'gpt-4.1-nano', 'claude': 'gpt-4o' };
        const completion = await ai.chat.completions.create({
            model: modelMap[settings?.activeModel] || 'gpt-4o',
            messages
        });

        res.json({ answer: completion.choices[0].message.content });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API Routes
app.get('/config/keys', async (req, res) => {
    let config = await prisma.setting.findUnique({ where: { id: 'global' } });
    if (!config) config = await prisma.setting.create({ data: { id: 'global', activeModel: 'openai' } });
    res.json({
        openai: config.openaiKey,
        claude: config.claudeKey,
        activeModel: config.activeModel,
        gcalClientId: config.gcalClientId,
        gcalClientSecret: config.gcalClientSecret,
        gcalCalendarId: config.gcalCalendarId,
        gcalSyncHour: config.gcalSyncHour,
        businessName: config.businessName,
        managerJid: config.managerJid,
        deliveryJid: config.deliveryJid,
        reportEnabled: config.reportEnabled,
        reportHour: config.reportHour,
    });
});

app.post('/config/keys', async (req, res) => {
    const { openai, claude, activeModel, gcalClientId, gcalClientSecret, gcalSyncHour, businessName, managerJid, deliveryJid, reportEnabled, reportHour } = req.body;
    const data = {
        openaiKey: openai,
        claudeKey: claude,
        activeModel,
        gcalClientId,
        gcalClientSecret,
        gcalSyncHour: gcalSyncHour ?? 6,
        businessName,
        managerJid,
        deliveryJid,
        reportEnabled: !!reportEnabled,
        reportHour: reportHour ?? 7,
    };
    const config = await prisma.setting.upsert({
        where: { id: 'global' },
        update: data,
        create: { id: 'global', ...data }
    });
    openaiInstance = null;
    res.json(config);
});

app.get('/instances', async (req, res) => {
    const instances = await prisma.instance.findMany();
    res.json(instances);
});

app.post('/instances', async (req, res) => {
    const { name, color } = req.body;
    const instance = await prisma.instance.create({ data: { name, color: color || '#3b82f6' } });
    await initInstance(instance.id);
    res.json(instance);
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

app.post('/instances/:id/restart', async (req, res) => {
    const { id } = req.params;
    const sock = sessions.get(id);
    if (sock) {
        sock.end();
        sessions.delete(id);
    }
    await initInstance(id);
    res.json({ success: true });
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

    const [chats, total] = await Promise.all([
        prisma.chat.findMany({ where, orderBy: { updatedAt: 'desc' }, skip, take }),
        prisma.chat.count({ where }),
    ]);
    res.json({ chats, total, hasMore: skip + take < total });
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
    const messages = await prisma.message.findMany({
        where: { instanceId: id, jid },
        orderBy: { timestamp: 'asc' },
        take: 100
    });
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
    const { id } = req.params;
    const { jid, msgId } = req.body;
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

app.post('/instances/:id/send', async (req, res) => {
    try {
        const { id } = req.params;
        let { jid, text } = req.body;
        const sock = sessions.get(id);

        console.log(`[${id}] Tentando enviar para: "${jid}" | Mensagem: "${text}"`);

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
