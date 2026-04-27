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
const { Client: GoogleMapsClient } = require("@googlemaps/google-maps-services-js");
const mapsClient = new GoogleMapsClient({});
const { getLinkPreview } = require('link-preview-js');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const multer = require('multer');

// Configuração do Multer para Marketing Assets
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'assets/marketing'),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const uploadMarketing = multer({ storage });

const prisma = new PrismaClient();

function estimateMotoPrice(km) {
    let price = 0;
    if (km <= 1.0) {
        price = 4.70;
    } else if (km <= 5.5) {
        price = 4.70 + ((km - 1.0) * 0.50);
    } else {
        price = 6.95 + ((km - 5.5) * 1.05);
    }

    const estimated = Math.round(price * 100) / 100;
    const min = Math.round(estimated * 0.95 * 100) / 100;
    const max = Math.round(estimated * 1.08 * 100) / 100;

    return { estimated, min, max };
}

// Função para calcular frete baseado em distância
async function calculateFee(clientAddress) {
    const settings = await prisma.setting.findUnique({ where: { id: 'global' } });

    if (!settings?.googleApiKey) {
        console.error('[Maps Error] Google API Key não configurada no banco!');
        return { error: 'Chave não configurada.' };
    }
    if (!settings?.businessAddress) {
        console.error('[Maps Error] Endereço da empresa (origem) não configurado!');
        return { error: 'Origem não configurada.' };
    }

    try {
        const response = await mapsClient.distancematrix({
            params: {
                origins: [settings.businessAddress],
                destinations: [clientAddress],
                key: settings.googleApiKey,
                mode: 'driving'
            }
        });

        const data = response.data.rows[0].elements[0];
        if (!data || data.status !== 'OK') {
            console.error(`[Maps Error] Google retornou status: ${data?.status || 'UNKNOWN'}`);
            return { error: 'Endereço não localizado.' };
        }

        const distanceKm = data.distance.value / 1000;

        // Verifica limite máximo
        if (distanceKm > (settings.maxDeliveryKm || 15)) {
            return { error: `Limite excedido (${distanceKm.toFixed(1)}km).`, distance: distanceKm.toFixed(1) };
        }

        const rules = JSON.parse(settings.deliveryRules || '[]').sort((a, b) => a.maxKm - b.maxKm);
        const matchingRule = rules.find(r => distanceKm <= r.maxKm);

        if (matchingRule) {
            return { fee: matchingRule.fee, distance: distanceKm.toFixed(1), type: 'fixed' };
        } else {
            const estimate = estimateMotoPrice(distanceKm);
            return { ...estimate, distance: distanceKm.toFixed(1), type: 'estimate' };
        }
    } catch (err) {
        console.error('[Maps Fatal Error]', err.response?.data || err.message);
        return { error: 'Erro técnico no cálculo.' };
    }
}
const { router: ordersRouter, setupCronJobs } = require('./routes/orders');
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors({ origin: "*" }));
app.use(express.json());
app.use('/orders', ordersRouter);
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

const { google } = require('googleapis');
const GCAL_SCOPES = ['https://www.googleapis.com/auth/calendar'];

function getOAuth2Client(req) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    // Constrói a URL de redirecionamento baseada em quem chamou (localhost ou IP)
    const protocol = req.protocol;
    const host = req.get('host');
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
    const settings = await prisma.setting.findUnique({ where: { id: 'global' } });
    const connected = !!(settings?.gcalRefreshToken);
    const hasCredentials = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    res.json({ connected, calendarId: settings?.gcalCalendarId, hasCredentials });
});

// Lista os calendários disponíveis na conta conectada
app.get('/auth/google/calendars', async (req, res) => {
    try {
        const settings = await prisma.setting.findUnique({ where: { id: 'global' } });
        if (!settings?.gcalRefreshToken) return res.status(401).json({ error: 'Não conectado' });

        const oauth2Client = getOAuth2Client();
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

async function executeChamarGerente(reason, jid, currentChat, settings, flowAdminPhone, sock, prisma, instanceId) {
    // 1. Prioridade máxima: adminPhone configurado no nó do fluxo atual (se houver)
    // 2. Prioridade média: adminJid salvo no banco para este chat (handover anterior)
    // 3. Prioridade mínima: managerJid global (settings)
    let managerJid = flowAdminPhone || currentChat?.adminJid || settings?.managerJid;

    if (managerJid) {
        if (!managerJid.includes('@')) {
            managerJid = managerJid.replace(/\D/g, '') + '@s.whatsapp.net';
        }

        // Sempre salva o último manager usado no chat para persistência
        await prisma.chat.update({
            where: { instanceId_jid: { instanceId, jid } },
            data: { adminJid: managerJid.includes('@') ? managerJid.split('@')[0] : managerJid }
        }).catch(() => { });

        const clientName = currentChat?.name || jid.split('@')[0];
        const alertMsg = `⚠️ *ATENÇÃO GESTOR!* ⚠️\n\nO cliente solicitou ajuda.\n\n👤 *Cliente:* ${clientName}\n❓ *Motivo:* ${reason}\n\n🔗 *Abrir Chat:* http://localhost:5173/chat`;
        console.log(`[AI Agent] Chamando gerente em: ${managerJid}`);
        sock.sendMessage(managerJid, { text: alertMsg }).catch(e => console.error('[Manager Alert Error]', e.message));
        return { success: true, message: "O gerente foi avisado. Peça para o cliente aguardar." };
    } else {
        return { success: false, error: "Gerente não cadastrado." };
    }
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

                // ─── MOTOR DE FLUXOS (FLOW BUILDER) ──────────────────────────────
                let flowHandled = false;
                if (!msg.key.fromMe) {
                    flowHandled = await handleFlows(sock, instanceId, jid, text, msg);
                }
                if (flowHandled) return;

                // ─── COMANDOS DE ADMINISTRADOR (MANAGER) ──────────────────────────
                const settings = await prisma.setting.findUnique({ where: { id: 'global' } });
                if (!msg.key.fromMe && settings?.managerJid && jid === settings.managerJid) {
                    console.log(`[Admin Command] Processando comando do gerente: ${text}`);
                    // Chama o agente específico para o administrador
                    await handleAdminAgent(sock, instanceId, jid, text, settings);
                    return;
                }

                // AI AGENT LOGIC (CLIENTES)
                // Re-buscamos o chat para garantir que pegamos o status de aiEnabled atualizado (caso um fluxo tenha acabado de ligar)
                const currentChat = await prisma.chat.findUnique({
                    where: { instanceId_jid: { instanceId, jid } }
                });

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
                        const settings = await prisma.setting.findUnique({ where: { id: 'global' } });
                        const instance = await prisma.instance.findUnique({ where: { id: instanceId } });
                        const isImage = !!msg.message?.imageMessage || (msg.message?.documentMessage?.mimetype?.startsWith('image/'));
                        const isVideo = !!msg.message?.videoMessage;
                        let userMessageContent = [{ type: "text", text: text || "O cliente enviou uma imagem." }];

                        if (isImage) {
                            try {
                                const { downloadMediaMessage } = require('@whiskeysockets/baileys');
                                const buffer = await downloadMediaMessage(msg, 'buffer', {});
                                const base64Image = buffer.toString('base64');
                                userMessageContent.push({
                                    type: "image_url",
                                    image_url: { url: `data:image/jpeg;base64,${base64Image}` }
                                });
                            } catch (vErr) {
                                console.error('[Vision Error] Falha ao processar imagem:', vErr);
                            }
                        }

                        const history = await prisma.message.findMany({
                            where: { instanceId, jid },
                            orderBy: { timestamp: 'desc' },
                            take: 30
                        });

                        // BUSCA DADOS DO PEDIDO ATUAL (EM NEGOCIAÇÃO OU RECENTE)
                        const lastOrder = await prisma.order.findFirst({
                            where: { clientJid: jid },
                            orderBy: { createdAt: 'desc' }
                        });
                        let orderContext = "";
                        if (lastOrder) {
                            orderContext = `\n--- ESTADO DO PEDIDO ATUAL (${lastOrder.id.slice(-5).toUpperCase()}) ---\n` +
                                `Produto: ${lastOrder.product || 'Pendente'}\n` +
                                `Peso/Qtd: ${lastOrder.quantity || 'Pendente'}\n` +
                                `Data: ${lastOrder.scheduledDate || 'Pendente'} às ${lastOrder.scheduledTime || 'Pendente'}\n` +
                                `Forma de Pagamento: ${lastOrder.paymentMethod || 'Pendente'}\n` +
                                `Status: ${lastOrder.status}\n` +
                                `Observações: ${lastOrder.notes || 'Nenhuma'}\n` +
                                `Use esses dados para NÃO perguntar o que já foi informado.\n`;
                        }


                        const kb = JSON.parse(instance?.knowledge || '[]');
                        let kbContext = kb.length > 0
                            ? "\n\n--- BASE DE CONHECIMENTO OFICIAL (PRIORIDADE MÁXIMA) ---\n" +
                            "Use as informações abaixo como ÚNICA verdade para preços, políticas e dúvidas técnicas. " +
                            "NUNCA invente preços diferentes dos que estão aqui.\n\n" +
                            kb.map(k => `DÚVIDA: ${k.q}\nRESPOSTA OFICIAL: ${k.a}`).join('\n---\n')
                            : "";


                        // BUSCA PRODUTOS COM HIERARQUIA REAL
                        const allProducts = await prisma.product.findMany();
                        let catalogContext = "\n\n--- CARDÁPIO: PRONTA ENTREGA (Delivery/Para comer agora) ---\n";
                        const deliveryItems = allProducts.filter(p => p.type === 'delivery');
                        const orderItems = allProducts.filter(p => p.type !== 'delivery');

                        if (deliveryItems.length === 0) {
                            catalogContext += "(Sem itens de pronta entrega hoje)\n";
                        } else {
                            deliveryItems.forEach(p => {
                                const vars = typeof p.variations === 'string' ? JSON.parse(p.variations || '[]') : (p.variations || []);
                                
                                let prices = vars.length > 0 ? vars.map(v => v.price) : [p.price];
                                const minP = Math.min(...prices);
                                const maxP = Math.max(...prices);
                                const priceRange = minP === maxP ? `R$${minP.toFixed(2)}` : `R$${minP.toFixed(2)} a R$${maxP.toFixed(2)}`;

                                let totalStock = p.stock;
                                if (vars.length > 0) {
                                    totalStock = vars.reduce((acc, v) => {
                                        const subStock = v.subItems?.reduce((sAcc, si) => sAcc + (si.stock || 0), 0) || 0;
                                        return acc + (v.stock || 0) + subStock;
                                    }, 0);
                                }

                                if (totalStock > 0) {
                                    const variationsInfo = vars.map(v => `   - ${v.name}: ${v.description || 'Sem descrição'}`).join('\n');
                                    catalogContext += `- *${p.name}* (${priceRange}): ${p.description || ''}\n${variationsInfo}\n`;
                                } else {
                                    catalogContext += `- *${p.name}*: (ESGOTADO NO MOMENTO)\n`;
                                }
                            });
                        }

                        catalogContext += "\n--- CARDÁPIO: ENCOMENDAS (Para outro dia/Festa) ---\n";
                        if (orderItems.length === 0) {
                            catalogContext += "(Sem itens para encomenda)\n";
                        } else {
                            orderItems.forEach(p => {
                                const vars = typeof p.variations === 'string' ? JSON.parse(p.variations || '[]') : (p.variations || []);
                                if (vars.length > 0) {
                                    const variationsStr = vars.map(v => `${v.name} (R$${v.price})`).join(', ');
                                    catalogContext += `- *${p.name}*: Opções: ${variationsStr}.\n`;
                                } else {
                                    catalogContext += `- *${p.name}*: R$${p.price.toFixed(2)}. ${p.description || ''}\n`;
                                }
                            });
                        }

                        const diasSemana = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
                        const hoje = new Date();
                        const year = hoje.getFullYear();
                        const month = hoje.getMonth();

                        // Lista explícita de dias do mês atual para evitar QUALQUER erro de cálculo da IA
                        let daysList = "";
                        const lastDate = new Date(year, month + 1, 0).getDate();
                        for (let d = 1; d <= lastDate; d++) {
                            const dateObj = new Date(year, month, d);
                            daysList += `${d}/${month + 1}: ${diasSemana[dateObj.getDay()]}, `;
                        }

                        const slots = await prisma.availableSlot.findMany();
                        const diasSiglas = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
                        const diasCompletos = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
                        
                        // Monta o contexto de horários para TODOS os dias
                        let hoursContext = diasCompletos.map((dia, index) => {
                            const slot = slots.find(s => s.dayOfWeek === index);
                            if (slot) return `${dia}: ${slot.startTime} às ${slot.endTime}`;
                            return `${dia}: FECHADO`;
                        }).join('\n');

                        const timeContext = `\n\n--- REGRAS DE ATENDIMENTO HUMANO ---\n1. NÃO SEJA UM ROBÔ: Não mande listas técnicas. Use texto corrido e amigável.\n2. USE NEGRITO: Use asteriscos para destacar nomes de produtos.\n3. PEDIDO IMEDIATO: Se o cliente disser "quero agora" ou "pra já", pule o horário de retirada e peça o endereço para o frete.\n4. HORÁRIO DE HOJE: Hoje é ${diasCompletos[hoje.getDay()]}. O horário é: ${slots.find(s => s.dayOfWeek === hoje.getDay()) ? `${slots.find(s => s.dayOfWeek === hoje.getDay()).startTime} às ${slots.find(s => s.dayOfWeek === hoje.getDay()).endTime}` : 'FECHADO'}.\n\n--- CONTEXTO DE TEMPO ---\nHoje é ${diasCompletos[hoje.getDay()]}, ${hoje.toLocaleDateString('pt-BR')} às ${hoje.toLocaleTimeString('pt-BR')}\n\nHORÁRIOS DA SEMANA:\n${hoursContext}\n\n--- TABELA DE DATAS (${year}) ---\n${daysList}\n\n--- PROTOCOLO DE ENCOMENDA ---\n1. COLETA: Peça APENAS UM item por vez.\n2. AGUARDAR PREÇO: Se for encomenda, avise que aguarda a admin.\n\n--- PAGAMENTO ---\n- OPÇÕES: Pix, Dinheiro, Crédito.\n- PIX: Peça o comprovante. SÓ CHAME create_order após o cliente enviar o comprovante.\n- CRÉDITO: Diga "Vou solicitar ao meu gerente que te envie o link de pagamento agora mesmo!". NÃO CHAME create_order ainda. Aguarde o cliente pagar.\n- DINHEIRO: Pode chamar create_order normalmente.\n- NUNCA feche o pedido sem saber a forma de pagamento.\n\n--- LOGÍSTICA ---\n- RETIRADA POR PADRÃO: Trate todos os pedidos como "Retirada na Loja".\n- NÃO OFEREÇA ENTREGA: Nunca ofereça o serviço de entrega proativamente.\n- REATIVO: Se e SOMENTE SE o cliente perguntar sobre entrega (ex: "Vocês entregam?"), responda que sim, que temos parceria com "Apps de Entrega".\n- CÁLCULO DE FRETE: Só peça o endereço e use get_delivery_fee se o cliente solicitou a entrega.\n- NUNCA diga "Uber", use apenas "App de entrega".\n`;

                        const finalSystemPrompt = `--- REGRAS DE ATENDIMENTO (PRIORIDADE MÁXIMA) ---\n` +
                            `1. HORÁRIOS DE HOJE: Hoje é ${diasCompletos[hoje.getDay()]}. Abrimos às ${slots.find(s => s.dayOfWeek === hoje.getDay())?.startTime || '09:00'} e fechamos às ${slots.find(s => s.dayOfWeek === hoje.getDay())?.endTime || '20:00'}.\n` +
                            `2. PEDIDO IMEDIATO: Se o cliente disser "quero agora", "pra já" ou "tô com pressa", NÃO pergunte horário de retirada. Confirme o item e peça o endereço para o frete (Uber) imediatamente.\n` +
                            `3. NÃO USE LISTAS: Responda de forma fluida e humana.\n` +
                            `4. DESCRIÇÕES REAIS: Use as descrições das variações que estão no cardápio abaixo.\n\n` +
                            catalogContext + timeContext + orderContext + 
                            (kbContext ? "\n\n--- INFORMAÇÕES EXTRAS ---\n" + kbContext : "") +
                            "\n\n--- PERSONALIDADE DA LILY ---\n" + (instance?.botPrompt || 'Você é a Lily, assistente da Linda Cake.');

                        console.log("\n--- DEBUG LILY PROMPT ---\n", finalSystemPrompt.slice(0, 500) + "...");

                        const messages = [
                            { role: 'system', content: finalSystemPrompt },
                            ...history.reverse().map(m => ({
                                role: m.fromMe ? 'assistant' : 'user',
                                content: m.text || "O cliente enviou uma imagem/arquivo."
                            })),
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
                                    description: "Calcula o valor do frete baseado no endereço do cliente usando Google Maps e as regras da loja.",
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
                                    description: "Cria um novo pedido ou agendamento (bolo, doce, delivery, etc). Identifique o produto e a variação correta se disponível.",
                                    parameters: {
                                        type: "object",
                                        properties: {
                                            product: { type: "string", description: "Nome do produto/bolo" },
                                            variation: { type: "string", description: "Sabor da massa e sabor dos recheios (ex: Massa branca, Recheio de Ninho com Morango)" },
                                            quantity: { type: "string", description: "Peso do bolo (ex: 2kg) ou Quantidade" },
                                            scheduledDate: { type: "string", description: "Data do agendamento YYYY-MM-DD" },
                                            scheduledTime: { type: "string", description: "Horário do agendamento HH:MM" },
                                            clientName: { type: "string", description: "Nome do cliente" },
                                            paymentMethod: { type: "string", description: "Forma de pagamento (ex: Pix com comprovante, Dinheiro, Cartão/Link)" },
                                            type: { type: "string", enum: ["order", "delivery"], description: "Tipo: order (encomenda) ou delivery (entrega)" },
                                            deliveryAddress: { type: "string", description: "Endereço se for delivery" },
                                            deliveryFee: { type: "number", description: "Valor do frete calculado (apenas o número, ex: 4.50)" },
                                            notes: { type: "string", description: "Detalhes do modelo de referência, detalhes do topo, e outras observações" }
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
                            }
                        ];

                        const modelMap = { 'openai': 'gpt-4o', 'openai-mini': 'gpt-4o-mini', 'openai-nano': 'gpt-4o-mini', 'claude': 'gpt-4o' };

                        let responseMessage;
                        try {
                            console.log("\n--- DEBUG SYSTEM PROMPT (AGENTE) ---\n", messages[0].content, "\n-----------------------------------\n");

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

                                    if (functionName === "chamar_gerente") {
                                        const { reason } = args;
                                        result = await executeChamarGerente(reason, jid, currentChat, settings, null, sock, prisma, instanceId);
                                    }
                                    else if (functionName === "check_availability") {
                                        const { checkAvailability } = require('./routes/orders');
                                        result = await checkAvailability(args.date, args.time);
                                    }
                                    else if (functionName === "get_delivery_fee") {
                                        const feeRes = await calculateFee(args.address);
                                        if (feeRes.error) result = "Erro: " + feeRes.error;
                                        else if (feeRes.type === 'fixed') {
                                            result = `VALOR DO FRETE: R$ ${feeRes.fee.toFixed(2)}`;
                                        } else {
                                            result = `VALOR DO FRETE (APP): R$ ${feeRes.estimated.toFixed(2)}`;
                                        }
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
                                            result = { success: true, referenceCode: res.data.id.slice(-5).toUpperCase(), calendarEvent: !!res.data.calendarEventId };
                                        } catch (err) {
                                            result = { success: false, error: err.response?.data?.error || err.message };
                                        }
                                    }
                                    else if (functionName === "update_order") {
                                        const axios = require('axios');
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

                        let replyText = responseMessage.content;
                        if (replyText) {
                            // LIMPEZA AGRESSIVA DE FORMATAÇÃO
                            replyText = replyText.replace(/\*/g, ''); // Remove negrito/itálico
                            replyText = replyText.replace(/#/g, '');  // Remove hashtags
                            replyText = replyText.replace(/•/g, '-'); // Troca bullet por traço
                            replyText = replyText.replace(/·/g, '-'); // Troca bullet médio por traço
                            replyText = replyText.replace(/·/g, '-'); // Repetindo para garantir
                            replyText = replyText.replace(/_/g, '');  // Remove underlines
                            replyText = replyText.replace(/`/g, '');  // Remove backticks
                            replyText = replyText.trim();
                        }


                        // SIMULATE HUMAN TYPING
                        const typingSpeed = 50; // ms per character
                        const delay = Math.min(Math.max(replyText.length * typingSpeed, 2000), 10000);

                        await sock.sendPresenceUpdate('composing', jid);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        await sock.sendPresenceUpdate('paused', jid);

                        await sendRichMessage(sock, jid, replyText);
                        console.log(`[AI] Resposta enviada com sucesso para ${jid}`);
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
        gcalRefreshToken: config.gcalRefreshToken
    });
});

app.post('/config/keys', async (req, res) => {
    const {
        openai, claude, activeModel, gcalSyncHour,
        businessName, businessAddress, businessLocation,
        dailyMaxOrders, dailyDeliveryItems, managerJid,
        deliveryJid, reportEnabled, reportHour,
        googleApiKey, deliveryRules, gcalCalendarId
    } = req.body;

    const currentConfig = await prisma.setting.findUnique({ where: { id: 'global' } });
    
    const updateData = {
        openaiKey: openai,
        claudeKey: claude,
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

// ─── MOTOR DE FLUXOS (EXECUÇÃO) ─────────────────────────────────────────────

async function handleFlows(sock, instanceId, jid, text, rawMsg) {
    try {
        // 0. Se a IA estiver ligada para este chat, não disparamos fluxos automáticos (Handover)
        const chat = await prisma.chat.findUnique({
            where: { instanceId_jid: { instanceId, jid } },
            select: { aiEnabled: true }
        });
        if (chat?.aiEnabled) {
            return false;
        }

        // 1. Verificar se é uma resposta de botão para continuar um fluxo
        const buttonResponse = rawMsg.message?.buttonsResponseMessage ||
            rawMsg.message?.templateButtonReplyMessage ||
            rawMsg.message?.interactiveResponseMessage ||
            rawMsg.message?.listResponseMessage;

        const state = await prisma.flowState.findUnique({ where: { instanceId_jid: { instanceId, jid } } });

        // Se o cliente responder, cancelamos qualquer espera pendente (Follow-up cancelado por interação)
        if (state?.resumeAt) {
            await prisma.flowState.update({
                where: { id: state.id },
                data: { resumeAt: null }
            }).catch(() => { });
        }

        // Expiração de estado: se o estado for mais antigo que 60 minutos, vamos ignorá-lo e permitir novo gatilho
        if (state) {
            const lastUpdate = new Date(state.updatedAt).getTime();
            const now = new Date().getTime();
            const diffMinutes = (now - lastUpdate) / (1000 * 60);

            if (diffMinutes > 60) {
                await prisma.flowState.delete({ where: { id: state.id } }).catch(() => { });
                // Chama novamente para tentar disparar gatilhos iniciais agora que o estado foi limpo
                return await handleFlows(sock, instanceId, jid, text, rawMsg);
            }
        }

        if (buttonResponse || text) {
            let selectedId = null;

            if (buttonResponse) {
                selectedId = buttonResponse.selectedButtonId ||
                    buttonResponse.selectedId ||
                    (buttonResponse.nativeFlowResponseMessage?.paramsJson ? JSON.parse(buttonResponse.nativeFlowResponseMessage.paramsJson).id : null) ||
                    buttonResponse.singleSelectReply?.selectedRowId;
            } else {
                // Se for texto, tentamos casar com o label de alguma opção do nó atual
                selectedId = text.trim();
            }

            if (state) {
                const flow = await prisma.flow.findUnique({ where: { id: state.flowId } });
                if (flow && flow.status === 'Ativo') {
                    const flowData = JSON.parse(flow.data);
                    const currentNode = flowData.nodes.find(n => n.id === state.currentNodeId);

                    // LÓGICA DE ESPERA: Se o usuário interagir durante uma espera, voltamos 1 nó
                    if (currentNode?.type === 'waitNode') {
                        const edges = flowData.edges || [];
                        const incomingEdge = edges.find(e => e.target === currentNode.id);

                        if (incomingEdge) {
                            // Limpa o agendamento de espera pois houve interação
                            await prisma.flowState.updateMany({
                                where: { instanceId, jid },
                                data: { resumeAt: null }
                            });
                            // Executa o nó que deu origem à espera (geralmente a IA)
                            await runFlowNode(sock, instanceId, jid, flow, incomingEdge.source);
                            return true;
                        }
                    }

                    // Se não for espera, apenas continua de onde parou
                    await runFlowNode(sock, instanceId, jid, flow, state.currentNodeId);
                    return true;
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

                    await runFlowNode(sock, instanceId, jid, flow, triggerNode.id);
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

async function runFlowNode(sock, instanceId, jid, flow, nodeId, sourceHandle = null) {
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

                await sock.sendPresenceUpdate('composing', jid).catch(() => { });
                console.log(`[Flow AI] Ativando Agente para ${jid}...`);

                // Busca o histórico diretamente via Prisma
                const history = await prisma.message.findMany({
                    where: { instanceId, jid },
                    orderBy: { timestamp: 'desc' },
                    take: 10
                });

                const settings = await prisma.setting.findUnique({ where: { id: 'global' } });

                const instance = await prisma.instance.findUnique({ where: { id: instanceId } });
                const kb = JSON.parse(instance?.knowledge || '[]');
                const kbContext = kb.length > 0
                    ? "\n\n--- BASE DE CONHECIMENTO OFICIAL ---\n" + kb.map(k => `DÚVIDA: ${k.q}\nRESPOSTA: ${k.a}`).join('\n---\n')
                    : "";

                const allProducts = await prisma.product.findMany();
                let catalogContext = "\n\n--- CARDÁPIO: PRONTA ENTREGA (Delivery/Para comer agora) ---\n";
                const deliveryItems = allProducts.filter(p => p.type === 'delivery');
                const orderItems = allProducts.filter(p => p.type !== 'delivery');

                if (deliveryItems.length === 0) {
                    catalogContext += "(Sem itens de pronta entrega hoje)\n";
                } else {
                    deliveryItems.forEach(p => {
                        const vars = typeof p.variations === 'string' ? JSON.parse(p.variations || '[]') : (p.variations || []);
                        
                        let prices = vars.length > 0 ? vars.map(v => v.price) : [p.price];
                        const minP = Math.min(...prices);
                        const maxP = Math.max(...prices);
                        const priceRange = minP === maxP ? `R$${minP.toFixed(2)}` : `R$${minP.toFixed(2)} a R$${maxP.toFixed(2)}`;

                        let totalStock = p.stock;
                        if (vars.length > 0) {
                            totalStock = vars.reduce((acc, v) => {
                                const subStock = v.subItems?.reduce((sAcc, si) => sAcc + (si.stock || 0), 0) || 0;
                                return acc + (v.stock || 0) + subStock;
                            }, 0);
                        }

                        if (totalStock > 0) {
                            const variationsInfo = vars.map(v => `   - ${v.name}: ${v.description || 'Sem descrição'}`).join('\n');
                            catalogContext += `- *${p.name}* (${priceRange}): ${p.description || ''}\n${variationsInfo}\n`;
                        } else {
                            catalogContext += `- *${p.name}*: (ESGOTADO NO MOMENTO)\n`;
                        }
                    });
                }

                catalogContext += "\n--- CARDÁPIO: ENCOMENDAS (Para outro dia/Festa) ---\n";
                if (orderItems.length === 0) {
                    catalogContext += "(Sem itens para encomenda)\n";
                } else {
                    orderItems.forEach(p => {
                        const vars = typeof p.variations === 'string' ? JSON.parse(p.variations || '[]') : (p.variations || []);
                        if (vars.length > 0) {
                            const variationsStr = vars.map(v => `${v.name} (R$${v.price})`).join(', ');
                            catalogContext += `- *${p.name}*: Opções: ${variationsStr}.\n`;
                        } else {
                            catalogContext += `- *${p.name}*: R$${p.price.toFixed(2)}. ${p.description || ''}\n`;
                        }
                    });
                }

                const lastOrder = await prisma.order.findFirst({
                    where: { clientJid: jid },
                    orderBy: { createdAt: 'desc' }
                });
                let orderContext = "";
                if (lastOrder) {
                    orderContext = `\n--- ESTADO DO PEDIDO ATUAL ---\nProduto: ${lastOrder.product}\nData/Hora: ${lastOrder.scheduledDate} ${lastOrder.scheduledTime}\nPagamento: ${lastOrder.paymentMethod}\n`;
                }

                const diasSemana = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
                const hoje = new Date();
                const year = hoje.getFullYear();
                let daysList = "";
                const lastDate = new Date(year, hoje.getMonth() + 1, 0).getDate();
                for (let d = 1; d <= lastDate; d++) {
                    const dateObj = new Date(year, hoje.getMonth(), d);
                    daysList += `${d}/${hoje.getMonth() + 1}: ${diasSemana[dateObj.getDay()]}, `;
                }

                const slots = await prisma.availableSlot.findMany();
                const diasSiglas = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
                let hoursContext = slots.length > 0 
                    ? slots.map(s => `${diasSiglas[s.dayOfWeek]}: ${s.startTime}-${s.endTime}`).join(', ')
                    : "Terça a Domingo: 09:00 às 20:00 (Segunda fechado)";

                const timeContext = `\n\n--- TABELA DE DATAS (${year}) ---\n${daysList}\n\n--- CONTEXTO ---\nHoje: ${diasSemana[hoje.getDay()]}, ${hoje.toLocaleDateString('pt-BR')}\nHORÁRIO DE FUNCIONAMENTO: ${hoursContext}\n`;

                const diasCompletos = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
                const hoursContextDetailed = diasCompletos.map((dia, index) => {
                    const slot = slots.find(s => s.dayOfWeek === index);
                    return slot ? `${dia}: ${slot.startTime} às ${slot.endTime}` : `${dia}: FECHADO`;
                }).join('\n');

                const flowAiContext = `\n\n--- REGRAS DE ATENDIMENTO (PRIORIDADE MÁXIMA) ---\n` +
                    `1. NÃO INVENTE: Nunca preencha a forma de pagamento ou endereço sem perguntar ao cliente.\n` +
                    `2. ESTOQUE: Se o item estiver (ESGOTADO), peça desculpas e ofereça outro.\n` +
                    `3. HORÁRIO: Hoje é ${diasCompletos[hoje.getDay()]}. Horário: ${slots.find(s => s.dayOfWeek === hoje.getDay())?.startTime || '09:00'} às ${slots.find(s => s.dayOfWeek === hoje.getDay())?.endTime || '20:00'}.\n` +
                    `4. HUMANO: Não use listas. Use texto corrido e *Negrito* para nomes de produtos.\n` +
                    `5. QUERO AGORA: Se o cliente quiser 'pra já', peça o endereço para o Uber imediatamente.\n\n` +
                    `--- HORÁRIOS DA SEMANA ---\n${hoursContextDetailed}\n` +
                    kbContext + catalogContext + orderContext;



                const messages = [
                    { role: 'system', content: (node.data.prompt || instance?.botPrompt || 'Você é um assistente prestativa.') + flowAiContext },
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
                    }
                ];

                console.log("\n--- DEBUG SYSTEM PROMPT (FLOW) ---\n", messages[0].content, "\n-----------------------------------\n");

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
                            // Usa a função centralizada, passando o adminPhone do nó como prioridade máxima
                            result = await executeChamarGerente(reason, jid, null, settings, node.data.adminPhone, sock, prisma, instanceId);
                        }

                        messages.push({
                            tool_call_id: toolCall.id,
                            role: "tool",
                            name: functionName,
                            content: JSON.stringify(result),
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
                    io.emit('chat_update', { instanceId, jid, aiEnabled: true, inFlow: false });
                    return; // Encerra o fluxo aqui
                }
                break;
            }
            case 'tagNode': {
                const tags = node.data.tags?.split(',').map(t => t.trim()) || [];
                // Lógica de tag (opcional, implementar no DB se precisar)
                break;
            }
            case 'notifyNode': {
                let adminPhone = node.data.phone || process.env.MANAGER_PHONE;
                if (adminPhone) {
                    // Remove tudo que não for número (ex: +, -, espaços)
                    const cleanPhone = adminPhone.replace(/\D/g, '');
                    const adminJid = adminPhone.includes('@') ? adminPhone : `${cleanPhone}@s.whatsapp.net`;

                    console.log(`[Flow Notify] Enviando alerta para: ${adminJid}`);

                    // Salva o administrador na conversa para persistência (Handover inteligente)
                    await prisma.chat.update({
                        where: { instanceId_jid: { instanceId, jid } },
                        data: { adminJid: cleanPhone }
                    }).catch(() => { });

                    // Busca o nome do usuário para enviar um alerta amigável
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
                await runFlowNode(sock, instanceId, jid, flow, edge.target, edge.sourceHandle);
            }
        } else {
            console.log(`[Flow Debug] Fluxo finalizado para ${jid}.`);
            await prisma.flowState.deleteMany({ where: { instanceId, jid } }).catch(() => { });
            io.emit('chat_update', { instanceId, jid, inFlow: false });
        }

    } catch (err) {
        console.error(`[Flow Error] Falha ao processar nó ${nodeId}:`, err.message);
    }
}

// Monitor de Esperas do Fluxo (Follow-up)
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
            if (!sock) {
                console.warn(`[Flow Cron] Sessão ${state.instanceId} não encontrada para retomar ${state.jid}`);
                continue;
            }

            const flow = await prisma.flow.findUnique({ where: { id: state.flowId } });
            if (!flow || flow.status !== 'Ativo') continue;

            // Limpa o resumeAt antes de continuar para evitar loop
            await prisma.flowState.update({
                where: { id: state.id },
                data: { resumeAt: null }
            });

            const flowData = JSON.parse(flow.data);
            const outgoingEdges = (flowData.edges || []).filter(e => e.source === state.currentNodeId);

            for (const edge of outgoingEdges) {
                await runFlowNode(sock, state.instanceId, state.jid, flow, edge.target, edge.sourceHandle);
            }
        }
    } catch (err) {
        console.error('[Flow Cron Error]:', err.message);
    }
}, 10000);

// ─── AGENTE DE ADMINISTRADOR (LILY EXECUTIVE) ──────────────────────────
async function handleAdminAgent(sock, instanceId, jid, text, settings) {
    try {
        const ai = await getOpenAI();
        if (!ai) return;

        // Contexto de Produtos e Horários
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
   - FORMATO JSON OBRIGATÓRIO: { name: 'Nome', price: 0, stock: 0, description: '...', subItems: [] }
   - SEMPRE inclua subItems: [] se não houver sabores específicos.
   - Use type='delivery' para Pronta Entrega e type='encomenda' para Agendados.
   - SEJA CRIATIVA: Se ele não der descrição, crie uma bem persuasiva.
4. Se ele mandar apenas um "Oi", responda com carinho.
5. IMPORTANTE: Você recebe áudios transcritos automaticamente. Se o usuário falar por áudio, o sistema converterá em texto para você. Processe como se fosse um comando escrito.
6. Confirme suas ações de forma curta, fofa e eficiente.`;

        // Busca Histórico de Conversa (Memória)
        const history = await prisma.message.findMany({
            where: { instanceId, jid },
            orderBy: { timestamp: 'desc' },
            take: 30
        });

        const messages = [
            { role: "system", content: systemPrompt },
            ...history.reverse().map(m => ({
                role: m.fromMe ? "assistant" : "user",
                content: m.text
            })),
            { role: "user", content: text } // Mensagem atual
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
                                notes: { type: "string" }
                            },
                            required: ["orderId"]
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
                                    description: "JSON Array: [{name: 'M', price: 50, stock: 10, subItems: [{name: 'Nutella', stock: 5}]}]" 
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
        console.log(`[Admin Agent] IA respondeu. Tool calls: ${msg.tool_calls?.length || 0}`);
        if (msg.content) {
            await sock.sendMessage(jid, { text: msg.content });
        }

        if (msg.tool_calls) {
            console.log(`[Admin Agent] Ferramentas chamadas: ${msg.tool_calls.map(c => c.function.name).join(', ')}`);
            for (const call of msg.tool_calls) {
                const axios = require('axios');
                if (call.function.name === "create_order") {
                    const args = JSON.parse(call.function.arguments);
                    try {
                        const res = await axios.post('http://localhost:3001/orders', { ...args, instanceId: instanceId });
                        const ref = res.data.id.slice(-5).toUpperCase();
                        await sock.sendMessage(jid, { text: `✅ *Agendado com sucesso!*\n\n👤 *Cliente:* ${args.clientName}\n🎂 *Item:* ${args.product} ${args.variation || ''}\n📅 *Data:* ${args.scheduledDate}\n⏰ *Hora:* ${args.scheduledTime}\n🆔 *Ref:* #${ref}` });
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
                } else if (call.function.name === "post_status") {
                    const args = JSON.parse(call.function.arguments);
                    console.log(`[Admin Agent] Tentando postar status. AssetId: ${args.assetId}`);
                    try {
                        // Sem foto: posta texto puro
                        if (!args.assetId || args.assetId === 'none') {
                            await sock.sendMessage('status@broadcast', { text: args.caption });
                            await sock.sendMessage(jid, { text: `✅ *Status de texto publicado!* ✨\n\n"${args.caption}"` });
                            continue;
                        }

                        const asset = await prisma.marketingAsset.findUnique({ where: { id: args.assetId } });
                        if (!asset) {
                            console.log(`[Admin Agent] Asset não encontrado: ${args.assetId}. Postando como texto.`);
                            await sock.sendMessage('status@broadcast', { text: args.caption });
                            await sock.sendMessage(jid, { text: `⚠️ Foto não encontrada na galeria. Postei como *texto* no status:\n\n"${args.caption}"` });
                            continue;
                        }

                        const fullPath = path.join(__dirname, asset.path);
                        console.log(`[Admin Agent] Imagem: ${fullPath} | Existe: ${fs.existsSync(fullPath)}`);

                        if (!fs.existsSync(fullPath)) {
                            await sock.sendMessage('status@broadcast', { text: args.caption });
                            await sock.sendMessage(jid, { text: `⚠️ Arquivo não encontrado no servidor. Postei como *texto* no status.` });
                            continue;
                        }

                        const imageBuffer = fs.readFileSync(fullPath);
                        console.log(`[Admin Agent] Postando status com imagem "${asset.name}" (${imageBuffer.length} bytes)...`);

                        await sock.sendMessage('status@broadcast', {
                            image: imageBuffer,
                            caption: args.caption
                        });

                        console.log(`[Admin Agent] Status postado com sucesso!`);
                        await sock.sendMessage(jid, { text: `✅ *Status publicado!* ✨\n\n📸 Foto: "${asset.name}"\n💬 Legenda: "${args.caption}"` });
                    } catch (err) {
                        console.error(`[Admin Agent] Erro ao postar status:`, err.message);
                        await sock.sendMessage(jid, { text: `❌ *Erro ao postar status:* ${err.message}` });
                    }
                } else if (call.function.name === "manage_products") {
                    const args = JSON.parse(call.function.arguments);
                    console.log(`[Admin Agent] Gerenciando produto:`, args);
                    try {
                        if (args.action === "create") {
                            // Verifica se já existe um produto com nome similar
                            const existing = await prisma.product.findFirst({
                                where: { name: { contains: args.name } }
                            });

                            if (existing) {
                                await sock.sendMessage(jid, { text: `⚠️ *Atenção:* Já temos um produto chamado "${existing.name}" cadastrado. Você deseja que eu *edite* este item ou prefere cadastrar com um nome diferente?` });
                                console.log(`[Admin Agent] Bloqueio de duplicidade: ${args.name} já existe.`);
                                continue;
                            }

                            let finalVariations = args.variations || "[]";
                            
                            // Lógica inteligente de LIMPEZA para Variações (se houver)
                            if (finalVariations && finalVariations !== '[]' && typeof finalVariations === 'string') {
                                try {
                                    let incomingVars = JSON.parse(finalVariations);
                                    const cleanVars = (vars) => vars.map(v => ({
                                        name: v.name || "Padrão",
                                        price: parseFloat(v.price) || 0,
                                        stock: parseInt(v.stock) || 0,
                                        description: v.description || "",
                                        subItems: (v.subItems || []).filter(si => si.name && si.name.trim() !== "")
                                    }));
                                    finalVariations = JSON.stringify(cleanVars(incomingVars));
                                } catch (e) {
                                    console.error("[Admin Agent] Erro ao limpar variações:", e.message);
                                }
                            }

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
                            await sock.sendMessage(jid, { text: `✅ *Produto cadastrado!* ✨\n\n🎂 *Item:* ${product.name}\n💰 *Preço:* R$ ${product.price.toFixed(2)}\n📦 *Estoque:* ${product.stock}` });
                        } else {
                            const existing = await prisma.product.findFirst({
                                where: { name: { contains: args.name } }
                            });
                            if (!existing) {
                                await sock.sendMessage(jid, { text: `❌ *Erro:* Não encontrei o produto "${args.name}" para atualizar.` });
                                continue;
                            }
                            let newVariations = args.variations;
                            
                            // Lógica inteligente de Merge e LIMPEZA para Variações
                            if (newVariations && typeof newVariations === 'string') {
                                try {
                                    let incomingVars = JSON.parse(newVariations);
                                    let currentVars = existing ? JSON.parse(existing.variations || '[]') : [];

                                    // Função para limpar variações (remover lixo como {"name":"","stock":null})
                                    const cleanVars = (vars) => vars.map(v => ({
                                        name: v.name || "Padrão",
                                        price: parseFloat(v.price) || 0,
                                        stock: parseInt(v.stock) || 0,
                                        description: v.description || "",
                                        subItems: (v.subItems || []).filter(si => si.name && si.name.trim() !== "")
                                    }));

                                    if (existing) {
                                        // Merge se estiver editando
                                        incomingVars.forEach(iv => {
                                            let idx = currentVars.findIndex(cv => cv.name.toLowerCase() === iv.name.toLowerCase());
                                            if (idx > -1) {
                                                currentVars[idx] = { ...currentVars[idx], ...iv };
                                            } else {
                                                currentVars.push(iv);
                                            }
                                        });
                                        newVariations = JSON.stringify(cleanVars(currentVars));
                                    } else {
                                        // Apenas limpeza se for criação nova
                                        newVariations = JSON.stringify(cleanVars(incomingVars));
                                    }
                                } catch (e) {
                                    console.error("[Admin Agent] Erro ao processar variações:", e.message);
                                }
                            }

                            const updated = await prisma.product.update({
                                where: { id: existing.id },
                                data: {
                                    price: args.price !== undefined ? args.price : existing.price,
                                    stock: args.stock !== undefined ? args.stock : existing.stock,
                                    description: args.description !== undefined ? args.description : existing.description,
                                    variations: newVariations !== undefined ? newVariations : existing.variations,
                                    type: args.type !== undefined ? args.type : existing.type
                                }
                            });
                            await sock.sendMessage(jid, { text: `✅ *Produto atualizado!* ✨\n\n🎂 *Item:* ${updated.name}\n💰 *Preço:* R$ ${updated.price.toFixed(2)}\n📦 *Status:* Alterações gravadas com sucesso!` });
                        }
                    } catch (err) {
                        console.error(`[Admin Agent] Erro ao gerenciar produtos:`, err.message);
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
