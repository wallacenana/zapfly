/**
 * routes/orders.js — Agendamentos, Estoque, Disponibilidade, Calendar Sync
 */
const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { checkEntitlement, hasPlanFeature } = require('../lib/plans');
const cron = require('node-cron');
const { MercadoPagoConfig, Preference, Payment, PaymentRefund } = require('mercadopago');

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
const ORDER_TIME_STEP_MINUTES = 15;
const ORDER_MINIMUM_LEAD_MINUTES = 30;

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

function formatScheduledDateForCustomer(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return 'a data combinada';

  const date = new Date(`${dateStr}T12:00:00-03:00`);
  if (Number.isNaN(date.getTime())) return 'a data combinada';

  const formatted = new Intl.DateTimeFormat('pt-BR', {
    timeZone: SCHEDULING_TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).format(date);
  const today = getBrazilDateString();
  const tomorrow = getBrazilDateString(new Date(Date.now() + (24 * 60 * 60 * 1000)));

  if (dateStr === today) return `hoje (${formatted})`;
  if (dateStr === tomorrow) return `amanhã (${formatted})`;
  return formatted;
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

function normalizeCatalogName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function normalizeVariationName(value) {
  return normalizeCatalogName(value)
    .replace(/^bolo\s+de\s+/, '')
    .replace(/\s+/g, '');
}

function parseOrderQuantity(value) {
  const normalized = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return 1;
  return Math.max(1, Number(normalized));
}

function findCatalogVariation(variations, variationName) {
  const normalizedVariation = normalizeVariationName(variationName);
  if (!normalizedVariation) return null;
  const matches = (Array.isArray(variations) ? variations : [])
    .filter(item => normalizeVariationName(item?.name) === normalizedVariation);
  return matches.find(item => !item?.hidden) || matches[0] || null;
}

async function findCatalogProduct(userId, productId, productName) {
  if (productId) {
    const byId = await prisma.product.findFirst({ where: { id: productId, userId } });
    if (byId) return byId;
  }
  const normalizedName = normalizeCatalogName(productName);
  if (!normalizedName) return null;
  const products = await prisma.product.findMany({ where: { userId } });
  return products.find(candidate => normalizeCatalogName(candidate.name) === normalizedName)
    || products.find(candidate => normalizeCatalogName(candidate.name).includes(normalizedName)
      || normalizedName.includes(normalizeCatalogName(candidate.name)))
    || null;
}

async function buildOrderCustomFields({ userId, productId, productName, notes, clientJid, instanceId }) {
  const product = await findCatalogProduct(userId, productId, productName);

  const definitions = safeJsonParse(product?.customFields, []);
  if (!Array.isArray(definitions) || !definitions.length || !notes) return null;

  const noteParts = String(notes).split(/\s*(?:\||\r?\n)\s*/);
  const fields = [];
  for (const definition of definitions) {
    const name = String(definition?.name || '').trim();
    if (!name) continue;
    const normalizedFieldName = normalizeCatalogName(name).replace(/\s*\(.+\)$/, '');
    const note = noteParts.find(part => normalizeCatalogName(part).startsWith(`${normalizedFieldName}:`));
    if (!note) continue;
    const value = note.slice(note.indexOf(':') + 1).trim();
    const type = String(definition?.type || 'text').toLowerCase();

    if (type !== 'image') {
      fields.push({ name, type, value });
      continue;
    }

    const requestedCount = Number(value.match(/\d+/)?.[0] || 0);
    if (!requestedCount || !clientJid || !instanceId) continue;
    const messages = await prisma.message.findMany({
      where: { instanceId, jid: clientJid, fromMe: false, mediaUrl: { not: null } },
      orderBy: { timestamp: 'desc' },
      take: requestedCount,
      select: { mediaUrl: true }
    });
    const urls = messages.reverse().map(message => message.mediaUrl).filter(Boolean);
    fields.push({ name, type: 'image', urls });
  }

  return fields.length ? JSON.stringify(fields) : null;
}

function isSameDayOrderAllowed(settings, date, type = 'order') {
  return type !== 'order'
    || date !== getBrazilDateString()
    || settings?.acceptSameDayOrders === true;
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

function formatMinutesAsTime(minutes) {
  const normalized = Math.max(0, Math.min(1439, minutes));
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function buildOrderTimeOptions(availableSlots) {
  const times = new Set();
  for (const slot of availableSlots || []) {
    const start = parseTimeToMinutes(slot?.startTime);
    const end = parseTimeToMinutes(slot?.endTime);
    if (start === null || end === null || end < start) continue;
    for (let minutes = start; minutes <= end; minutes += ORDER_TIME_STEP_MINUTES) {
      times.add(formatMinutesAsTime(minutes));
    }
  }
  return [...times].sort((a, b) => parseTimeToMinutes(a) - parseTimeToMinutes(b));
}

function getTimePeriod(time) {
  const minutes = parseTimeToMinutes(time);
  if (minutes === null) return null;
  if (minutes < 12 * 60) return 'manhã';
  if (minutes < 18 * 60) return 'tarde';
  return 'noite';
}

function buildAvailabilityByPeriod(times) {
  const periods = new Map();
  const availableTimes = (times || [])
    .filter(item => item?.available)
    .map(item => item.time)
    .filter(time => parseTimeToMinutes(time) !== null)
    .sort((left, right) => parseTimeToMinutes(left) - parseTimeToMinutes(right));

  for (const time of availableTimes) {
    const period = getTimePeriod(time);
    if (!period) continue;
    const ranges = periods.get(period) || [];
    const previous = ranges[ranges.length - 1];
    if (previous && parseTimeToMinutes(time) === parseTimeToMinutes(previous.end) + ORDER_TIME_STEP_MINUTES) {
      previous.end = time;
    } else {
      ranges.push({ start: time, end: time });
    }
    periods.set(period, ranges);
  }

  return ['manhã', 'tarde', 'noite']
    .filter(period => periods.has(period))
    .map(period => ({ period, ranges: periods.get(period) }));
}

function buildDisabledTimes(reason, availableSlots = []) {
  return buildOrderTimeOptions(availableSlots).map(time => ({
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
    const { address, slug, lat, lng } = req.body;
    if (!address) return res.status(400).json({ error: 'Endereço é obrigatório' });

    let userId = req.user?.id;
    if (!userId && slug) {
      const user = await prisma.user.findUnique({ where: { slug } });
      userId = user?.id;
    }
    if (!userId) return res.status(400).json({ error: 'User ID ou Slug não identificado.' });

    const { calculateFee } = require('../lib/maps');
    const coordinates = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
      ? { lat: Number(lat), lng: Number(lng) }
      : null;
    const result = await calculateFee(address, userId, coordinates);
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

function buildCalendarOrderDescription(order, links = []) {
  const rawProduct = String(order.product || 'Produto');
  const extrasMatch = rawProduct.match(/\s*\[([^\]]+)\]\s*$/);
  const productName = (extrasMatch ? rawProduct.slice(0, extrasMatch.index) : rawProduct).trim();
  const extras = extrasMatch ? extrasMatch[1].split(/,\s*/).filter(Boolean) : [];
  return [
    `ITEM ${order.quantity || '1'}x`,
    productName,
    order.variation ? `Variação: ${order.variation}` : '',
    '------------------------------',
    order.massa ? `MASSA: ${order.massa}` : '',
    order.recheio ? `RECHEIO: ${order.recheio}` : '',
    order.topo ? `TOPO: ${order.topo}` : '',
    extras.length ? `INFORMAÇÕES: ${extras.join(' | ')}` : '',
    order.notes ? `OBSERVAÇÃO: ${order.notes}` : '',
    order.deliveryAddress ? `ENTREGA: ${order.deliveryAddress}` : 'RETIRADA NA LOJA',
    '------------------------------',
    ...links
  ].filter(Boolean).join('\n');
}

function hasRequestedProductStock(product, variationName, subItemName) {
  if (!product?.trackStock) return true;
  const variations = safeJsonParse(product.variations, []);
  if (!Array.isArray(variations) || variations.length === 0) return Number(product.stock) > 0;
  const visibleVariations = variations.filter((variation) => !variation?.hidden);
  const selected = visibleVariations.find((variation) => String(variation.name || '') === String(variationName || ''));
  const candidates = selected ? [selected] : visibleVariations;
  if (selected && subItemName && Array.isArray(selected.subItems) && selected.subItems.length > 0) {
    const subItem = selected.subItems.find(item => String(item?.name || '') === String(subItemName || ''));
    return !!subItem && (!product.trackStock || Number(subItem.stock) > 0);
  }
  return candidates.some((variation) => Number(variation.stock) > 0
    || (Array.isArray(variation.subItems) && variation.subItems.some((item) => Number(item?.stock) > 0)));
}

function getOrderRecipientJid(order) {
  const storedJid = String(order?.clientJid || '').trim();
  if (storedJid.includes('@') && !storedJid.startsWith('manual_')) return storedJid;

  const digits = String(order?.clientPhone || '').replace(/\D/g, '');
  if (digits.length < 10) return '';
  const phone = digits.startsWith('55') ? digits : `55${digits}`;
  return `${phone}@s.whatsapp.net`;
}

async function notifyOrderAccepted(order, sockGetter, jidResolver) {
  let jid = getOrderRecipientJid(order);
  if (!jid || typeof sockGetter !== 'function') return;

  const sock = sockGetter(order.instanceId || 'global');
  if (!sock) return;

  if (typeof jidResolver === 'function') {
    jid = await jidResolver(jid, order.instanceId || 'global');
  }

  const product = String(order.product || 'seu pedido').replace(/\s*\[[^\]]+\]\s*$/, '').trim();
  const message = `✅ *Pedido aceito!*

Olá, *${order.clientName || 'cliente'}*! Seu pedido de *${product}* foi aceito e já entrou na nossa fila de produção. Avisaremos você assim que estiver pronto. 🎂`;
  await sock.sendMessage(jid, { text: message });
}

function getOrderCustomFieldsSummary(order) {
  const fields = safeJsonParse(order?.customFields, []);
  if (!Array.isArray(fields)) return [];

  return fields.flatMap((field) => {
    const name = String(field?.name || '').trim();
    if (!name) return [];

    if (String(field?.type || '').toLowerCase() === 'image') {
      const count = Array.isArray(field.urls) ? field.urls.filter(Boolean).length : 0;
      if (!count) return [];
      return `- *${name}:* ${count} ${count === 1 ? 'imagem foi enviada' : 'imagens foram enviadas'}.`;
    }

    const value = String(field?.value || '').trim();
    return value ? `- *${name}:* "${value}".` : [];
  });
}

async function notifyOrderStatus(order, status, sockGetter, jidResolver) {
  const isDelivery = String(order?.type || '').toLowerCase() === 'delivery';
  const isLocalConsumption = String(order?.deliveryAddress || '').trim().toLowerCase() === 'consumo no local';
  const messages = {
    accepted: isDelivery
      ? ['Pedido aceito!', 'Seu pedido foi aceito e entrou na fila de produção.']
      : ['Pedido de encomenda aceito!', 'Seu pedido de encomenda foi aceito. Quando chegar o horário agendado, vamos prepará-lo com todo carinho.'],
    production: ['Pedido em preparação!', 'Seu pedido já está sendo preparado.'],
    ready: isDelivery
      ? ['Pedido saiu para entrega!', 'Seu pedido saiu para entrega.']
      : (isLocalConsumption
          ? ['Pedido pronto!', 'Seu pedido está pronto para consumo no local.']
        : ['Pedido pronto!', 'Seu pedido está pronto para ser retirado.']),
    completed: ['Pedido finalizado!', 'Seu pedido foi finalizado e agradecemos muito pela preferência. Espero de coração que tenha ficado do jeitinho que você gostaria. Te espero na próxima! Amanhã teremos mais delícias para você.'],
    cancelled: ['Pedido cancelado', 'Seu pedido foi cancelado. Entre em contato conosco se precisar de ajuda.']
  };
  const messageData = messages[String(status || '').toLowerCase()];
  if (!messageData || typeof sockGetter !== 'function') return;

  let jid = getOrderRecipientJid(order);
  if (!jid) {
    console.warn(`[WhatsApp] Pedido ${order.id} sem telefone/JID para aviso de status.`);
    return;
  }
  const instanceId = order.instanceId || 'global';
  const sock = sockGetter(instanceId);
  if (!sock) {
    console.warn(`[WhatsApp] Nenhuma conexao disponivel para avisar o pedido ${order.id}.`);
    return;
  }
  if (!sock.user?.id) {
    console.warn(`[WhatsApp] Conexao ainda nao autenticada para avisar o pedido ${order.id}.`);
    return;
  }
  const originalJid = jid;
  if (typeof jidResolver === 'function') jid = await jidResolver(jid, instanceId);

  // Em mensagens para o proprio numero, o LID da sessao e a referencia mais confiavel.
  const ownPhoneDigits = String(sock.user?.id || '').split(':')[0].replace(/\D/g, '');
  const ownPhoneJid = ownPhoneDigits
    ? `${ownPhoneDigits.startsWith('55') ? ownPhoneDigits : `55${ownPhoneDigits}`}@s.whatsapp.net`
    : '';
  const ownLid = String(sock.user?.lid || '').split(':')[0];
  if (ownLid && originalJid === ownPhoneJid) jid = ownLid;

  // O WhatsApp pode exigir o LID mesmo quando o pedido veio com o telefone.
  if (jid.endsWith('@s.whatsapp.net') && typeof sock.onWhatsApp === 'function') {
    try {
      const lookup = await Promise.race([
        sock.onWhatsApp(jid),
        new Promise(resolve => setTimeout(() => resolve([]), 5000))
      ]);
      const resolvedJid = Array.isArray(lookup) && lookup.find(item => item?.exists && item?.jid)?.jid;
      if (resolvedJid) jid = resolvedJid;
    } catch (lookupError) {
      console.warn(`[WhatsApp] Nao foi possivel resolver o destinatario do pedido ${order.id}:`, lookupError.message);
    }
  }

  const product = String(order.product || 'seu pedido').replace(/\s*\[[^\]]+\]\s*$/, '').trim();
  const orderId = String(order.id || '').slice(-4).toUpperCase();
  const statusIcon = isDelivery && String(status || '').toLowerCase() === 'ready' ? '🚚' : '✅';
  let message = `${statusIcon} *${messageData[0]}* (#${orderId})

Olá, *${order.clientName || 'cliente'}*! ${messageData[1]}
Pedido de *${product}*.

Se precisar, pode me perguntar aqui mais informações sobre o pedido.`;

  if (String(status || '').toLowerCase() === 'accepted' && !isDelivery) {
    const settings = await getSettings(order.userId).catch(() => null);
    const reminderHours = Math.max(1, Number(settings?.reminderHours) || 2);
    const reminderLabel = `${reminderHours} ${reminderHours === 1 ? 'hora' : 'horas'}`;
    const scheduledDay = formatScheduledDateForCustomer(order.scheduledDate);
    const scheduledTime = String(order.scheduledTime || '').trim();
    const itemDescription = [product, order.variation].filter(Boolean).join(' - ');
    const extras = getOrderCustomFieldsSummary(order);
    const extrasMessage = extras.length
      ? ['', '', '*Informações extras:*', ...extras].join('\n')
      : '';

    message = `✅ *Pedido de encomenda aceito!* (#${orderId})

Olá, *${order.clientName || 'cliente'}*! Sua encomenda para *${scheduledDay}*${scheduledTime ? `, às *${scheduledTime}*` : ''} foi aceita.

Seu pedido é *${itemDescription || 'a encomenda solicitada'}*.${extrasMessage}

Não se preocupe, já está tudo certo. Vamos enviar uma mensagem *${reminderLabel} antes* do horário agendado para confirmar que continua tudo bem.

Se quiser mais informações ou precisar fazer alguma alteração, é só falar comigo por aqui. Vamos resolver qualquer necessidade do seu pedido.`;
  }
  await sock.sendMessage(jid, { text: message });
  console.log(`[WhatsApp] Aviso de status ${status} enviado para ${jid} (pedido ${order.id}).`);
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
    event.description = buildCalendarOrderDescription(order, [
      `ID DO PEDIDO: #${idShort}`,
      `CLIENTE: ${order.clientName || 'Não informado'}`,
      `WhatsApp: ${waLink}`,
      `Abrir no Sistema: ${systemLink}`,
      `HORÁRIO AGENDADO: ${order.scheduledTime}`
    ]);

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
    event.description = buildCalendarOrderDescription(order, [
      `ID DO PEDIDO: #${idShort}`,
      `CLIENTE: ${order.clientName || 'Não informado'}`,
      `WhatsApp: ${waLink}`,
      `Abrir no Sistema: ${systemLink}`,
      `HORÁRIO AGENDADO: ${order.scheduledTime}`
    ]);

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


function resolveEffectivePrice(item, fallback = 0) {
  const fallbackPrice = Number(fallback) || 0;
  const basePrice = Number(item?.price);
  const price = Number.isFinite(basePrice) && basePrice > 0 ? basePrice : fallbackPrice;
  const promoPrice = Number(item?.promoPrice);
  return Number.isFinite(promoPrice) && promoPrice > 0 && promoPrice < price ? promoPrice : price;
}

// Helper para calcular o total do pedido com inteligência (storefront + IA)
async function calculateOrderBreakdown(data, userId) {
  const providedTotal = parseFloat(data.totalValue);

  let mainProductPrice = 0;

  const productId = data.productId;
  const product = data.product;
  const variation = data.variation;
  const subItem = data.subItem;
  const quantity = data.quantity;
  const deliveryFee = data.deliveryFee;
  const carrinho_itens_extras = data.carrinho_itens_extras;

  if (productId) {
    const p = await findCatalogProduct(userId, productId, product);
    if (p) {
      mainProductPrice = resolveEffectivePrice(p);
      if (variation && p.variations) {
        try {
          const vars = typeof p.variations === 'string' ? JSON.parse(p.variations) : p.variations;
          const vObj = findCatalogVariation(vars, variation);
          if (vObj) {
            const selectedSubItem = Array.isArray(vObj.subItems)
              ? vObj.subItems.find(item => String(item?.name || '') === String(subItem || ''))
              : null;
            mainProductPrice = resolveEffectivePrice(selectedSubItem, resolveEffectivePrice(vObj, mainProductPrice));
          }
        } catch (e) { }
      }
    }
  } else if (product) {
    const p = await findCatalogProduct(userId, null, product);
    if (p) {
      mainProductPrice = resolveEffectivePrice(p);
      if (variation && p.variations) {
        try {
          const vars = typeof p.variations === 'string' ? JSON.parse(p.variations) : p.variations;
          const vObj = findCatalogVariation(vars, variation);
          if (vObj) {
            const selectedSubItem = Array.isArray(vObj.subItems)
              ? vObj.subItems.find(item => String(item?.name || '') === String(subItem || ''))
              : null;
            mainProductPrice = resolveEffectivePrice(selectedSubItem, resolveEffectivePrice(vObj, mainProductPrice));
          }
        } catch (e) { }
      }
    }
  }

  const mainQty = parseOrderQuantity(quantity);
  const productTotal = mainProductPrice * mainQty;
  let extrasTotal = 0;

  if (carrinho_itens_extras && Array.isArray(carrinho_itens_extras)) {
    for (const item of carrinho_itens_extras) {
      if (typeof item === 'object' && item !== null) {
        let itemPrice = parseFloat(item.price) || 0;
        let itemQty = parseFloat(item.quantity) || 1;
        extrasTotal += (itemPrice * itemQty);
      } else if (typeof item === 'string') {
        const normalizedItem = String(item).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const products = await prisma.product.findMany({ where: { userId } });
        const extraP = products.find(candidate => String(candidate.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(normalizedItem));
        if (extraP) extrasTotal += resolveEffectivePrice(extraP);
      }
    }
  }

  const addonItems = safeJsonParse(data.addons, []);
  let addonsTotal = 0;
  if (Array.isArray(addonItems)) {
    for (const item of addonItems) {
      if (typeof item === 'object' && item !== null) {
        const itemPrice = parseFloat(item.price) || 0;
        const itemQty = parseFloat(item.quantity) || 1;
        addonsTotal += (itemPrice * itemQty);
      }
    }
  }

  const normalizedDeliveryFee = parseFloat(deliveryFee) || 0;
  // A IA nunca define o valor: use o total informado apenas para pedidos manuais
  // sem produto identificável no catálogo.
  if (mainProductPrice <= 0 && !isNaN(providedTotal)) {
    return { productTotal: 0, extrasTotal: 0, addonsTotal: 0, deliveryFee: 0, total: Math.max(0, providedTotal) };
  }
  return {
    productTotal,
    extrasTotal,
    addonsTotal,
    deliveryFee: normalizedDeliveryFee,
    total: productTotal + extrasTotal + addonsTotal + normalizedDeliveryFee
  };
}

async function calculateOrderTotal(data, userId) {
  return (await calculateOrderBreakdown(data, userId)).total;
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
    const variationName = String(order.variation || '').trim();
    const productName = String(order.product || 'Produto')
      .replace(/\s*\[[^\]]*\]\s*$/, '')
      .replace(/\s*\([^)]*\)\s*$/, '')
      .trim() || 'Produto';
    const paymentTitle = variationName || productName;

    const managerPhone = settings?.managerJid ? settings.managerJid.split('@')[0] : '5511999999999';
    const redirectUrl = `https://wa.me/${managerPhone}?text=Ol%C3%A1%2C+meu+pedido+%23${order.id.slice(-4).toUpperCase()}+teve+o+pagamento+processado.`;

    const preferenceBody = {
      body: {
        items: [
          {
            id: order.id,
            title: paymentTitle,
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

async function refundConfirmedPayment(order, settings) {
  if (String(order.paymentStatus || '').toLowerCase() === 'refunded') return;
  if (String(order.paymentStatus || '').toLowerCase() !== 'confirmed') return;
  if (!settings?.mercadopagoToken) throw new Error('Token do Mercado Pago não configurado para estorno.');

  const client = new MercadoPagoConfig({ accessToken: settings.mercadopagoToken });
  const paymentClient = new Payment(client);
  const search = await paymentClient.search({
    options: { external_reference: order.id, sort: 'date_created', criteria: 'desc', limit: 20 }
  });
  const payment = (search.results || []).find(item => item.status === 'approved' && item.id);
  if (!payment) throw new Error('Pagamento aprovado não localizado para este pedido.');

  const refundClient = new PaymentRefund(client);
  await refundClient.total({ payment_id: payment.id });
}

// Verifica disponibilidade num dia/hora
async function checkAvailability(userId, date, time, type = 'order', costToUse = 1) {
  try {
    const settings = await getSettings(userId);
    const dailyLimit = settings?.dailyMaxOrders || 10;

    if ((type || 'order') === 'order' && settings?.acceptOrders === false) {
      const reason = 'As encomendas estão desativadas no momento.';
      if (!time) {
        return { available: false, reason, date, times: [] };
      }
      return { available: false, reason };
    }

    if (!date) {
      const reason = 'Data inválida.';
      if (!time) return { available: false, reason, date, used: 0, limit: dailyLimit, remaining: 0, times: [] };
      return { available: false, reason, used: 0, limit: dailyLimit, remaining: 0 };
    }

    if (isDateBeforeToday(date)) {
      const reason = 'Data anterior a hoje.';
      if (!time) return { available: false, reason, date, times: [] };
      return { available: false, reason };
    }

    if (!isSameDayOrderAllowed(settings, date, type || 'order')) {
      const reason = 'Encomendas para o mesmo dia não estão disponíveis.';
      if (!time) return { available: false, reason, date, times: [] };
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
      if (!time) return { available: false, reason, date, times: [] };
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
        return { available: false, reason, date, times: [] };
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

      const times = buildOrderTimeOptions(availableSlots).map(slotTime => {
        const matchingSlots = availableSlots.filter(slot => timeFitsSlot(slotTime, slot));
        if (matchingSlots.length === 0) {
          return { time: slotTime, available: false, reason: 'Fora do horário de atendimento.' };
        }

        const timeMinutes = parseTimeToMinutes(slotTime);
        if (date === today && nowMinutes !== null && timeMinutes !== null && timeMinutes < nowMinutes + ORDER_MINIMUM_LEAD_MINUTES) {
          return { time: slotTime, available: false, reason: 'Horário já passou.' };
        }

        const slotWithCapacity = matchingSlots.find(slot => {
          const slotStart = parseTimeToMinutes(slot.startTime);
          const slotEnd = parseTimeToMinutes(slot.endTime);
          const ordersInSlot = ordersToday.filter(order => {
            const orderTime = parseTimeToMinutes(order.scheduledTime);
            return orderTime !== null && orderTime >= slotStart && orderTime <= slotEnd;
          }).length;
          return ordersInSlot < Math.max(1, Number(slot.maxOrders || 10));
        });
        if (!slotWithCapacity) {
          return { time: slotTime, available: false, reason: 'Limite de encomendas atingido neste horário.' };
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
        availabilityByPeriod: buildAvailabilityByPeriod(times),
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
    if (date === today && nowMinutes !== null && timeMinutes !== null && timeMinutes < nowMinutes + ORDER_MINIMUM_LEAD_MINUTES) {
      return { available: false, reason: 'Horário já passou.' };
    }

    const slotWithCapacity = matchingSlots.find(slot => {
      const slotStart = parseTimeToMinutes(slot.startTime);
      const slotEnd = parseTimeToMinutes(slot.endTime);
      const ordersInSlot = ordersToday.filter(order => {
        const orderTime = parseTimeToMinutes(order.scheduledTime);
        return orderTime !== null && orderTime >= slotStart && orderTime <= slotEnd;
      }).length;
      return ordersInSlot < Math.max(1, Number(slot.maxOrders || 10));
    });
    if (!slotWithCapacity) {
      return { available: false, reason: 'Limite de encomendas atingido neste horário.' };
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

async function setupCronJobs(sockGetter, jidResolver) {
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

  // Lembrete de retirada. Executa a cada minuto para respeitar o horário configurado.
  cron.schedule('* * * * *', async () => {
    const allSettings = await prisma.setting.findMany();
    if (!sockGetter) return;

    const now = new Date();
    const todayBR = getBrazilDateString(now);

    for (const settings of allSettings) {
      const leadHours = Number.isFinite(Number(settings.reminderHours)) ? Number(settings.reminderHours) : 2;
      const connectedInstances = await prisma.instance.findMany({
        where: { userId: settings.userId, status: 'connected' },
        select: { id: true },
        orderBy: { updatedAt: 'desc' }
      });
      const upcomingOrders = await prisma.order.findMany({
        where: {
          userId: settings.userId,
          scheduledDate: todayBR,
          status: { in: ['accepted', 'pending', 'production', 'ready'] },
          type: 'order',
          reminderSent: false,
          clientJid: { not: null }
        }
      });

      for (const order of upcomingOrders) {
        try {
          if (!order.scheduledTime || !order.clientJid) continue;
          const pickupTime = getTimeWindowForOrder(order.scheduledDate, order.scheduledTime)?.start;
          if (!pickupTime) continue;
          const diffMinutes = (pickupTime.getTime() - now.getTime()) / 60000;

          if (diffMinutes > leadHours * 60 || diffMinutes <= -15) continue;
          {
            const preferredInstanceId = order.instanceId && order.instanceId !== 'global' ? order.instanceId : null;
            const activeInstance = preferredInstanceId && sockGetter(preferredInstanceId)?.user?.id
              ? preferredInstanceId
              : connectedInstances.find(instance => sockGetter(instance.id)?.user?.id)?.id;
            const instanceId = activeInstance || preferredInstanceId || order.instanceId || 'global';
            const sock = sockGetter(instanceId);
            if (!sock?.user?.id) {
              console.warn(`[Reminder] Sem conexão autenticada para o pedido ${order.id} (instância ${instanceId}).`);
              continue;
            }
            let recipientJid = getOrderRecipientJid(order);
            if (typeof jidResolver === 'function') recipientJid = await jidResolver(recipientJid, instanceId);
            if (!recipientJid) continue;

            // Claims the reminder before sending so overlapping cron runs cannot duplicate it.
            const claimed = await prisma.order.updateMany({
              where: { id: order.id, reminderSent: false },
              data: { reminderSent: true }
            });
            if (claimed.count !== 1) continue;

            try {
              const reminderMessage = `Ol\u00e1 *${order.clientName || 'cliente'}*! \ud83c\udf82\n\nSua encomenda est\u00e1 agendada para retirada hoje \u00e0s *${order.scheduledTime}*.\n\nJ\u00e1 estamos nos preparativos finais! \ud83d\ude80`;
              const result = await sock.sendMessage(recipientJid, { text: reminderMessage });
              console.log(`[Reminder] Enviado: pedido=${order.id} destinatário=${recipientJid} horário=${order.scheduledDate} ${order.scheduledTime} msgId=${result?.key?.id || 'não informado'}`);
            } catch (sendError) {
              await prisma.order.update({ where: { id: order.id }, data: { reminderSent: false } }).catch(() => { });
              throw sendError;
            }
          }
        } catch (err) {
          console.error(`[Reminder] Falha ao enviar pedido ${order.id}:`, err.message);
        }
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
    // Encomendas aguardando decisão ficam na fila geral, independente da data agendada.
    where.OR = [
      { type: 'order', status: { in: ['waiting_payment', 'pending'] } },
      { type: 'delivery', status: { in: ['waiting_payment', 'pending'] } },
      { scheduledDate: date, status: { notIn: ['waiting_payment', 'pending'] } }
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
  const addonGroups = await prisma.addonGroup.findMany({
    where: { userId },
    select: { id: true, name: true, max: true, items: true }
  });
  const addonGroupMap = new Map(addonGroups.map(group => [group.id, group]));
  const enrichedOrders = orders.map(order => {
    if (!order.productRelation?.addonGroups) return order;
    const groupIds = safeJsonParse(order.productRelation.addonGroups, []);
    const addonGroupDefinitions = (Array.isArray(groupIds) ? groupIds : [])
      .map(groupId => addonGroupMap.get(groupId))
      .filter(Boolean);
    return {
      ...order,
      productRelation: { ...order.productRelation, addonGroupDefinitions }
    };
  });
  res.json(enrichedOrders);
});

router.post('/', async (req, res) => {
  try {
    let { instanceId, slug, productId, product, variation, subItem, quantity, notes, scheduledDate, scheduledTime, clientName, clientJid, clientPhone, type, deliveryAddress, paymentMethod, deliveryFee, totalValue, massa, recheio, topo, addons, carrinho_itens_extras, cartItems } = req.body;

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

    console.log('[Orders][CREATE_INPUT]', JSON.stringify({
      internal: !!req.user?.internal, userId, instanceId, productId, product,
      variation, subItem, quantity, deliveryFee, totalValue, addons
    }));

    const orderType = type || 'order';
    const normalizedPaymentMethod = String(paymentMethod || '').trim().toLowerCase();
    const isCashPayment = ['dinheiro', 'cash'].includes(normalizedPaymentMethod);
    // Dinheiro no delivery nao depende de configuracao do gateway para criar o pedido.
    const settings = (orderType === 'order' || !isCashPayment) ? await getSettings(userId) : null;

    if (!clientJid && clientPhone) {
      let cleanPhone = clientPhone.replace(/\D/g, "");
      if (cleanPhone.length >= 10) {
        if (!cleanPhone.startsWith("55")) cleanPhone = "55" + cleanPhone;
        clientJid = `${cleanPhone}@s.whatsapp.net`;
        // Nao consulte onWhatsApp aqui: a consulta ao Baileys pode expirar e
        // bloquear a criacao do pedido. O JID por telefone ja e suficiente.
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

    const qtyNum = parseOrderQuantity(quantity);
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

    if (orderType === 'delivery') {
      const requestedItems = Array.isArray(cartItems) && cartItems.length > 0
        ? cartItems
        : [{ productId, variation, subItem }];
      const productIds = [...new Set(requestedItems.map((item) => item?.productId).filter(Boolean))];
      const productsForStock = productIds.length > 0
        ? await prisma.product.findMany({ where: { userId, id: { in: productIds } } })
        : [];
      const productsById = new Map(productsForStock.map((item) => [item.id, item]));
      const unavailable = requestedItems.find((item) => {
        const productRecord = productsById.get(item?.productId);
        return productRecord && (productRecord.active === false || !hasRequestedProductStock(productRecord, item?.variation, item?.subItem));
      });
      if (unavailable) {
        return res.status(409).json({ error: 'Este produto está esgotado no momento.' });
      }

      // Reserva estoque simples de forma condicional para evitar venda acima do limite
      // quando dois clientes finalizam pedidos ao mesmo tempo.
      const reservedStock = [];
      try {
        for (const item of requestedItems) {
          const productRecord = productsById.get(item?.productId);
          const variations = safeJsonParse(productRecord?.variations, []);
          const hasVariations = Array.isArray(variations) && variations.length > 0;
          const itemQuantity = Math.max(1, parseInt(item?.quantity, 10) || 1);
          if (!productRecord?.trackStock) continue;

          if (hasVariations) {
            const nextVariations = JSON.parse(JSON.stringify(variations));
            const selectedVariation = nextVariations.find(v => String(v?.name || '') === String(item?.variation || ''));
            if (!selectedVariation) {
              throw Object.assign(new Error('A variação selecionada não existe.'), { statusCode: 409 });
            }

            const subItems = Array.isArray(selectedVariation.subItems) ? selectedVariation.subItems : [];
            if (subItems.length > 0) {
              const selectedSubItem = subItems.find(sub => String(sub?.name || '') === String(item?.subItem || ''));
              if (!selectedSubItem || Number(selectedSubItem.stock) < itemQuantity) {
                throw Object.assign(new Error('Esta combinação não está disponível no momento.'), { statusCode: 409 });
              }
              selectedSubItem.stock = Number(selectedSubItem.stock) - itemQuantity;
            } else {
              if (Number(selectedVariation.stock) < itemQuantity) {
                throw Object.assign(new Error('Esta variação não está disponível no momento.'), { statusCode: 409 });
              }
              selectedVariation.stock = Number(selectedVariation.stock) - itemQuantity;
            }

            await prisma.product.update({
              where: { id: productRecord.id },
              data: { variations: JSON.stringify(nextVariations) }
            });
            reservedStock.push({ id: productRecord.id, previousVariations: productRecord.variations });
            productRecord.variations = JSON.stringify(nextVariations);
            continue;
          }

          const updated = await prisma.product.updateMany({
            where: {
              id: productRecord.id,
              userId,
              active: true,
              stock: { gte: itemQuantity }
            },
            data: { stock: { decrement: itemQuantity } }
          });
          if (updated.count !== 1) {
            throw Object.assign(new Error('Este produto nao esta disponivel no momento.'), { statusCode: 409 });
          }
          reservedStock.push({ id: productRecord.id, quantity: itemQuantity });
          productRecord.stock = Number(productRecord.stock) - itemQuantity;
        }
      } catch (reservationError) {
        for (const item of reservedStock.reverse()) {
          if (item.previousVariations !== undefined) {
            await prisma.product.update({
              where: { id: item.id },
              data: { variations: item.previousVariations }
            }).catch(() => {});
          } else {
            await prisma.product.update({
              where: { id: item.id },
              data: { stock: { increment: item.quantity } }
            }).catch(() => {});
          }
        }
        return res.status(reservationError.statusCode || 409).json({ error: reservationError.message });
      }
    }

    const existingCustomer = await prisma.customer.findUnique({
      where: { jid_userId: { jid: finalClientJid, userId } },
      select: { name: true }
    });
    const resolvedClientName = String(clientName || existingCustomer?.name || 'Cliente').trim() || 'Cliente';

    await prisma.customer.upsert({
      where: { jid_userId: { jid: finalClientJid, userId } },
      update: { name: resolvedClientName, address: deliveryAddress, lastOrderDate: new Date() },
      create: { jid: finalClientJid, userId, name: resolvedClientName, address: deliveryAddress }
    });

    const catalogProduct = await findCatalogProduct(userId, productId, product);
    if (!productId && catalogProduct) productId = catalogProduct.id;
    const breakdown = await calculateOrderBreakdown({ ...req.body, productId }, userId);
    const computedTotal = breakdown.total;
    console.log('[Orders][CREATE_CALCULATED]', JSON.stringify({
      productId, product, variation, quantity: qtyNum, ...breakdown
    }));
    const customFields = await buildOrderCustomFields({
      userId,
      productId,
      productName: product,
      notes,
      clientJid: finalClientJid,
      instanceId: instanceId || 'global'
    });

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
      notes: [notes, subItem ? ('Subvariação: ' + subItem) : ''].filter(Boolean).join(' | '),
      scheduledDate: scheduledDate || getBrazilDateString(),
      scheduledTime: scheduledTime || fallbackTime,
      clientName: resolvedClientName,
      clientJid: finalClientJid,
      clientPhone: clientPhone || (finalClientJid && finalClientJid.includes('@') ? finalClientJid.split('@')[0] : null),
      type: orderType,
      deliveryAddress: deliveryAddress || null,
      paymentMethod: isCashPayment ? 'dinheiro' : (paymentMethod || 'A definir'),
      deliveryFee: parseFloat(deliveryFee) || 0,
      totalValue: computedTotal,
      addons: addons || null,
      customFields,
      cartItems: Array.isArray(cartItems) ? JSON.stringify(cartItems) : null,
      // Pedido público só entra na operação depois da confirmação do pagamento.
      status: isManual ? 'accepted' : (isCashPayment ? 'pending' : 'waiting_payment'),
      paymentStatus: isManual ? 'confirmed' : 'pending',
      instanceId: instanceId || 'global'
    };

    let order;
    try {
      order = await prisma.order.create({ data: orderData });
      console.log('[Orders][CREATE_SAVED]', JSON.stringify({ id: order.id, productId: order.productId, totalValue: order.totalValue }));
    } catch (createError) {
      // Compatibilidade durante o deploy: permite criar pedidos enquanto a
      // colunas novas ainda nao foram aplicadas no banco de producao.
      const unavailableColumns = createError?.code === 'P2022'
        || /Unknown argument `(cartItems|customFields)`|column `(cartItems|customFields)` does not exist/i.test(String(createError?.message || ''));
      if (!unavailableColumns) throw createError;
      console.warn('[Orders] Colunas novas ausentes; criando pedido em modo de compatibilidade. Aplique prisma migrate deploy.');
      const legacyOrderData = { ...orderData };
      delete legacyOrderData.cartItems;
      delete legacyOrderData.customFields;
      // Usa um campo legado existente para nao perder os demais itens durante
      // o periodo em que a migracao ainda nao foi aplicada.
      legacyOrderData.addons = JSON.stringify({
        cartItems: Array.isArray(cartItems) ? cartItems : [],
        addons: addons || null
      });
      order = await prisma.order.create({ data: legacyOrderData });
    }

    // Pagamento em dinheiro nao passa pelo webhook do Mercado Pago.
    // Emite o mesmo evento para atualizar o dashboard e tocar o ding global.
    if (isCashPayment && !isManual) {
      const io = req.app.get('io');
      if (io) io.emit('new_order_pending', {
        orderId: order.id,
        status: order.status,
        paymentMethod: order.paymentMethod
      });
    }

    // NOVO: Gerar link de pagamento se não for manual e nem pagamento em dinheiro
    let paymentError = null;
    if (!isManual && !isCashPayment && order.totalValue > 0) {
      const gatewayEnabled = await hasPlanFeature(prisma, userId, 'paymentGateway');
      if (!gatewayEnabled) {
        paymentError = 'O pagamento online está disponível apenas no plano Ilimitado.';
      } else if (!settings?.mercadopagoToken) {
        paymentError = 'O Mercado Pago ainda não foi configurado para esta loja.';
      }

      const paymentLink = paymentError ? null : await createPaymentLink(order, settings);
      if (paymentLink) {
        order = await prisma.order.update({
          where: { id: order.id },
          data: { paymentLink, status: 'waiting_payment' }
        });
      } else if (!paymentError) {
        paymentError = 'Não foi possível gerar o link do Mercado Pago. Verifique a integração.';
      }
    }

    res.json(paymentError ? { ...order, paymentError } : order);
  } catch (err) {
    console.error(`[Orders][CREATE_ERROR] user=${req.user?.id || 'instance'} status=${err.status || err.statusCode || 500} message=${err.message}`);
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
      price: Math.max(0, parseFloat(price) || 0),
      promoPrice: promoPrice !== undefined && promoPrice !== null && promoPrice !== ''
        ? Math.max(0, parseFloat(promoPrice) || 0)
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
      updateData.price = Math.max(0, parseFloat(updateData.price) || 0);
    }
    if (Object.prototype.hasOwnProperty.call(updateData, 'promoPrice')) {
      updateData.promoPrice = updateData.promoPrice !== undefined && updateData.promoPrice !== null && updateData.promoPrice !== ''
        ? Math.max(0, parseFloat(updateData.promoPrice) || 0)
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
    delete updateData.orderId;

    console.log('[Orders][UPDATE_INPUT]', JSON.stringify({ id, internal: !!req.user?.internal, userId, payload: updateData }));
    if (req.user?.internal) delete updateData.totalValue;
    if (req.user?.internal && updateData.quantity && parseOrderQuantity(updateData.quantity) === 1 && !/^1(?:\.0+)?$/.test(String(updateData.quantity).trim())) {
      updateData.variation = updateData.variation || updateData.quantity;
      delete updateData.quantity;
    }

    const isCancellation = ['cancelled', 'canceled', 'cancelado'].includes(String(updateData.status || '').toLowerCase());
    const isCashOrder = String(existing.paymentMethod || '').trim().toLowerCase() === 'dinheiro';
    if (String(updateData.status || '').toLowerCase() === 'production'
      && String(existing.type || 'order').toLowerCase() === 'delivery'
      && String(existing.paymentStatus || '').toLowerCase() !== 'confirmed'
      && !isCashOrder) {
      return res.status(400).json({ error: 'Delivery só pode entrar em produção após a confirmação do pagamento.' });
    }

    if (isCancellation && String(existing.paymentStatus || '').toLowerCase() === 'confirmed') {
      try {
        await refundConfirmedPayment(existing, await getSettings(userId));
        updateData.paymentStatus = 'refunded';
      } catch (refundError) {
        console.error(`[MercadoPago] Falha ao estornar pedido ${id}:`, refundError);
        return res.status(502).json({ error: `Pedido nao cancelado: ${refundError.message}` });
      }
    }

    if (Object.prototype.hasOwnProperty.call(updateData, 'deliveryFee')) {
      updateData.deliveryFee = parseFloat(updateData.deliveryFee) || 0;
    }
    if (Object.prototype.hasOwnProperty.call(updateData, 'totalValue')) {
      updateData.totalValue = parseFloat(updateData.totalValue) || 0;
    }
    if (Object.prototype.hasOwnProperty.call(updateData, 'reminderSent')) {
      updateData.reminderSent = !!updateData.reminderSent;
    }
    if (Object.prototype.hasOwnProperty.call(updateData, 'scheduledDate')
      || Object.prototype.hasOwnProperty.call(updateData, 'scheduledTime')) {
      updateData.reminderSent = false;
    }

    // A IA atualiza o pedido à medida que coleta os dados. Reconstroi os campos
    // extras aqui para vincular as imagens recebidas pelo WhatsApp ao pedido.
    if (Object.prototype.hasOwnProperty.call(updateData, 'notes')
      || Object.prototype.hasOwnProperty.call(updateData, 'product')
      || Object.prototype.hasOwnProperty.call(updateData, 'productId')) {
      const customFields = await buildOrderCustomFields({
        userId,
        productId: updateData.productId || existing.productId,
        productName: updateData.product || existing.product,
        notes: updateData.notes ?? existing.notes,
        clientJid: existing.clientJid,
        instanceId: existing.instanceId || 'global'
      });
      if (customFields) updateData.customFields = customFields;
      console.log('[Orders][UPDATE_ATTACHMENTS]', JSON.stringify({
        id,
        rebuilt: !!customFields,
        fields: customFields ? safeJsonParse(customFields, []).map(field => ({
          name: field.name,
          type: field.type,
          attachments: Array.isArray(field.urls) ? field.urls.length : 0
        })) : []
      }));
    }

    // 1. Atualizar o pedido principal com o payload recebido
    let order = await prisma.order.update({
      where: { id },
      data: updateData
    });

    if (String(updateData.status || '').toLowerCase() === 'accepted'
      && String(existing.status || '').toLowerCase() !== 'accepted') {
      try {
        await notifyOrderStatus(order, updateData.status, req.app.get('getSock'), req.app.get('resolveChatJid'));
      } catch (notifyError) {
        console.error(`[WhatsApp] Falha ao avisar aceite do pedido ${id}:`, notifyError.message);
      }
    }

    // 2. Recalcular o valor total do pedido após o update (se necessário)
    if (String(updateData.status || '').toLowerCase() !== 'accepted'
      && String(existing.status || '').toLowerCase() !== String(updateData.status || '').toLowerCase()) {
      try {
        await notifyOrderStatus(order, updateData.status, req.app.get('getSock'), req.app.get('resolveChatJid'));
      } catch (notifyError) {
        console.error(`[WhatsApp] Falha ao avisar status do pedido ${id}:`, notifyError.message);
      }
    }

    const computedTotal = await calculateOrderTotal(order, userId);
    console.log('[Orders][UPDATE_CALCULATED]', JSON.stringify({
      id, productId: order.productId, product: order.product, variation: order.variation,
      quantity: order.quantity, deliveryFee: order.deliveryFee, totalValue: computedTotal
    }));

    // Atualiza com o valor final recalculado
    order = await prisma.order.update({
      where: { id },
      data: { totalValue: computedTotal }
    });
    console.log('[Orders][UPDATE_SAVED]', JSON.stringify({ id: order.id, totalValue: order.totalValue }));

    // 3. Buscar as configurações do usuário
    const settings = await getSettings(userId);

    // 4. Regenerar link de pagamento se não for em dinheiro e o valor for maior que 0
    const isCashPayment = String(order.paymentMethod || '').trim().toLowerCase() === 'dinheiro';
    const changesPayment = Object.keys(updateData).some((key) => !['status', 'reminderSent'].includes(key));
    if (!isCancellation && !isCashPayment && order.totalValue > 0 && changesPayment) {
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
    console.error('[Orders][UPDATE_ERROR]', JSON.stringify({ id, message: err.message, code: err.code }));
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  try {
    const existing = await getOwnedRecord('order', id, userId);
    if (!existing) return res.status(403).json({ error: "Não autorizado" });

    if (String(existing.paymentStatus || '').toLowerCase() === 'confirmed') {
      try {
        await refundConfirmedPayment(existing, await getSettings(userId));
      } catch (refundError) {
        console.error(`[MercadoPago] Falha ao estornar pedido ${id}:`, refundError);
        return res.status(502).json({ error: `Pedido nao excluido: ${refundError.message}` });
      }
    }

    await prisma.order.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, setupCronJobs, syncCalendarEvents, sendDailyReport, checkAvailability, calculateOrderBreakdown, calculateOrderTotal, resolveEffectivePrice, isSameDayOrderAllowed, buildAvailabilityByPeriod, updateCalendarEvent };
