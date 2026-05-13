require('dotenv').config();
const { google } = require('googleapis');
const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, makeInMemoryStore } = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const OpenAI = require('openai');
const fs = require('fs');
const prisma = require('./lib/prisma');
const { calculateFee } = require('./lib/maps');
const { getStoreStatus, sendRichMessage, formatProduct } = require('./lib/utils');
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

// Configuração do Multer para Áudios Temporários
const audioStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = 'assets/temp';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '.ogg');
    }
});
const uploadAudio = multer({ storage: audioStorage });
 
const productStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = 'assets/products';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'product-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const uploadProduct = multer({ storage: productStorage });


// Prisma singleton is now loaded from lib/prisma.js

const {
    getSettings,
    invalidateSettingsCache
} = require('./lib/cache');

const { router: ordersRouter, setupCronJobs, checkAvailability, updateCalendarEvent } = require('./routes/orders');
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});
app.set('io', io); // Disponibiliza o IO para as rotas
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
app.use('/auth', require('./routes/auth'));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
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
                    window.location.href = '${process.env.FRONTEND_URL || 'http://157.230.239.80:5173'}/settings';
                }
            </script>
        `);
    }
    res.send('Zapfly Backend is running!');
});

// ─── WEBHOOK MERCADO PAGO ───────────────────────────────────────────────
const processingPayments = new Set();

app.post('/mercadopago/webhook', async (req, res) => {
    try {
        const { type, data } = req.body;
        const paymentId = data?.id || req.query.id;

        if ((type === 'payment' || req.query.topic === 'payment') && paymentId) {
            if (processingPayments.has(paymentId)) return res.sendStatus(200);
            processingPayments.add(paymentId);

            try {
                // Tenta encontrar o pedido pelo external_reference ou paymentId
                const externalReference = req.body.external_reference || req.query.external_reference;
                const order = await prisma.order.findFirst({
                    where: { OR: [{ id: paymentId }, { id: externalReference }] }
                });

                if (!order) {
                    console.error(`[MP Webhook] Pedido não encontrado para paymentId ${paymentId}`);
                    return res.sendStatus(200);
                }

                const userId = order.userId;
                const settings = await getSettings(userId);
                if (!settings?.mercadopagoToken) return res.sendStatus(200);

                const client = new MercadoPagoConfig({ accessToken: settings.mercadopagoToken });
                const payment = new MercadoPagoPayment(client);

                const p = await payment.get({ id: paymentId });
                if (p.status === 'approved') {
                    if (order.paymentStatus !== 'confirmed') {
                        const updatedOrder = await prisma.order.update({
                            where: { id: order.id },
                            data: { status: 'pending', paymentStatus: 'confirmed' }
                        });

                        io.emit('order_confirmed', updatedOrder);
                        io.emit('new_order_pending', { orderId: updatedOrder.id, userId: updatedOrder.userId });

                        await updateCalendarEvent(updatedOrder).catch(e => console.error('[GCal Sync Error]', e.message));

                        if (settings?.managerJid) {
                            const sock = sessions.get(updatedOrder.instanceId);
                            if (sock) {
                                const orderIdShort = updatedOrder.id.slice(-4).toUpperCase();
                                const aviso = `💰 *PAGAMENTO APROVADO!* (#${orderIdShort}) 💰\n\n👤 *Cliente:* ${updatedOrder.clientName}\n🎂 *Pedido:* ${updatedOrder.product}\n\nO pedido já está na aba *PENDENTES* do seu painel. ✨`;
                                await sock.sendMessage(settings.managerJid.includes('@') ? settings.managerJid : settings.managerJid + '@s.whatsapp.net', { text: aviso }).catch(() => { });
                            }
                        }
                    }
                }
            } finally {
                processingPayments.delete(paymentId);
            }
        }
        res.sendStatus(200);
    } catch (err) {
        console.error('[MercadoPago Webhook Error]', err.message);
        res.sendStatus(200);
    }
});

app.use('/assets', express.static(path.join(__dirname, 'assets')));

// ─── ROTAS — MARKETING ASSETS (STORIES) ──────────────────────────────────
// ─── ROTAS — MARKETING ASSETS (STORIES) ──────────────────────────────────
app.get('/marketing-assets', authenticate, async (req, res) => {
    try {
        const assets = await prisma.marketingAsset.findMany({
            where: { userId: req.user.id },
            orderBy: { createdAt: 'desc' }
        });
        res.json(assets);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/marketing-assets', authenticate, uploadMarketing.single('file'), async (req, res) => {
    try {
        const { name } = req.body;
        const asset = await prisma.marketingAsset.create({
            data: {
                userId: req.user.id,
                name: name || 'Sem nome',
                path: `/assets/marketing/${req.file.filename}`
            }
        });
        res.json(asset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/marketing-assets/:id', authenticate, async (req, res) => {
    try {
        const asset = await prisma.marketingAsset.findFirst({
            where: { id: req.params.id, userId: req.user.id }
        });
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

const { authenticate } = require('./middleware/auth');

// Inicia o fluxo OAuth — redireciona para o consent screen do Google
app.get('/auth/google', authenticate, async (req, res) => {
    const oauth2Client = getOAuth2Client(req);
    const origin = req.get('referer') || `http://${req.get('host')}`;
    if (!oauth2Client) {
        return res.redirect(`${origin.split('?')[0]}?gcal_error=missing_env_credentials`);
    }
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: GCAL_SCOPES,
        prompt: 'consent',
        state: req.user.id // Passa o userId no state para recuperar no callback
    });
    res.redirect(url);
});

// Callback do Google com o código de autorização
app.get('/auth/google/callback', async (req, res) => {
    const { code, error, state: userId } = req.query;
    const origin = req.get('referer') || `http://${req.get('host')}`;
    if (error) return res.redirect(`${origin.split('?')[0]}?gcal_error=${error}`);

    try {
        const oauth2Client = getOAuth2Client(req);
        const { tokens } = await oauth2Client.getToken(code);

        const updateData = {
            gcalAccessToken: tokens.access_token,
            gcalTokenExpiry: tokens.expiry_date?.toString(),
            gcalEnabled: true,
        };

        if (tokens.refresh_token) {
            updateData.gcalRefreshToken = tokens.refresh_token;
        }

        await prisma.setting.upsert({
            where: { userId },
            update: updateData,
            create: { userId, ...updateData },
        });

        res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/settings?gcal_success=1`);
    } catch (e) {
        console.error('[GCal OAuth]', e.message);
        res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/settings?gcal_error=token_exchange_failed`);
    }
});

// Status da conexão com o Google Calendar
app.get('/auth/google/status', authenticate, async (req, res) => {
    const userId = req.user.id;
    const settings = await getSettings(userId);
    const connected = !!(settings?.gcalRefreshToken);
    const hasCredentials = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    res.json({ connected, calendarId: settings?.gcalCalendarId, hasCredentials });
});

// Lista os calendários disponíveis na conta conectada
app.get('/auth/google/calendars', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const settings = await getSettings(userId);
        if (!settings?.gcalRefreshToken) return res.status(401).json({ error: 'Não conectado' });

        const oauth2Client = getOAuth2Client(req);
        oauth2Client.setCredentials({ refresh_token: settings.gcalRefreshToken, access_token: settings.gcalAccessToken });
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        const list = await calendar.calendarList.list(    await prisma.setting.update({ where: { userId }, data: { gcalCalendarId: calendarId } });
    res.json({ success: true });
});

async function initInstance(instanceId) {
    const instance = await prisma.instance.findUnique({ where: { id: instanceId } });
    if (!instance) return;
    const userId = instance.userId;

    const sessionDir = path.join(__dirname, 'sessions', instanceId);
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();
    const store = makeInMemoryStore({ logger: pino({ level: 'silent' }) });

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: ['ZapFly AI', 'Chrome', '1.0.0'],
        logger: pino({ level: 'silent' })
    });

    sessions.set(instanceId, sock);
    store.bind(sock.ev);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) io.emit('qr', { instanceId, qr });
        if (connection === 'open') {
            await prisma.instance.update({ where: { id: instanceId }, data: { status: 'connected' } });
            io.emit('connection_update', { instanceId, status: 'connected' });
        } else if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) initInstance(instanceId);
            else {
                await prisma.instance.update({ where: { id: instanceId }, data: { status: 'disconnected' } });
                io.emit('connection_update', { instanceId, status: 'disconnected' });
            }
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const jid = msg.key.remoteJid;
        if (jid === 'status@broadcast' || jid.includes('@g.us')) return;

        let text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || "";

        try {
            // Persistência da mensagem
            await prisma.chat.upsert({
                where: { instanceId_jid: { instanceId, jid } },
                update: { lastMsg: text, updatedAt: new Date() },
                create: { instanceId, jid, name: msg.pushName, lastMsg: text }
            });
            await prisma.message.create({
                data: { msgId: msg.key.id, instanceId, jid, text, fromMe: false, timestamp: new Date() }
            });

            const settings = await getSettings(userId);
            
            // 1. Verificar Fluxos
            const inFlow = await handleFlows(sock, instanceId, jid, text, msg, buildLilyPrompt, getOpenAI, executeChamarGerente, settings, msg.pushName, [], userId);
            if (inFlow) return;

            // 2. IA Agent
            const currentChat = await prisma.chat.findUnique({ where: { instanceId_jid: { instanceId, jid } } });
            if (currentChat?.aiEnabled) {
                if (aiDebounceTimers[jid]) clearTimeout(aiDebounceTimers[jid]);
                aiDebounceTimers[jid] = setTimeout(async () => {
                    const ai = await getOpenAI(userId);
                    if (!ai) return;

                    const storeInfo = await getStoreStatus(userId);
                    const history = await prisma.message.findMany({ where: { instanceId, jid }, take: 10, orderBy: { timestamp: 'desc' } });
                    const formattedHistory = history.reverse().map(m => `${m.fromMe ? 'Lily' : 'Cliente'}: ${m.text}`).join('\n');
                    const prompt = await buildLilyPrompt(instanceId, jid, formattedHistory, storeInfo, msg.pushName, userId);

                    const response = await ai.chat.completions.create({
                        model: MODEL_MAP[settings?.activeModel] || 'gpt-4o-mini',
                        messages: [{ role: 'system', content: prompt }, { role: 'user', content: text }],
                        tools: [
                            { type: "function", function: { name: "create_order", parameters: { type: "object", properties: { product: { type: "string" }, scheduledDate: { type: "string" }, scheduledTime: { type: "string" }, clientName: { type: "string" } }, required: ["product", "scheduledDate", "scheduledTime", "clientName"] } } }
                        ]
                    });

                    const aiMsg = response.choices[0].message;
                    if (aiMsg.content) await sock.sendMessage(jid, { text: aiMsg.content });
                    
                    if (aiMsg.tool_calls) {
                        const internalSecret = process.env.INTERNAL_TOKEN || 'zapfly-internal-bypass-key';
                        for (const call of aiMsg.tool_calls) {
                            if (call.function.name === "create_order") {
                                const args = JSON.parse(call.function.arguments);
                                const res = await axios.post('http://127.0.0.1:3001/orders', args, {
                                    headers: { 'x-internal-token': internalSecret, 'x-user-id': userId }
                                });
                                await sock.sendMessage(jid, { text: `✅ Pedido #${res.data.id.slice(-5).toUpperCase()} criado!` });
                            }
                        }
                    }
                }, 3000);
            }
        } catch (err) { console.error('[Message Upsert Error]', err); }
    });
}
�ão de ferramentas...
                                     // Por brevidade e para garantir o userId, as ferramentas chamadas usarão userId.
                                 }
                             }
                        }
                    } catch (err) { console.error("[AI] Error:", err); }
                }, 3000);
            } catch (err) { console.error("[Upsert] Error:", err); }
        }
    });
}
     }
                                                pendingCatalogMessage = catalogText;
                                                result = "CATÁLOGO DE ENCOMENDAS ENVIADO PARA MEMÓRIA. Responda ao cliente usando o formato: [Intro] --- [CTA].";
                                            }
                                            else if (functionName === "check_availability") {
                                                result = await checkAvailability(args.date, args.time, args.type || 'order');
                                            }
                                            else if (functionName === "get_delivery_fee") {
                                                const feeRes = await calculateFee(args.address);
                                                if (feeRes.error) result = "Erro: " + feeRes.error;
                                                else {
                                                    const rules = JSON.parse(settings?.deliveryRules || '[]');
                                                    const maxCashKm = rules.length > 0 ? parseFloat(rules[0].maxKm) : 2.0;
                                                    const canCash = parseFloat(feeRes.distance) <= maxCashKm;

                                                    const feeValue = feeRes.type === 'fixed' ? feeRes.fee : feeRes.estimated;
                                                    lastDeliveryFee = feeValue; // Salva para o fallback

                                                    // PERSISTÊNCIA: Salva no cadastro do cliente para evitar re-calculo caro
                                                    await prisma.customer.update({
                                                        where: { jid },
                                                        data: { address: args.address, lastDeliveryFee: feeValue }
                                                    }).catch(() => { });

                                                    const feeLabel = feeRes.type === 'fixed' ? 'VALOR DO FRETE' : 'VALOR DO FRETE (ESTIMADO)';

                                                    result = `${feeLabel}: R$ ${feeValue.toFixed(2)}. ${canCash ? 'DINHEIRO LIBERADO' : 'APENAS PIX/CARTÃO (Link)'}`;
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
                                                        result = {
                                                            success: false,
                                                            error: `BLOQUEIO: Já existe o pedido #${recentOrder.id.slice(-5).toUpperCase()} em aberto. Use 'update_order' com este código para adicionar mais produtos ou atualizar o valor total. NÃO CRIE OUTRO PEDIDO.`
                                                        };
                                                    } else {
                                                        const res = await axios.post('http://localhost:3001/orders', {
                                                            ...args,
                                                            deliveryFee: args.deliveryFee || lastDeliveryFee, // FALLBACK: Usa o último frete calculado
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
                                                        if (res.data.paymentLink) {
                                                            pendingPaymentLink = res.data.paymentLink;
                                                            result.message = "Pedido criado. SILÊNCIO ABSOLUTO NO PRÓXIMO TURNO. NÃO GERE NENHUM TEXTO, O SISTEMA ENVIARÁ O LINK.";
                                                        } else {
                                                            result.message = "Pedido criado. Informe que recebemos o pedido (Pagamento em Dinheiro) e que ele está agora aguardando a aprovação da nossa equipe. Peça para o cliente aguardar a confirmação oficial.";
                                                        }

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
                                                    const refCode = (args.orderId || "").replace('#', '').trim().toUpperCase();
                                                    const targetOrder = allOrders.find(o => {
                                                        const fullId = o.id.toUpperCase();
                                                        return fullId.endsWith(refCode) || refCode.endsWith(fullId.slice(-5));
                                                    });

                                                    if (!targetOrder) {
                                                        result = { success: false, error: `Pedido ${refCode} não encontrado entre seus pedidos ativos.` };
                                                    } else {
                                                        const updateData = {};
                                                        if (args.product) updateData.product = args.product;
                                                        if (args.quantity) updateData.quantity = args.quantity;
                                                        if (args.scheduledDate) updateData.scheduledDate = args.scheduledDate;
                                                        if (args.scheduledTime) updateData.scheduledTime = args.scheduledTime;
                                                        if (args.notes) updateData.notes = args.notes;
                                                        if (args.carrinho_itens_extras) updateData.carrinho_itens_extras = args.carrinho_itens_extras;
                                                        if (args.totalValue) updateData.totalValue = args.totalValue;

                                                        const res = await axios.patch(`http://localhost:3001/orders/${targetOrder.id}`, updateData);

                                                        result = { success: true, message: "Pedido atualizado com sucesso." };

                                                        if (res.data.paymentLink) {
                                                            pendingPaymentLink = res.data.paymentLink;
                                                            result.message = "Pedido atualizado e novo link gerado. SILÊNCIO ABSOLUTO NO PRÓXIMO TURNO. NÃO GERE NENHUM TEXTO, O SISTEMA ENVIARÁ O LINK.";
                                                        }
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
                                            else if (functionName === "solicitar_cancelamento") {
                                                const { reason } = args;
                                                const clientName = currentChat?.name || jid.split('@')[0];
                                                const alertMsg = `🚨 *SOLICITAÇÃO DE CANCELAMENTO* 🚨\n\n👤 *Cliente:* ${clientName}\n📱 *WhatsApp:* ${jid.split('@')[0]}\n📝 *Motivo:* ${reason}\n\nLily já avisou o cliente que o gerente foi notificado. Por favor, verifique o pedido no painel.`;

                                                await sock.sendMessage(settings.managerJid, { text: alertMsg });
                                                result = { success: true, message: "O gerente foi notificado sobre o seu pedido de cancelamento e entrará em contato em breve." };
                                            }
                                            else if (functionName === "get_marketing_media") {
                                                const { search } = args;
                                                const assets = await prisma.marketingAsset.findMany({
                                                    where: search ? { name: { contains: search } } : {}
                                                });
                                                result = assets.map(a => ({ id: a.id, name: a.name }));
                                            }
                                            else if (functionName === "send_marketing_media") {
                                                const { assetId, caption } = args;
                                                const asset = await prisma.marketingAsset.findUnique({ where: { id: assetId } });
                                                if (asset) {
                                                    await sock.sendMessage(jid, { image: { url: asset.path }, caption: caption || "" });
                                                    result = { success: true, message: "Imagem enviada com sucesso." };
                                                } else {
                                                    result = { success: false, error: "Imagem não encontrada." };
                                                }
                                            }
                                            else if (functionName === "post_status") {
                                                const { text, assetId } = args;
                                                if (assetId) {
                                                    const asset = await prisma.marketingAsset.findUnique({ where: { id: assetId } });
                                                    if (asset) {
                                                        await sock.sendMessage('status@broadcast', { image: { url: asset.path }, caption: text });
                                                        result = { success: true, message: "Status com imagem postado com sucesso." };
                                                    } else {
                                                        result = { success: false, error: "Imagem não encontrada para o status." };
                                                    }
                                                } else {
                                                    await sock.sendMessage('status@broadcast', { text });
                                                    result = { success: true, message: "Status de texto postado com sucesso." };
                                                }
                                            }

                                            else if (functionName === "get_delivery_catalog") {
                                                const allProducts = await prisma.product.findMany();
                                                const prods = allProducts.filter(p => p.type === 'delivery');
                                                let deliveryStr = '';
                                                prods.forEach(p => {
                                                    const vars = typeof p.variations === 'string' ? JSON.parse(p.variations || '[]') : (p.variations || []);
                                                    let line = `*${p.name}*`;
                                                    if (vars.length > 0) {
                                                        line += '\n' + vars.map(v => `   - ${v.name}: R$ ${v.price.toFixed(2)}`).join('\n');
                                                    } else {
                                                        line += ` - R$ ${p.price.toFixed(2)}`;
                                                    }
                                                    deliveryStr += line + '\n\n';
                                                });
                                                pendingCatalogMessage = deliveryStr.trim() || 'Nenhum item de pronta entrega no momento.';
                                                result = { success: true, message: "Catálogo de pronta entrega preparado. O sistema enviará o catálogo agora. SILÊNCIO ABSOLUTO." };
                                            }
                                            else if (functionName === "get_order_catalog") {
                                                const { formatProduct } = require('./lib/utils');
                                                const allProducts = await prisma.product.findMany();
                                                let catalogStr = "";
                                                allProducts.filter(p => p.type === 'encomenda').forEach(p => {
                                                    const vars = typeof p.variations === 'string' ? JSON.parse(p.variations || '[]') : (p.variations || []);
                                                    catalogStr += formatProduct(p, vars) + "\n\n";
                                                });
                                                pendingCatalogMessage = catalogStr.trim() || "Poxa, não encontrei itens no momento.";
                                                result = { success: true, message: "Catálogo de encomendas preparado. O sistema enviará o catálogo agora. SILÊNCIO ABSOLUTO." };
                                            }
                                            else if (functionName === "check_availability") {
                                                const { checkAvailability } = require('./routes/orders');
                                                result = await checkAvailability(args.date, args.time);
                                            }

                                            messages.push({
                                                tool_call_id: toolCall.id,
                                                role: "tool",
                                                name: functionName,
                                                content: JSON.stringify(result),
                                            });
                                        }

                                        if (currentToken.cancelled) return;

                                        // ─── SEQUESTRAR O FLUXO: SE GEROU LINK OU CATÁLOGO, A IA SE CALA E O SISTEMA ASSUME ───
                                        if (pendingPaymentLink) {
                                            // Balão 1: Aviso
                                            await sock.sendPresenceUpdate('composing', jid);
                                            await new Promise(r => setTimeout(r, 1200));
                                            await sock.sendPresenceUpdate('paused', jid);
                                            await sendRichMessage(sock, jid, 'Vou gerar o link do seu pagamento logo abaixo:');

                                            // Balão 2: Link
                                            await sock.sendPresenceUpdate('composing', jid);
                                            await new Promise(r => setTimeout(r, 800));
                                            await sock.sendPresenceUpdate('paused', jid);
                                            await sock.sendMessage(jid, { text: pendingPaymentLink });

                                            // Balão 3: Confirmação
                                            await sock.sendPresenceUpdate('composing', jid);
                                            await new Promise(r => setTimeout(r, 1000));
                                            await sock.sendPresenceUpdate('paused', jid);
                                            await sendRichMessage(sock, jid, 'O pedido será confirmado após o pagamento.');

                                            return; // FIM IMEDIATO: a IA não fala mais nada.
                                        }

                                        if (pendingCatalogMessage) {
                                            const isDelivery = pendingCatalogMessage.includes('pronta entrega') || !pendingCatalogMessage.includes('Bolo');

                                            // Balão 1: Intro
                                            await sock.sendPresenceUpdate('composing', jid);
                                            await new Promise(r => setTimeout(r, 1000));
                                            await sock.sendPresenceUpdate('paused', jid);
                                            await sock.sendMessage(jid, { text: isDelivery ? 'Hoje teremos os seguintes produtos de pronta entrega:' : 'Vou te mostrar nossas opções maravilhosas de bolos de encomenda:' });

                                            // Balão 2: Catálogo
                                            await sock.sendPresenceUpdate('composing', jid);
                                            await new Promise(r => setTimeout(r, Math.min(pendingCatalogMessage.length * 5, 3000)));
                                            await sock.sendPresenceUpdate('paused', jid);
                                            await sock.sendMessage(jid, { text: pendingCatalogMessage });

                                            // Balão 3: CTA
                                            await sock.sendPresenceUpdate('composing', jid);
                                            await new Promise(r => setTimeout(r, 1200));
                                            await sock.sendPresenceUpdate('paused', jid);
                                            await sock.sendMessage(jid, { text: isDelivery ? 'Qual desses posso separar para você? 😊' : 'Qual destes mais te encantou? Posso te ajudar a escolher o tamanho ideal para sua festa! 😊✨' });

                                            return; // FIM IMEDIATO
                                        }

                                        const secondResponse = await ai.chat.completions.create({
                                            model: MODEL_MAP[settings?.activeModel] || 'gpt-4o',
                                            messages,
                                        });

                                        if (currentToken.cancelled) return;
                                        let aiFinalText = secondResponse.choices[0].message.content || "";

                                        // Se houver um catálogo pendente, vamos dividir a resposta da IA em Intro e CTA usando o separador ---
                                        if (pendingCatalogMessage) {
                                            let introText = "Temos essas delícias:";
                                            let ctaText = "Qual desses posso separar para você? 😊";

                                            if (aiFinalText.includes('---')) {
                                                const parts = aiFinalText.split('---');
                                                introText = parts[0].trim();
                                                ctaText = parts[1].trim();
                                            } else {
                                                // Fallback inteligente se a IA não usar o separador
                                                const sentences = aiFinalText.split(/[.!?\n]/).filter(s => s.trim().length > 5);
                                                if (sentences.length >= 2) {
                                                    introText = sentences[0].trim() + (aiFinalText.includes(':') ? '' : ':');
                                                    ctaText = sentences[sentences.length - 1].trim();
                                                }
                                            }

                                            // Envia Intro (IA)
                                            await sendRichMessage(sock, jid, introText);

                                            // Envia Catálogo (SISTEMA)
                                            await new Promise(resolve => setTimeout(resolve, 1500));
                                            await sock.sendMessage(jid, { text: pendingCatalogMessage });

                                            // Envia CTA (IA)
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

                                let flowState = await prisma.flowState.findFirst({
                                    where: {
                                        instanceId,
                                        jid: { contains: cleanJid }
                                    }
                                });

                                if (flowState) {
                                    const flow = await prisma.flow.findUnique({ where: { id: flowState.flowId } });
                                    if (flow && flow.status === 'Ativo') {
                                        await runFlowNode(sock, instanceId, jid, flow, flowState.currentNodeId, null, buildLilyPrompt, getOpenAI, executeChamarGerente, settings, msg.pushName, combinedImages, textForFlow);
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
        try {
            if ('all' in item) {
                const deleted = await prisma.message.deleteMany({
                    where: { instanceId, clientJid: item.jid }
                });
                io.emit('messages_deleted', { instanceId, jid: item.jid, all: true });
            } else {
                for (const key of item.keys) {
                    const deleted = await prisma.message.deleteMany({
                        where: { instanceId, msgId: key.id }
                    });
                    io.emit('message_deleted', { instanceId, msgId: key.id });
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
// API Routes
app.get('/config/keys', authenticate, async (req, res) => {
    try {
        let config = await getSettings(req.user.id);
        if (!config) {
            config = await prisma.setting.create({
                data: { userId: req.user.id, activeModel: 'openai' }
            });
        }
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
            mercadopagoToken: config.mercadopagoToken,
            pixReceiverName: config.pixReceiverName,
            pixReceiverKey: config.pixReceiverKey
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/config/keys', authenticate, async (req, res) => {
    const {
        openai, claude, activeModel, gcalSyncHour,
        businessName, businessAddress, businessLocation,
        dailyMaxOrders, managerJid,
        deliveryJid, reportEnabled, reportHour,
        googleApiKey, deliveryRules, gcalCalendarId,
        mercadopagoToken, mercadopagoPublicKey,
        pixReceiverName, pixReceiverKey
    } = req.body;

    try {
        const updateData = {
            openaiKey: openai,
            claudeKey: claude,
            mercadopagoToken,
            mercadopagoPublicKey,
            activeModel,
            gcalSyncHour: parseInt(gcalSyncHour || 6),
            businessName,
            businessAddress,
            businessLocation,
            dailyMaxOrders: parseInt(dailyMaxOrders || 10),
            managerJid,
            deliveryJid,
            reportEnabled: !!reportEnabled,
            reportHour: parseInt(reportHour || 7),
            googleApiKey: googleApiKey || "",
            deliveryRules: typeof deliveryRules === 'string' ? deliveryRules : JSON.stringify(deliveryRules || []),
            gcalCalendarId: gcalCalendarId || "",
            pixReceiverName,
            pixReceiverKey
        };

        const config = await prisma.setting.upsert({
            where: { userId: req.user.id },
            update: updateData,
            create: { userId: req.user.id, ...updateData }
        });

        invalidateSettingsCache(req.user.id);
        res.json(config);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/config/slots', authenticate, async (req, res) => {
    try {
        const slots = await prisma.availableSlot.findMany({
            where: { userId: req.user.id },
            orderBy: { dayOfWeek: 'asc' }
        });
        res.json(slots);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/config/slots', authenticate, async (req, res) => {
    try {
        const { slots } = req.body;
        await prisma.availableSlot.deleteMany({ where: { userId: req.user.id } });
        const created = await prisma.availableSlot.createMany({
            data: slots.map(s => ({
                userId: req.user.id,
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
    
    // Deleta os filhos primeiro para evitar Foreign Key Constraint (Cascade)
    try {
        await prisma.message.deleteMany({ where: { instanceId: id } });
        await prisma.chat.deleteMany({ where: { instanceId: id } });
        await prisma.flowState.deleteMany({ where: { instanceId: id } });
    } catch(e) { console.error('Erro ao deletar filhos da instância:', e.message) }

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
            // Apaga para todos no WhatsApp
            await sock.sendMessage(jid, { delete: { remoteJid: jid, fromMe: true, id: msgId } });
        }

        // Remove do banco local em todos os casos (assim o histórico da IA e da tela limpam na hora)
        await prisma.message.deleteMany({ where: { instanceId: id, msgId } });
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
        // Remove do banco local as mensagens, o chat e o ESTADO DO FLUXO
        const mDel = await prisma.message.deleteMany({ where: { instanceId: id, jid } });
        const cDel = await prisma.chat.deleteMany({ where: { instanceId: id, jid } });
        const fDel = await prisma.flowState.deleteMany({ where: { instanceId: id, jid } }).catch(() => { });

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

// Rota de Upload de Imagem de Produto
app.post('/upload/product', uploadProduct.single('image'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada' });
        const imageUrl = `/assets/products/${req.file.filename}`;
        res.json({ url: imageUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/instances/:id/send-audio', uploadAudio.single('audio'), async (req, res) => {
    try {
        const { id } = req.params;
        const { jid } = req.body;
        const sock = sessions.get(id);

        if (!sock) return res.status(404).json({ error: 'Sessão não encontrada' });
        if (!jid || !req.file) return res.status(400).json({ error: 'JID e arquivo de áudio são obrigatórios' });

        let finalJid = jid.trim();
        if (!finalJid.includes('@')) {
            finalJid = finalJid.includes(':') ? finalJid.split(':')[0] + '@s.whatsapp.net' : finalJid + '@s.whatsapp.net';
        }

        const audioPath = req.file.path;

        const result = await sock.sendMessage(finalJid, {
            audio: { url: audioPath },
            mimetype: 'audio/ogg; codecs=opus',
            ptt: true
        });

        // Save outgoing message to DB
        await prisma.message.create({
            data: {
                msgId: result.key.id,
                instanceId: id,
                jid: finalJid,
                text: '🎤 Áudio',
                fromMe: true,
                timestamp: new Date(),
                status: 'sent'
            }
        });

        // Update Chat
        await prisma.chat.upsert({
            where: { instanceId_jid: { instanceId: id, jid: finalJid } },
            update: {
                lastMsg: '🎤 Áudio',
                lastMsgTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                updatedAt: new Date(),
            },
            create: {
                instanceId: id,
                jid: finalJid,
                lastMsg: '🎤 Áudio',
                lastMsgTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            }
        });

        // Clean up temp file
        fs.unlink(audioPath, (err) => {
            if (err) console.error('Erro ao apagar áudio temporário:', err);
        });

        res.json(result);
    } catch (err) {
        console.error('ERRO AO ENVIAR ÁUDIO:', err);
        res.status(500).json({ error: 'Erro ao enviar áudio: ' + err.message });
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

module.exports = { getSocket: (id) => sessions.get(id) };
