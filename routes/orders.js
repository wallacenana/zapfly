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

async function getGoogleCalendar() {
  try {
    const settings = await getSettings();
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret || !settings?.gcalRefreshToken) {
      console.error('[GCal] Interrompendo: Faltam credenciais no .env ou no banco.');
      return null;
    }

    const { google } = require('googleapis');
    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      'http://localhost:3001/auth/google/callback'
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
      console.log('[GCal] Novo Access Token gerado via Auto-Refresh.');
      await prisma.setting.update({
        where: { id: 'global' },
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
      console.error('[GCal] Acesso revogado ou credenciais inválidas no Google Cloud.');
      console.error('[GCal] Erro Técnico:', e.message);
    } else {
      console.error('[GCal] Erro ao autenticar:', e.message);
    }
    return null;
  }
}

// Sincroniza eventos do Google Calendar para o banco local
async function syncCalendarEvents() {
  const gcal = await getGoogleCalendar();
  if (!gcal) {
    console.error('[GCal Sync] Falha: Calendário não conectado ou credenciais ausentes.');
    throw new Error('Google Calendar não conectado. Por favor, conecte sua conta nas configurações.');
  }

  try {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0); // Começa do início do dia atual
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
        update: { title: event.summary || 'Sem título', description: event.description, startAt, endAt, allDay, syncedAt: new Date() },
        create: { id: event.id, title: event.summary || 'Sem título', description: event.description, startAt, endAt, allDay },
      });

      // LÓGICA DE SYNC REVERSO: Se o evento estiver com colorId '10' (Verde/Basílico) ou for deletado
      // Consideramos como PRONTO no Kanban
      if (event.colorId === '10' || event.status === 'cancelled') {
        await prisma.order.updateMany({
          where: { calendarEventId: event.id, status: 'pending' },
          data: { status: 'ready' }
        });
      }
    }

    // Se um evento de um pedido sumiu do Google, marcamos como finalizado/ready no Kanban
    const unsyncedOrdersWithEvents = await prisma.order.findMany({
      where: { calendarEventId: { not: null }, status: 'pending' }
    });

    for (const order of unsyncedOrdersWithEvents) {
      if (!eventIdsInGoogle.includes(order.calendarEventId)) {
        console.log(`[GCal Sync] Evento ${order.calendarEventId} não encontrado. Marcando pedido #${order.id} como PRONTO.`);
        await prisma.order.update({ where: { id: order.id }, data: { status: 'ready' } });
      }
    }

    // Remove eventos antigos do cache que foram deletados no Calendar
    await prisma.calendarEvent.deleteMany({
      where: { id: { notIn: eventIdsInGoogle }, startAt: { gte: startOfDay } }
    });

    // ─── TWO-WAY SYNC: ENVIAR PEDIDOS ÓRFÃOS AO GCAL (Apenas Encomendas) ───
    // Inclui pedidos em qualquer status ativo que não tenham evento no Calendar
    const unsyncedOrders = await prisma.order.findMany({
      where: {
        OR: [
          { calendarEventId: null },
          { calendarEventId: "" },
          // Re-sincroniza se o evento não está mais no Google
          { calendarEventId: { notIn: eventIdsInGoogle.length > 0 ? eventIdsInGoogle : ['__none__'] } }
        ],
        status: { in: ['pending', 'production', 'ready'] }, // Todos os ativos
        type: 'order' // FILTRO CRÍTICO: Não envia delivery para a agenda
      }
    });

    let pushedCount = 0;
    for (const order of unsyncedOrders) {
      try {
        const calId = await createCalendarEvent(order);
        if (calId) {
          await prisma.order.update({ where: { id: order.id }, data: { calendarEventId: calId } });
          pushedCount++;
        }
      } catch (err) {
        console.error(`[GCal Sync] Erro ao sincronizar pedido ${order.id}:`, err.message);
      }
    }

    return { fetched: events.length, pushed: pushedCount };
  } catch (e) {
    if (e.code === 401 || e.message.includes('invalid_grant')) {
      console.error('[GCal Sync] Falha de Autenticação Crítica: O token foi revogado ou é inválido.');
      console.error('[GCal Sync] Por favor, clique em "RECONECTAR" no painel de Configurações.');
      throw new Error('Autenticação expirada. Por favor, clique em Reconectar nas Configurações.');
    }
    console.error('[GCal Sync] Erro:', e.message);
    throw e;
  }
}

// Cria evento no Google Calendar
async function createCalendarEvent(order) {
  // BLINDAGEM EXTRA: Recusa absoluta de criar evento para Delivery
  if (order.type === 'delivery') {
    console.log(`[GCal] Ignorando sincronização: Pedido #${order.id} é do tipo DELIVERY.`);
    return null;
  }

  const gcal = await getGoogleCalendar();
  if (!gcal) return null;

  try {
    // O evento representa o TEMPO DE PRODUÇÃO (30 min antes da retirada)
    const endDateTime = new Date(`${order.scheduledDate}T${order.scheduledTime}:00`);
    const startDateTime = new Date(endDateTime.getTime() - 30 * 60 * 1000); // -30 min

    const event = {
      summary: `🎂 ${order.product} — ${order.clientName || 'Cliente'}`,
      description: [
        `🔔 RETIRADA: ${order.scheduledTime}`,
        order.quantity ? `Quantidade: ${order.quantity}` : '',
        order.notes ? `Observações: ${order.notes}` : '',
        order.clientJid ? `WhatsApp: ${order.clientJid.replace('@s.whatsapp.net', '')}` : '',
      ].filter(Boolean).join('\n'),
      start: { dateTime: startDateTime.toISOString(), timeZone: 'America/Sao_Paulo' },
      end: { dateTime: endDateTime.toISOString(), timeZone: 'America/Sao_Paulo' },
      colorId: '1', // Azul (Produção)
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 15 }] },
    };

    const response = await gcal.calendar.events.insert({ calendarId: gcal.calendarId, resource: event });
    return response.data.id;
  } catch (e) {
    console.error('[GCal] Erro ao criar evento:', e.message);
    return null;
  }
}

// Atualiza evento no Google Calendar
async function updateCalendarEvent(order) {
  if (!order.calendarEventId) return createCalendarEvent(order);
  const gcal = await getGoogleCalendar();
  if (!gcal) return null;

  try {
    const startDateTime = new Date(`${order.scheduledDate}T${order.scheduledTime}:00`);
    const endDateTime = new Date(startDateTime.getTime() + 2 * 60 * 60 * 1000);

    const event = {
      summary: `📦 ${order.product} — ${order.clientName || 'Cliente'}`,
      description: [
        order.quantity ? `Quantidade: ${order.quantity}` : '',
        order.notes ? `Observações: ${order.notes}` : '',
        order.clientJid ? `WhatsApp: ${order.clientJid.replace('@s.whatsapp.net', '')}` : '',
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
    console.error('[GCal] Erro ao atualizar evento:', e.message);
    return null;
  }
}

// ─── MERCADO PAGO ───────────────────────────────────────────────────────────

async function createPaymentLink(order, settings) {
  if (!settings?.mercadopagoToken) {
    console.warn('[MercadoPago] Token não configurado.');
    return null;
  }

  try {
    const client = new MercadoPagoConfig({ accessToken: settings.mercadopagoToken });
    const preference = new Preference(client);

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
          success: 'https://wa.me/5511999999999',
          failure: 'https://wa.me/5511999999999',
          pending: 'https://wa.me/5511999999999'
        },
        auto_return: 'approved',
        notification_url: `${process.env.PUBLIC_URL}/mercadopago/webhook`,
        external_reference: order.id,
        payment_methods: {
          default_payment_method_id: order.paymentMethod?.toLowerCase().includes('pix') ? 'pix' : undefined,
          default_payment_type_id: (order.paymentMethod?.toLowerCase().includes('cartão') || order.paymentMethod?.toLowerCase().includes('crédito')) ? 'credit_card' : undefined,
          installments: 12
        }
      }
    };

    console.log('[MercadoPago] Criando preferência com o corpo:', JSON.stringify(preferenceBody, null, 2));
    const result = await preference.create(preferenceBody);

    console.log(`[MercadoPago] Link criado com sucesso: ${result.init_point}`);
    return result.init_point;
  } catch (err) {
    console.error('[MercadoPago] Erro ao criar link:', err);
    if (err.response) {
      console.error('[MercadoPago] Detalhes do erro da API:', JSON.stringify(err.response, null, 2));
    }
    return null;
  }
}

// Verifica disponibilidade num dia/hora
async function checkAvailability(date, time, costToUse = 1) {
  try {
    const settings = await prisma.setting.findUnique({ where: { id: 'global' } });
    const dailyLimit = settings?.dailyMaxOrders || 10;

    // SOMA O CUSTO DE CAPACIDADE (VAGAS) DE TODOS OS PEDIDOS NO DIA
    const ordersToday = await prisma.order.findMany({
      where: { 
        scheduledDate: date, 
        status: { notIn: ['cancelled', 'cancelado'] } 
      }
    });

    // Precisamos buscar os custos de cada produto desses pedidos
    const productIds = ordersToday.map(o => o.productId).filter(Boolean);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } }
    });

    const totalUsed = ordersToday.reduce((acc, order) => {
      const p = products.find(prod => prod.id === order.productId);
      return acc + (p?.capacityCost || 1); // Se não achou produto, conta como 1 vaga
    }, 0);

    if (totalUsed >= dailyLimit) {
      return { available: false, reason: `Desculpe, já atingimos nosso limite de produção de ${dailyLimit} vagas para o dia ${date}.` };
    }

    // Verifica conflito no Google Agenda (considerando os 30 min de produção)
    const endReq = new Date(`${date}T${time}:00`);
    const startReq = new Date(endReq.getTime() - 30 * 60 * 1000); // Início da produção

    const conflict = await prisma.calendarEvent.findFirst({
      where: {
        OR: [
          // Conflito se o início da nova produção cair dentro de um evento existente
          { startAt: { lte: startReq }, endAt: { gt: startReq } },
          // Conflito se o fim da nova produção cair dentro de um evento existente
          { startAt: { lt: endReq }, endAt: { gte: endReq } },
          // Conflito se a nova produção englobar um evento existente
          { startAt: { gte: startReq }, endAt: { lte: endReq } },
          { allDay: true, startAt: { lte: startReq } }
        ]
      }
    });

    if (conflict) {
      // Sugerir horários próximos (simples: 30 min antes ou depois)
      const suggestedBefore = new Date(startReq.getTime() - 30 * 60 * 1000);
      const suggestedAfter = new Date(endReq.getTime() + 30 * 60 * 1000);

      const format = (d) => d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');

      return {
        available: false,
        reason: `Horário ocupado (conflito com ${conflict.title}). Sugestões: ${format(suggestedBefore)} ou ${format(suggestedAfter)}.`
      };
    }

    return { available: true, remaining: dailyLimit - totalUsed };
  } catch (e) {
    console.error('[Availability] Erro:', e.message);
    return { available: false, reason: 'Erro ao verificar disponibilidade.' };
  }
}

// ─── CRON JOBS ───────────────────────────────────────────────────────────────

// Sincronização do Google Calendar — agora roda a cada MINUTO
async function setupCronJobs(sockGetter) {
  // Sincronização GCal (A cada 5 min)
  cron.schedule('*/5 * * * *', () => {
    syncCalendarEvents().catch(err => {
      console.error('[Cron GCal Sync Error]:', err.message);
    });
  });

  // Lembrete de Retirada (Rodando a cada 15 min)
  cron.schedule('*/15 * * * *', async () => {
    const settings = await prisma.setting.findUnique({ where: { id: 'global' } });
    if (!settings || !sockGetter) return;

    const leadHours = settings.reminderHours || 2;
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();

    const upcomingOrders = await prisma.order.findMany({
      where: {
        scheduledDate: today,
        status: { in: ['pending', 'production', 'ready'] },
        type: 'order',
        reminderSent: false
      }
    });

    const sock = sockGetter();
    if (!sock) return;

    for (const order of upcomingOrders) {
      try {
        const [hour, minute] = order.scheduledTime.split(':').map(Number);
        const pickupTime = new Date();
        pickupTime.setHours(hour, minute, 0, 0);

        const diffMs = pickupTime - now;
        const diffHours = diffMs / (1000 * 60 * 60);

        // Se faltar X horas ou menos (mas ainda não passou do horário)
        if (diffHours > 0 && diffHours <= leadHours) {
          const msg = `Olá *${order.clientName || 'cliente'}*! 🎂\n\nPassando para te avisar que sua encomenda está agendada para retirada hoje às *${order.scheduledTime}*.\n\nJá estamos nos preparativos finais por aqui! Te esperamos. 🚀`;

          await sock.sendMessage(order.clientJid, { text: msg });
          await prisma.order.update({ where: { id: order.id }, data: { reminderSent: true } });
          console.log(`[Reminder] Lembrete enviado para ${order.clientName} (${order.id})`);
        }
      } catch (err) {
        console.error(`[Reminder Error] Falha ao enviar para ${order.id}:`, err.message);
      }
    }
  });

  // Relatório Diário
  const settings = await prisma.setting.findUnique({ where: { id: 'global' } });
  const reportHour = settings?.reportHour ?? 7;
  if (settings?.reportEnabled) {
    cron.schedule(`0 ${reportHour} * * *`, async () => {
      console.log('[Cron] Gerando relatório diário...');
      await sendDailyReport(sockGetter);
    });
  }

  // Monitor ativo silencioso
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
    include: { productRelation: true },
    orderBy: [{ scheduledDate: 'asc' }, { scheduledTime: 'asc' }]
  });
  res.json(orders);
});

router.post('/', async (req, res) => {
  console.log('[Order v3.0] INICIANDO PROCESSAMENTO');
  let finalProductName = 'Produto Indefinido';
  try {
    const settings = await prisma.setting.findUnique({ where: { id: 'global' } });
    let { productId, product, variation, quantity, notes, scheduledDate, scheduledTime, clientName, clientJid, type, deliveryAddress, paymentMethod, deliveryFee, massa, recheio, topo } = req.body;

    finalProductName = (product || '').replace(/\s*\(.*?\)\s*/g, '').trim();

    // Notes are now kept clean from payment/delivery info (unless needed for special customer requests)
    // We only prepend if the user didn't provide specific notes, or just keep them separate.
    // For now, let's keep them CLEAN as requested.

    // Busca o produto — prioriza ID direto (mais confiável), senão busca por nome
    let dbProduct = null;
    if (productId) {
      dbProduct = await prisma.product.findUnique({ where: { id: productId } });
      if (dbProduct) console.log(`[Order] Produto encontrado por ID: ${dbProduct.name} (R$${dbProduct.price})`);
    }
    if (!dbProduct) {
      dbProduct = await prisma.product.findFirst({ where: { name: { contains: finalProductName || product } } });
      if (dbProduct) console.log(`[Order] Produto encontrado por nome: ${dbProduct.name} (R$${dbProduct.price})`);
    }

    let priceToUse = dbProduct?.price || 0;

    if (dbProduct) {
      const vars = typeof dbProduct.variations === 'string' ? JSON.parse(dbProduct.variations || '[]') : (dbProduct.variations || []);
      
      let matchedVar = variation
        ? (vars.find(v => v.name.toLowerCase() === variation.toLowerCase())
          || vars.find(v => v.name.toLowerCase().includes(variation.toLowerCase())))
        : null;

      if (matchedVar && matchedVar.price) {
        priceToUse = matchedVar.price;
        console.log(`[Order] Variação encontrada: "${matchedVar.name}". Preço: R$${priceToUse}`);
      }
    }

    // Valida disponibilidade
    // Primeiro, busca o custo de capacidade (capcityCost)
    let costToUse = dbProduct?.capacityCost || 1;
    if (dbProduct) {
        const vars = typeof dbProduct.variations === 'string' ? JSON.parse(dbProduct.variations || '[]') : (dbProduct.variations || []);
        let matchedVar = variation ? vars.find(v => v.name.toLowerCase() === variation.toLowerCase()) : null;
        if (matchedVar && matchedVar.capacityCost) costToUse = matchedVar.capacityCost;
    }

    const avail = await checkAvailability(scheduledDate, scheduledTime, costToUse);
    if (!avail.available) return res.status(409).json({ error: avail.reason });

    // ─── CÁLCULO DE VALORES ───
    const qtyNum = parseFloat(quantity) || 1;
    const dFee = parseFloat(deliveryFee) || 0;
    const itemsValue = priceToUse * qtyNum;
    const finalTotalValue = itemsValue + dFee;
    console.log(`[Order] Cálculo: R$${priceToUse} x ${qtyNum} + R$${dFee} = TOTAL R$${finalTotalValue}`);

    const isCash = paymentMethod === 'Dinheiro';
    const initialStatus = isCash ? 'pending' : 'waiting_payment';

    // ─── UPSERT CUSTOMER ───
    if (clientJid) {
      await prisma.customer.upsert({
        where: { jid: clientJid },
        update: { name: clientName, address: deliveryAddress, lastOrderDate: new Date() },
        create: { jid: clientJid, name: clientName, address: deliveryAddress }
      });
    }

    const order = await prisma.order.create({
      data: {
        product: variation ? `${finalProductName || product} (${variation})` : (finalProductName || product),
        productId: dbProduct?.id,
        quantity: quantity?.toString(),
        notes: notes || "",
        scheduledDate,
        scheduledTime,
        clientName,
        clientJid,
        type: type || 'order',
        deliveryAddress,
        instanceId: req.body.instanceId || 'global',
        totalValue: finalTotalValue,
        deliveryFee: dFee,
        paymentMethod: paymentMethod,
        status: initialStatus,
        paymentStatus: initialStatus,
        massa,
        recheio,
        topo
      }
    });

    // ─── BAIXA DE ESTOQUE AUTOMÁTICA ───
    if (dbProduct && order.type === 'delivery') {
      const qtyToDecrement = Math.max(1, parseInt(quantity) || 1);

      if (!dbProduct.variations || dbProduct.variations === '[]') {
        // Caso 1: Produto Simples
        await prisma.product.update({
          where: { id: dbProduct.id },
          data: { stock: { decrement: qtyToDecrement } }
        });
      } else {
        // Caso 2: Produto com Variações
        let vars = typeof dbProduct.variations === 'string' ? JSON.parse(dbProduct.variations) : dbProduct.variations;
        let updated = false;

        // Tenta achar a variação ou o sub-item (sabor)
        for (let v of vars) {
          // Se o match for na variação e ela tiver estoque próprio
          if (v.name.toLowerCase() === variation?.toLowerCase() || variation?.toLowerCase().includes(v.name.toLowerCase())) {
            if (v.stock > 0) {
              v.stock = Math.max(0, v.stock - qtyToDecrement);
              updated = true;
            }
            // Se não tiver estoque na variação, tenta nos sub-items (sabores)
            else if (v.subItems && v.subItems.length > 0) {
              for (let si of v.subItems) {
                // Se o nome do sub-item estiver contido na nota ou na variação informada
                if (notes?.toLowerCase().includes(si.name.toLowerCase()) || variation?.toLowerCase().includes(si.name.toLowerCase())) {
                  si.stock = Math.max(0, si.stock - qtyToDecrement);
                  updated = true;
                  break;
                }
              }
            }
          }
          if (updated) break;
        }

        if (updated) {
          await prisma.product.update({
            where: { id: dbProduct.id },
            data: { variations: JSON.stringify(vars) }
          });
        }
      }
    }

    // 1. Sincroniza com Google Agenda (APENAS ENCOMENDAS CONFIRMADAS)
    let calendarEventId = null;
    if (order.type === 'order' && initialStatus !== 'waiting_payment') {
      calendarEventId = await createCalendarEvent(order);
      if (calendarEventId) {
        await prisma.order.update({ where: { id: order.id }, data: { calendarEventId } });
      }
    }

    // 2. Mercado Pago (Link de Pagamento)
    let paymentLink = null;
    if (paymentMethod !== 'Dinheiro') {
      try {
        const mpClient = new MercadoPagoConfig({ accessToken: settings.mercadopagoToken });
        const preference = new Preference(mpClient);
        
        const prefRes = await preference.create({
          body: {
            items: [
              {
                title: order.product,
                quantity: 1,
                unit_price: finalTotalValue,
                currency_id: 'BRL'
              }
            ],
            back_urls: {
              success: `${process.env.PUBLIC_URL || 'https://seusite.com'}/sucesso`,
              failure: `${process.env.PUBLIC_URL || 'https://seusite.com'}/falha`,
              pending: `${process.env.PUBLIC_URL || 'https://seusite.com'}/pendente`
            },
            auto_return: 'approved',
            notification_url: `${process.env.PUBLIC_URL}/mercadopago/webhook`,
            external_reference: order.id
          }
        });
        
        paymentLink = prefRes.init_point;
        console.log(`[MercadoPago] Link gerado: ${paymentLink}`);
      } catch (mpErr) {
        console.error('[MercadoPago] Erro ao gerar link:', mpErr.message);
      }
    }

    // 3. Notifica o Gestor
    if (settings?.managerJid && req.sockGetter) {
      const sock = req.sockGetter();
      if (sock) {
        const aviso = `🚨 *NOVA ENCOMENDA!* 🚨\n\n👤 *Cliente:* ${clientName || 'Não informado'}\n🎂 *Pedido:* ${order.product}\n📅 *Data:* ${scheduledDate}\n⏰ *Hora:* ${scheduledTime}\n📝 *Obs:* ${notes || '-'}\n📍 *Entrega:* ${deliveryAddress || 'Retirada'}`;
        await sock.sendMessage(settings.managerJid, { text: aviso }).catch(() => {});
        
        // Dispara o som (DING) apenas se for Dinheiro (já entra em produção/pendente)
        if (paymentMethod === 'Dinheiro') {
           io.emit('new_order_pending', { orderId: order.id });
        }
      }
    }

    // 4. Notifica o Cliente (se for dinheiro, confirma recebimento)
    if (paymentMethod === 'Dinheiro' && order.clientJid && req.sockGetter) {
      const sock = req.sockGetter();
      if (sock) {
        const msg = `✅ *PEDIDO RECEBIDO!* \n\nOi, *${clientName || 'cliente'}*! Recebemos seu pedido de *${order.product}* (Pagamento em Dinheiro).\n\nAgora ele está aguardando a aprovação da nossa equipe. Avisaremos você assim que começarmos a preparar! ✨`;
        await sock.sendMessage(order.clientJid, { text: msg }).catch(() => {});
      }
    }

    res.json({ ...order, calendarEventId, paymentLink });
  } catch (e) {
    const fs = require('fs');
    fs.appendFileSync('backend_errors.log', `[${new Date().toISOString()}] ERROR POST /orders: ${e.message}\n${e.stack}\n\n`);
    res.status(500).json({ error: e.message });
  }
});

router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const data = { ...req.body };
  delete data.id; 

  try {
    const oldOrder = await prisma.order.findUnique({ where: { id } });
    if (!oldOrder) return res.status(404).json({ error: 'Pedido não encontrado' });

    const order = await prisma.order.update({
      where: { id },
      data
    });

    const status = data.status || order.status;

    // ─── AUTOMAÇÕES DE STATUS ───
    
    // ─── AUTOMAÇÕES DE STATUS — NOTIFICAÇÕES AO CLIENTE ───
    if (data.status && order.clientJid && req.sockGetter) {
      const sock = req.sockGetter(order.instanceId);
      console.log(`[Status Notification] Tentando enviar para ${order.clientName} (${order.clientJid}) - Status: ${data.status}`);
      
      if (sock) {
        let msg = '';
        if (data.status === 'production') {
          msg = `✅ *PEDIDO ACEITO!* \n\nOi, *${order.clientName}*! Seu pedido de *${order.product}* já foi aceito e começou a ser preparado com muito carinho! 🧑‍🍳✨\n\nAvisaremos você assim que estiver pronto para entrega ou retirada!`;
        } else if (data.status === 'ready') {
          const typeLabel = order.type === 'delivery' ? 'está saindo para entrega' : 'já está pronto para retirada';
          msg = `🚀 *BOAS NOTÍCIAS!* \n\nOi, *${order.clientName}*! Seu pedido de *${order.product}* ${typeLabel}! 🎂✨\n\n${order.type === 'delivery' ? 'Prepare o coração (e o estômago), jajá chega aí!' : 'Pode vir buscar quando quiser, estamos te esperando!'}`;
        } else if (data.status === 'completed') {
          msg = `❤️ *PEDIDO FINALIZADO!* \n\nOi, *${order.clientName}*! Seu pedido foi finalizado com sucesso. \n\nMuito obrigado pela confiança e esperamos que aproveite cada pedacinho! Se puder, nos conte o que achou. 🥰`;
        }

        if (msg) {
          await sock.sendMessage(order.clientJid, { text: msg })
            .then(() => console.log(`[Status Notification] Mensagem enviada com sucesso!`))
            .catch(err => console.error(`[Status Notification] Erro ao enviar mensagem:`, err.message));
        }
      } else {
        console.warn(`[Status Notification] Alerta: Nenhuma conexão ativa encontrada para enviar notificação.`);
      }
    }

    // 2. Notificar entregador (se for delivery e estiver pronto)
    if (data.status === 'ready' && order.type === 'delivery' && req.sockGetter) {
      const settings = await prisma.setting.findUnique({ where: { id: 'global' } });
      if (settings?.deliveryJid) {
        const sock = req.sockGetter();
        if (sock) {
          const msg = `🚚 *PEDIDO PRONTO PARA ENTREGA!* 🚚\n\n🆔 *Pedido:* #${order.id.slice(-4).toUpperCase()}\n👤 *Cliente:* ${order.clientName}\n📦 *Itens:* ${order.product}\n📍 *Endereço:* ${order.deliveryAddress || 'Retirada'}\n💰 *Status:* Aguardando retirada pelo entregador.`;
          await sock.sendMessage(settings.deliveryJid, { text: msg }).catch(() => {});
        }
      }
    }

    // 3. Gerenciar Google Calendar (Cancelamento ou Atualização)
    if (status === 'cancelled' || status === 'cancelado') {
      if (order.calendarEventId) {
        const gcal = await getGoogleCalendar();
        if (gcal) {
          try {
            await gcal.calendar.events.delete({
              calendarId: gcal.calendarId,
              eventId: order.calendarEventId
            });
            // Limpa o ID e remove do cache local de eventos
            await prisma.order.update({ where: { id }, data: { calendarEventId: null } });
            await prisma.calendarEvent.deleteMany({ where: { id: order.calendarEventId } });
          } catch (err) {
            console.error('[GCal] Erro ao deletar evento no cancelamento:', err.message);
          }
        }
      }
    } else if (status !== 'waiting_payment' && (order.calendarEventId || (order.scheduledDate && order.scheduledTime))) {
      // Atualiza se houver mudança de data/hora ou se for re-ativado (e não estiver aguardando pagamento)
      await updateCalendarEvent(order);
    }

    res.json(order);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
    where: { 
      scheduledDate: date, 
      status: { notIn: ['cancelled', 'cancelado'] } 
    }
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
  try {
    const { name, description, type, price, stock, capacityCost, variations, unit } = req.body;
    const product = await prisma.product.create({
      data: {
        name,
        description: description || null,
        type: type || 'delivery',
        price: price || 0,
        stock: stock || 0,
        capacityCost: capacityCost || 1,
        unit: unit || 'unidade',
        variations: variations || '[]',
      }
    });
    res.json(product);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar produto' });
  }
});

router.patch('/products/:id', async (req, res) => {
  try {
    const { name, description, type, price, stock, capacityCost, variations, unit } = req.body;
    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: {
        name, description, type, price, stock, capacityCost, variations, unit
      }
    });
    res.json(product);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar produto' });
  }
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
  try {
    const result = await syncCalendarEvents();
    res.json({ synced: result.fetched, pushed: result.pushed });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Relatório manual
router.post('/report/send', async (req, res) => {
  const { sockGetter } = req;
  await sendDailyReport(sockGetter);
  res.json({ ok: true });
});

module.exports = { router, setupCronJobs, syncCalendarEvents, sendDailyReport, checkAvailability, updateCalendarEvent };
