/**
 * routes/orders.js — Agendamentos, Estoque, Disponibilidade, Calendar Sync
 */
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const cron = require('node-cron');

const prisma = new PrismaClient();

// ─── HELPERS ────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

async function getGoogleCalendar() {
  try {
    const settings = await prisma.setting.findUnique({ where: { id: 'global' } });
    if (!settings?.gcalClientId || !settings?.gcalClientSecret || !settings?.gcalRefreshToken) return null;

    const { google } = require('googleapis');
    const oauth2Client = new google.auth.OAuth2(
      settings.gcalClientId,
      settings.gcalClientSecret,
      'http://localhost:3001/auth/google/callback'
    );

    oauth2Client.setCredentials({
      refresh_token: settings.gcalRefreshToken,
      access_token: settings.gcalAccessToken,
      expiry_date: settings.gcalTokenExpiry ? parseInt(settings.gcalTokenExpiry) : undefined,
    });

    // Auto-refresh e salva novo token se expirado
    oauth2Client.on('tokens', async (tokens) => {
      await prisma.setting.update({
        where: { id: 'global' },
        data: {
          gcalAccessToken: tokens.access_token,
          gcalTokenExpiry: tokens.expiry_date?.toString(),
        },
      });
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const calendarId = settings.gcalCalendarId || 'primary';
    return { calendar, calendarId };
  } catch (e) {
    console.error('[GCal] Erro ao autenticar:', e.message);
    return null;
  }
}

// Sincroniza eventos do Google Calendar para o banco local
async function syncCalendarEvents() {
  const gcal = await getGoogleCalendar();
  if (!gcal) return;

  try {
    const now = new Date();
    const inThirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const response = await gcal.calendar.events.list({
      calendarId: gcal.calendarId,
      timeMin: now.toISOString(),
      timeMax: inThirtyDays.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.data.items || [];
    console.log(`[GCal Sync] ${events.length} eventos encontrados.`);

    for (const event of events) {
      const allDay = !!event.start.date;
      const startAt = new Date(event.start.dateTime || event.start.date);
      const endAt = new Date(event.end.dateTime || event.end.date);

      await prisma.calendarEvent.upsert({
        where: { id: event.id },
        update: { title: event.summary || 'Sem título', description: event.description, startAt, endAt, allDay, syncedAt: new Date() },
        create: { id: event.id, title: event.summary || 'Sem título', description: event.description, startAt, endAt, allDay },
      });
    }

    // Remove eventos antigos do cache que foram deletados no Calendar
    const eventIds = events.map(e => e.id);
    await prisma.calendarEvent.deleteMany({
      where: { id: { notIn: eventIds }, startAt: { gte: now } }
    });

    console.log('[GCal Sync] Sincronização concluída.');
  } catch (e) {
    console.error('[GCal Sync] Erro:', e.message);
  }
}

// Cria evento no Google Calendar
async function createCalendarEvent(order) {
  const gcal = await getGoogleCalendar();
  if (!gcal) return null;

  try {
    const startDateTime = new Date(`${order.scheduledDate}T${order.scheduledTime}:00`);
    const endDateTime = new Date(startDateTime.getTime() + 2 * 60 * 60 * 1000); // +2h padrão

    const event = {
      summary: `📦 ${order.product} — ${order.clientName || 'Cliente'}`,
      description: [
        order.quantity ? `Quantidade: ${order.quantity}` : '',
        order.notes ? `Observações: ${order.notes}` : '',
        order.clientJid ? `WhatsApp: ${order.clientJid.replace('@s.whatsapp.net', '')}` : '',
      ].filter(Boolean).join('\n'),
      start: { dateTime: startDateTime.toISOString(), timeZone: 'America/Sao_Paulo' },
      end: { dateTime: endDateTime.toISOString(), timeZone: 'America/Sao_Paulo' },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 60 }] },
    };

    const response = await gcal.calendar.events.insert({ calendarId: gcal.calendarId, resource: event });
    return response.data.id;
  } catch (e) {
    console.error('[GCal] Erro ao criar evento:', e.message);
    return null;
  }
}

// Verifica disponibilidade num dia/hora
async function checkAvailability(date, time) {
  const dayOfWeek = new Date(date + 'T12:00:00').getDay();
  const slots = await prisma.availableSlot.findMany({ where: { dayOfWeek } });

  if (slots.length === 0) return { available: false, reason: 'Dia não configurado para atendimento.' };

  const [hReq, mReq] = time.split(':').map(Number);
  const timeMinutes = hReq * 60 + mReq;

  const matchSlot = slots.find(slot => {
    const [hS, mS] = slot.startTime.split(':').map(Number);
    const [hE, mE] = slot.endTime.split(':').map(Number);
    return timeMinutes >= hS * 60 + mS && timeMinutes <= hE * 60 + mE;
  });

  if (!matchSlot) return { available: false, reason: `Horário ${time} fora do horário de atendimento.` };

  const ordersOnSlot = await prisma.order.count({
    where: { scheduledDate: date, scheduledTime: time, status: { not: 'cancelled' } }
  });

  if (ordersOnSlot >= matchSlot.maxOrders) {
    return { available: false, reason: `Horário ${time} já está lotado para ${date}.` };
  }

  return { available: true, slot: matchSlot };
}

// ─── CRON JOBS ───────────────────────────────────────────────────────────────

// Sincronização do Google Calendar — roda no horário configurado
async function setupCronJobs(sockGetter) {
  const settings = await prisma.setting.findUnique({ where: { id: 'global' } });

  const syncHour = settings?.gcalSyncHour ?? 6;
  cron.schedule(`0 ${syncHour} * * *`, () => {
    console.log('[Cron] Sincronizando Google Calendar...');
    syncCalendarEvents();
  });

  const reportHour = settings?.reportHour ?? 7;
  if (settings?.reportEnabled) {
    cron.schedule(`0 ${reportHour} * * *`, async () => {
      console.log('[Cron] Gerando relatório diário...');
      await sendDailyReport(sockGetter);
    });
  }

  console.log(`[Cron] GCal sync às ${syncHour}h | Relatório às ${reportHour}h`);
}

// Gera e envia relatório diário
async function sendDailyReport(sockGetter) {
  const settings = await prisma.setting.findUnique({ where: { id: 'global' } });
  if (!settings?.managerJid) return;

  const today = new Date().toISOString().split('T')[0];

  const [ordersToday, pendingOrders, lowStock] = await Promise.all([
    prisma.order.findMany({ where: { scheduledDate: today, status: { not: 'cancelled' } } }),
    prisma.order.findMany({ where: { status: 'pending' } }),
    prisma.stockItem.findMany({ where: { quantity: { lt: prisma.stockItem.fields.minQuantity } } }),
  ]);

  // Low stock manual check (SQLite não suporta filtro entre campos)
  const allStock = await prisma.stockItem.findMany();
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

  // Busca instância ativa para enviar
  const instances = await prisma.instance.findMany({ where: { status: 'connected' } });
  if (instances.length > 0) {
    const sock = sockGetter(instances[0].id);
    if (sock) {
      await sock.sendMessage(settings.managerJid, { text: report });
      console.log('[Report] Relatório enviado para', settings.managerJid);
    }
  }
}

// ─── ROTAS — PEDIDOS / AGENDAMENTOS ─────────────────────────────────────────

router.get('/', async (req, res) => {
  const { status, date, type } = req.query;
  const where = {};
  if (status) where.status = status;
  if (date) where.scheduledDate = date;
  if (type) where.type = type;

  const orders = await prisma.order.findMany({
    where,
    orderBy: [{ scheduledDate: 'asc' }, { scheduledTime: 'asc' }]
  });
  res.json(orders);
});

router.post('/', async (req, res) => {
  try {
    const { product, quantity, notes, scheduledDate, scheduledTime, clientName, clientJid, type, deliveryAddress } = req.body;

    const avail = await checkAvailability(scheduledDate, scheduledTime);
    if (!avail.available) return res.status(409).json({ error: avail.reason });

    const order = await prisma.order.create({
      data: { product, quantity, notes, scheduledDate, scheduledTime, clientName, clientJid, type: type || 'order', deliveryAddress, instanceId: 'manual' }
    });

    // Cria evento no Google Calendar
    const calendarEventId = await createCalendarEvent(order);
    if (calendarEventId) {
      await prisma.order.update({ where: { id: order.id }, data: { calendarEventId } });
    }

    // Debita estoque se produto tem receita
    const product_db = await prisma.product.findFirst({
      where: { name: { contains: product } },
      include: { ingredients: { include: { stockItem: true } } }
    });
    if (product_db && quantity) {
      const qty = parseFloat(quantity) || 1;
      for (const ing of product_db.ingredients) {
        await prisma.stockItem.update({
          where: { id: ing.stockItemId },
          data: { quantity: { decrement: ing.quantityPer * qty } }
        });
      }
    }

    res.json({ ...order, calendarEventId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/:id', async (req, res) => {
  const order = await prisma.order.update({ where: { id: req.params.id }, data: req.body });
  res.json(order);
});

router.delete('/:id', async (req, res) => {
  await prisma.order.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// Verificar disponibilidade
router.get('/availability', async (req, res) => {
  const { date, time } = req.query;
  if (!date || !time) return res.status(400).json({ error: 'date e time obrigatórios' });
  const result = await checkAvailability(date, time);
  res.json(result);
});

// Slots do dia para o calendário
router.get('/slots/:date', async (req, res) => {
  const { date } = req.params;
  const dayOfWeek = new Date(date + 'T12:00:00').getDay();
  const slots = await prisma.availableSlot.findMany({ where: { dayOfWeek } });

  const orders = await prisma.order.findMany({
    where: { scheduledDate: date, status: { not: 'cancelled' } }
  });

  const result = slots.map(slot => ({
    ...slot,
    dayName: DAY_NAMES[slot.dayOfWeek],
    ordersCount: orders.filter(o => {
      const [h, m] = o.scheduledTime.split(':').map(Number);
      const [hs, ms] = slot.startTime.split(':').map(Number);
      const [he, me] = slot.endTime.split(':').map(Number);
      const t = h * 60 + m;
      return t >= hs * 60 + ms && t <= he * 60 + me;
    }).length,
    full: orders.filter(o => o.scheduledTime === slot.startTime).length >= slot.maxOrders
  }));

  res.json(result);
});

// ─── ROTAS — DISPONIBILIDADE ─────────────────────────────────────────────────

router.get('/available-slots', async (req, res) => {
  const slots = await prisma.availableSlot.findMany({ orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] });
  res.json(slots.map(s => ({ ...s, dayName: DAY_NAMES[s.dayOfWeek] })));
});

router.post('/available-slots', async (req, res) => {
  const slot = await prisma.availableSlot.create({ data: req.body });
  res.json(slot);
});

router.patch('/available-slots/:id', async (req, res) => {
  const slot = await prisma.availableSlot.update({ where: { id: req.params.id }, data: req.body });
  res.json(slot);
});

router.delete('/available-slots/:id', async (req, res) => {
  await prisma.availableSlot.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// ─── ROTAS — ESTOQUE ─────────────────────────────────────────────────────────

router.get('/stock', async (req, res) => {
  const items = await prisma.stockItem.findMany({ orderBy: { name: 'asc' } });
  const withAlerts = items.map(i => ({ ...i, alert: i.quantity <= i.minQuantity }));
  res.json(withAlerts);
});

router.post('/stock', async (req, res) => {
  const item = await prisma.stockItem.create({ data: req.body });
  res.json(item);
});

router.patch('/stock/:id', async (req, res) => {
  const item = await prisma.stockItem.update({ where: { id: req.params.id }, data: req.body });
  res.json(item);
});

router.delete('/stock/:id', async (req, res) => {
  await prisma.stockItem.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// ─── ROTAS — PRODUTOS / RECEITAS ─────────────────────────────────────────────

router.get('/products', async (req, res) => {
  const products = await prisma.product.findMany({ include: { ingredients: { include: { stockItem: true } } } });
  res.json(products);
});

router.post('/products', async (req, res) => {
  const { name, unit, ingredients } = req.body;
  const product = await prisma.product.create({
    data: {
      name, unit: unit || 'unidade',
      ingredients: { create: ingredients?.map(i => ({ stockItemId: i.stockItemId, quantityPer: i.quantityPer })) || [] }
    },
    include: { ingredients: { include: { stockItem: true } } }
  });
  res.json(product);
});

router.delete('/products/:id', async (req, res) => {
  await prisma.product.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// ─── ROTAS — GOOGLE CALENDAR ─────────────────────────────────────────────────

router.get('/calendar-events', async (req, res) => {
  const events = await prisma.calendarEvent.findMany({
    where: { startAt: { gte: new Date() } },
    orderBy: { startAt: 'asc' }
  });
  res.json(events);
});

router.post('/calendar-sync', async (req, res) => {
  await syncCalendarEvents();
  const events = await prisma.calendarEvent.findMany({ orderBy: { startAt: 'asc' } });
  res.json({ synced: events.length });
});

// Relatório manual
router.post('/report/send', async (req, res) => {
  const { sockGetter } = req;
  await sendDailyReport(sockGetter);
  res.json({ ok: true });
});

module.exports = { router, setupCronJobs, syncCalendarEvents, sendDailyReport, checkAvailability };
