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

const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "http://localhost:5173", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json());

// OpenAI Instance (Lazy initialized)
let openai = null;
const getOpenAI = async () => {
    if (!openai) {
        const config = await prisma.setting.findUnique({ where: { id: 'global' } });
        if (config?.openaiKey) {
            openai = new OpenAI({ apiKey: config.openaiKey });
        }
    }
    return openai;
};

// Baileys Instances Manager
const sessions = new Map();
const stores = new Map();

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
    } catch (e) {}
    
    const saveInterval = setInterval(() => {
        try {
            store.writeToFile(storePath);
        } catch (e) {}
    }, 10000);

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: ['ZapAlpha', 'Chrome', '1.0.0'],
        logger: pino({ level: 'silent' }),
        syncFullHistory: true
    });

    store.bind(sock.ev);

    // PERSISTENCE LOGIC
    sock.ev.on('contacts.upsert', async (contacts) => {
        for (const contact of contacts) {
            try {
                const jid = contact.id;
                const name = contact.name || contact.verifiedName || contact.notify || jid.split('@')[0];
                await prisma.chat.upsert({
                    where: { instanceId_jid: { instanceId, jid } },
                    update: { name: name },
                    create: { instanceId, jid, name: name }
                });
            } catch (e) {}
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
            } catch (e) {}
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message) return;
        const jid = msg.key.remoteJid;
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        
        if (text) {
            try {
                const messageRecord = await prisma.message.create({
                    data: {
                        msgId: msg.key.id,
                        instanceId,
                        jid,
                        text,
                        fromMe: msg.key.fromMe,
                        timestamp: new Date(msg.messageTimestamp * 1000),
                        status: 'received'
                    }
                });

                const chat = await prisma.chat.upsert({
                    where: { instanceId_jid: { instanceId, jid } },
                    update: { 
                        lastMsg: text, 
                        lastMsgTime: new Date(msg.messageTimestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        unreadCount: { increment: msg.key.fromMe ? 0 : 1 },
                        updatedAt: new Date()
                    },
                    create: {
                        instanceId,
                        jid,
                        lastMsg: text,
                        lastMsgTime: new Date(msg.messageTimestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        unreadCount: msg.key.fromMe ? 0 : 1
                    }
                });

                // AI AGENT LOGIC
                if (!msg.key.fromMe && chat.aiEnabled) {
                    const ai = await getOpenAI();
                    if (ai) {
                        const instance = await prisma.instance.findUnique({ where: { id: instanceId } });
                        const history = await prisma.message.findMany({
                            where: { instanceId, jid },
                            orderBy: { timestamp: 'desc' },
                            take: 20
                        });
                        
                        const messages = [
                            { role: 'system', content: instance.botPrompt || 'Você é um assistente prestativo.' },
                            ...history.reverse().map(m => ({
                                role: m.fromMe ? 'assistant' : 'user',
                                content: m.text
                            }))
                        ];

                        const completion = await ai.chat.completions.create({
                            model: 'gpt-3.5-turbo',
                            messages
                        });

                        const replyText = completion.choices[0].message.content;
                        await sock.sendMessage(jid, { text: replyText });
                        console.log(`[${instanceId}] AI respondeu para ${jid}: ${replyText}`);
                    }
                }
            } catch (e) {
                console.error('Erro na persistência/AI:', e.message);
            }
        }
        io.emit('new_message', { instanceId, message: msg });
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

    sock.ev.on('creds.update', saveCreds);

    sessions.set(instanceId, sock);
    stores.set(instanceId, store);
}

// API Routes
app.get('/config/keys', async (req, res) => {
    let config = await prisma.setting.findUnique({ where: { id: 'global' } });
    if (!config) config = await prisma.setting.create({ data: { id: 'global', activeModel: 'openai' } });
    res.json(config);
});

app.post('/config/keys', async (req, res) => {
    const config = await prisma.setting.upsert({
        where: { id: 'global' },
        update: req.body,
        create: { id: 'global', ...req.body }
    });
    openai = null;
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
    const { name, color } = req.body;
    const instance = await prisma.instance.update({
        where: { id },
        data: { name, color }
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
    const chats = await prisma.chat.findMany({
        where: { instanceId: req.params.id },
        orderBy: { updatedAt: 'desc' }
    });
    res.json(chats);
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
        time: new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: m.status
    }));
    res.json(formatted);
    await prisma.chat.updateMany({ where: { instanceId: id, jid }, data: { unreadCount: 0 } }).catch(() => {});
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

        const result = await sock.sendMessage(finalJid, { text });
        
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

        // Update Chat
        await prisma.chat.upsert({
            where: { instanceId_jid: { instanceId: id, jid: finalJid } },
            update: { 
                lastMsg: text, 
                lastMsgTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                updatedAt: new Date()
            },
            create: { 
                instanceId: id, 
                jid: finalJid, 
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

const PORT = 3001;
server.listen(PORT, async () => {
    console.log(`Backend rodando em http://localhost:${PORT}`);
    const instances = await prisma.instance.findMany();
    for (const inst of instances) {
        initInstance(inst.id);
    }
});
