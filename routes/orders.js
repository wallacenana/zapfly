/**
 * routes/orders.js — Agendamentos, Estoque, Disponibilidade, Calendar Sync
 */
const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const cron = require('node-cron');
const { MercadoPagoConfig, Preference } = require('mercadopago');

const { getSettings } = require('../lib/cache');

// ─── HELPERS ────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

async function getGoogleCalendar(userId) {
  try {
    const settings = await getSettings(userId);
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret || !settings?.gcalRefreshToken) {
      console.error(`[GCal] [User ${userId}] Interrompendo: Faltam credenciais no .env ou no banco.`);
      return null;
    }

    const { google } = require('googleapis');
    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      process.env.GOOGLE_REDIRECT_URI || `${process.env.PUBLIC_URL || 'http://localhost:3001'}/auth/google/callback`
    );

    oauth2Client.setCredentials({
      refresh_token: settings.gcalRefreshToken,
      access_token: settings.gcalAccessToken,
      expiry_date: settings.gcalTokenExpiry ? parseInt(settings.gcalTokenExpiry) : null
    });

    // Usa getAccessToken() que lida com o refresh automaticamente se houver refresh_token
    const { token } = await oauth2Client.getAccessToken();

    if (!token) {
      throw new Error('Não foi possível obter um Access Token válido.');
    }

    // Se o access_token mudou, atualiza no banco
    if (token !== settings.gcalAccessToken) {
      await prisma.setting.update({
        where: { userId },
        data: {
          gcalAccessToken: token,
          gcalTokenExpiry: oauth2Client.credentials.expiry_date?.toString()
        }
      });
    }

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const calendarId = settings.gcalCalendarId || 'primary';
    return { calendar, calendarId };
  } catch (e) {
    if (e.message.includes('invalid_grant') || e.code === 401) {
      console.error(`[GCal] [User ${userId}] Acesso revogado ou credenciais inválidas.`);
    } else {
      console.error(`[GCal] [User ${userId}] Erro ao autenticar:`, e.message);
    }
    return null;
  }
}

router.get('/settings/public', async (req, res) => {
  try {
    const { slug } = req.query;
    if (!slug) return res.status(400).json({ error: 'Slug é obrigatório para menu público.' });

    const user = await prisma.user.findUnique({ where: { slug } });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const settings = await getSettings(user.id);
    res.json({
      businessName: settings?.businessName || user.name || 'DigiZap Shop',
      googleApiKey: settings?.googleApiKey || '',
      deliveryRules: JSON.parse(settings?.deliveryRules || '[]'),
      maxDeliveryKm: settings?.maxDeliveryKm || 15
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/calculate-fee', async (req, res) => {
  try {
    const { address, slug } = req.body;
    if (!address) return res.status(400).json({ error: 'Endereço é obrigatório' });

    let userId = req.user?.id;
    if (!userId && slug) {
      const user = await prisma.user.findUnique({ where: { slug } });
      userId = user?.id;
    }
    if (!userId) return res.status(400).json({ error: 'User ID ou Slug não identificado.' });

    const { calculateFee } = require('../lib/maps');
    const result = await calculateFee(address, userId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sincroniza eventos do Google Calendar para o banco local
async function syncCalendarEvents(userId) {
  if (!userId) return { fetched: 0, pushed: 0 };

  const syncKey = `syncing_${userId}`;
  if (global[syncKey]) return { fetched: 0, pushed: 0 };
  global[syncKey] = true;

  try {
    const gcal = await getGoogleCalendar(userId);
    if (!gcal) {
      console.error(`[GCal Sync] [User ${userId}] Falha: Calendário não conectado.`);
      return { fetched: 0, pushed: 0 };
    }

    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const inThirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const response = await gcal.calendar.events.list({
      calendarId: gcal.calendarId,
      timeMin: startOfDay.toISOString(),
      timeMax: inThirtyDays.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.data.items || [];
    const eventIdsInGoogle = events.map(e => e.id);

    for (const event of events) {
      const allDay = !!event.start.date;
      const startAt = new Date(event.start.dateTime || event.start.date);
      const endAt = new Date(event.end.dateTime || event.end.date);

      await prisma.calendarEvent.upsert({
        where: { id: event.id },
        update: { userId, title: event.summary || 'Sem título', description: event.description, startAt, endAt, allDay, syncedAt: new Date() },
        create: { id: event.id, userId, title: event.summary || 'Sem título', description: event.description, startAt, endAt, allDay },
      });

      const hasCheck = (event.summary || '').includes('✅');
      if (event.colorId === '10' || hasCheck) {
        await prisma.order.updateMany({
          where: { userId, calendarEventId: event.id, status: { not: 'completed' } },
          data: { status: 'completed' }
        });
      }
    }

    const unsyncedOrdersWithEvents = await prisma.order.findMany({
      where: { userId, calendarEventId: { not: null, not: "" }, status: { notIn: ['cancelled', 'completed'] } }
    });

    for (const order of unsyncedOrdersWithEvents) {
      if (!eventIdsInGoogle.includes(order.calendarEventId)) {
        await prisma.order.update({ where: { id: order.id }, data: { status: 'cancelled' } });
      }
    }

    await prisma.calendarEvent.deleteMany({
      where: { userId, id: { notIn: eventIdsInGoogle }, startAt: { gte: startOfDay } }
    });

    const unsyncedOrders = await prisma.order.findMany({
      where: {
        userId,
        OR: [{ calendarEventId: null }, { calendarEventId: "" }],
        status: { in: ['accepted', 'production', 'ready'] },
        OR: [
          { type: 'order' },
          { type: 'delivery', scheduledDate: { gt: today } }
        ]
      }
    });

    let pushedCount = 0;
    for (const order of unsyncedOrders) {
      try {
        const calId = await createCalendarEvent(order);
        if (calId) pushedCount++;
      } catch (err) {
        console.error(`[GCal Sync] Erro ao sincronizar pedido ${order.id}:`, err.message);
      }
    }
    return { fetched: events.length, pushed: pushedCount };

  } catch (e) {
    console.error(`[GCal Sync] [User ${userId}] Erro:`, e.message);
    throw e;
  } finally {
    global[syncKey] = false;
  }
}

// Cria evento no Google Calendar
async function createCalendarEvent(order) {
  const today = new Date().toISOString().split('T')[0];
  // Só não manda pro calendar se for delivery para HOJE (pronta entrega imediata)
  if (order.type === 'delivery' && order.scheduledDate === today) return null;

  const gcal = await getGoogleCalendar(order.userId);
  if (!gcal) return null;

  try {
    const endDateTime = new Date(`${order.scheduledDate}T${order.scheduledTime}:00`);
    const startDateTime = new Date(endDateTime.getTime() - 60 * 60 * 1000); // 1 hora de produção
    const idShort = order.id.slice(-4).toUpperCase();
    const phone = order.clientJid ? order.clientJid.split('@')[0] : '';

    // IDEMPOTÊNCIA: Busca se já existe um evento para este pedido no Calendar
    const existingEvents = await gcal.calendar.events.list({
      calendarId: gcal.calendarId,
      q: `#${idShort}`,
      timeMin: new Date(new Date().setDate(new Date().getDate() - 7)).toISOString() // Busca na última semana
    });

    if (existingEvents.data.items && existingEvents.data.items.length > 0) {
      const found = existingEvents.data.items[0];
      // Salva no banco se estiver faltando
      if (!order.calendarEventId) {
        await prisma.order.update({ where: { id: order.id }, data: { calendarEventId: found.id } });
      }
      return found.id;
    }

    const user = await prisma.user.findUnique({ where: { id: order.userId } });
    const waLink = `https://wa.me/${phone}`;
    const systemLink = `${process.env.PUBLIC_URL || 'http://localhost:5173'}/chat?jid=${order.clientJid}`;

    const isDelivery = order.type === 'delivery' || !!order.deliveryAddress;
    const event = {
      summary: `${isDelivery ? '🚚' : '🎂'} #${idShort} - ${order.product} (${order.clientName || 'Cliente'})`,
      description: [
        `🆔 *ID DO PEDIDO:* #${idShort}`,
        `👤 *CLIENTE:* ${order.clientName || 'Não informado'}`,
        `🍰 *PRODUTO:* ${order.product}`,
        `───────────────────────`,
        order.massa ? `🍞 *MASSA:* ${order.massa}` : '',
        order.recheio ? `🍯 *RECHEIO:* ${order.recheio}` : '',
        order.topo ? `🎨 *TOPO:* ${order.topo}` : '',
        order.notes ? `📝 *OBS:* ${order.notes}` : '',
        order.deliveryAddress ? `📍 *ENTREGA:* ${order.deliveryAddress}` : '🏠 *RETIRADA NA LOJA*',
        `───────────────────────`,
        `🔗 *LINKS DE CONTATO:*`,
        `👉 [WhatsApp] ${waLink}`,
        `👉 [Abrir no Sistema] ${systemLink}`,
        `───────────────────────`,
        `⏰ RETIRADA AGENDADA: ${order.scheduledTime}`
      ].filter(Boolean).join('\n'),
      start: { dateTime: startDateTime.toISOString(), timeZone: 'America/Sao_Paulo' },
      end: { dateTime: endDateTime.toISOString(), timeZone: 'America/Sao_Paulo' },
      colorId: isDelivery ? '5' : '1', // 5: Amarelo (Banana), 1: Azul (Lavender)
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] },
    };

    const response = await gcal.calendar.events.insert({ calendarId: gcal.calendarId, resource: event });
    const calId = response.data.id;

    // Salva no banco imediatamente
    if (calId) {
      await prisma.order.update({ where: { id: order.id }, data: { calendarEventId: calId } });
    }

    return calId;
  } catch (e) {
    console.error(`[GCal] [User ${order.userId}] Erro ao criar evento:`, e.message);
    return null;
  }
}

// Atualiza evento no Google Calendar
async function updateCalendarEvent(order) {
  if (!order.calendarEventId) {
    const newId = await createCalendarEvent(order);
    return newId;
  }
  const gcal = await getGoogleCalendar(order.userId);
  if (!gcal) return null;

  try {
    const endDateTime = new Date(`${order.scheduledDate}T${order.scheduledTime}:00`);
    const startDateTime = new Date(endDateTime.getTime() - 60 * 60 * 1000);
    const idShort = order.id.slice(-4).toUpperCase();
    const phone = order.clientJid ? order.clientJid.split('@')[0] : '';

    const waLink = `https://wa.me/${phone}`;
    const systemLink = `${process.env.PUBLIC_URL || 'http://localhost:5173'}/chat?jid=${order.clientJid}`;

    const isCompleted = order.status === 'completed';
    const cleanProduct = (order.product || '').replace(/^✅\s*/, '');

    const event = {
      summary: `${isCompleted ? '✅ ' : ''}🎂 #${idShort} - ${cleanProduct} (${order.clientName || 'Cliente'})`,
      colorId: isCompleted ? '10' : null, //  verde
      description: [
        `🆔 *ID DO PEDIDO:* #${idShort}`,
        `👤 *CLIENTE:* ${order.clientName || 'Não informado'}`,
        `🍰 *PRODUTO:* ${order.product}`,
        `───────────────────────`,
        order.massa ? `🍞 *MASSA:* ${order.massa}` : '',
        order.recheio ? `🍯 *RECHEIO:* ${order.recheio}` : '',
        order.topo ? `🎨 *TOPO:* ${order.topo}` : '',
        order.notes ? `📝 *OBS:* ${order.notes}` : '',
        `───────────────────────`,
        `🔗 *LINKS DE CONTATO:*`,
        `👉 [WhatsApp] ${waLink}`,
        `👉 [Abrir no Sistema] ${systemLink}`,
        `───────────────────────`,
        `⏰ RETIRADA AGENDADA: ${order.scheduledTime}`
      ].filter(Boolean).join('\n'),
      start: { dateTime: startDateTime.toISOString(), timeZone: 'America/Sao_Paulo' },
      end: { dateTime: endDateTime.toISOString(), timeZone: 'America/Sao_Paulo' },
    };

    await gcal.calendar.events.patch({
      calendarId: gcal.calendarId,
      eventId: order.calendarEventId,
      resource: event
    });
    return order.calendarEventId;
  } catch (e) {
    console.error(`[GCal] [User ${order.userId}] Erro ao atualizar evento:`, e.message);
    return null;
  }
}

// Deleta evento no Google Calendar
async function deleteCalendarEvent(userId, calendarEventId) {
  if (!calendarEventId || !userId) return;
  const gcal = await getGoogleCalendar(userId);
  if (!gcal) return;

  try {
    await gcal.calendar.events.delete({
      calendarId: gcal.calendarId,
      eventId: calendarEventId
    });
  } catch (e) {
    if (e.code !== 404) {
      console.error(`[GCal] [User ${userId}] Erro ao remover evento:`, e.message);
    }
  }
}


// Helper para calcular o total do pedido com inteligência (storefront + IA)
async function calculateOrderTotal(data, userId) {
  let computedTotalValue = parseFloat(data.totalValue);
  if (!isNaN(computedTotalValue)) return computedTotalValue;

  computedTotalValue = 0;
  let mainProductPrice = 0;
  
  const productId = data.productId;
  const product = data.product;
  const variation = data.variation;
  const quantity = data.quantity;
  const deliveryFee = data.deliveryFee;
  const carrinho_itens_extras = data.carrinho_itens_extras;

  if (productId) {
    const p = await prisma.product.findUnique({ where: { id: productId } });
    if (p) {
      mainProductPrice = p.price;
      if (variation && p.variations) {
        try {
          const vars = typeof p.variations === 'string' ? JSON.parse(p.variations) : p.variations;
          const vObj = vars.find(v => v.name === variation);
          if (vObj && vObj.price !== undefined) mainProductPrice = vObj.price;
        } catch (e) {}
      }
    }
  } else if (product) {
    const p = await prisma.product.findFirst({ where: { userId, name: { contains: product, mode: 'insensitive' } } });
    if (p) {
      mainProductPrice = p.price;
      if (variation && p.variations) {
        try {
          const vars = typeof p.variations === 'string' ? JSON.parse(p.variations) : p.variations;
          const vObj = vars.find(v => v.name === variation);
          if (vObj && vObj.price !== undefined) mainProductPrice = vObj.price;
        } catch (e) {}
      }
    }
  }

  const mainQty = parseFloat(quantity) || 1;
  computedTotalValue += (mainProductPrice * mainQty);

  if (carrinho_itens_extras && Array.isArray(carrinho_itens_extras)) {
    for (const item of carrinho_itens_extras) {
      if (typeof item === 'object' && item !== null) {
        let itemPrice = parseFloat(item.price) || 0;
        let itemQty = parseFloat(item.quantity) || 1;
        computedTotalValue += (itemPrice * itemQty);
      } else if (typeof item === 'string') {
        const extraP = await prisma.product.findFirst({ where: { userId, name: { contains: item, mode: 'insensitive' } } });
        if (extraP) computedTotalValue += extraP.price;
      }
    }
  }

  computedTotalValue += (parseFloat(deliveryFee) || 0);
  return computedTotalValue;
}

// ─── MERCADO PAGO ───────────────────────────────────────────────────────────

async function createPaymentLink(order, settings) {
  if (!settings?.mercadopagoToken) {
    console.warn(`[MercadoPago] [User ${order.userId}] Token não configurado.`);
    return null;
  }

  try {
    const client = new MercadoPagoConfig({ accessToken: settings.mercadopagoToken });
    const preference = new Preference(client);

    const managerPhone = settings?.managerJid ? settings.managerJid.split('@')[0] : '5511999999999';
    const redirectUrl = `https://wa.me/${managerPhone}?text=Ol%C3%A1%2C+meu+pedido+%23${order.id.slice(-4).toUpperCase()}+teve+o+pagamento+processado.`;

    const preferenceBody = {
      body: {
        items: [
          {
            id: order.id,
            title: order.product,
            quantity: 1,
            unit_price: parseFloat(order.totalValue.toFixed(2)),
            currency_id: 'BRL'
          }
        ],
        back_urls: {
          success: redirectUrl,
          failure: redirectUrl,
          pending: redirectUrl
        },
        auto_return: 'approved',
        notification_url: `${process.env.PUBLIC_URL}/mercadopago/webhook?userId=${order.userId}`,
        external_reference: order.id,
        payment_methods: {
          default_payment_method_id: order.paymentMethod?.toLowerCase().includes('pix') ? 'pix' : undefined,
          default_payment_type_id: (order.paymentMethod?.toLowerCase().includes('cartão') || order.paymentMethod?.toLowerCase().includes('crédito')) ? 'credit_card' : undefined,
          installments: 12
        }
      }
    };

    const result = await preference.create(preferenceBody);

    return result.init_point;
  } catch (err) {
    console.error(`[MercadoPago] [User ${order.userId}] Erro ao criar link:`, err);
    return null;
  }
}

// Verifica disponibilidade num dia/hora
async function checkAvailability(userId, date, time, type = 'order', costToUse = 1) {
  try {
    const settings = await getSettings(userId);
    const dailyLimit = settings?.dailyMaxOrders || 10;

    // SOMA O CUSTO DE CAPACIDADE (VAGAS) DE TODOS OS PEDIDOS NO DIA
    const ordersToday = await prisma.order.findMany({
      where: {
        userId,
        scheduledDate: date,
        OR: [
          { type: 'delivery', status: { notIn: ['cancelled', 'cancelado'] } },
          { type: 'order', status: { in: ['accepted', 'production', 'ready', 'completed'] } }
        ]
      }
    });

    const productIds = ordersToday.map(o => o.productId).filter(Boolean);
    const products = await prisma.product.findMany({
      where: { userId, id: { in: productIds } }
    });

    const totalUsed = ordersToday.reduce((acc, order) => {
      const p = products.find(prod => prod.id === order.productId);
      return acc + (p?.capacityCost || 1);
    }, 0);

    if (totalUsed >= dailyLimit) {
      return { available: false, reason: `Desculpe, já atingimos nosso limite de produção para o dia ${date}.` };
    }

    if (type === 'delivery') {
      const deliveriesAtTime = await prisma.order.count({
        where: {
          userId,
          scheduledDate: date,
          scheduledTime: time,
          type: 'delivery',
          status: { notIn: ['cancelled', 'cancelado'] }
        }
      });

      if (deliveriesAtTime >= 3) {
        return { available: false, reason: `Já temos o máximo de entregas para as ${time}.` };
      }
      return { available: true, remaining: dailyLimit - totalUsed };
    }

    const endReq = new Date(`${date}T${time}:00`);
    const startReq = new Date(endReq.getTime() - 30 * 60 * 1000);

    const conflict = await prisma.calendarEvent.findFirst({
      where: {
        userId,
        OR: [
          { startAt: { lte: startReq }, endAt: { gt: startReq } },
          { startAt: { lt: endReq }, endAt: { gte: endReq } },
          { startAt: { gte: startReq }, endAt: { lte: endReq } },
          { allDay: true, startAt: { lte: startReq } }
        ]
      }
    });

    if (conflict) {
      return { available: false, reason: `Horário ocupado (conflito com ${conflict.title}).` };
    }

    return { available: true, remaining: dailyLimit - totalUsed };
  } catch (e) {
    console.error('[Availability] Erro:', e.message);
    return { available: false, reason: 'Erro ao verificar disponibilidade.' };
  }
}

// ─── CRON JOBS ───────────────────────────────────────────────────────────────

// ─── CRON JOBS ───────────────────────────────────────────────────────────────

async function setupCronJobs(sockGetter) {
  // Sincronização GCal (A cada 5 min para todos os usuários com GCal)
  cron.schedule('*/5 * * * *', async () => {
    const usersWithGCal = await prisma.setting.findMany({
      where: { gcalRefreshToken: { not: null } },
      select: { userId: true }
    });
    for (const u of usersWithGCal) {
      syncCalendarEvents(u.userId).catch(err => {
        console.error(`[Cron GCal Sync Error] User ${u.userId}:`, err.message);
      });
    }
  });

  // Lembrete de Retirada (Rodando a cada 15 min)
  cron.schedule('*/15 * * * *', async () => {
    const allSettings = await prisma.setting.findMany();
    if (!sockGetter) return;

    const now = new Date();
    const nowBR = new Date(now.getTime() - (3 * 60 * 60 * 1000));
    const todayBR = nowBR.toISOString().split('T')[0];

    for (const settings of allSettings) {
      const leadHours = settings.reminderHours || 2;
      const upcomingOrders = await prisma.order.findMany({
        where: {
          userId: settings.userId,
          scheduledDate: todayBR,
          status: { in: ['pending', 'production', 'ready'] },
          type: 'order',
          reminderSent: false
        }
      });

      const sock = sockGetter(); // Idealmente, buscar o sock da instância conectada deste user
      if (!sock) continue;

      for (const order of upcomingOrders) {
        try {
          const [hour, minute] = order.scheduledTime.split(':').map(Number);
          const pickupTime = new Date(nowBR);
          pickupTime.setHours(hour, minute, 0, 0);

          const diffHours = (pickupTime.getTime() - nowBR.getTime()) / (1000 * 60 * 60);

          if (diffHours > -0.25 && diffHours <= leadHours) {
            const msg = `Olá *${order.clientName || 'cliente'}*! 🎂\n\nSua encomenda está agendada para retirada hoje às *${order.scheduledTime}*.\n\nJá estamos nos preparativos finais! 🚀`;
            await sock.sendMessage(order.clientJid, { text: msg });
            await prisma.order.update({ where: { id: order.id }, data: { reminderSent: true } });
          }
        } catch (err) { }
      }
    }
  });

  // Relatórios Diários
  cron.schedule('0 * * * *', async () => { // Roda a cada hora e verifica se é a hora do relatório de algum user
    const currentHour = new Date().getHours();
    const settingsToReport = await prisma.setting.findMany({
      where: { reportEnabled: true, reportHour: currentHour }
    });
    for (const s of settingsToReport) {
      sendDailyReport(s.userId, sockGetter).catch(() => { });
    }
  });
}

// Gera e envia relatório diário
async function sendDailyReport(userId, sockGetter) {
  const settings = await prisma.setting.findUnique({ where: { userId } });
  if (!settings?.managerJid) return;

  const today = new Date().toISOString().split('T')[0];

  const [ordersToday, pendingOrders, allStock] = await Promise.all([
    prisma.order.findMany({ where: { userId, scheduledDate: today, status: { not: 'cancelled' } } }),
    prisma.order.findMany({ where: { userId, status: 'pending' } }),
    prisma.stockItem.findMany({ where: { userId } }),
  ]);

  const lowStockItems = allStock.filter(s => s.quantity <= s.minQuantity);

  let report = `📊 *Relatório do Dia — ${today}*\n\n`;
  report += `📅 *Agendamentos de hoje:* ${ordersToday.length}\n`;
  ordersToday.forEach(o => {
    report += `  • ${o.scheduledTime} — ${o.product} (${o.clientName || 'Cliente'})\n`;
  });

  report += `\n⏳ *Pedidos pendentes:* ${pendingOrders.length}\n`;

  if (lowStockItems.length > 0) {
    report += `\n⚠️ *Estoque baixo:*\n`;
    lowStockItems.forEach(s => {
      report += `  • ${s.name}: ${s.quantity}${s.unit} (mínimo: ${s.minQuantity}${s.unit})\n`;
    });
  } else {
    report += `\n✅ Estoque OK\n`;
  }

  const instances = await prisma.instance.findMany({ where: { userId, status: 'connected' } });
  if (instances.length > 0) {
    const sock = sockGetter(instances[0].id);
    if (sock) {
      let jid = settings.managerJid;
      if (!jid.includes('@')) jid += '@s.whatsapp.net';
      await sock.sendMessage(jid, { text: report });
    }
  }
}

// ─── ROTAS — PEDIDOS / AGENDAMENTOS ─────────────────────────────────────────

const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  const { status, date } = req.query;
  const userId = req.user.id;
  const where = { userId };

  if (date) {
    where.OR = [
      { status: { in: ['pending', 'production', 'ready'] } },
      { scheduledDate: date }
    ];
  } else {
    where.status = { in: ['waiting_payment', 'pending', 'accepted', 'production', 'ready'] };
  }

  if (status) {
    delete where.OR;
    where.status = status;
    if (date) where.scheduledDate = date;
  }

  const orders = await prisma.order.findMany({
    where,
    include: { productRelation: true },
    orderBy: [{ scheduledDate: 'asc' }, { scheduledTime: 'asc' }]
  });
  res.json(orders);
});

router.post('/', async (req, res) => {
  try {
    let { instanceId, slug, productId, product, variation, quantity, notes, scheduledDate, scheduledTime, clientName, clientJid, clientPhone, type, deliveryAddress, paymentMethod, deliveryFee, totalValue, massa, recheio, topo, addons, carrinho_itens_extras } = req.body;

    let userId = req.user?.id;
    if (!userId && instanceId) {
      const inst = await prisma.instance.findUnique({ where: { id: instanceId } });
      userId = inst?.userId;
    }
    if (!userId && slug) {
      const user = await prisma.user.findUnique({ where: { slug } });
      userId = user?.id;
    }

    if (!userId) return res.status(400).json({ error: 'User ID não identificado.' });

    const settings = await getSettings(userId);

    if (!clientJid && clientPhone) {
      let cleanPhone = clientPhone.replace(/\D/g, "");
      if (cleanPhone.length >= 10) {
        if (!cleanPhone.startsWith("55")) cleanPhone = "55" + cleanPhone;
        clientJid = `${cleanPhone}@s.whatsapp.net`;
        try {
          const sockGetter = req.app.get('getSock');
          if (sockGetter) {
            const sock = sockGetter(instanceId || 'global');
            if (sock && sock.onWhatsApp) {
              const result = await sock.onWhatsApp(clientJid);
              if (result && result.length > 0 && result[0].exists) clientJid = result[0].jid;
            }
          }
        } catch (err) { }
      }
    }

    const qtyNum = parseFloat(quantity) || 1;
    const finalClientJid = (clientJid && clientJid.trim() !== "") ? clientJid.trim() : 'manual_LOJA';
    const isManual = finalClientJid === 'manual_LOJA';

    await prisma.customer.upsert({
      where: { jid_userId: { jid: finalClientJid, userId } },
      update: { name: clientName || 'Cliente Balcão', address: deliveryAddress, lastOrderDate: new Date() },
      create: { jid: finalClientJid, userId, name: clientName || 'Cliente Balcão', address: deliveryAddress }
    });

    const computedTotal = await calculateOrderTotal(req.body, userId);

    const orderData = {
      userId,
      productId: productId || null,
      product: product || 'Produto',
      variation: variation || null,
      quantity: qtyNum.toString(),
      notes: notes || '',
      scheduledDate: scheduledDate || new Date().toISOString().split('T')[0],
      scheduledTime: scheduledTime || '00:00',
      clientName: clientName || 'Cliente',
      clientJid: finalClientJid,
      type: type || 'order',
      deliveryAddress: deliveryAddress || null,
      paymentMethod: paymentMethod || 'A definir',
      deliveryFee: parseFloat(deliveryFee) || 0,
      totalValue: computedTotal,
      status: isManual ? 'accepted' : 'pending',
      paymentStatus: isManual ? 'confirmed' : 'pending',
      instanceId: instanceId || 'global'
    };

    let order = await prisma.order.create({ data: orderData });

    // NOVO: Gerar link de pagamento se não for manual e nem pagamento em dinheiro
    if (!isManual && paymentMethod !== 'Dinheiro' && order.totalValue > 0) {
      const paymentLink = await createPaymentLink(order, settings);
      if (paymentLink) {
        order = await prisma.order.update({
          where: { id: order.id },
          data: { paymentLink, status: 'waiting_payment' }
        });
      }
    }

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/availability', async (req, res) => {
  const { date, time, slug } = req.query;
  let userId = req.user?.id;
  if (!userId && slug) {
    const user = await prisma.user.findUnique({ where: { slug } });
    userId = user?.id;
  }
  if (!userId) return res.status(400).json({ error: 'User ID não identificado.' });
  const result = await checkAvailability(userId, date, time);
  res.json(result);
});

router.get('/stock', authenticate, async (req, res) => {
  const userId = req.user.id;
  const items = await prisma.stockItem.findMany({ where: { userId }, orderBy: { name: 'asc' } });
  res.json(items);
});

router.post('/stock', authenticate, async (req, res) => {
  const userId = req.user.id;
  const item = await prisma.stockItem.create({ data: { ...req.body, userId } });
  res.json(item);
});

router.get('/products', authenticate, async (req, res) => {
  const userId = req.user.id;
  const products = await prisma.product.findMany({
    where: { userId },
    orderBy: { displayOrder: 'asc' }
  });
  res.json(products);
});

router.post('/products', authenticate, async (req, res) => {
  const userId = req.user.id;
  const product = await prisma.product.create({ data: { ...req.body, userId } });
  res.json(product);
});

router.post('/products/reorder', authenticate, async (req, res) => {
  const userId = req.user.id;
  const { items } = req.body; // Array de { id, displayOrder }

  try {
    await prisma.$transaction(
      items.map(item =>
        prisma.product.update({
          where: { id: item.id, userId }, // Garante que é do usuário
          data: { displayOrder: item.displayOrder }
        })
      )
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/categories', authenticate, async (req, res) => {
  const userId = req.user.id;
  const categories = await prisma.category.findMany({
    where: { userId },
    orderBy: { order: 'asc' }
  });
  res.json(categories);
});

router.post('/categories', authenticate, async (req, res) => {
  const userId = req.user.id;
  const count = await prisma.category.count({ where: { userId } });
  const cat = await prisma.category.create({
    data: { ...req.body, userId, order: count + 1 }
  });
  res.json(cat);
});

router.post('/categories/reorder', authenticate, async (req, res) => {
  const userId = req.user.id;
  const { items } = req.body; // Array de { id, order }

  try {
    // Prisma requires unique fields in update where clauses.
    // Since we need to update multiple, we'll verify first or just update by id.
    const allCategories = await prisma.category.findMany({ where: { userId } });
    const userCategoryIds = allCategories.map(c => c.id);

    const validItems = items.filter(item => userCategoryIds.includes(item.id));

    await prisma.$transaction(
      validItems.map(item =>
        prisma.category.update({
          where: { id: item.id },
          data: { order: item.order }
        })
      )
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/categories/:id', authenticate, async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;
  try {
    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) return res.status(403).json({ error: "Não autorizado" });

    const updateData = { ...req.body };
    delete updateData.id;
    delete updateData.userId;

    const cat = await prisma.category.update({
      where: { id },
      data: updateData
    });
    res.json(cat);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/categories/:id', authenticate, async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;
  try {
    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) return res.status(403).json({ error: "Não autorizado" });

    await prisma.category.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/history/:phone', authenticate, async (req, res) => {
  const userId = req.user.id;
  const jid = `${req.params.phone.replace(/\D/g, "")}@s.whatsapp.net`;
  const orders = await prisma.order.findMany({ where: { userId, clientJid: jid }, orderBy: { createdAt: 'desc' }, take: 10 });
  res.json(orders);
});

// Rota PÚBLICA para o cardápio digital — identifica a loja pelo slug, sem token
router.get('/history/public/:slug/:phone', async (req, res) => {
  try {
    const slug = req.params.slug.toLowerCase();
    const phone = req.params.phone.replace(/\D/g, '');
    const jid = `${phone}@s.whatsapp.net`;

    const store = await prisma.user.findFirst({ where: { slug } });
    if (!store) return res.status(404).json({ error: 'Loja não encontrada' });

    const orders = await prisma.order.findMany({
      where: { userId: store.id, clientJid: jid },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        product: true,
        variation: true,
        quantity: true,
        totalValue: true,
        type: true,
        createdAt: true
      }
    });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/calendar-sync', authenticate, async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await syncCalendarEvents(userId);
    res.json({ synced: result.fetched, pushed: result.pushed });
  } catch (err) {
    console.error('[Manual Sync Error]', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/calendar-events', authenticate, async (req, res) => {
  const userId = req.user.id;
  const events = await prisma.calendarEvent.findMany({ where: { userId }, orderBy: { startAt: 'asc' } });
  res.json(events);
});

router.get('/customers/:jid', authenticate, async (req, res) => {
  const userId = req.user.id;
  const customer = await prisma.customer.findFirst({
    where: { jid: req.params.jid, userId },
    include: { orders: { where: { userId }, orderBy: { createdAt: 'desc' }, take: 1 } }
  });
  res.json(customer);
});

router.get('/seasonal', authenticate, async (req, res) => {
  const userId = req.user.id;
  const catalogs = await prisma.seasonalCatalog.findMany({ where: { userId }, orderBy: { eventDate: 'asc' } });
  res.json(catalogs);
});

router.post('/seasonal', authenticate, async (req, res) => {
  const userId = req.user.id;
  const catalog = await prisma.seasonalCatalog.create({ data: { ...req.body, userId } });
  res.json(catalog);
});

router.patch('/seasonal/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  try {
    const catalog = await prisma.seasonalCatalog.update({
      where: { id, userId },
      data: req.body
    });
    res.json(catalog);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/seasonal/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  try {
    await prisma.seasonalCatalog.delete({ where: { id, userId } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/products/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  try {
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) return res.status(403).json({ error: "Não autorizado" });

    // Filtra dados invalidos
    const updateData = { ...req.body };
    delete updateData.id;
    delete updateData.userId;

    const product = await prisma.product.update({
      where: { id },
      data: updateData
    });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/products/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  try {
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) return res.status(403).json({ error: "Não autorizado" });

    await prisma.product.delete({
      where: { id }
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/categories/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  try {
    const cat = await prisma.category.update({
      where: { id, userId },
      data: req.body
    });
    res.json(cat);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/categories/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  try {
    await prisma.category.delete({ where: { id, userId } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/stock/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  try {
    const item = await prisma.stockItem.update({
      where: { id, userId },
      data: req.body
    });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/stock/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  try {
    await prisma.stockItem.delete({ where: { id, userId } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  try {
    // 1. Atualizar o pedido principal com o payload recebido
    let order = await prisma.order.update({
      where: { id, userId },
      data: req.body
    });

    // 2. Recalcular o valor total do pedido após o update (se necessário)
    const computedTotal = await calculateOrderTotal(order, userId);
    
    // Atualiza com o valor final recalculado
    order = await prisma.order.update({
      where: { id, userId },
      data: { totalValue: computedTotal }
    });

    // 3. Buscar as configurações do usuário
    const settings = await getSettings(userId);

    // 4. Regenerar link de pagamento se não for em dinheiro e o valor for maior que 0
    if (order.paymentMethod !== 'Dinheiro' && order.totalValue > 0) {
      const paymentLink = await createPaymentLink(order, settings);
      if (paymentLink) {
        order = await prisma.order.update({
          where: { id, userId },
          data: { paymentLink, status: 'waiting_payment' }
        });
      }
    }

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  try {
    await prisma.order.delete({ where: { id, userId } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, setupCronJobs, syncCalendarEvents, sendDailyReport, checkAvailability, updateCalendarEvent };
