require('dotenv').config();
const { google } = require('googleapis');
const Baileys = require('@whiskeysockets/baileys');
const makeWASocket = Baileys.default || Baileys.makeWASocket;
const { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, makeInMemoryStore } = Baileys;
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
const { authenticate } = require('./middleware/auth');


// Configuraﾃｧﾃ｣o do Multer para Marketing Assets
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'assets/marketing'),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const uploadMarketing = multer({ storage });

// Configuraﾃｧﾃ｣o do Multer para ﾃ「dios Temporﾃ｡rios
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
    invalidateSettingsCache,
    getCachedInstance
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
app.use(express.json());

// Assets estﾃ｡ticos (PRIORIDADE)
app.use('/menu-assets', express.static(path.join(__dirname, 'public-menu')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/auth', require('./routes/auth'));

// --- SEO: Robots na Raiz ---
app.get('/robots.txt', (req, res) => {
    res.sendFile(path.join(__dirname, 'public-menu', 'robots.txt'));
});


// 笏€笏€笏€ CONFIGURAﾃﾃ髭S DO SITE (BRANDING) 笏€笏€笏€笏€笏€笏€笏€笏€笏€笏€笏€笏€笏€笏€笏€笏€笏€笏€笏€笏€笏€笏€笏€笏€笏€笏€笏€笏€笏€笏€笏€笏€笏€笏€笏€笏€笏€笏€笏€笏€
app.get('/settings', authenticate, async (req, res) => {
    try {
        const settings = await prisma.setting.findUnique({
            where: { userId: req.user.id }
        });
        res.json(settings || {});
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/settings', authenticate, async (req, res) => {
    try {
        const {
            businessName, logoUrl, faviconUrl,
            accentColor, buttonColor,
            accentColorOrders, buttonColorOrders,
            buttonTextColor, backgroundColor, textColor,
            seoDescription, pixelId, googleAnalyticsId, microsoftClarityId
        } = req.body;

        const data = {
            businessName, logoUrl, faviconUrl,
            accentColor, buttonColor,
            accentColorOrders, buttonColorOrders,
            buttonTextColor, backgroundColor, textColor,
            seoDescription, pixelId, googleAnalyticsId, microsoftClarityId
        };

        console.log('[DEBUG] Tentando salvar configurações para o usuário:', req.user.id);
        console.log('[DEBUG] Dados do payload:', JSON.stringify(data, null, 2));

        // Tenta encontrar uma configuração existente
        const existing = await prisma.setting.findUnique({
            where: { userId: req.user.id }
        });

        let settings;
        if (existing) {
            // Se já existe, atualiza
            settings = await prisma.setting.update({
                where: { userId: req.user.id },
                data: data
            });
        } else {
            // Se não existe, cria do zero
            settings = await prisma.setting.create({
                data: { ...data, userId: req.user.id }
            });
        }

        console.log('[DEBUG] Configurações salvas com sucesso!');
        res.json(settings);
    } catch (err) {
        console.error('[Settings Save Error] Erro detalhado:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/marketing/upload', authenticate, uploadMarketing.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    const fileUrl = `https://files.digizap.com.br/marketing/${req.file.filename}`;
    res.json({ url: fileUrl });
});

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
    // Se vier do Google Agenda, volta para as configuraﾃｧﾃｵes
    if (req.query.gcal_success) {
        return res.send(`
            <script>
                if (window.opener) {
                    window.opener.location.reload();
                    window.close();
                } else {
                    window.location.href = '${process.env.FRONTEND_URL || 'https://dash.digizap.com.br'}/settings';
                }
            </script>
        `);
    }
    // Serve a landing page (Home)
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 笏笏笏 WEBHOOK MERCADO PAGO 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
const processingPayments = new Set();

app.post('/mercadopago/webhook', async (req, res) => {
    try {
        const { type, data } = req.body;
        const paymentId = data?.id || req.query.id;

        if ((type === 'payment' || req.query.topic === 'payment') && paymentId) {

            // TRAVA DE MEMﾃ迭IA: Evita processar o mesmo ID se ele jﾃ｡ estiver em curso
            if (processingPayments.has(paymentId)) {
                return res.sendStatus(200);
            }
            processingPayments.add(paymentId);

            try {
                // Busca detalhes do pagamento no MP
                const userId = req.query.userId;
                const settings = await getSettings(userId);

                if (!settings?.mercadopagoToken) {
                    console.warn(`[MercadoPago Webhook] Token nﾃ｣o encontrado para o usuﾃ｡rio: ${userId}`);
                    processingPayments.delete(paymentId);
                    return res.sendStatus(200);
                }

                const client = new MercadoPagoConfig({ accessToken: settings.mercadopagoToken });
                const payment = new MercadoPagoPayment(client);

                const p = await payment.get({ id: paymentId });
                const orderId = p.external_reference;

                if (p.status === 'approved' && orderId) {
                    const order = await prisma.order.findUnique({ where: { id: orderId } });

                    // Trava de seguranﾃｧa no DB: Se jﾃ｡ foi confirmado, ignora
                    if (order && order.paymentStatus !== 'confirmed') {

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

                        // Sincroniza com Google Agenda agora que estﾃ｡ confirmado
                        await updateCalendarEvent(updatedOrder).catch(e => console.error('[GCal Sync Error]', e.message));

                        if (settings?.managerJid) {
                            const sock = sessions.get(updatedOrder.instanceId || 'global') || Array.from(sessions.values())[0];
                            if (sock) {
                                let aviso = "";
                                const orderIdShort = updatedOrder.id.slice(-4).toUpperCase();

                                if (updatedOrder.type === 'order') {
                                    aviso = `�圷 *NOVA ENCOMENDA!* (#${orderIdShort}) �圷\n\n�側 *Cliente:* ${updatedOrder.clientName}\n�獅 *Pedido:* ${updatedOrder.product}\n�套 *Data:* ${updatedOrder.scheduledDate}\n竢ｰ *Hora:* ${updatedOrder.scheduledTime}\n�統 *Obs:* ${updatedOrder.notes || '-'}\n�桃 *Entrega:* ${updatedOrder.deliveryAddress || 'Retirada'}\n\nO pagamento foi confirmado e o pedido jﾃ｡ estﾃ｡ no seu painel! 笨ｨ`;
                                } else {
                                    aviso = `�腸 *PAGAMENTO APROVADO!* (#${orderIdShort}) �腸\n\n�側 *Cliente:* ${updatedOrder.clientName}\n�獅 *Pedido:* ${updatedOrder.product}\n\nO pedido jﾃ｡ estﾃ｡ na aba *PENDENTES* do seu painel. Aceite-o para iniciar a produﾃｧﾃ｣o! 笨ｨ`;
                                }

                                await sock.sendMessage(settings.managerJid, { text: aviso }).catch(() => { });
                            }
                        }

                        if (updatedOrder.clientJid) {
                            const sock = sessions.get(updatedOrder.instanceId || 'global') || Array.from(sessions.values())[0];
                            if (sock) {
                                const msg = `�腸 *PAGAMENTO APROVADO!* �諜\n\nOi, *${updatedOrder.clientName}*! Seu pagamento foi aprovado e seu pedido jﾃ｡ estﾃ｡ na nossa fila de produﾃｧﾃ｣o. �ｧ鯛昨沚ｳ笨ｨ\n\nAvisaremos vocﾃｪ assim que estiver pronto! 笶､�汁`;
                                await sock.sendMessage(updatedOrder.clientJid, { text: msg }).catch(() => { });
                            }
                        }
                    }
                }
            } finally {
                // Remove da trava apﾃｳs o processamento (independente de sucesso ou falha)
                processingPayments.delete(paymentId);
            }
        }
        res.sendStatus(200);
    } catch (err) {
        console.error('[MercadoPago Webhook Error]', err.message);
        res.sendStatus(200);
    }
});

app.get('/public/menu/:slug', async (req, res) => {
    try {
        const slug = req.params.slug.toLowerCase();
        console.log(`[Public Menu] Buscando loja: ${slug}`);

        const user = await prisma.user.findUnique({
            where: { slug },
            include: {
                settings: true,
                products: true,
                categories: {
                    orderBy: { order: 'asc' }
                },
                availableSlots: true
            }
        });

        if (!user) {
            console.warn(`[Public Menu] Loja nao encontrada: ${slug}`);
            return res.status(404).json({ error: 'Loja nao encontrada' });
        }

        const settings = Array.isArray(user.settings) ? user.settings[0] : user.settings;
        console.log(`[Public Menu] Loja encontrada: ${user.name} (ID: ${user.id})`);

        res.json({
            businessName: settings?.businessName || user.name,
            businessAddress: settings?.businessAddress,
            logoUrl: settings?.logoUrl,
            faviconUrl: settings?.faviconUrl,
            accentColor: settings?.accentColor || '#ff4d6d',
            buttonColor: settings?.buttonColor || '#ff4d6d',
            accentColorOrders: settings?.accentColorOrders || '#4a2c2a',
            buttonColorOrders: settings?.buttonColorOrders || '#4a2c2a',
            buttonTextColor: settings?.buttonTextColor || '#ffffff',
            backgroundColor: settings?.backgroundColor || '#ffffff',
            textColor: settings?.textColor || '#333333',
            seoDescription: settings?.seoDescription || '',
            pixelId: settings?.pixelId || '',
            googleAnalyticsId: settings?.googleAnalyticsId || '',
            microsoftClarityId: settings?.microsoftClarityId || '',
            products: user.products,
            categories: user.categories,
            availableSlots: user.availableSlots,
            userId: user.id
        });
    } catch (err) {
        console.error('[Public Menu Error]', err);
        res.status(500).json({ error: 'Erro interno no servidor', details: err.message });
    }
});

// 笏笏笏 SLUG AVAILABILITY CHECK 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
app.get('/public/check-slug/:slug', async (req, res) => {
    try {
        const base = req.params.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        const existing = await prisma.user.findUnique({ where: { slug: base } });
        if (!existing) {
            return res.json({ available: true, slug: base });
        }
        // Tenta base-2, base-3, ...
        let counter = 2;
        while (counter <= 99) {
            const candidate = `${base}-${counter}`;
            const taken = await prisma.user.findUnique({ where: { slug: candidate } });
            if (!taken) return res.json({ available: false, suggestion: candidate, slug: base });
            counter++;
        }
        res.json({ available: false, slug: base });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.use('/assets', express.static(path.join(__dirname, 'assets')));

// ROTAS - MARKETING ASSETS (STORIES)
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
        const { name, url } = req.body;

        // Se o frontend já mandou a URL do bucket PHP, usamos ela. 
        // Caso contrário, usamos o domínio de arquivos correto.
        const finalUrl = url || (req.file ? `https://files.digizap.com.br/marketing/${req.file.filename}` : null);

        if (!finalUrl) {
            return res.status(400).json({ error: "Nenhum arquivo ou URL fornecida" });
        }

        const asset = await prisma.marketingAsset.create({
            data: {
                userId: req.user.id,
                name: name || 'Sem nome',
                url: finalUrl
            }
        });
        res.json(asset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/marketing-assets/:id', authenticate, async (req, res) => {
    try {
        const asset = await prisma.marketingAsset.findUnique({
            where: { id: req.params.id, userId: req.user.id }
        });
        if (asset) {
            if (asset.url && asset.url.includes('/marketing/')) {
                const filename = asset.url.split('/').pop();
                const fullPath = path.join(__dirname, 'assets', 'marketing', filename);
                if (fs.existsSync(fullPath)) {
                    fs.unlinkSync(fullPath);
                }
            }
            await prisma.marketingAsset.delete({ where: { id: req.params.id } });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 笏笏笏 GOOGLE CALENDAR OAUTH 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏

const GCAL_SCOPES = ['https://www.googleapis.com/auth/calendar'];

function getOAuth2Client(req) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    // Prefere usar a URL pﾃｺblica do .env para evitar mismatch de redirect_uri
    const publicUrl = process.env.PUBLIC_URL || 'http://localhost:3001';
    const redirectUri = `${publicUrl}/auth/google/callback`;

    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// Inicia o fluxo OAuth 窶� redireciona para o consent screen do Google
app.get('/auth/google', authenticate, async (req, res) => {
    const oauth2Client = getOAuth2Client(req);
    const origin = req.query.origin || req.get('referer') || `http://${req.get('host')}`;

    if (!oauth2Client) {
        return res.redirect(`${origin.split('?')[0]}?gcal_error=missing_env_credentials`);
    }
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: GCAL_SCOPES,
        prompt: 'consent', // forca refresh_token sempre
        state: req.user.id // Passa o userId no state para recuperar no callback
    });
    res.redirect(url);
});

// Callback do Google com o cﾃｳdigo de autorizaﾃｧﾃ｣o
app.get('/auth/google/callback', async (req, res) => {
    const { code, state: userId, error } = req.query;
    const origin = process.env.FRONTEND_URL || 'http://localhost:5173';

    if (error) return res.redirect(`${origin}/settings?gcal_error=${error}`);
    if (!userId) return res.redirect(`${origin}/settings?gcal_error=no_user_context`);

    try {
        const oauth2Client = getOAuth2Client(req);
        const { tokens } = await oauth2Client.getToken(code);
        console.log('[GCal OAuth] Tokens recebidos do Google.');

        const updateData = {
            gcalAccessToken: tokens.access_token,
            gcalTokenExpiry: tokens.expiry_date?.toString(),
            gcalEnabled: true,
        };

        // Sﾃｳ atualiza o refresh_token se o Google enviou um novo (geralmente sﾃｳ no primeiro consentimento ou com prompt=consent)
        if (tokens.refresh_token) {
            console.log('[GCal OAuth] Novo Refresh Token recebido.');
            updateData.gcalRefreshToken = tokens.refresh_token;
        } else {
            console.warn('[GCal OAuth] Refresh Token Nﾃグ recebido. Usando o existente.');
        }

        await prisma.setting.update({
            where: { userId },
            data: updateData
        });

        res.redirect(`${origin}/settings?gcal_success=1`);
    } catch (e) {
        console.error('[GCal OAuth]', e.message);
        const origin = req.get('referer') || `http://${req.get('host')}`;
        res.redirect(`${origin.split('?')[0]}?gcal_error=token_exchange_failed`);
    }
});

// Status da conexﾃ｣o com o Google Calendar
app.get('/auth/google/status', authenticate, async (req, res) => {
    const settings = await getSettings(req.user.id);
    const connected = !!(settings?.gcalRefreshToken);
    const hasCredentials = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    res.json({ connected, calendarId: settings?.gcalCalendarId, hasCredentials });
});

// Lista os calendﾃ｡rios disponﾃｭveis na conta conectada
app.get('/auth/google/calendars', authenticate, async (req, res) => {
    try {
        const settings = await getSettings(req.user.id);
        if (!settings?.gcalRefreshToken) return res.status(401).json({ error: 'Nﾃ｣o conectado' });

        const oauth2Client = getOAuth2Client(req);
        oauth2Client.setCredentials({ refresh_token: settings.gcalRefreshToken, access_token: settings.gcalAccessToken });
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        const list = await calendar.calendarList.list();
        const calendars = (list.data.items || [])
            .map(c => ({ id: c.id, name: c.summaryOverride || c.summary, primary: c.primary }))
            .filter(c => c.name); // Remove itens sem nome

        res.json(calendars);
    } catch (e) {
        if (e.message.includes('invalid_grant')) {
            console.error('[GCal Error] Conexﾃ｣o expirada ou revogada. Por favor, reconecte sua conta nas Configuraﾃｧﾃｵes.');
        } else {
            console.error('[GCal Error] Falha ao listar calendﾃ｡rios:', e.message);
        }
        res.status(500).json({ error: e.message });
    }
});

// Salva o calendﾃ｡rio selecionado
app.patch('/auth/google/calendar', authenticate, async (req, res) => {
    try {
        const { calendarId } = req.body;
        await prisma.setting.update({ where: { userId: req.user.id }, data: { gcalCalendarId: calendarId } });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Desconectar o Google Calendar
app.post('/auth/google/disconnect', authenticate, async (req, res) => {
    try {
        await prisma.setting.update({
            where: { userId: req.user.id },
            data: { gcalEnabled: false, gcalAccessToken: null, gcalRefreshToken: null, gcalTokenExpiry: null },
        });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});



// 笏笏笏 INICIA O SERVIDOR 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
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
    // Inicia os cron jobs (GCal sync + relatﾃｳrio)
    await setupCronJobs((instanceId) => sessions.get(instanceId));
});

module.exports = { getSocket: (id) => sessions.get(id) };



// Controle de reconexﾃ｣o com backoff por instﾃ｢ncia
const reconnectAttempts = {};

let cachedWAVersion = null;

async function initInstance(instanceId) {
    const sessionDir = path.join(__dirname, 'sessions', instanceId);
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    // Busca a versﾃ｣o mais recente do WhatsApp Web (Cache para performance)
    let version = cachedWAVersion || [2, 3000, 1015901307];
    if (!cachedWAVersion) {
        try {
            const result = await fetchLatestBaileysVersion();
            version = result.version;
            cachedWAVersion = version;
        } catch (e) {
            console.warn(`[Baileys] Falha ao buscar versﾃ｣o do WA Web. Usando fallback.`);
        }
    }

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
        browser: ['DigiZap', 'Chrome', '1.0.0'],
        logger: pino({ level: 'silent' }),
        syncFullHistory: false,            // true consome muita memﾃｳria e pode causar desconexﾃｵes
        keepAliveIntervalMs: 30000,        // envia ping a cada 30s para manter a conexﾃ｣o viva
        connectTimeoutMs: 60000,           // timeout de 60s para estabelecer conexﾃ｣o
        defaultQueryTimeoutMs: 60000,      // timeout para queries ao servidor do WhatsApp
        retryRequestDelayMs: 500,          // delay entre tentativas de retry de mensagens
        maxMsgRetryCount: 5                // mﾃ｡ximo de retentativas por mensagem
    });

    store.bind(sock.ev);

    // PERSISTENCE LOGIC
    sock.ev.on('contacts.upsert', async (contacts) => {
        for (const contact of contacts) {
            try {
                const jid = contact.id;
                const isGroup = jid.endsWith('@g.us');
                const name = contact.name || contact.verifiedName || contact.notify || (isGroup ? 'Grupo' : jid.split('@')[0]);

                // Apenas atualiza o nome se o chat jﾃ｡ existir. Nﾃ｣o cria chats vazios para cada pessoa de um grupo.
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

        if (!msg.key.fromMe) {
            console.log(`[Mensagem] ${pushName} (${jid.split('@')[0]})`);
        }

        // BLOQUEIO DE STATUS E GRUPOS (OPCIONAL)
        if (jid === 'status@broadcast' || jid.includes('@g.us')) return;

        // 笏笏笏 INTERCEPTA MENSAGEM APAGADA ("Apagar para Todos") 笏笏笏
        if (msg.message?.protocolMessage?.type === 0 || msg.message?.protocolMessage?.type === 'REVOKE') {
            const keyToRevoke = msg.message.protocolMessage.key;
            if (keyToRevoke && keyToRevoke.id) {
                await prisma.message.deleteMany({ where: { instanceId, msgId: keyToRevoke.id } });
                io.emit('message_deleted', { instanceId, msgId: keyToRevoke.id });
            }
            return; // Interrompe aqui, nﾃ｣o processa IA
        }

        let text = msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption ||
            msg.message?.documentMessage?.caption || '';

        // TRANSCRIPﾃ�グ DE ﾃゞDIO (Lily ou Clientes)
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
                    // Salva apenas o texto para a IA nﾃ｣o se confundir
                    text = transcription.text;
                }
            } catch (err) {
                console.error('[Audio Error]', err.message);
                text = "�痔 [ﾃ「dio (Erro na transcriﾃｧﾃ｣o)]";
            }
        }

        const isMedia = !!(msg.message?.imageMessage ||
            msg.message?.videoMessage ||
            msg.message?.audioMessage ||
            msg.message?.documentMessage ||
            msg.message?.viewOnceMessageV2 ||
            msg.message?.viewOnceMessage);

        if (!text && isMedia) {
            // console.log("[DEBUG MEDIA] Mensagem de mﾃｭdia detectada. Estrutura:", JSON.stringify(msg.message, null, 2));
        }

        if (text || isMedia) {
            // Se for mﾃｭdia sem texto, define um placeholder para o banco de dados
            if (!text && isMedia) {
                if (msg.message?.imageMessage) text = "�胴 [Imagem]";
                else if (msg.message?.videoMessage) text = "�磁 [Vﾃｭdeo]";
                else if (msg.message?.audioMessage) text = "�痔 [ﾃ「dio]";
                else if (msg.message?.documentMessage) text = "�塘 [Documento]";
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

                // 笏笏笏 COMANDOS DE ADMINISTRADOR (MANAGER) 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏
                const settings = await getSettings();
                if (!msg.key.fromMe && settings?.managerJid && jid === settings.managerJid) {

                    let adminImages = [];
                    const isImg = !!msg.message?.imageMessage ||
                        !!msg.message?.viewOnceMessageV2?.message?.imageMessage ||
                        !!msg.message?.viewOnceMessage?.message?.imageMessage ||
                        (msg.message?.documentMessage?.mimetype?.startsWith('image/'));

                    if (isImg) {
                        try {
                            const { downloadMediaMessage } = require('@whiskeysockets/baileys');
                            const buffer = await downloadMediaMessage(msg, 'buffer', {});
                            adminImages.push(buffer.toString('base64'));
                        } catch (e) {
                            console.error("[Admin Error] Falha ao baixar imagem do gerente:", e.message);
                        }
                    }

                    // Chama o agente especﾃｭfico para o administrador passando imagens se houver
                    await handleAdminAgent(sock, instanceId, jid, text, settings, adminImages);
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

                        // Re-buscamos o chat para garantir que pegamos o status de aiEnabled atualizado
                        const currentChat = await prisma.chat.findUnique({
                            where: { instanceId_jid: { instanceId, jid } }
                        });

                        // Agrupa todos os textos e imagens do buffer LOGO NO INﾃ垢IO
                        let combinedText = "";
                        let combinedImages = [];

                        for (const m of messagesToProcess) {
                            if (m.text) combinedText += (combinedText ? "\n" : "") + m.text;
                            const isImg = !!m.msg.message?.imageMessage ||
                                !!m.msg.message?.viewOnceMessageV2?.message?.imageMessage ||
                                !!m.msg.message?.viewOnceMessage?.message?.imageMessage ||
                                (m.msg.message?.documentMessage?.mimetype?.startsWith('image/'));
                            if (isImg) {
                                try {
                                    const { downloadMediaMessage } = require('@whiskeysockets/baileys');
                                    const buffer = await downloadMediaMessage(m.msg, 'buffer', {});
                                    combinedImages.push(buffer.toString('base64'));
                                } catch (e) { console.error("Erro imagem buffer:", e); }
                            }
                        }

                        // Juntamos o texto para o motor de fluxos (usando o combinedText jﾃ｡ calculado)
                        const textForFlow = combinedText;
                        const instanceData = await getCachedInstance(instanceId);
                        const userId = instanceData?.userId;

                        let flowHandled = false;
                        if (!msg.key.fromMe) {
                            flowHandled = await handleFlows(sock, instanceId, jid, textForFlow, messagesToProcess[messagesToProcess.length - 1].msg, buildLilyPrompt, getOpenAI, executeChamarGerente, settings, msg.pushName, combinedImages, userId);
                        }
                        if (flowHandled) return;

                        if (!msg.key.fromMe && currentChat?.aiEnabled) {
                            // COMMAND AGENT (Experimental)
                            if (text.toLowerCase().includes('crie um story')) {
                                const storyText = text.replace(/crie um story/i, '').trim();
                                if (storyText) {
                                    await sock.sendMessage('status@broadcast', { text: storyText });
                                    await sendRichMessage(sock, jid, "笨� Comando executado! Acabei de publicar seu Story.");
                                    return;
                                }
                            }

                            const ai = await getOpenAI(userId);
                            if (ai) {
                                const settings = await getSettings(userId);

                                let promptText = (combinedText ? combinedText : "");

                                let userMessageContent = [{ type: "text", text: promptText }];
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

                                // Formata o histﾃｳrico como texto para injetar no final do prompt do sistema
                                const formattedHistory = history.reverse().map(m =>
                                    `${m.fromMe ? 'Lily' : 'Cliente'}: ${m.text || '[Imagem/Arquivo]'}`
                                ).join('\n');

                                const finalSystemPrompt = await buildLilyPrompt(instanceId, jid, formattedHistory, storeInfo, msg.pushName, userId);
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
                                            description: "Avisa o dono/gerente da loja que existe uma dﾃｺvida que a IA nﾃ｣o sabe responder ou um pedido especial.",
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
                                            description: "Calcula o valor da entrega baseado no endereﾃｧo do cliente usando Google Maps e as regras da loja.",
                                            parameters: {
                                                type: "object",
                                                properties: {
                                                    address: { type: "string", description: "Endereﾃｧo completo do cliente" }
                                                },
                                                required: ["address"]
                                            }
                                        }
                                    },
                                    {
                                        type: "function",
                                        function: {
                                            name: "check_availability",
                                            description: "Verifica se hﾃ｡ horﾃ｡rios disponﾃｭveis para agendamento em uma data e hora especﾃｭfica.",
                                            parameters: {
                                                type: "object",
                                                properties: {
                                                    date: { type: "string", description: "A data no formato YYYY-MM-DD" },
                                                    time: { type: "string", description: "O horﾃ｡rio no formato HH:MM" },
                                                    type: { type: "string", description: "O tipo do pedido: 'order' (encomenda) ou 'delivery' (entrega)" }
                                                },
                                                required: ["date", "time", "type"]
                                            }
                                        }
                                    },
                                    {
                                        type: "function",
                                        function: {
                                            name: "create_order",
                                            description: "Cria um novo pedido. REGRAS CRﾃ控ICAS: 1. NUNCA crie pedidos duplicados se o cliente estiver apenas corrigindo algo ou tentando de novo apﾃｳs um erro; use 'update_order' nesses casos. 2. Se o cliente mudar de ideia no meio do atendimento, atualize o pedido existente.",
                                            parameters: {
                                                type: "object",
                                                properties: {
                                                    productId: { type: "string", description: "ID do produto (ex: cmo...) encontrado entre [ID:...] no catﾃ｡logo." },
                                                    product: { type: "string", description: "Nome do produto" },
                                                    variation: { type: "string", description: "Nome da variaﾃｧﾃ｣o EXACTA (ex: 'P', 'M', 'Mini'). Nﾃ｣o coloque sabores aqui." },
                                                    quantity: { type: "string", description: "Peso do bolo (ex: 2kg) ou Quantidade" },
                                                    scheduledDate: { type: "string", description: "Data do agendamento YYYY-MM-DD" },
                                                    scheduledTime: { type: "string", description: "Horﾃ｡rio do agendamento HH:MM" },
                                                    clientName: { type: "string", description: "Nome do cliente" },
                                                    paymentMethod: { type: "string", description: "Forma de pagamento (ex: Pix e Cartﾃ｣o com link de pagamento e Dinheiro em alguns casos)" },
                                                    type: { type: "string", enum: ["order", "delivery"], description: "OBRIGATﾃ迭IO: Use 'delivery' para pedidos imediatos (hoje/agora) com entrega. Use 'order' para agendamentos futuros, encomendas de bolos ou retiradas programadas." },
                                                    deliveryAddress: { type: "string", description: "Endereﾃｧo se for delivery" },
                                                    deliveryFee: { type: "number", description: "Valor da entrega calculado por get_delivery_fee" },
                                                    massa: { type: "string", description: "Sabor da massa escolhida" },
                                                    recheio: { type: "string", description: "Sabor do recheio escolhido" },
                                                    topo: { type: "string", description: "Informaﾃｧﾃｵes sobre o topo do bolo" },
                                                    carrinho_itens_extras: { type: "array", items: { type: "string" }, description: "Produtos ADICIONAIS. IMPORTANTE: Para Kits/Combos, Nﾃグ coloque aqui os itens que jﾃ｡ fazem parte do kit, senﾃ｣o o cliente serﾃ｡ cobrado em dobro. Use apenas para itens extras comprados ﾃ� parte." },
                                                    notes: { type: "string", description: "Outras observaﾃｧﾃｵes gerais" }
                                                },
                                                required: ["product", "paymentMethod"],
                                            },
                                        },
                                    },
                                    {
                                        type: "function",
                                        function: {
                                            name: "update_order",
                                            description: "Atualiza informaﾃｧﾃｵes de um pedido ou agendamento jﾃ｡ existente. Sﾃｳ use se o cliente pedir para corrigir algo.",
                                            parameters: {
                                                type: "object",
                                                properties: {
                                                    orderId: { type: "string", description: "Cﾃｳdigo de referﾃｪncia curto do pedido (ex: FJBIR)" },
                                                    product: { type: "string", description: "Novo produto (opcional)" },
                                                    quantity: { type: "string", description: "Novo peso ou quantidade (opcional)" },
                                                    scheduledDate: { type: "string", description: "Nova data YYYY-MM-DD (opcional)" },
                                                    scheduledTime: { type: "string", description: "Novo horﾃ｡rio HH:MM (opcional)" },
                                                    notes: { type: "string", description: "Novas observaﾃｧﾃｵes ou mudanﾃｧas nos sabores (opcional)" },
                                                    carrinho_itens_extras: { type: "array", items: { type: "string" }, description: "Nova lista completa de produtos extras." },
                                                    totalValue: { type: "number", description: "Novo valor total do pedido apﾃｳs as alteraﾃｧﾃｵes (opcional)" }
                                                },
                                                required: ["orderId"]
                                            }
                                        }
                                    },
                                    {
                                        type: "function",
                                        function: {
                                            name: "get_order_status",
                                            description: "Verifica se o pedido do cliente atual estﾃ｡ pronto para retirada ou entrega.",
                                            parameters: { type: "object", properties: {} }
                                        }
                                    },
                                    {
                                        type: "function",
                                        function: {
                                            name: "get_store_location",
                                            description: "Retorna o endereﾃｧo fﾃｭsico da loja e o link do Google Maps para retirada.",
                                            parameters: { type: "object", properties: {} }
                                        }
                                    },
                                    {
                                        type: "function",
                                        function: {
                                            name: "get_delivery_catalog",
                                            description: "OBRIGATﾃ迭IO: Chame SEMPRE que o cliente perguntar o que tem para hoje, pronta entrega, ou pedir opﾃｧﾃｵes imediatas. Proibido listar produtos manualmente, quando estiver fechado e o cliente pedir informaﾃｧﾃｵes \"sobre o que tem hoje\".",
                                            parameters: { type: "object", properties: {} }
                                        }
                                    },
                                    {
                                        type: "function",
                                        function: {
                                            name: "get_order_catalog",
                                            description: "OBRIGATﾃ迭IO: Chame SEMPRE que o cliente pedir cardﾃ｡pio de encomendas, bolos de festa, personalizados ou agendamentos futuros. Proibido listar produtos manualmente.",
                                            parameters: { type: "object", properties: {} }
                                        }
                                    },
                                    {
                                        type: "function",
                                        function: {
                                            name: "solicitar_cancelamento",
                                            description: "Chama o gerente/admin para tratar de um cancelamento de pedido que o cliente solicitou.",
                                            parameters: {
                                                type: "object",
                                                properties: {
                                                    reason: { type: "string", description: "O motivo que o cliente deu para o cancelamento." }
                                                },
                                                required: ["reason"]
                                            }
                                        }
                                    },
                                    {
                                        type: "function",
                                        function: {
                                            name: "get_marketing_media",
                                            description: "Busca na biblioteca de marketing imagens de produtos ou promoﾃｧﾃｵes para mostrar ao cliente.",
                                            parameters: {
                                                type: "object",
                                                properties: {
                                                    search: { type: "string", description: "Termo de busca (ex: 'vulcﾃ｣o', 'promoﾃｧﾃ｣o'). Deixe vazio para listar todos." }
                                                }
                                            }
                                        }
                                    },
                                    {
                                        type: "function",
                                        function: {
                                            name: "send_marketing_media",
                                            description: "Envia uma imagem especﾃｭfica da biblioteca de marketing para o cliente.",
                                            parameters: {
                                                type: "object",
                                                properties: {
                                                    assetId: { type: "string", description: "O ID da imagem/asset a ser enviada." },
                                                    caption: { type: "string", description: "Legenda opcional para acompanhar a imagem." }
                                                },
                                                required: ["assetId"]
                                            }
                                        }
                                    },
                                    {
                                        type: "function",
                                        function: {
                                            name: "post_status",
                                            description: "Posta um novo Story (Status) no WhatsApp da loja.",
                                            parameters: {
                                                type: "object",
                                                properties: {
                                                    text: { type: "string", description: "Texto do status." },
                                                    assetId: { type: "string", description: "O ID de uma imagem da biblioteca de marketing para postar como status (opcional)." }
                                                },
                                                required: ["text"]
                                            }
                                        }
                                    }
                                ];

                                let responseMessage;
                                let pendingPaymentLink = null;
                                let pendingCatalogMessage = null;
                                let pendingCatalogCTA = null; // 3ﾂｪ mensagem: CTA da Lily apﾃｳs o catﾃ｡logo
                                try {
                                    // Detecta se o usuﾃ｡rio estﾃ｡ pedindo o cardﾃ｡pio e forﾃｧa a ferramenta correta
                                    const lastUserMsgObj = messages.filter(m => m.role === 'user').pop();
                                    const lastUserMsgContent = Array.isArray(lastUserMsgObj?.content)
                                        ? lastUserMsgObj.content.map(c => c.text || '').join(' ')
                                        : (lastUserMsgObj?.content || '');
                                    const lastUserMsg = lastUserMsgContent.toLowerCase();

                                    const isDeliveryRequest = /card[aﾃ｡]pio|o que tem|pronta entrega|o que voc[eﾃｪ] tem|tem hoje|tem pra hoje|disponﾃｭvel|disponivel|preﾃｧo|preco|o que vende|possibilidades|opﾃｧﾃｵes|opcoes/i.test(lastUserMsg);
                                    const isOrderRequest = /encomenda|bolo de festa|personalizado|encomendar|quero encomendar/i.test(lastUserMsg);

                                    let forcedToolChoice = "auto";

                                    if (statusLoja.includes("FECHADA")) {
                                        // Detecta se ﾃｩ um "SIM" genﾃｩrico ou se jﾃ｡ ﾃｩ o nome de um produto
                                        const isGenericAcceptance = /^(sim|quero|pode|manda|veja|vﾃｪ|ok|agendar|amanhﾃ｣|pode ser|com certeza|claro|uhum)$/i.test(lastUserMsg.trim());
                                        const isAskingOptions = /o que tem|opﾃｧﾃｵes|cardapio|catalogo|vﾃｪ ai/i.test(combinedText);

                                        if (isGenericAcceptance || isAskingOptions) {
                                            forcedToolChoice = { type: "function", function: { name: "get_delivery_catalog" } };
                                        } else {
                                            // Se ele jﾃ｡ falou o nome de um produto (ex: "quero um vulcﾃ｣o"), deixa o fluxo seguir normal
                                            forcedToolChoice = "auto";
                                        }
                                    } else if (statusLoja.includes("ABERTA")) {
                                        if (isDeliveryRequest && !isOrderRequest) {
                                            forcedToolChoice = { type: "function", function: { name: "get_delivery_catalog" } };
                                        } else if (isOrderRequest) {
                                            forcedToolChoice = { type: "function", function: { name: "get_order_catalog" } };
                                        }
                                    }

                                    const modelToUse = (settings && settings.activeModel) ? (MODEL_MAP[settings.activeModel] || 'gpt-4o') : 'gpt-4o';

                                    const completion = await ai.chat.completions.create({
                                        model: modelToUse,
                                        messages,
                                        tools,
                                        tool_choice: forcedToolChoice
                                    });

                                    responseMessage = completion.choices[0].message;
                                    let initialAIText = responseMessage.content;

                                    // Interceptador de Memﾃｳria de Imagem
                                    if (initialAIText && initialAIText.includes('[ANALISE:')) {
                                        const match = initialAIText.match(/\[ANALISE: (.*?)\]/s);
                                        if (match) {
                                            const analysisContent = match[1];
                                            console.log(`[AI Memory] Salvando anﾃ｡lise tﾃｩcnica no banco...`);
                                            await prisma.chat.update({
                                                where: { instanceId_jid: { instanceId, jid } },
                                                data: { lastPixAnalysis: analysisContent }
                                            }).catch(e => console.error("Erro ao salvar memﾃｳria AI:", e));

                                            // Remove o bloco tﾃｩcnico do texto que o cliente verﾃ｡
                                            initialAIText = initialAIText.replace(/\[ANALISE: .*?\]/s, '').trim();
                                            responseMessage.content = initialAIText;
                                        }
                                    }

                                    // FUNCTION CALLING LOOP
                                    if (responseMessage.tool_calls) {
                                        messages.push(responseMessage);
                                        let lastDeliveryFee = 0; // Fallback se a IA esquecer de passar no create_order

                                        for (const toolCall of responseMessage.tool_calls) {
                                            const functionName = toolCall.function.name;
                                            const args = JSON.parse(toolCall.function.arguments);
                                            let result;


                                            if (functionName === "chamar_gerente") {
                                                const { reason } = args;
                                                result = await executeChamarGerente(reason, jid, currentChat, settings, null, sock, prisma, instanceId);
                                            }
                                            else if (functionName === "get_delivery_catalog") {
                                                const { statusLoja, isBeforeOpening } = await getStoreStatus();
                                                const prods = await prisma.product.findMany();

                                                let deliveryStr = '';
                                                prods.filter(p => (p.type === 'delivery' || p.type === 'combo_delivery') && (p.trackStock === false || p.stock > 0)).forEach(p => {
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
                                                pendingCatalogMessage = catalogText;
                                                result = "CATﾃ´OGO ENVIADO PARA MEMﾃ迭IA. Responda ao cliente usando o formato: [Intro] --- [CTA].";
                                            }
                                            else if (functionName === "get_order_catalog") {
                                                const prods = await prisma.product.findMany({
                                                    where: {
                                                        OR: [
                                                            { type: { in: ['encomenda', 'addon'] } },
                                                            { type: { contains: 'combo_' } }
                                                        ]
                                                    }
                                                });
                                                let orderStr = '';
                                                let addonStr = '';

                                                prods.forEach(p => {
                                                    const vars = typeof p.variations === 'string' ? JSON.parse(p.variations || '[]') : (p.variations || []);
                                                    const line = formatProduct(p, vars, false);

                                                    if (p.type === 'addon') addonStr += line + '\n';
                                                    else orderStr += line + '\n\n';
                                                });

                                                let catalogText = orderStr.trim() || 'Nenhum item para encomenda no momento.';
                                                if (addonStr) {
                                                    catalogText += '\n\n笨ｨ *ADICIONAIS & EXTRAS:*\n' + addonStr.trim();
                                                }
                                                pendingCatalogMessage = catalogText;
                                                result = "CATﾃ´OGO DE ENCOMENDAS ENVIADO PARA MEMﾃ迭IA. Responda ao cliente usando o formato: [Intro] --- [CTA].";
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

                                                    // PERSISTﾃ劾CIA: Salva no cadastro do cliente para evitar re-calculo caro
                                                    await prisma.customer.update({
                                                        where: { jid },
                                                        data: { address: args.address, lastDeliveryFee: feeValue }
                                                    }).catch(() => { });

                                                    const feeLabel = feeRes.type === 'fixed' ? 'VALOR DO FRETE' : 'VALOR DO FRETE (ESTIMADO)';

                                                    result = `${feeLabel}: R$ ${feeValue.toFixed(2)}. ${canCash ? 'DINHEIRO LIBERADO' : 'APENAS PIX/CARTﾃグ (Link)'}`;
                                                }
                                            }
                                            else if (functionName === "create_order") {
                                                // Notes are now kept clean, cake details passed as separate fields
                                                let finalNotes = args.notes || '';

                                                try {
                                                    // TRAVA DE SEGURANﾃ②: Evita duplicatas em curto espaﾃｧo de tempo
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
                                                            error: `BLOQUEIO: Jﾃ｡ existe o pedido #${recentOrder.id.slice(-5).toUpperCase()} em aberto. Use 'update_order' com este cﾃｳdigo para adicionar mais produtos ou atualizar o valor total. Nﾃグ CRIE OUTRO PEDIDO.`
                                                        };
                                                    } else {
                                                        const internalBase = `http://127.0.0.1:${process.env.PORT || 3001}`;
                                                        const res = await axios.post(`${internalBase}/orders`, {
                                                            ...args,
                                                            deliveryFee: args.deliveryFee || lastDeliveryFee, // FALLBACK: Usa o ﾃｺltimo frete calculado
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
                                                            result.message = "Pedido criado. SILﾃ劾CIO ABSOLUTO NO PRﾃ店IMO TURNO. Nﾃグ GERE NENHUM TEXTO, O SISTEMA ENVIARﾃ� O LINK.";
                                                        } else {
                                                            result.message = "Pedido criado. Informe que recebemos o pedido (Pagamento em Dinheiro) e que ele estﾃ｡ agora aguardando a aprovaﾃｧﾃ｣o da nossa equipe. Peﾃｧa para o cliente aguardar a confirmaﾃｧﾃ｣o oficial.";
                                                        }

                                                        // Se for dinheiro, jﾃ｡ cai como pending, entﾃ｣o dispara o DING agora
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
                                                        result = { success: false, error: `Pedido ${refCode} nﾃ｣o encontrado entre seus pedidos ativos.` };
                                                    } else {
                                                        const updateData = {};
                                                        if (args.product) updateData.product = args.product;
                                                        if (args.quantity) updateData.quantity = args.quantity;
                                                        if (args.scheduledDate) updateData.scheduledDate = args.scheduledDate;
                                                        if (args.scheduledTime) updateData.scheduledTime = args.scheduledTime;
                                                        if (args.notes) updateData.notes = args.notes;
                                                        if (args.carrinho_itens_extras) updateData.carrinho_itens_extras = args.carrinho_itens_extras;
                                                        if (args.totalValue) updateData.totalValue = args.totalValue;

                                                        const internalBase = `http://127.0.0.1:${process.env.PORT || 3001}`;
                                                        const res = await axios.patch(`${internalBase}/orders/${targetOrder.id}`, updateData);

                                                        result = { success: true, message: "Pedido atualizado com sucesso." };

                                                        if (res.data.paymentLink) {
                                                            pendingPaymentLink = res.data.paymentLink;
                                                            result.message = "Pedido atualizado e novo link gerado. SILﾃ劾CIO ABSOLUTO NO PRﾃ店IMO TURNO. Nﾃグ GERE NENHUM TEXTO, O SISTEMA ENVIARﾃ� O LINK.";
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
                                                        status: order.status === "ready" ? "PRONTO" : "EM PRODUﾃ�グ",
                                                        product: order.product,
                                                        canOfferLocation: order.status === "ready"
                                                    };
                                                } else {
                                                    result = { error: "Nenhum pedido ativo encontrado para este nﾃｺmero." };
                                                }
                                            }
                                            else if (functionName === "get_store_location") {
                                                result = {
                                                    address: settings?.businessAddress || "Endereﾃｧo nﾃ｣o configurado.",
                                                    locationLink: settings?.businessLocation || "Link nﾃ｣o disponﾃｭvel."
                                                };
                                            }
                                            else if (functionName === "solicitar_cancelamento") {
                                                const { reason } = args;
                                                const clientName = currentChat?.name || jid.split('@')[0];
                                                const alertMsg = `�圷 *SOLICITAﾃ�グ DE CANCELAMENTO* �圷\n\n�側 *Cliente:* ${clientName}\n�導 *WhatsApp:* ${jid.split('@')[0]}\n�統 *Motivo:* ${reason}\n\nLily jﾃ｡ avisou o cliente que o gerente foi notificado. Por favor, verifique o pedido no painel.`;

                                                await sock.sendMessage(settings.managerJid, { text: alertMsg });
                                                result = { success: true, message: "O gerente foi notificado sobre o seu pedido de cancelamento e entrarﾃ｡ em contato em breve." };
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
                                                    result = { success: false, error: "Imagem nﾃ｣o encontrada." };
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
                                                        result = { success: false, error: "Imagem nﾃ｣o encontrada para o status." };
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
                                                result = { success: true, message: "Catﾃ｡logo de pronta entrega preparado. O sistema enviarﾃ｡ o catﾃ｡logo agora. SILﾃ劾CIO ABSOLUTO." };
                                            }
                                            else if (functionName === "get_order_catalog") {
                                                const { formatProduct } = require('./lib/utils');
                                                const allProducts = await prisma.product.findMany();
                                                let catalogStr = "";
                                                allProducts.filter(p => p.type === 'encomenda').forEach(p => {
                                                    const vars = typeof p.variations === 'string' ? JSON.parse(p.variations || '[]') : (p.variations || []);
                                                    catalogStr += formatProduct(p, vars) + "\n\n";
                                                });
                                                pendingCatalogMessage = catalogStr.trim() || "Poxa, nﾃ｣o encontrei itens no momento.";
                                                result = { success: true, message: "Catﾃ｡logo de encomendas preparado. O sistema enviarﾃ｡ o catﾃ｡logo agora. SILﾃ劾CIO ABSOLUTO." };
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

                                        // 笏笏笏 SEQUESTRAR O FLUXO: SE GEROU LINK OU CATﾃ´OGO, A IA SE CALA E O SISTEMA ASSUME 笏笏笏
                                        if (pendingPaymentLink) {
                                            // Balﾃ｣o 1: Aviso
                                            await sock.sendPresenceUpdate('composing', jid);
                                            await new Promise(r => setTimeout(r, 1200));
                                            await sock.sendPresenceUpdate('paused', jid);
                                            await sendRichMessage(sock, jid, 'Vou gerar o link do seu pagamento logo abaixo:');

                                            // Balﾃ｣o 2: Link
                                            await sock.sendPresenceUpdate('composing', jid);
                                            await new Promise(r => setTimeout(r, 800));
                                            await sock.sendPresenceUpdate('paused', jid);
                                            await sock.sendMessage(jid, { text: pendingPaymentLink });

                                            // Balﾃ｣o 3: Confirmaﾃｧﾃ｣o
                                            await sock.sendPresenceUpdate('composing', jid);
                                            await new Promise(r => setTimeout(r, 1000));
                                            await sock.sendPresenceUpdate('paused', jid);
                                            await sendRichMessage(sock, jid, 'O pedido serﾃ｡ confirmado apﾃｳs o pagamento.');

                                            return; // FIM IMEDIATO: a IA nﾃ｣o fala mais nada.
                                        }

                                        if (pendingCatalogMessage) {
                                            const isDelivery = pendingCatalogMessage.includes('pronta entrega') || !pendingCatalogMessage.includes('Bolo');

                                            // Balﾃ｣o 1: Intro
                                            await sock.sendPresenceUpdate('composing', jid);
                                            await new Promise(r => setTimeout(r, 1000));
                                            await sock.sendPresenceUpdate('paused', jid);
                                            await sock.sendMessage(jid, { text: isDelivery ? 'Hoje teremos os seguintes produtos de pronta entrega:' : 'Vou te mostrar nossas opﾃｧﾃｵes maravilhosas de bolos de encomenda:' });

                                            // Balﾃ｣o 2: Catﾃ｡logo
                                            await sock.sendPresenceUpdate('composing', jid);
                                            await new Promise(r => setTimeout(r, Math.min(pendingCatalogMessage.length * 5, 3000)));
                                            await sock.sendPresenceUpdate('paused', jid);
                                            await sock.sendMessage(jid, { text: pendingCatalogMessage });

                                            // Balﾃ｣o 3: CTA
                                            await sock.sendPresenceUpdate('composing', jid);
                                            await new Promise(r => setTimeout(r, 1200));
                                            await sock.sendPresenceUpdate('paused', jid);
                                            await sock.sendMessage(jid, { text: isDelivery ? 'Qual desses posso separar para vocﾃｪ? ��' : 'Qual destes mais te encantou? Posso te ajudar a escolher o tamanho ideal para sua festa! ��笨ｨ' });

                                            return; // FIM IMEDIATO
                                        }

                                        const secondResponse = await ai.chat.completions.create({
                                            model: MODEL_MAP[settings?.activeModel] || 'gpt-4o',
                                            messages,
                                        });

                                        if (currentToken.cancelled) return;
                                        let aiFinalText = secondResponse.choices[0].message.content || "";

                                        // Se houver um catﾃ｡logo pendente, vamos dividir a resposta da IA em Intro e CTA usando o separador ---
                                        if (pendingCatalogMessage) {
                                            let introText = "Temos essas delﾃｭcias:";
                                            let ctaText = "Qual desses posso separar para vocﾃｪ? ��";

                                            if (aiFinalText.includes('---')) {
                                                const parts = aiFinalText.split('---');
                                                introText = parts[0].trim();
                                                ctaText = parts[1].trim();
                                            } else {
                                                // Fallback inteligente se a IA nﾃ｣o usar o separador
                                                const sentences = aiFinalText.split(/[.!?\n]/).filter(s => s.trim().length > 5);
                                                if (sentences.length >= 2) {
                                                    introText = sentences[0].trim() + (aiFinalText.includes(':') ? '' : ':');
                                                    ctaText = sentences[sentences.length - 1].trim();
                                                }
                                            }

                                            // Envia Intro (IA)
                                            await sendRichMessage(sock, jid, introText);

                                            // Envia Catﾃ｡logo (SISTEMA)
                                            await new Promise(resolve => setTimeout(resolve, 1500));
                                            await sock.sendMessage(jid, { text: pendingCatalogMessage });

                                            // Envia CTA (IA)
                                            await new Promise(resolve => setTimeout(resolve, 2000));
                                            await sendRichMessage(sock, jid, ctaText);
                                        } else {
                                            // Se nﾃ｣o for catﾃ｡logo, envia a resposta normal
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
                                    // LIMPEZA AGRESSIVA DE FORMATAﾃ�グ
                                    replyText = replyText.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$2'); // links markdown -> URL pura
                                    replyText = replyText.replace(/\*/g, ''); // Remove negrito/itﾃ｡lico
                                    replyText = replyText.replace(/#/g, '');  // Remove hashtags
                                    replyText = replyText.replace(/窶｢/g, '-'); // Troca bullet por traﾃｧo
                                    replyText = replyText.replace(/ﾂｷ/g, '-'); // Troca bullet mﾃｩdio por traﾃｧo
                                    replyText = replyText.replace(/ﾂｷ/g, '-'); // Repetindo para garantir
                                    replyText = replyText.replace(/_/g, '');  // Remove underlines
                                    replyText = replyText.replace(/`/g, '');  // Remove backticks
                                    replyText = replyText.trim();

                                    // TRAVA DE SEGURANﾃ②: Se o catﾃ｡logo vai ser enviado em seguida,
                                    // forﾃｧa o replyText a ser APENAS a primeira frase da IA (a introduﾃｧﾃ｣o).
                                    if (pendingCatalogMessage) {
                                        const firstSentence = replyText.split(/[\n!?]/)[0].trim();
                                        replyText = firstSentence || replyText;
                                    }
                                }

                                // 1ﾂｪ MENSAGEM: INTRODUﾃ�グ DA LILY
                                if (currentToken.cancelled) return;
                                const typingSpeed = 50;
                                const introDelay = Math.min(Math.max(replyText.length * typingSpeed, 2000), 10000);

                                await sock.sendPresenceUpdate('composing', jid);
                                await new Promise(resolve => setTimeout(resolve, introDelay));
                                await sock.sendPresenceUpdate('paused', jid);

                                await sendRichMessage(sock, jid, replyText);



                                // 2ﾂｪ MENSAGEM: CARDﾃ￣IO (SISTEMA)
                                if (pendingCatalogMessage) {
                                    // Pausa mﾃｭnima para respiro
                                    await new Promise(resolve => setTimeout(resolve, 500));

                                    // Digitaﾃｧﾃ｣o rﾃ｡pida para o catﾃ｡logo
                                    const catalogDelay = Math.min(Math.max(pendingCatalogMessage.length * 5, 800), 3000);
                                    await sock.sendPresenceUpdate('composing', jid);
                                    await new Promise(resolve => setTimeout(resolve, catalogDelay));
                                    await sock.sendPresenceUpdate('paused', jid);

                                    await sock.sendMessage(jid, { text: pendingCatalogMessage });

                                    // 3ﾂｪ MENSAGEM: CTA DA LILY (DINﾃ�ICO)
                                    if (pendingCatalogCTA) {
                                        // Pausa mﾃｭnima para o CTA
                                        await new Promise(resolve => setTimeout(resolve, 800));

                                        const ctaPrompt = pendingCatalogCTA === "delivery"
                                            ? "O cardﾃ｡pio de hoje foi enviado. Agora, como Lily (vendedora sutil e ﾃｳtima), envie UM CTA final (1 frase) perfeito para fechar a venda. Seja natural e direta, sem formalidades. Ex: 'Dﾃｪ uma olhadinha nas opﾃｧﾃｵes e me diz qual dessas posso separar para vocﾃｪ?'"
                                            : "O cardﾃ｡pio de encomendas foi enviado. Agora, como Lily, envie UM CTA final (1 frase) humano e simpﾃ｡tico para entender o desejo do cliente. Ex: 'Qual dessas combina mais com o que vocﾃｪ estﾃ｡ imaginando?'";
                                        try {
                                            const ctaResponse = await ai.chat.completions.create({
                                                model: MODEL_MAP[settings?.activeModel] || 'gpt-4o',
                                                messages: [...messages, { role: 'user', content: ctaPrompt }],
                                                max_tokens: 60
                                            });
                                            let ctaText = ctaResponse.choices[0].message.content?.trim();
                                            if (ctaText) {
                                                ctaText = ctaText.replace(/\*/g, '').replace(/#/g, '').replace(/_/g, '').trim();

                                                // Digitaﾃｧﾃ｣o rﾃ｡pida para o CTA
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
                                // PONTE ROBUSTA: Busca o fluxo tentando bater o nﾃｺmero (prefixo) se o JID exato falhar
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
                                        await runFlowNode(sock, instanceId, jid, flow, flowState.currentNodeId, null, buildLilyPrompt, getOpenAI, executeChamarGerente, settings, msg.pushName, combinedImages, textForFlow, userId);
                                    }
                                }
                            } else {
                                console.warn(`[AI] Agente estﾃ｡ ligado para ${jid}, mas a OpenAI API Key nﾃ｣o estﾃ｡ configurada.`);
                            }
                        }
                    } catch (errDbnc) {
                        console.error('[AI Debounce Error]', errDbnc);
                    }
                }, 4000); // 4 SEGUNDOS DE ESPERA (Otimizado para UX humana)
            } catch (e) {
                console.error('Erro na persistﾃｪncia/AI:', e.message);
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
            } catch (e) { /* mensagem pode nﾃ｣o estar no banco ainda */ }
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
            // Conexﾃ｣o bem-sucedida 窶� reseta o contador de tentativas
            delete reconnectAttempts[instanceId];
            await prisma.instance.update({ where: { id: instanceId }, data: { status: 'connected' } }).catch(() => { });
            io.emit('connection_update', { instanceId, status: 'connected' });
        }
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            clearInterval(saveInterval);

            // Se o socket que esta fechando NAO FOR o socket atual no mapa, 
            // significa que e uma conexao antiga de um Restart.
            const manualRemoval = (sessions.get(instanceId) !== sock);

            await prisma.instance.update({ where: { id: instanceId }, data: { status: 'disconnected' } }).catch(() => { });
            io.emit('connection_update', { instanceId, status: 'disconnected' });

            if (shouldReconnect && !manualRemoval) {
                // Backoff exponencial: evita loop de reconexﾃ｣o rﾃ｡pida
                const attempts = reconnectAttempts[instanceId] || 0;
                const delay = Math.min(1000 * Math.pow(2, attempts), 60000); // max 60s
                reconnectAttempts[instanceId] = attempts + 1;
                console.log(`[Baileys] Instﾃ｢ncia ${instanceId} reconectando em ${delay / 1000}s (tentativa ${attempts + 1})...`);
                setTimeout(() => initInstance(instanceId), delay);
            } else {
                // Deslogado ou remoﾃｧﾃ｣o manual 窶� limpa contador de tentativas
                delete reconnectAttempts[instanceId];
                if (manualRemoval) {
                    console.log(`[Baileys] Instﾃ｢ncia ${instanceId} removida manualmente. Ignorando auto-reconexﾃ｣o.`);
                } else {
                    console.log(`[Baileys] Instﾃ｢ncia ${instanceId} deslogada. Nﾃ｣o haverﾃ｡ reconexﾃ｣o automﾃ｡tica.`);
                }
            }
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
        if (!ai) return res.status(400).json({ error: 'OpenAI nﾃ｣o configurada' });

        const kb = JSON.parse(knowledge || '[]');
        const kbContext = kb.length > 0
            ? "\n\nUse as seguintes informaﾃｧﾃｵes especﾃｭficas da empresa para responder se relevante:\n" +
            kb.map(k => `Pergunta: ${k.q}\nResposta: ${k.a}`).join('\n---\n')
            : "";

        const messages = [
            { role: 'system', content: (botPrompt || 'Vocﾃｪ ﾃｩ um assistente prestativo.') + kbContext },
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
app.get('/config/keys', authenticate, async (req, res) => {
    let config = await getSettings(req.user.id);
    if (!config) config = await prisma.setting.create({ data: { userId: req.user.id, activeModel: 'openai' } });
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { slug: true } });

    res.json({
        slug: user?.slug,
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
});

app.post('/config/keys', authenticate, async (req, res) => {
    const {
        slug, openai, claude, activeModel, gcalSyncHour,
        businessName, businessAddress, businessLocation,
        dailyMaxOrders, dailyDeliveryItems, managerJid,
        deliveryJid, reportEnabled, reportHour,
        googleApiKey, deliveryRules, gcalCalendarId,
        mercadopagoToken, mercadopagoPublicKey,
        pixReceiverName, pixReceiverKey
    } = req.body;

    if (slug) {
        const existing = await prisma.user.findFirst({
            where: { slug, NOT: { id: req.user.id } }
        });
        if (existing) {
            return res.status(400).json({ error: 'Este slug jﾃ｡ estﾃ｡ em uso.' });
        }
        await prisma.user.update({
            where: { id: req.user.id },
            data: { slug }
        });
    }

    const currentConfig = await getSettings(req.user.id);

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
        gcalCalendarId: gcalCalendarId || "",
        pixReceiverName,
        pixReceiverKey
    };

    console.log(`[Config Save] Salvando configuraﾃｧﾃｵes do usuﾃ｡rio ${req.user.id}...`);

    const config = await prisma.setting.upsert({
        where: { userId: req.user.id },
        update: updateData,
        create: { userId: req.user.id, ...updateData, gcalEnabled: false }
    });

    openaiInstance = null;
    invalidateSettingsCache(req.user.id); // forﾃｧa reload das configuraﾃｧﾃｵes no prﾃｳximo uso
    res.json(config);
});

app.get('/config/slots', authenticate, async (req, res) => {
    try {
        const slots = await prisma.availableSlot.findMany({ where: { userId: req.user.id }, orderBy: { dayOfWeek: 'asc' } });
        res.json(slots);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/config/slots', authenticate, async (req, res) => {
    try {
        const { slots } = req.body; 

        if (!Array.isArray(slots)) return res.status(400).json({ error: 'Slots deve ser um array.' });
        const validSlots = slots.filter(s => s.startTime && s.endTime).map(s => ({
            userId: req.user.id,
            dayOfWeek: parseInt(s.dayOfWeek),
            startTime: s.startTime,
            endTime: s.endTime,
            maxOrders: 10
        }));
        await prisma.availableSlot.deleteMany({ where: { userId: req.user.id } });
        if (validSlots.length > 0) {
            const created = await prisma.availableSlot.createMany({ data: validSlots });
            return res.json(created);
        }
        res.json({ count: 0 });
    } catch (err) {
        console.error('[Slots Error]:', err);
        res.status(500).json({ error: err.message });
    }
});

// Rotas de Google Auth duplicadas removidas

app.get('/instances', authenticate, async (req, res) => {
    const instances = await prisma.instance.findMany({ where: { userId: req.user.id } });
    res.json(instances);
});

app.post('/instances', authenticate, async (req, res) => {
    try {
        const { name, color } = req.body;
        const instance = await prisma.instance.create({
            data: {
                name,
                userId: req.user.id,
                color: color || '#3b82f6'
            }
        });
        await initInstance(instance.id);
        res.json(instance);
    } catch (err) {
        console.error('[Instance Create Error]', err);
        res.status(500).json({ error: err.message });
    }
});

app.patch('/instances/:id', authenticate, async (req, res) => {
    const { id } = req.params;
    const { name, color, botPrompt, knowledge } = req.body;
    const instance = await prisma.instance.update({
        where: { id, userId: req.user.id },
        data: { name, color, botPrompt, knowledge }
    });
    res.json(instance);
});

app.post('/instances/:id/logout', authenticate, async (req, res) => {
    const { id } = req.params;

    // Verifica propriedade
    const instance = await prisma.instance.findUnique({ where: { id, userId: req.user.id } });
    if (!instance) return res.status(404).json({ error: 'Instﾃ｢ncia nﾃ｣o encontrada' });

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

app.post('/instances/:id/restart', authenticate, async (req, res) => {
    try {
        const { id } = req.params;

        // Verifica propriedade
        const instance = await prisma.instance.findUnique({ where: { id, userId: req.user.id } });
        if (!instance) return res.status(404).json({ error: 'Instﾃ｢ncia nﾃ｣o encontrada' });

        console.log(`[Restart] Reiniciando instﾃ｢ncia ${id} solicitada por ${req.user.id}`);

        const sock = sessions.get(id);
        if (sock) {
            // Remove do mapa ANTES de fechar para evitar que o evento 'close' dispare auto-reconnect
            sessions.delete(id);
            try { sock.end(); } catch (e) { }
        }

        // Reseta contador de tentativas
        delete reconnectAttempts[id];

        // Inicia em background para nﾃ｣o travar a resposta HTTP
        initInstance(id).catch(err => console.error(`[Restart Error] Falha ao iniciar ${id}:`, err));

        res.json({ success: true, message: 'Reinicializaﾃｧﾃ｣o iniciada' });
    } catch (err) {
        console.error('[Instance Restart Error]', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/instances/:id', authenticate, async (req, res) => {
    const { id } = req.params;

    // Verifica propriedade
    const instance = await prisma.instance.findUnique({ where: { id, userId: req.user.id } });
    if (!instance) return res.status(404).json({ error: 'Instﾃ｢ncia nﾃ｣o encontrada' });

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
    } catch (e) { console.error('Erro ao deletar filhos da instﾃ｢ncia:', e.message) }

    await prisma.instance.delete({ where: { id } });
    res.json({ success: true });
});

app.get('/instances/:id/chats', authenticate, async (req, res) => {
    // Verifica propriedade
    const instance = await prisma.instance.findUnique({ where: { id: req.params.id, userId: req.user.id } });
    if (!instance) return res.status(404).json({ error: 'Instﾃ｢ncia nﾃ｣o encontrada' });

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

    // Mapeia quais chats estﾃ｣o em fluxo
    const chatsWithFlow = chats.map(chat => ({
        ...chat,
        inFlow: flowStates.some(fs => fs.jid === chat.jid)
    }));

    res.json({ chats: chatsWithFlow, total, hasMore: skip + take < total });
});

app.patch('/instances/:id/chats/:jid', authenticate, async (req, res) => {
    const { id, jid } = req.params;
    const { aiEnabled } = req.body;

    // Verifica propriedade
    const instance = await prisma.instance.findUnique({ where: { id, userId: req.user.id } });
    if (!instance) return res.status(404).json({ error: 'Instﾃ｢ncia nﾃ｣o encontrada' });

    const chat = await prisma.chat.update({
        where: { instanceId_jid: { instanceId: id, jid } },
        data: { aiEnabled }
    });
    res.json(chat);
});

app.get('/instances/:id/messages/:jid', authenticate, async (req, res) => {
    const { id, jid } = req.params;

    // Verifica propriedade
    const instance = await prisma.instance.findUnique({ where: { id, userId: req.user.id } });
    if (!instance) return res.status(404).json({ error: 'Instﾃ｢ncia nﾃ｣o encontrada' });

    // Carrega apenas as ﾃｺltimas 20 mensagens para manter o carregamento instantﾃ｢neo
    let messages = await prisma.message.findMany({
        where: { instanceId: id, jid },
        orderBy: { timestamp: 'desc' },
        take: 20
    });

    // Inverte o array para a ordem cronolﾃｳgica correta no frontend (antigas em cima, novas embaixo)
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

app.get('/instances/:id/profile-pic/:jid', authenticate, async (req, res) => {
    try {
        const { id, jid } = req.params;

        // Verifica propriedade
        const instance = await prisma.instance.findUnique({ where: { id, userId: req.user.id } });
        if (!instance) return res.status(404).json({ error: 'Instﾃ｢ncia nﾃ｣o encontrada' });

        const sock = sessions.get(id);
        if (!sock) return res.status(404).json({ error: 'Sessﾃ｣o nﾃ｣o encontrada' });

        const urlPromise = sock.profilePictureUrl(jid, 'image');
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000));

        const url = await Promise.race([urlPromise, timeoutPromise]).catch(() => null);
        res.json({ url });
    } catch (err) {
        res.json({ url: null });
    }
});

// Apagar mensagem
app.post('/instances/:id/messages/delete', authenticate, async (req, res) => {
    const { id } = req.params;
    const { jid, msgId, fromMe, forEveryone } = req.body;

    // Verifica propriedade
    const instance = await prisma.instance.findUnique({ where: { id, userId: req.user.id } });
    if (!instance) return res.status(404).json({ error: 'Instﾃ｢ncia nﾃ｣o encontrada' });

    const sock = sessions.get(id);
    if (!sock) return res.status(404).json({ error: 'Instﾃ｢ncia nﾃ｣o conectada' });

    try {
        if (forEveryone && fromMe) {
            // Apaga para todos no WhatsApp
            await sock.sendMessage(jid, { delete: { remoteJid: jid, fromMe: true, id: msgId } });
        }

        // Remove do banco local em todos os casos (assim o histﾃｳrico da IA e da tela limpam na hora)
        await prisma.message.deleteMany({ where: { instanceId: id, msgId } });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Marcar conversa como lida (Visto)
app.post('/instances/:id/chats/read', authenticate, async (req, res) => {
    const { id } = req.params;
    const { jid, msgId } = req.body;

    // Verifica propriedade
    const instance = await prisma.instance.findUnique({ where: { id, userId: req.user.id } });
    if (!instance) return res.status(404).json({ error: 'Instﾃ｢ncia nﾃ｣o encontrada' });

    const sock = sessions.get(id);
    if (!sock) return res.status(404).json({ error: 'Instﾃ｢ncia nﾃ｣o conectada' });

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

// Marcar como nﾃ｣o lido (Manual)
app.patch('/instances/:id/chats/:jid/unread', authenticate, async (req, res) => {
    const { id, jid } = req.params;
    try {
        // Verifica propriedade
        const instance = await prisma.instance.findUnique({ where: { id, userId: req.user.id } });
        if (!instance) return res.status(404).json({ error: 'Instﾃ｢ncia nﾃ｣o encontrada' });

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
app.delete('/instances/:id/chats/:jid', authenticate, async (req, res) => {
    const { id, jid } = req.params;
    try {
        // Verifica propriedade
        const instance = await prisma.instance.findUnique({ where: { id, userId: req.user.id } });
        if (!instance) return res.status(404).json({ error: 'Instﾃ｢ncia nﾃ｣o encontrada' });

        // Remove do banco local as mensagens, o chat e o ESTADO DO FLUXO
        await prisma.message.deleteMany({ where: { instanceId: id, jid } });
        await prisma.chat.deleteMany({ where: { instanceId: id, jid } });
        await prisma.flowState.deleteMany({ where: { instanceId: id, jid } }).catch(() => { });

        // Avisa o front-end para limpar o indicador visual
        io.emit('chat_update', { instanceId: id, jid, inFlow: false });

        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/instances/:id/send', authenticate, async (req, res) => {
    try {
        const { id } = req.params;

        // Verifica propriedade
        const instance = await prisma.instance.findUnique({ where: { id, userId: req.user.id } });
        if (!instance) return res.status(404).json({ error: 'Instﾃ｢ncia nﾃ｣o encontrada' });

        let { jid, text } = req.body;
        const sock = sessions.get(id);
        if (!jid || typeof jid !== 'string' || !text) {
            return res.status(400).json({ error: 'JID (string) e texto sﾃ｣o obrigatﾃｳrios' });
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
                    console.warn(`[${id}] Erro de sessﾃ｣o detectado. Tentando recuperar metadados e reenviar (${attempts}/${maxAttempts})...`);

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
        const imageUrl = `https://files.digizap.com.br/products/${req.file.filename}`;
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

        if (!sock) return res.status(404).json({ error: 'Sessﾃ｣o nﾃ｣o encontrada' });
        if (!jid || !req.file) return res.status(400).json({ error: 'JID e arquivo de ﾃ｡udio sﾃ｣o obrigatﾃｳrios' });

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
                text: '�痔 ﾃ「dio',
                fromMe: true,
                timestamp: new Date(),
                status: 'sent'
            }
        });

        // Update Chat
        await prisma.chat.upsert({
            where: { instanceId_jid: { instanceId: id, jid: finalJid } },
            update: {
                lastMsg: '�痔 ﾃ「dio',
                lastMsgTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                updatedAt: new Date(),
            },
            create: {
                instanceId: id,
                jid: finalJid,
                lastMsg: '�痔 ﾃ「dio',
                lastMsgTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            }
        });

        // Clean up temp file
        fs.unlink(audioPath, (err) => {
            if (err) console.error('Erro ao apagar ﾃ｡udio temporﾃ｡rio:', err);
        });

        res.json(result);
    } catch (err) {
        console.error('ERRO AO ENVIAR ﾃゞDIO:', err);
        res.status(500).json({ error: 'Erro ao enviar ﾃ｡udio: ' + err.message });
    }
});


// 笏笏笏 ROTAS 窶� FLUXOS (FLOW BUILDER) 笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏笏

app.get('/flows', authenticate, async (req, res) => {
    try {
        const flows = await prisma.flow.findMany({
            where: { userId: req.user.id },
            orderBy: { updatedAt: 'desc' }
        });
        res.json(flows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/flows/:id', authenticate, async (req, res) => {
    try {
        const flow = await prisma.flow.findUnique({
            where: { id: req.params.id, userId: req.user.id }
        });
        if (!flow) return res.status(404).json({ error: 'Flow nﾃ｣o encontrado' });
        res.json(flow);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/flows', authenticate, async (req, res) => {
    try {
        const { id, name, trigger, status, data, instanceId } = req.body;
        const flowPayload = {
            name: name || 'Novo Fluxo',
            trigger: trigger || 'whatsapp.inbound',
            status: status || 'Rascunho',
            data: typeof data === 'string' ? data : JSON.stringify(data || { nodes: [], edges: [] }),
            instanceId: instanceId || null,
            userId: req.user.id
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

app.patch('/flows/:id', authenticate, async (req, res) => {
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



// --- CATCH-ALL PARA SLUGS E HOME (FINAL DA FILA) ---------------------------
app.get('/:slug?', async (req, res) => {
    try {
        let slug = req.params.slug;

        // Se não tem slug ou é expressamente 'home', serve a PV (Página de Vendas)
        if (!slug || slug === '' || slug.toLowerCase() === 'home') {
            return res.sendFile(path.join(__dirname, 'public-menu', 'index.html'));
        }

        // Lista exaustiva de rotas do sistema para não confundir com slugs
        const reserved = ['api', 'orders', 'auth', 'menu-assets', 'assets', 'uploads', 'favicon.ico', 'robots.txt', 'instances', 'config', 'flows', 'chats', 'messages', 'dashboard', 'settings', 'connections', 'login', 'register'];
        if (reserved.includes(slug.toLowerCase()) || slug.includes('.')) {
            return res.status(404).send('Not Found');
        }

        const user = await prisma.user.findUnique({
            where: { slug: slug.toLowerCase() },
            include: {
                settings: true,
                categories: { orderBy: { order: 'asc' } },
                products: { where: { active: true }, orderBy: { displayOrder: 'asc' } }
            }
        });

        if (user) {
            const htmlPath = path.join(__dirname, 'public-menu', 'menu.html');
            let html = fs.readFileSync(htmlPath, 'utf8');
            const settings = user.settings || {};

            // --- SSR: Renderização do Conteúdo no Servidor ---
            let menuHtml = '';
            const categories = user.categories || [];
            const products = user.products || [];

            categories.forEach(cat => {
                const catProducts = products.filter(p => p.categoryId === cat.id || p.category === cat.name);
                if (catProducts.length > 0) {
                    menuHtml += `<section class="menu-section">
                        <h2 class="section-title">${cat.name}</h2>
                        <div class="products-grid">`;

                    catProducts.forEach(p => {
                        const price = parseFloat(p.price || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                        menuHtml += `
                            <div class="product-card">
                                <div class="product-info">
                                    <h3>${p.name}</h3>
                                    <p>${p.description || ''}</p>
                                    <div class="product-price">${price}</div>
                                </div>
                            </div>`;
                    });

                    menuHtml += `</div></section>`;
                }
            });

            html = html.replace('<div id="menu-sections">', `<div id="menu-sections">${menuHtml}`);
            res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=60');

            const title = settings.businessName ? `${settings.businessName} - Cardápio Digital` : 'Cardápio Digital';
            const description = settings.seoDescription || `Confira o cardápio digital de ${settings.businessName || 'nossa loja'} e faça seu pedido online.`;
            const image = settings.logoUrl || 'https://digizap.com.br/default-logo.png';

            const metaTags = `
                <title>${title}</title>
                <meta name="description" content="${description}">
                <meta property="og:title" content="${title}">
                <meta property="og:description" content="${description}">
                <meta property="og:image" content="${image}">
                <meta property="og:type" content="website">
                <meta name="twitter:card" content="summary_large_image">
            `;

            let trackingTags = '';
            if (settings.googleAnalyticsId) {
                trackingTags += `
                <script async src="https://www.googletagmanager.com/gtag/js?id=${settings.googleAnalyticsId}"></script>
                <script>
                  window.dataLayer = window.dataLayer || [];
                  function gtag(){dataLayer.push(arguments);}
                  gtag('js', new Date());
                  gtag('config', '${settings.googleAnalyticsId}');
                </script>`;
            }
            if (settings.microsoftClarityId) {
                trackingTags += `
                <script type="text/javascript">
                    (function(c,l,a,r,i,t,y){
                        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
                        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
                        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
                    })(window, document, "clarity", "script", "${settings.microsoftClarityId}");
                </script>`;
            }
            if (settings.pixelId) {
                trackingTags += `
                <script>
                !function(f,b,e,v,n,t,s)
                {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
                n.callMethod.apply(n,arguments):n.queue.push(arguments)};
                if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
                n.queue=[];t=b.createElement(e);t.async=!0;
                t.src=v;s=b.getElementsByTagName(e)[0];
                s.parentNode.insertBefore(t,s)}(window, document,'script',
                'https://connect.facebook.net/en_US/fbevents.js');
                fbq('init', '${settings.pixelId}');
                fbq('track', 'PageView');
                </script>
                <noscript><img height="1" width="1" style="display:none"
                src="https://www.facebook.com/tr?id=${settings.pixelId}&ev=PageView&noscript=1"
                /></noscript>`;
            }

            html = html.replace('<head>', `<head>\n${metaTags}\n${trackingTags}`);
            return res.send(html);
        }
        res.sendFile(path.join(__dirname, 'public-menu', 'index.html'));
    } catch (e) {
        console.error(e);
        res.sendFile(path.join(__dirname, 'public-menu', 'index.html'));
    }
});
