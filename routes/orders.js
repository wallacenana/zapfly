/**
 * routes/orders.js — Agendamentos, Estoque, Disponibilidade, Calendar Sync
 */
const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { checkEntitlement, hasPlanFeature } = require('../lib/plans');
const cron = require('node-cron');
const { MercadoPagoConfig, Preference } = require('mercadopago');

const { getSettings } = require('../lib/cache');

// ─── HELPERS ────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function safeJsonParse(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) return value;
  if (typeof value !== 'string') return fallback;

  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function normalizeStringArray(value) {
  const parsed = safeJsonParse(value, []);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map(item => {
      if (typeof item === 'string') return item.trim();
      if (item === null || item === undefined) return '';
      return String(item).trim();
    })
    .filter(Boolean);
}

function normalizeAddonGroupItems(value) {
  const parsed = safeJsonParse(value, []);
  if (!Array.isArray(parsed)) return '[]';

  const items = parsed
    .map(item => {
      if (!item || typeof item !== 'object') return null;
      const name = typeof item.name === 'string' ? item.name.trim() : String(item.name || '').trim();
      if (!name) return null;
      return {
        name,
        price: Number(item.price) || 0
      };
    })
    .filter(Boolean);

  return JSON.stringify(items);
}

async function getOwnedRecord(modelName, id, userId) {
  const record = await prisma[modelName].findUnique({ where: { id } });
  if (!record || record.userId !== userId) return null;
  return record;
}

async function normalizeProductAddonGroups(value, userId) {
  const parsedIds = normalizeStringArray(value);
  if (parsedIds.length === 0) return '[]';

  const allowedGroups = await prisma.addonGroup.findMany({
    where: { userId },
    select: { id: true }
  });
  const allowedIds = new Set(allowedGroups.map(group => group.id));
  const filteredIds = parsedIds.filter(id => allowedIds.has(id));
  return JSON.stringify(filteredIds);
}

async function normalizeSuggestedItemId(value, userId, currentId = null) {
  const itemId = String(value || '').trim();
  if (!itemId) return null;
  if (currentId && String(currentId) === itemId) return null;

  const exists = await prisma.product.findFirst({
    where: { id: itemId, userId },
    select: { id: true }
  });

  return exists ? itemId : null;
}

const SCHEDULING_TIME_ZONE = 'America/Sao_Paulo';
const ORDER_TIME_OPTIONS = Array.from({ length: 12 }, (_, index) => `${String(index + 9).padStart(2, '0')}:00`);

function getBrazilDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHEDULING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  return Object.fromEntries(
    parts
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );
}

function getBrazilDateString(date = new Date()) {
  const parts = getBrazilDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getBrazilTimeString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SCHEDULING_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);

  const mapped = Object.fromEntries(
    parts
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );

  return `${mapped.hour}:${mapped.minute}`;
}

function parseTimeToMinutes(time) {
  if (typeof time !== 'string') return null;
  const match = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return hours * 60 + minutes;
}

function getDayOfWeekFromDateString(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;

  const parsed = new Date(`${dateStr}T12:00:00-03:00`);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.getDay();
}

function isDateBeforeToday(dateStr) {
  if (!dateStr) return false;
  return dateStr < getBrazilDateString();
}

function getTimeWindowForOrder(dateStr, time) {
  if (!dateStr || !time) return null;
  const parsed = new Date(`${dateStr}T${time}:00-03:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    start: parsed,
    end: new Date(parsed.getTime() + 30 * 60 * 1000)
  };
}

function timeFitsSlot(time, slot) {
  const target = parseTimeToMinutes(time);
  const start = parseTimeToMinutes(slot.startTime);
  const end = parseTimeToMinutes(slot.endTime);
  if (target === null || start === null || end === null) return false;
  return target >= start && target <= end;
}

function buildDisabledTimes(reason) {
  return ORDER_TIME_OPTIONS.map(time => ({
    time,
    available: false,
    reason
  }));
}

async function getGoogleCalendar(userId) {
  try {
    const settings = await getSettings(userId);
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!settings?.gcalEnabled || !settings?.gcalRefreshToken) {
      return null;
    }

    if (!clientId || !clientSecret) {
      console.error(`[GCal] [User ${userId}] Interrompendo: Faltam credenciais no .env.`);
      return null;
    }

    const { google } = require('googleapis');
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${process.env.PUBLIC_URL || 'http://localhost:3001'}/auth/google/callback`;
    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
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
      await prisma.setting.update({
        where: { userId },
        data: {
          gcalEnabled: false,
          gcalAccessToken: null,
          gcalRefreshToken: null,
          gcalTokenExpiry: null
        }
      }).catch(() => {});
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
      businessName: settings?.businessName || user.name || 'Menzzu',
      googleApiKey: process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_KEY || process.env.GOOGLE_API_KEY || settings?.googleApiKey || '',
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
        } catch (e) { }
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
        } catch (e) { }
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

  const addonItems = safeJsonParse(data.addons, []);
  if (Array.isArray(addonItems)) {
    for (const item of addonItems) {
      if (typeof item === 'object' && item !== null) {
        const itemPrice = parseFloat(item.price) || 0;
        const itemQty = parseFloat(item.quantity) || 1;
        computedTotalValue += (itemPrice * itemQty);
      }
    }
  }

  computedTotalValue += (parseFloat(deliveryFee) || 0);
  return computedTotalValue;
}

// ─── MERCADO PAGO ───────────────────────────────────────────────────────────

async function createPaymentLink(order, settings) {
  if (!(await hasPlanFeature(prisma, order.userId, 'paymentGateway'))) {
    console.warn(`[MercadoPago] [User ${order.userId}] Recurso bloqueado pelo plano.`);
    return null;
  }
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

    if ((type || 'order') === 'order' && settings?.acceptOrders === false) {
      const reason = 'As encomendas estão desativadas no momento.';
      if (!time) {
        return { available: false, reason, date, times: buildDisabledTimes(reason) };
      }
      return { available: false, reason };
    }

    if (!date) {
      const reason = 'Data inválida.';
      if (!time) return { available: false, reason, date, used: totalUsed, limit: dailyLimit, remaining: 0, times: buildDisabledTimes(reason) };
      return { available: false, reason, used: totalUsed, limit: dailyLimit, remaining: 0 };
    }

    if (isDateBeforeToday(date)) {
      const reason = 'Data anterior a hoje.';
      if (!time) return { available: false, reason, date, times: buildDisabledTimes(reason) };
      return { available: false, reason };
    }

    // Delivery e encomendas possuem limites independentes por dia.
    const requestedType = (type || 'order') === 'delivery' ? 'delivery' : 'order';
    const ordersToday = await prisma.order.findMany({
      where: {
        userId,
        scheduledDate: date,
        type: requestedType,
        status: { notIn: ['cancelled', 'cancelado'] }
      }
    });

    const totalUsed = ordersToday.length;

    if (totalUsed >= dailyLimit) {
      const reason = `Desculpe, já atingimos nosso limite de produção para o dia ${date}.`;
      if (!time) return { available: false, reason, date, times: buildDisabledTimes(reason) };
      return { available: false, reason };
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
      return { available: true, used: totalUsed, limit: dailyLimit, remaining: dailyLimit - totalUsed };
    }

    const dayOfWeek = getDayOfWeekFromDateString(date);
    const availableSlots = await prisma.availableSlot.findMany({
      where: { userId, dayOfWeek },
      orderBy: [{ startTime: 'asc' }, { endTime: 'asc' }]
    });

    if (!time) {
      if (!availableSlots.length) {
        const reason = 'A loja está fechada neste dia.';
        return { available: false, reason, date, times: buildDisabledTimes(reason) };
      }

      const dayStart = new Date(`${date}T00:00:00-03:00`);
      const dayEnd = new Date(`${date}T23:59:59.999-03:00`);
      const calendarEvents = await prisma.calendarEvent.findMany({
        where: {
          userId,
          OR: [
            { startAt: { lte: dayEnd }, endAt: { gte: dayStart } },
            { allDay: true, startAt: { lte: dayEnd } }
          ]
        },
        orderBy: [{ startAt: 'asc' }]
      });

      const today = getBrazilDateString();
      const nowMinutes = parseTimeToMinutes(getBrazilTimeString());

      const times = ORDER_TIME_OPTIONS.map(slotTime => {
        const matchingSlots = availableSlots.filter(slot => timeFitsSlot(slotTime, slot));
        if (matchingSlots.length === 0) {
          return { time: slotTime, available: false, reason: 'Fora do horário de atendimento.' };
        }

        const timeMinutes = parseTimeToMinutes(slotTime);
        if (date === today && nowMinutes !== null && timeMinutes !== null && timeMinutes <= nowMinutes) {
          return { time: slotTime, available: false, reason: 'Horário já passou.' };
        }

        const conflict = calendarEvents.find(event => {
          const window = getTimeWindowForOrder(date, slotTime);
          if (!window) return false;
          return (
            (event.startAt <= window.start && event.endAt > window.start) ||
            (event.startAt < window.end && event.endAt >= window.end) ||
            (event.startAt >= window.start && event.endAt <= window.end) ||
            (event.allDay && event.startAt <= window.start)
          );
        });

        if (conflict) {
          return { time: slotTime, available: false, reason: `Horário ocupado (conflito com ${conflict.title}).` };
        }

        return { time: slotTime, available: true, reason: null };
      });

      const anyAvailable = times.some(item => item.available);
      return {
        available: anyAvailable,
        reason: anyAvailable ? null : 'Nenhum horário disponível para este dia.',
        date,
        used: totalUsed,
        limit: dailyLimit,
        remaining: Math.max(0, dailyLimit - totalUsed),
        times
      };
    }

    const matchingSlots = availableSlots.filter(slot => timeFitsSlot(time, slot));
    if (!matchingSlots.length) {
      return { available: false, reason: 'Fora do horário de atendimento.' };
    }

    const today = getBrazilDateString();
    const nowMinutes = parseTimeToMinutes(getBrazilTimeString());
    const timeMinutes = parseTimeToMinutes(time);
    if (date === today && nowMinutes !== null && timeMinutes !== null && timeMinutes <= nowMinutes) {
      return { available: false, reason: 'Horário já passou.' };
    }

    const window = getTimeWindowForOrder(date, time);
    if (!window) {
      return { available: false, reason: 'Horário inválido.' };
    }

    const conflict = await prisma.calendarEvent.findFirst({
      where: {
        userId,
        OR: [
          { startAt: { lte: window.start }, endAt: { gt: window.start } },
          { startAt: { lt: window.end }, endAt: { gte: window.end } },
          { startAt: { gte: window.start }, endAt: { lte: window.end } },
          { allDay: true, startAt: { lte: window.start } }
        ]
      }
    });

    if (conflict) {
      return { available: false, reason: `Horário ocupado (conflito com ${conflict.title}).` };
    }

    return { available: true, used: totalUsed, limit: dailyLimit, remaining: Math.max(0, dailyLimit - totalUsed) };
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
      where: {
        gcalEnabled: true,
        gcalRefreshToken: { not: null }
      },
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
      { status: { in: ['waiting_payment', 'pending', 'production', 'ready'] } },
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

    if (clientJid && clientJid.endsWith('@s.whatsapp.net')) {
      const phonePart = clientJid.split('@')[0].replace(/\D/g, '');
      clientJid = `${phonePart}@s.whatsapp.net`;
    } else if (clientJid && !clientJid.includes('@') && clientJid.trim() !== "") {
      let cleanPhone = clientJid.replace(/\D/g, "");
      if (cleanPhone.length >= 10) {
        if (!cleanPhone.startsWith("55")) cleanPhone = "55" + cleanPhone;
        clientJid = `${cleanPhone}@s.whatsapp.net`;
      }
    }

    const qtyNum = parseFloat(quantity) || 1;
    const orderType = type || 'order';
    const finalClientJid = (clientJid && clientJid.trim() !== "") ? clientJid.trim() : 'manual_LOJA';
    const isManual = finalClientJid === 'manual_LOJA';

    if (orderType === 'order' && settings?.acceptOrders === false && !isManual) {
      return res.status(403).json({ error: 'As encomendas estão desativadas no momento.' });
    }

    if (orderType === 'order' && !isManual) {
      if (!scheduledDate) {
        return res.status(400).json({ error: 'Data da encomenda é obrigatória.' });
      }
      if (!scheduledTime) {
        return res.status(400).json({ error: 'Horário da encomenda é obrigatório.' });
      }
      const availability = await checkAvailability(userId, scheduledDate, scheduledTime, orderType);
      if (!availability.available) {
        return res.status(400).json({ error: availability.reason || 'Horário indisponível.' });
      }
    }

    await prisma.customer.upsert({
      where: { jid_userId: { jid: finalClientJid, userId } },
      update: { name: clientName || 'Cliente Balcão', address: deliveryAddress, lastOrderDate: new Date() },
      create: { jid: finalClientJid, userId, name: clientName || 'Cliente Balcão', address: deliveryAddress }
    });

    const computedTotal = await calculateOrderTotal(req.body, userId);

    let fallbackTime = '00:00';
    try {
      fallbackTime = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    } catch (e) {
      const now = new Date();
      fallbackTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    }

    const orderData = {
      userId,
      productId: productId || null,
      product: product || 'Produto',
      variation: variation || null,
      quantity: qtyNum.toString(),
      notes: notes || '',
      scheduledDate: scheduledDate || getBrazilDateString(),
      scheduledTime: scheduledTime || fallbackTime,
      clientName: clientName || 'Cliente',
      clientJid: finalClientJid,
      clientPhone: clientPhone || (finalClientJid && finalClientJid.includes('@') ? finalClientJid.split('@')[0] : null),
      type: orderType,
      deliveryAddress: deliveryAddress || null,
      paymentMethod: paymentMethod || 'A definir',
      deliveryFee: parseFloat(deliveryFee) || 0,
      totalValue: computedTotal,
      addons: addons || null,
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
  const { date, time, slug, type } = req.query;
  let userId = req.user?.id;
  if (!userId && slug) {
    const user = await prisma.user.findUnique({ where: { slug } });
    userId = user?.id;
  }
  if (!userId) return res.status(400).json({ error: 'User ID não identificado.' });
  const result = await checkAvailability(userId, date, time, type || 'order');
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

router.get('/addon-groups', authenticate, async (req, res) => {
  const userId = req.user.id;
  const groups = await prisma.addonGroup.findMany({
    where: { userId },
    orderBy: { name: 'asc' }
  });
  res.json(groups);
});

router.post('/addon-groups', authenticate, async (req, res) => {
  const userId = req.user.id;
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nome do grupo é obrigatório.' });

  const min = Math.max(parseInt(req.body.min, 10) || 0, 0);
  const max = Math.max(parseInt(req.body.max, 10) || 1, 1);
  if (max < min) return res.status(400).json({ error: 'O máximo não pode ser menor que o mínimo.' });

  const group = await prisma.addonGroup.create({
    data: {
      name,
      min,
      max,
      items: normalizeAddonGroupItems(req.body.items),
      userId
    }
  });

  res.json(group);
});

router.patch('/addon-groups/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  try {
    const existing = await getOwnedRecord('addonGroup', id, userId);
    if (!existing) return res.status(403).json({ error: 'Não autorizado' });

    const updateData = {};

    if (Object.prototype.hasOwnProperty.call(req.body, 'name')) {
      const name = String(req.body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Nome do grupo é obrigatório.' });
      updateData.name = name;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'min')) {
      updateData.min = Math.max(parseInt(req.body.min, 10) || 0, 0);
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'max')) {
      updateData.max = Math.max(parseInt(req.body.max, 10) || 1, 1);
    }

    const nextMin = updateData.min !== undefined ? updateData.min : existing.min;
    const nextMax = updateData.max !== undefined ? updateData.max : existing.max;
    if (nextMax < nextMin) return res.status(400).json({ error: 'O máximo não pode ser menor que o mínimo.' });

    if (Object.prototype.hasOwnProperty.call(req.body, 'items')) {
      updateData.items = normalizeAddonGroupItems(req.body.items);
    }

    const group = await prisma.addonGroup.update({
      where: { id },
      data: updateData
    });

    res.json(group);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/addon-groups/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  try {
    const existing = await getOwnedRecord('addonGroup', id, userId);
    if (!existing) return res.status(403).json({ error: 'Não autorizado' });

    await prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({
        where: { userId },
        select: { id: true, addonGroups: true }
      });

      for (const product of products) {
        const currentIds = normalizeStringArray(product.addonGroups);
        if (!currentIds.includes(id)) continue;

        const nextIds = currentIds.filter(groupId => groupId !== id);
        await tx.product.update({
          where: { id: product.id },
          data: { addonGroups: JSON.stringify(nextIds) }
        });
      }

      await tx.addonGroup.delete({ where: { id } });
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
  try {
    await checkEntitlement(prisma, req.user.id, 'productLimit', await prisma.product.count({ where: { userId: req.user.id } }));
  } catch (error) {
    return res.status(403).json({ error: error.message, code: error.code, limit: error.limit });
  }
  const { name, description, price, promoPrice, image, category, categoryId, type, variations, comboItems, customFields, stock, trackStock, featured, capacityCost, bannerUrl, displayOrder, suggestedItemId } = req.body;
  const addonGroups = await normalizeProductAddonGroups(req.body.addonGroups, req.user.id);
  const suggestedId = await normalizeSuggestedItemId(suggestedItemId, req.user.id);
  const currentMaxOrder = await prisma.product.aggregate({
    where: { userId: req.user.id },
    _max: { displayOrder: true }
  });
  const nextDisplayOrder = (currentMaxOrder._max.displayOrder ?? 0) + 1;
  let resolvedCategory = category || null;
  let resolvedCategoryId = categoryId || null;
  if (resolvedCategoryId) {
    const foundCategory = await prisma.category.findFirst({ where: { id: resolvedCategoryId, userId: req.user.id } });
    if (foundCategory) {
      resolvedCategory = foundCategory.name;
    }
  }
  const product = await prisma.product.create({
    data: {
      name,
      description,
      price: parseFloat(price) || 0,
      promoPrice: promoPrice !== undefined && promoPrice !== null && promoPrice !== ''
        ? (parseFloat(promoPrice) || 0)
        : 0,
      image,
      category: resolvedCategory,
      categoryName: resolvedCategory,
      categoryId: resolvedCategoryId,
      type: type || 'delivery',
      variations: variations || '[]',
      comboItems: comboItems || '[]',
      customFields: customFields || '[]',
      stock: parseInt(stock, 10) || 0,
      trackStock: !!trackStock,
      featured: !!featured,
      bannerUrl: bannerUrl || null,
      displayOrder: parseInt(displayOrder, 10) || nextDisplayOrder,
      capacityCost: parseInt(capacityCost, 10) || 1,
      addonGroups,
      suggestedItemId: suggestedId,
      userId: req.user.id
    }
  });
  res.json(product);
});

router.post('/products/reorder', authenticate, async (req, res) => {
  const userId = req.user.id;
  const { items } = req.body; // Array de { id, displayOrder }

  try {
    const allProducts = await prisma.product.findMany({ where: { userId }, select: { id: true } });
    const allowedIds = new Set(allProducts.map(product => product.id));
    const validItems = Array.isArray(items) ? items.filter(item => allowedIds.has(item.id)) : [];

    await prisma.$transaction(
      validItems.map(item =>
        prisma.product.update({
          where: { id: item.id },
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
    const existing = await getOwnedRecord('category', id, userId);
    if (!existing) return res.status(403).json({ error: "Não autorizado" });

    const updateData = { ...req.body };
    delete updateData.id;
    delete updateData.userId;
    if (Object.prototype.hasOwnProperty.call(updateData, 'order')) {
      updateData.order = parseInt(updateData.order, 10) || 0;
    }

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
    const existing = await getOwnedRecord('category', id, userId);
    if (!existing) return res.status(403).json({ error: "Não autorizado" });

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
        status: true,
        paymentStatus: true,
        type: true,
        createdAt: true
      }
    });

    const reviews = await prisma.storeReview.findMany({
      where: {
        userId: store.id,
        orderId: { in: orders.map(order => order.id) }
      },
      select: { orderId: true }
    });

    const reviewedOrderIds = new Set(reviews.map(review => review.orderId).filter(Boolean));
    const serialized = orders.map((order) => ({
      ...order,
      totalPrice: Number(order.totalValue || 0),
      reviewed: reviewedOrderIds.has(order.id),
      canReview: !reviewedOrderIds.has(order.id) && ['accepted', 'production', 'ready', 'completed'].includes(String(order.status || '').toLowerCase())
    }));

    res.json(serialized);
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
    const existing = await getOwnedRecord('seasonalCatalog', id, userId);
    if (!existing) return res.status(403).json({ error: "Não autorizado" });

    const catalog = await prisma.seasonalCatalog.update({
      where: { id },
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
    const existing = await getOwnedRecord('seasonalCatalog', id, userId);
    if (!existing) return res.status(403).json({ error: "Não autorizado" });

    await prisma.seasonalCatalog.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/products/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  try {
    const existing = await getOwnedRecord('product', id, userId);
    if (!existing) return res.status(403).json({ error: "Não autorizado" });

    // Filtra dados invalidos
    const updateData = { ...req.body };
    delete updateData.id;
    delete updateData.userId;

    if (Object.prototype.hasOwnProperty.call(updateData, 'price')) {
      updateData.price = parseFloat(updateData.price) || 0;
    }
    if (Object.prototype.hasOwnProperty.call(updateData, 'promoPrice')) {
      updateData.promoPrice = updateData.promoPrice !== undefined && updateData.promoPrice !== null && updateData.promoPrice !== ''
        ? (parseFloat(updateData.promoPrice) || 0)
        : 0;
    }
    if (Object.prototype.hasOwnProperty.call(updateData, 'stock')) {
      updateData.stock = parseInt(updateData.stock, 10) || 0;
    }
    if (Object.prototype.hasOwnProperty.call(updateData, 'capacityCost')) {
      updateData.capacityCost = parseInt(updateData.capacityCost, 10) || 1;
    }
    if (Object.prototype.hasOwnProperty.call(updateData, 'trackStock')) {
      updateData.trackStock = !!updateData.trackStock;
    }
    if (Object.prototype.hasOwnProperty.call(updateData, 'featured')) {
      updateData.featured = !!updateData.featured;
    }
    if (Object.prototype.hasOwnProperty.call(updateData, 'displayOrder')) {
      updateData.displayOrder = parseInt(updateData.displayOrder, 10) || 0;
    }
    if (Object.prototype.hasOwnProperty.call(updateData, 'categoryId') || Object.prototype.hasOwnProperty.call(updateData, 'category')) {
      if (updateData.categoryId) {
        const foundCategory = await prisma.category.findFirst({ where: { id: updateData.categoryId, userId } });
        if (foundCategory) {
          updateData.category = foundCategory.name;
          updateData.categoryName = foundCategory.name;
        }
      } else if (updateData.category) {
        updateData.categoryName = updateData.category;
      }
    }
    if (Object.prototype.hasOwnProperty.call(updateData, 'addonGroups')) {
      updateData.addonGroups = await normalizeProductAddonGroups(updateData.addonGroups, userId);
    }
    if (Object.prototype.hasOwnProperty.call(updateData, 'suggestedItemId')) {
      updateData.suggestedItemId = await normalizeSuggestedItemId(updateData.suggestedItemId, userId, id);
    }

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
    const existing = await getOwnedRecord('product', id, userId);
    if (!existing) return res.status(403).json({ error: "Não autorizado" });

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
    const existing = await getOwnedRecord('category', id, userId);
    if (!existing) return res.status(403).json({ error: "Não autorizado" });

    const updateData = { ...req.body };
    delete updateData.id;
    delete updateData.userId;
    if (Object.prototype.hasOwnProperty.call(updateData, 'order')) {
      updateData.order = parseInt(updateData.order, 10) || 0;
    }

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
  const { id } = req.params;
  const userId = req.user.id;
  try {
    const existing = await getOwnedRecord('category', id, userId);
    if (!existing) return res.status(403).json({ error: "Não autorizado" });

    await prisma.category.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/stock/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  try {
    const existing = await getOwnedRecord('stockItem', id, userId);
    if (!existing) return res.status(403).json({ error: "Não autorizado" });

    const updateData = { ...req.body };
    delete updateData.id;
    delete updateData.userId;
    if (Object.prototype.hasOwnProperty.call(updateData, 'quantity')) {
      updateData.quantity = parseFloat(updateData.quantity) || 0;
    }
    if (Object.prototype.hasOwnProperty.call(updateData, 'minQuantity')) {
      updateData.minQuantity = parseFloat(updateData.minQuantity) || 0;
    }

    const item = await prisma.stockItem.update({
      where: { id },
      data: updateData
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
    const existing = await getOwnedRecord('stockItem', id, userId);
    if (!existing) return res.status(403).json({ error: "Não autorizado" });

    await prisma.stockItem.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  try {
    const existing = await getOwnedRecord('order', id, userId);
    if (!existing) return res.status(403).json({ error: "Não autorizado" });

    const updateData = { ...req.body };
    delete updateData.id;
    delete updateData.userId;
    if (Object.prototype.hasOwnProperty.call(updateData, 'deliveryFee')) {
      updateData.deliveryFee = parseFloat(updateData.deliveryFee) || 0;
    }
    if (Object.prototype.hasOwnProperty.call(updateData, 'totalValue')) {
      updateData.totalValue = parseFloat(updateData.totalValue) || 0;
    }
    if (Object.prototype.hasOwnProperty.call(updateData, 'reminderSent')) {
      updateData.reminderSent = !!updateData.reminderSent;
    }

    // 1. Atualizar o pedido principal com o payload recebido
    let order = await prisma.order.update({
      where: { id },
      data: updateData
    });

    // 2. Recalcular o valor total do pedido após o update (se necessário)
    const computedTotal = await calculateOrderTotal(order, userId);

    // Atualiza com o valor final recalculado
    order = await prisma.order.update({
      where: { id },
      data: { totalValue: computedTotal }
    });

    // 3. Buscar as configurações do usuário
    const settings = await getSettings(userId);

    // 4. Regenerar link de pagamento se não for em dinheiro e o valor for maior que 0
    if (order.paymentMethod !== 'Dinheiro' && order.totalValue > 0) {
      const paymentLink = await createPaymentLink(order, settings);
      if (paymentLink) {
        order = await prisma.order.update({
          where: { id },
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
    const existing = await getOwnedRecord('order', id, userId);
    if (!existing) return res.status(403).json({ error: "Não autorizado" });

    await prisma.order.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, setupCronJobs, syncCalendarEvents, sendDailyReport, checkAvailability, updateCalendarEvent };
