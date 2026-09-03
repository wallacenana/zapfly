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
const { getStoreStatus, sendRichMessage, formatProduct, hasAvailableProductStock } = require('./lib/utils');
const { initFlows, handleFlows, runFlowNode, startFlowMonitor } = require('./lib/flows');
const { getOpenAI, buildLilyPrompt, executeChamarGerente, handleAdminAgent, MODEL_MAP } = require('./lib/ai');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const multer = require('multer');
const axios = require('axios');
const { MercadoPagoConfig, Payment: MercadoPagoPayment } = require('mercadopago');
const { authenticate, requireAdmin } = require('./middleware/auth');


// Dynamic JID canonicalization helper for Brazilian phone numbers
async function getCanonicalJid(jid, instanceId) {
    if (!jid || typeof jid !== 'string') return jid;
    if (!jid.endsWith('@s.whatsapp.net')) return jid;

    const phone = jid.split('@')[0];
    if (!phone.startsWith('55')) return jid;

    let alternativePhone;
    if (phone.length === 13 && phone[4] === '9') {
        alternativePhone = '55' + phone.substring(2, 4) + phone.substring(5);
    } else if (phone.length === 12) {
        alternativePhone = '55' + phone.substring(2, 4) + '9' + phone.substring(4);
    }

    if (alternativePhone) {
        const alternativeJid = `${alternativePhone}@s.whatsapp.net`;
        const exists = await prisma.chat.findUnique({
            where: { jid_instanceId: { jid: alternativeJid, instanceId } }
        });
        if (exists) return alternativeJid;
    }
    return jid;
}

// Configuracao do Multer para Marketing Assets
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'assets/marketing'),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const uploadMarketing = multer({ storage });

// Configuracao do Multer para Midias Temporarias
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
const { upsertStoreProfile, mergeStoreProfile } = require('./lib/storeProfile');
const { buildHomeDirectoryData, renderCategoryCards, renderHeroRestaurants, renderRestaurantCards, escapeHtml } = require('./lib/home');

const { router: ordersRouter, setupCronJobs, checkAvailability, updateCalendarEvent } = require('./routes/orders');
const reviewsRouter = require('./routes/reviews');
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

// Assets estáticos (PRIORIDADE)
app.use('/menu-assets', express.static(path.join(__dirname, 'public-menu')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/auth', require('./routes/auth'));
app.use('/reviews', reviewsRouter);

// --- SEO: Robots na Raiz ---
app.get('/robots.txt', (req, res) => {
    res.sendFile(path.join(__dirname, 'public-menu', 'robots.txt'));
});


//  CONFIGURACOES DO SITE (BRANDING)
app.get('/settings', authenticate, async (req, res) => {
    try {
        const settings = await getSettings(req.user.id);
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: { slug: true, active: true }
        });
        res.json({
            ...(settings || {}),
            slug: user?.slug || '',
            active: settings?.active ?? user?.active ?? true,
            userActive: user?.active ?? true
        });
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
            seoDescription, pixelId, googleAnalyticsId, microsoftClarityId,
            slug,
            menuTheme,
            acceptOrders,
            freeDeliveryEnabled,
            freeDeliveryKm,
            featuredCountDesktop,
            featuredCountTablet,
            featuredCountMobile,
            active
        } = req.body;

        if (slug) {
            const normalizedSlug = String(slug).toLowerCase().trim();
            const existingSlug = await prisma.user.findFirst({
                where: { slug: normalizedSlug, NOT: { id: req.user.id } }
            });
            if (existingSlug) {
                return res.status(400).json({ error: 'Este slug já está em uso.' });
            }
            await prisma.user.update({
                where: { id: req.user.id },
                data: { slug: normalizedSlug }
            });
        }

        if (active !== undefined) {
            await prisma.user.update({
                where: { id: req.user.id },
                data: { active: !!active }
            });
        }

        const parsePositiveInt = (value, fallback) => {
            if (value === undefined || value === null || value === '') return fallback;
            const parsed = Number.parseInt(value, 10);
            return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
        };

        const settingPayload = {};
        if (featuredCountDesktop !== undefined) {
            settingPayload.featuredCountDesktop = parsePositiveInt(featuredCountDesktop, 4);
        }
        if (featuredCountTablet !== undefined) {
            settingPayload.featuredCountTablet = parsePositiveInt(featuredCountTablet, 2);
        }
        if (featuredCountMobile !== undefined) {
            settingPayload.featuredCountMobile = parsePositiveInt(featuredCountMobile, 1);
        }

        if (Object.keys(settingPayload).length > 0) {
            await prisma.setting.upsert({
                where: { userId: req.user.id },
                update: settingPayload,
                create: {
                    id: req.user.id,
                    userId: req.user.id,
                    ...settingPayload
                }
            });
        }

        const settings = await upsertStoreProfile(req.user.id, {
            businessName,
            logoUrl,
            faviconUrl,
            accentColor,
            buttonColor,
            accentColorOrders,
            buttonColorOrders,
            buttonTextColor,
            backgroundColor,
            textColor,
            seoDescription,
            pixelId,
            googleAnalyticsId,
            microsoftClarityId,
            menuTheme,
            acceptOrders,
            freeDeliveryEnabled,
            freeDeliveryKm,
            active
        });

        invalidateSettingsCache(req.user.id);
        const merged = await getSettings(req.user.id);
        res.json(merged || settings);
    } catch (err) {
        console.error('[Settings Save Error] Erro detalhado:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/dashboard/summary', authenticate, requireAdmin, async (req, res) => {
    try {
        const userId = req.user.id;
        const now = new Date();
        const brazilDateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });
        const getBrazilDateString = (date = new Date()) => brazilDateFormatter.format(date);

        const today = getBrazilDateString(now);
        const todayStart = new Date(`${today}T00:00:00-03:00`);
        const todayEnd = new Date(`${today}T23:59:59.999-03:00`);

        const sevenDays = [];
        for (let i = 6; i >= 0; i -= 1) {
            const day = new Date(now);
            day.setDate(day.getDate() - i);
            const key = getBrazilDateString(day);
            sevenDays.push({ key, label: new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit' }).format(day) });
        }

        const [user, settings, storeProfile, products, categories, reviewsSummary, stockItems, instances, flows, customers, ordersToday, recentOrders, last7DaysOrders, topOrderGroups, orderStatusGroups, paymentStatusGroups, availableSlots, recentReviews, upcomingOrders] = await Promise.all([
            prisma.user.findUnique({
                where: { id: userId },
                select: { id: true, name: true, email: true, slug: true, role: true, active: true, createdAt: true, updatedAt: true }
            }),
            getSettings(userId),
            prisma.storeProfile.findUnique({ where: { userId } }),
            prisma.product.findMany({
                where: { userId },
                select: {
                    id: true,
                    name: true,
                    price: true,
                    promoPrice: true,
                    featured: true,
                    promotion: true,
                    displayOrder: true,
                    trackStock: true,
                    stock: true,
                    imageUrl: true,
                    image: true,
                    categoryId: true,
                    categoryName: true,
                    createdAt: true,
                }
            }),
            prisma.category.findMany({
                where: { userId },
                select: { id: true, name: true, order: true, createdAt: true },
                orderBy: [{ order: 'asc' }, { name: 'asc' }]
            }),
            prisma.storeReview.aggregate({
                where: { userId },
                _avg: { rating: true },
                _count: { _all: true }
            }),
            prisma.stockItem.findMany({
                where: { userId },
                select: { id: true, name: true, quantity: true, minQuantity: true, unit: true, createdAt: true },
                orderBy: [{ quantity: 'asc' }, { name: 'asc' }]
            }),
            prisma.instance.findMany({
                where: { userId },
                select: { id: true, name: true, status: true, updatedAt: true, createdAt: true },
                orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }]
            }),
            prisma.flow.findMany({
                where: { userId },
                select: { id: true, name: true, status: true, trigger: true, updatedAt: true, createdAt: true },
                orderBy: [{ updatedAt: 'desc' }]
            }),
            prisma.customer.count({ where: { userId } }),
            prisma.order.count({
                where: {
                    userId,
                    createdAt: { gte: todayStart, lte: todayEnd },
                    NOT: { status: { in: ['cancelled', 'canceled'] } }
                }
            }),
            prisma.order.findMany({
                where: { userId },
                orderBy: { createdAt: 'desc' },
                take: 8,
                select: {
                    id: true,
                    product: true,
                    variation: true,
                    clientName: true,
                    status: true,
                    type: true,
                    totalValue: true,
                    scheduledDate: true,
                    scheduledTime: true,
                    createdAt: true,
                    paymentStatus: true,
                    deliveryFee: true,
                    productId: true,
                    productRelation: {
                        select: { id: true, name: true, imageUrl: true, image: true }
                    }
                }
            }),
            prisma.order.findMany({
                where: {
                    userId,
                    createdAt: { gte: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000) },
                    NOT: { status: { in: ['cancelled', 'canceled'] } }
                },
                select: { createdAt: true, totalValue: true, status: true }
            }),
            prisma.order.groupBy({
                by: ['productId'],
                where: {
                    userId,
                    productId: { not: null },
                    NOT: { status: { in: ['cancelled', 'canceled'] } }
                },
                _count: { _all: true },
                _sum: { totalValue: true },
                orderBy: { _count: { productId: 'desc' } },
                take: 5
            }),
            prisma.message.count({
                where: {
                    instanceId: { in: instances.map((item) => item.id) },
                    timestamp: { gte: todayStart, lte: todayEnd }
                }
            }),
            prisma.order.groupBy({
                by: ['status'],
                where: {
                    userId,
                    createdAt: { gte: todayStart, lte: todayEnd }
                },
                _count: { _all: true }
            }),
            prisma.order.groupBy({
                by: ['paymentStatus'],
                where: {
                    userId,
                    NOT: { status: { in: ['cancelled', 'canceled'] } }
                },
                _count: { _all: true }
            }),
            prisma.availableSlot.findMany({
                where: { userId },
                select: { id: true, dayOfWeek: true, startTime: true, endTime: true, maxOrders: true },
                orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }]
            }),
            prisma.storeReview.findMany({
                where: { userId },
                orderBy: { createdAt: 'desc' },
                take: 5,
                select: {
                    id: true,
                    rating: true,
                    comment: true,
                    clientName: true,
                    createdAt: true,
                    order: {
                        select: { product: true, variation: true }
                    }
                }
            }),
            prisma.order.findMany({
                where: {
                    userId,
                    NOT: { status: { in: ['cancelled', 'canceled'] } },
                    scheduledDate: { gte: today }
                },
                orderBy: [{ scheduledDate: 'asc' }, { scheduledTime: 'asc' }],
                take: 6,
                select: {
                    id: true,
                    product: true,
                    variation: true,
                    scheduledDate: true,
                    scheduledTime: true,
                    status: true,
                    type: true,
                    clientName: true,
                    deliveryAddress: true,
                    productRelation: { select: { name: true, imageUrl: true, image: true } }
                }
            })
        ]);

        const messagesToday = instances.length > 0
            ? await prisma.message.count({
                where: {
                    instanceId: { in: instances.map((item) => item.id) },
                    timestamp: { gte: todayStart, lte: todayEnd }
                }
            })
            : 0;

        const upcomingOrdersFiltered = upcomingOrders.filter((order) => order?.scheduledDate && order.scheduledDate >= today);

        const productIds = topOrderGroups.map((item) => item.productId).filter(Boolean);
        const topProductsMap = productIds.length > 0
            ? new Map((await prisma.product.findMany({
                where: { userId, id: { in: productIds } },
                select: { id: true, name: true, imageUrl: true, image: true, price: true, promoPrice: true, featured: true, promotion: true }
            })).map((product) => [product.id, product]))
            : new Map();

        const todayOrdersValue = ordersToday.reduce((sum, order) => sum + (Number(order.totalValue) || 0), 0);
        const completedOrdersTodayValue = ordersToday
            .filter((order) => String(order.status || '').toLowerCase() === 'completed')
            .reduce((sum, order) => sum + (Number(order.totalValue) || 0), 0);
        const totalOrdersValue = await prisma.order.aggregate({
            where: { userId, NOT: { status: { in: ['cancelled', 'canceled'] } } },
            _sum: { totalValue: true }
        });
        const completedOrdersCount = await prisma.order.count({
            where: { userId, status: 'completed' }
        });
        const pendingOrdersCount = await prisma.order.count({
            where: { userId, status: { in: ['pending', 'waiting_payment'] } }
        });
        const acceptedOrdersCount = await prisma.order.count({
            where: { userId, status: 'accepted' }
        });
        const productionOrdersCount = await prisma.order.count({
            where: { userId, status: 'production' }
        });
        const readyOrdersCount = await prisma.order.count({
            where: { userId, status: 'ready' }
        });
        const cancelledOrdersCount = await prisma.order.count({
            where: { userId, status: { in: ['cancelled', 'canceled'] } }
        });
        const connectedInstancesCount = instances.filter((item) => String(item.status || '').toLowerCase() === 'connected').length;
        const activeFlowsCount = flows.filter((item) => String(item.status || '').toLowerCase() !== 'rascunho').length;
        const featuredProductsCount = products.filter((item) => item.featured).length;
        const promotionProductsCount = products.filter((item) => item.promotion || (item.promoPrice !== null && item.promoPrice !== undefined && Number(item.promoPrice) > 0)).length;
        const variationProductsCount = products.filter((item) => {
            if (!item?.variations) return false;
            if (Array.isArray(item.variations)) return item.variations.length > 0;
            if (typeof item.variations !== 'string') return false;
            try {
                return Array.isArray(JSON.parse(item.variations)) && JSON.parse(item.variations).length > 0;
            } catch (err) {
                return false;
            }
        }).length;
        const lowStockItems = stockItems.filter((item) => Number(item.quantity) <= Number(item.minQuantity));
        const paymentBreakdown = paymentStatusGroups.map((item) => ({
            paymentStatus: item.paymentStatus || 'pending',
            count: Number(item._count._all || 0)
        }));
        const slotsByDay = availableSlots.reduce((acc, slot) => {
            const key = String(slot.dayOfWeek);
            if (!acc[key]) {
                acc[key] = { dayOfWeek: slot.dayOfWeek, count: 0, totalCapacity: 0 };
            }
            acc[key].count += 1;
            acc[key].totalCapacity += Number(slot.maxOrders || 0);
            return acc;
        }, {});
        const recentSlots = availableSlots.slice(0, 6).map((slot) => ({
            id: slot.id,
            dayOfWeek: slot.dayOfWeek,
            startTime: slot.startTime,
            endTime: slot.endTime,
            maxOrders: Number(slot.maxOrders || 0)
        }));
        const configIssues = [
            !storeProfile?.businessName && !settings?.businessName ? 'Nome da loja não definido.' : null,
            !user?.slug ? 'Slug público não configurado.' : null,
            !storeProfile?.businessCategory && !settings?.businessCategory ? 'Categoria principal não informada.' : null,
            !storeProfile?.businessAddress && !settings?.businessAddress ? 'Endereço público não informado.' : null,
            !storeProfile?.prepTime && !settings?.prepTime ? 'Tempo de preparo não informado.' : null,
            !storeProfile?.logoUrl && !settings?.logoUrl ? 'Logo pública não configurada.' : null,
            !settings?.acceptOrders && !storeProfile?.acceptOrders ? 'Loja fechada para pedidos.' : null,
            !availableSlots.length ? 'Não há horários de atendimento cadastrados.' : null,
        ].filter(Boolean);
        const categoryProductStats = categories.map((category) => {
            const total = products.filter((product) => product.categoryId === category.id || String(product.categoryName || '').toLowerCase() === String(category.name || '').toLowerCase()).length;
            return {
                id: category.id,
                name: category.name,
                order: category.order,
                total
            };
        }).sort((a, b) => b.total - a.total || a.order - b.order);
        const orderTypeBreakdown = {
            delivery: await prisma.order.count({ where: { userId, type: 'delivery', NOT: { status: { in: ['cancelled', 'canceled'] } } } }),
            order: await prisma.order.count({ where: { userId, type: 'order', NOT: { status: { in: ['cancelled', 'canceled'] } } } }),
        };

        const ordersByDay = sevenDays.map((day) => {
            const dayOrders = last7DaysOrders.filter((order) => getBrazilDateString(order.createdAt) === day.key);
            const total = dayOrders.reduce((sum, order) => sum + (Number(order.totalValue) || 0), 0);
            return {
                date: day.key,
                label: day.label,
                count: dayOrders.length,
                total: Number(total.toFixed(2))
            };
        });

        const normalizedRecentOrders = recentOrders.map((order) => ({
            id: order.id,
            product: order.productRelation?.name || order.product || 'Produto',
            variation: order.variation || '',
            clientName: order.clientName || 'Cliente',
            status: order.status,
            type: order.type,
            totalValue: Number(order.totalValue || 0),
            scheduledDate: order.scheduledDate || '',
            scheduledTime: order.scheduledTime || '',
            paymentStatus: order.paymentStatus || 'pending',
            createdAt: order.createdAt,
            deliveryFee: Number(order.deliveryFee || 0),
            imageUrl: order.productRelation?.imageUrl || order.productRelation?.image || '',
        }));

        const topProducts = topOrderGroups.map((item) => {
            const product = topProductsMap.get(item.productId);
            return {
                id: item.productId,
                name: product?.name || 'Produto',
                count: Number(item._count._all || 0),
                totalValue: Number(item._sum.totalValue || 0),
                featured: Boolean(product?.featured),
                promotion: Boolean(product?.promotion),
                price: Number(product?.price || 0),
                promoPrice: product?.promoPrice !== null && product?.promoPrice !== undefined ? Number(product.promoPrice) : null,
                imageUrl: product?.imageUrl || product?.image || ''
            };
        });

        res.json({
            store: {
                id: user?.id || userId,
                name: settings?.businessName || storeProfile?.businessName || user?.name || 'HotWhats',
                slug: user?.slug || '',
                role: user?.role || '',
                active: user?.active ?? true,
                category: settings?.businessCategory || storeProfile?.businessCategory || '',
                address: settings?.businessAddress || storeProfile?.businessAddress || '',
                prepTime: settings?.prepTime || storeProfile?.prepTime || '',
                menuTheme: settings?.menuTheme || storeProfile?.menuTheme || 'dark',
                acceptOrders: settings?.acceptOrders ?? storeProfile?.acceptOrders ?? true,
                deliveryMode: settings?.deliveryMode || storeProfile?.deliveryMode || 'hibrido',
                freeDeliveryEnabled: settings?.freeDeliveryEnabled ?? storeProfile?.freeDeliveryEnabled ?? false,
                freeDeliveryKm: settings?.freeDeliveryKm ?? storeProfile?.freeDeliveryKm ?? null,
                maxDeliveryKm: settings?.maxDeliveryKm ?? storeProfile?.maxDeliveryKm ?? 15,
                logoUrl: settings?.logoUrl || storeProfile?.logoUrl || '',
                faviconUrl: settings?.faviconUrl || storeProfile?.faviconUrl || '',
                backgroundColor: settings?.backgroundColor || storeProfile?.backgroundColor || '#ffffff',
                textColor: settings?.textColor || storeProfile?.textColor || '#333333',
                accentColor: settings?.accentColor || storeProfile?.accentColor || '#ff4d6d',
                buttonColor: settings?.buttonColor || storeProfile?.buttonColor || '#ff4d6d',
            },
            metrics: {
                totalOrders: await prisma.order.count({ where: { userId, NOT: { status: { in: ['cancelled', 'canceled'] } } } }),
                ordersTodayCount,
                pendingOrdersCount,
                acceptedOrdersCount,
                productionOrdersCount,
                readyOrdersCount,
                completedOrdersCount,
                cancelledOrdersCount,
                todayOrdersValue: Number(todayOrdersValue.toFixed(2)),
                completedOrdersTodayValue: Number(completedOrdersTodayValue.toFixed(2)),
                totalOrdersValue: Number((totalOrdersValue?._sum?.totalValue || 0).toFixed(2)),
                averageTicketToday: ordersTodayCount > 0 ? Number((todayOrdersValue / ordersTodayCount).toFixed(2)) : 0,
                productsCount: products.length,
                featuredProductsCount,
                promotionProductsCount,
                categoriesCount: categories.length,
                addonGroupsCount: await prisma.addonGroup.count({ where: { userId } }),
                stockItemsCount: stockItems.length,
                lowStockCount: lowStockItems.length,
                reviewsCount: Number(reviewsSummary._count._all || 0),
                reviewsAverage: reviewsSummary._avg.rating !== null && reviewsSummary._avg.rating !== undefined ? Number(reviewsSummary._avg.rating) : 0,
                messagesTodayCount: messagesToday,
                instancesCount: instances.length,
                connectedInstancesCount,
                disconnectedInstancesCount: Math.max(instances.length - connectedInstancesCount, 0),
                flowsCount: flows.length,
                activeFlowsCount,
                customersCount: customers,
                paymentConfirmedCount: paymentStatusGroups.find((item) => String(item.paymentStatus || '').toLowerCase() === 'confirmed')?._count?._all || 0,
                paymentPendingCount: paymentStatusGroups.find((item) => String(item.paymentStatus || '').toLowerCase() === 'pending')?._count?._all || 0,
                paymentPaidCount: paymentStatusGroups.find((item) => String(item.paymentStatus || '').toLowerCase() === 'paid')?._count?._all || 0,
                paymentBreakdownTotal: paymentStatusGroups.reduce((sum, item) => sum + Number(item._count._all || 0), 0),
                slotsCount: availableSlots.length,
                averagePrepTime: products.length > 0 ? Number((products.reduce((sum, item) => sum + (Number(item.prepTime || 0)), 0) / products.length).toFixed(1)) : 0,
                deliveryCapableProducts: products.filter((item) => String(item.type || '').toLowerCase() === 'delivery').length,
                variationProductsCount
            },
            charts: {
                ordersByDay,
                statusBreakdown: orderStatusGroups.map((item) => ({
                    status: item.status,
                    count: Number(item._count._all || 0)
                })),
                paymentBreakdown,
                orderTypeBreakdown
            },
            lists: {
                recentOrders: normalizedRecentOrders,
                lowStockItems: lowStockItems.slice(0, 8).map((item) => ({
                    id: item.id,
                    name: item.name,
                    quantity: Number(item.quantity || 0),
                    minQuantity: Number(item.minQuantity || 0),
                    unit: item.unit || 'un'
                })),
                topProducts,
                instances: instances.map((item) => ({
                    id: item.id,
                    name: item.name,
                    status: item.status
                })),
                categories: categories.map((item) => ({
                    id: item.id,
                    name: item.name,
                    order: item.order
                })),
                recentReviews: recentReviews.map((review) => ({
                    id: review.id,
                    rating: Number(review.rating || 0),
                    comment: review.comment || '',
                    clientName: review.clientName || 'Cliente',
                    createdAt: review.createdAt,
                    product: review.order?.product || '',
                    variation: review.order?.variation || ''
                })),
                upcomingOrders: upcomingOrdersFiltered.map((order) => ({
                    id: order.id,
                    product: order.productRelation?.name || order.product || 'Produto',
                    variation: order.variation || '',
                    scheduledDate: order.scheduledDate || '',
                    scheduledTime: order.scheduledTime || '',
                    status: order.status || 'pending',
                    type: order.type || 'order',
                    clientName: order.clientName || 'Cliente',
                    deliveryAddress: order.deliveryAddress || ''
                })),
                recentSlots,
                configIssues,
                categoryProductStats,
                slotsByDay: Object.values(slotsByDay)
            }
        });
    } catch (err) {
        console.error('[Dashboard Summary] Error:', err);
        res.status(500).json({ error: err.message || 'Falha ao carregar dashboard.' });
    }
});

app.post('/marketing/upload', authenticate, uploadMarketing.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    const fileUrl = `https://files.hotwhats.com.br/marketing/${req.file.filename}`;
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
app.get('/', async (req, res) => {
    // Se vier do Google Agenda, volta para as configurações
    if (req.query.gcal_success) {
        return res.send(`
            <script>
                if (window.opener) {
                    window.opener.location.reload();
                    window.close();
                } else {
                    window.location.href = '${process.env.FRONTEND_URL || 'https://dash.hotwhats.com.br'}/settings';
                }
            </script>
        `);
    }
    try {
        const homeData = await buildHomeDirectoryData({ limit: 24 });
        console.log(homeData);
        const template = fs.readFileSync(path.join(__dirname, 'public', 'home.html'), 'utf8');
        const title = 'HotWhats | Restaurantes, entregas e encomendas';
        const description = 'Descubra restaurantes, encomendas e ofertas perto de voce com a experiencia iFood da HotWhats.';
        const safeJson = JSON.stringify(homeData).replace(/</g, '\\u003c');

        const html = template
            .replaceAll('__HOME_TITLE__', escapeHtml(title))
            .replaceAll('__HOME_DESCRIPTION__', escapeHtml(description))
            .replace('<!--HOME_FEATURED_CARDS-->', renderHeroRestaurants(homeData.featuredStores))
            .replace('<!--HOME_CATEGORY_CARDS-->', renderCategoryCards(homeData.categories))
            .replace('<!--HOME_RESTAURANT_CARDS-->', renderRestaurantCards(homeData.restaurants))
            .replace('__HOME_DATA__', safeJson);

        res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=120');
        res.send(html);
    } catch (err) {
        console.error('[Home Render Error]', err);
        try {
            const template = fs.readFileSync(path.join(__dirname, 'public', 'home.html'), 'utf8');
            const fallbackData = { search: '', category: '', total: 0, categories: [], featuredStores: [], restaurants: [] };
            const html = template
                .replaceAll('__HOME_TITLE__', escapeHtml('HotWhats | Restaurantes, entregas e encomendas'))
                .replaceAll('__HOME_DESCRIPTION__', escapeHtml('Descubra restaurantes, encomendas e ofertas perto de voce com a experiencia iFood da HotWhats.'))
                .replace('<!--HOME_FEATURED_CARDS-->', renderHeroRestaurants([]))
                .replace('<!--HOME_CATEGORY_CARDS-->', renderCategoryCards([]))
                .replace('<!--HOME_RESTAURANT_CARDS-->', renderRestaurantCards([]))
                .replace('__HOME_DATA__', JSON.stringify(fallbackData).replace(/</g, '\\u003c'));
            res.send(html);
        } catch (fallbackErr) {
            console.error('[Home Fallback Error]', fallbackErr);
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        }
    }
});

//  WEBHOOK MERCADO PAGO 
const processingPayments = new Set();

app.post('/mercadopago/webhook', async (req, res) => {
    try {
        const { type, data } = req.body;
        const paymentId = data?.id || req.query.id;

        if ((type === 'payment' || req.query.topic === 'payment') && paymentId) {

            // TRAVA DE MEMORIA: Evita processar o mesmo ID se ele ja estiver em curso
            if (processingPayments.has(paymentId)) {
                return res.sendStatus(200);
            }
            processingPayments.add(paymentId);

            try {
                // Busca detalhes do pagamento no MP
                const userId = req.query.userId;
                const settings = await getSettings(userId);

                if (!settings?.mercadopagoToken) {
                    console.warn(`[MercadoPago Webhook] Token não encontrado para o usuário: ${userId}`);
                    processingPayments.delete(paymentId);
                    return res.sendStatus(200);
                }

                const client = new MercadoPagoConfig({ accessToken: settings.mercadopagoToken });
                const payment = new MercadoPagoPayment(client);

                const p = await payment.get({ id: paymentId });
                const orderId = p.external_reference;

                if (p.status === 'approved' && orderId) {
                    const order = await prisma.order.findUnique({ where: { id: orderId } });

                    // Trava de seguranca no DB: Se ja foi confirmado, ignora
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

                        // Sincroniza com Google Agenda agora que está confirmado
                        await updateCalendarEvent(updatedOrder).catch(e => console.error('[GCal Sync Error]', e.message));

                        if (settings?.managerJid) {
                            const sock = sessions.get(updatedOrder.instanceId || 'global') || Array.from(sessions.values())[0];
                            if (sock) {
                                let aviso = "";
                                const orderIdShort = updatedOrder.id.slice(-4).toUpperCase();

                                if (updatedOrder.type === 'order') {
                                    aviso = `🚨 *NOVA ENCOMENDA!* (#${orderIdShort}) 🚨\n\n👤 *Cliente:* ${updatedOrder.clientName}\n📦 *Pedido:* ${updatedOrder.product}\n📅 *Data:* ${updatedOrder.scheduledDate}\n⏰ *Hora:* ${updatedOrder.scheduledTime}\n📝 *Obs:* ${updatedOrder.notes || '-'}\n🚵 *Entrega:* ${updatedOrder.deliveryAddress || 'Retirada'}\n\nO pagamento foi confirmado e o pedido ja esta no seu painel! ✨`;
                                } else {
                                    aviso = `✅ *PAGAMENTO APROVADO!* (#${orderIdShort}) ✅\n\n👤 *Cliente:* ${updatedOrder.clientName}\n📦 *Pedido:* ${updatedOrder.product}\n\nO pedido ja esta na aba *PENDENTES* do seu painel. Aceite-o para iniciar a producao! ✨`;
                                }

                                await sock.sendMessage(settings.managerJid, { text: aviso }).catch(() => { });
                            }
                        }

                        if (updatedOrder.clientJid) {
                            const sock = sessions.get(updatedOrder.instanceId || 'global') || Array.from(sessions.values())[0];
                            if (sock) {
                                const msg = `✅ *PAGAMENTO APROVADO!* 🎉\n\nOi, *${updatedOrder.clientName}*! Seu pagamento foi aprovado e seu pedido ja esta na nossa fila de producao. 👩‍🍳🚀✨\n\nAvisaremos voce assim que estiver pronto! 💖🚵`;
                                await sock.sendMessage(updatedOrder.clientJid, { text: msg }).catch(() => { });
                            }
                        }
                    }
                }
            } finally {
                // Remove da trava apos o processamento (independente de sucesso ou falha)
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
                storeProfile: true,
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

        const settings = mergeStoreProfile({
            setting: Array.isArray(user.settings) ? user.settings[0] : user.settings,
            storeProfile: user.storeProfile,
            user
        });
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
            acceptOrders: settings?.acceptOrders ?? true,
            products: user.products,
            categories: user.categories,
            availableSlots: user.availableSlots,
            userId: user.id,
            googleApiKey: settings?.googleApiKey || '',
            deliveryRules: JSON.parse(settings?.deliveryRules || '[]')
        });
    } catch (err) {
        console.error('[Public Menu Error]', err);
        res.status(500).json({ error: 'Erro interno no servidor', details: err.message });
    }
});

app.get('/public/restaurants', async (req, res) => {
    try {
        const search = String(req.query.search || '').trim();
        const category = String(req.query.category || '').trim();
        const location = String(req.query.location || '').trim();
        const locationLat = req.query.locationLat !== undefined ? parseFloat(req.query.locationLat) : null;
        const locationLng = req.query.locationLng !== undefined ? parseFloat(req.query.locationLng) : null;
        const limit = Math.min(parseInt(req.query.limit || '18', 10) || 18, 48);
        const data = await buildHomeDirectoryData({ search, category, location, locationLat, locationLng, limit });

        res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=120');
        res.json(data);
    } catch (err) {
        console.error('[Public Restaurants Error]', err);
        res.status(500).json({ error: 'Erro ao carregar diretório público.', details: err.message });
    }
});

//  SLUG AVAILABILITY CHECK 
app.get('/public/check-slug/:slug', async (req, res) => {
    try {
        const base = req.params.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        const currentSlug = String(req.query.currentSlug || '').toLowerCase().trim();
        const existing = await prisma.user.findUnique({ where: { slug: base } });
        if (!existing || (currentSlug && existing.slug === currentSlug)) {
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
            // Caso contrario, usamos o dominio de arquivos correto.
        const finalUrl = url || (req.file ? `https://files.hotwhats.com.br/marketing/${req.file.filename}` : null);

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

//  GOOGLE CALENDAR OAUTH 

const GCAL_SCOPES = ['https://www.googleapis.com/auth/calendar'];

function getOAuth2Client(req) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    // Use a URI explicitamente cadastrada no Google; PUBLIC_URL é apenas fallback.
    const configuredRedirectUri = String(process.env.GOOGLE_REDIRECT_URI || '').trim();
    const publicUrl = String(process.env.PUBLIC_URL || 'http://localhost:3001').replace(/\/$/, '');
    const redirectUri = configuredRedirectUri || `${publicUrl}/auth/google/callback`;

    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// Inicia o fluxo OAuth e redireciona para o consent screen do Google
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

// Callback do Google com o codigo de autorizacao
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

        // So atualiza o refresh_token se o Google enviou um novo (geralmente so no primeiro consentimento ou com prompt=consent)
        if (tokens.refresh_token) {
            console.log('[GCal OAuth] Novo Refresh Token recebido.');
            updateData.gcalRefreshToken = tokens.refresh_token;
        } else {
            console.warn('[GCal OAuth] Refresh Token NAO recebido. Usando o existente.');
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

// Status da conexão com o Google Calendar
app.get('/auth/google/status', authenticate, async (req, res) => {
    const settings = await getSettings(req.user.id);
    const connected = !!(settings?.gcalEnabled && settings?.gcalRefreshToken);
    const hasCredentials = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    res.json({ connected, calendarId: settings?.gcalCalendarId, hasCredentials });
});

// Lista os calendarios disponiveis na conta conectada
app.get('/auth/google/calendars', authenticate, async (req, res) => {
    try {
        const settings = await getSettings(req.user.id);
        if (!settings?.gcalRefreshToken) return res.status(401).json({ error: 'Não conectado' });

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
            console.error('[GCal Error] Conexao expirada ou revogada. Por favor, reconecte sua conta nas Configuracoes.');
        } else {
            console.error('[GCal Error] Falha ao listar calendários:', e.message);
        }
        res.status(500).json({ error: e.message });
    }
});

// Salva o calendário selecionado
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



//  INICIA O SERVIDOR 
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
    // Inicia os cron jobs (GCal sync + relatorio)
    await setupCronJobs((instanceId) => sessions.get(instanceId));
});

module.exports = { getSocket: (id) => sessions.get(id) };



// Controle de reconexão com backoff por instância
const reconnectAttempts = {};

let cachedWAVersion = null;

async function initInstance(instanceId) {
    const sessionDir = path.join(__dirname, 'sessions', instanceId);
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    // Busca a versão mais recente do WhatsApp Web (Cache para performance)
    let version = cachedWAVersion || [2, 3000, 1015901307];
    if (!cachedWAVersion) {
        try {
            const result = await fetchLatestBaileysVersion();
            version = result.version;
            cachedWAVersion = version;
        } catch (e) {
            console.warn(`[Baileys] Falha ao buscar versão do WA Web. Usando fallback.`);
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
        browser: ['HotWhats', 'Chrome', '1.0.0'],
        logger: pino({ level: 'silent' }),
        syncFullHistory: false,            // true consome muita memoria e pode causar desconexoes
        keepAliveIntervalMs: 30000,        // envia ping a cada 30s para manter a conexão viva
        connectTimeoutMs: 60000,           // timeout de 60s para estabelecer conexão
        defaultQueryTimeoutMs: 60000,      // timeout para queries ao servidor do WhatsApp
        retryRequestDelayMs: 500,          // delay entre tentativas de retry de mensagens
        maxMsgRetryCount: 5                // máximo de retentativas por mensagem
    });

    store.bind(sock.ev);

    // PERSISTENCE LOGIC
    sock.ev.on('contacts.upsert', async (contacts) => {
        for (const contact of contacts) {
            try {
                let jid = contact.id;
                jid = await getCanonicalJid(jid, instanceId);
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
                    const jid = await getCanonicalJid(update.id, instanceId);
                    await prisma.chat.update({
                        where: { jid_instanceId: { jid, instanceId } },
                        data: { name: update.name || update.verifiedName }
                    });
                }
            } catch (e) { }
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message) return;
        let jid = msg.key.remoteJid;
        const pushName = msg.pushName || 'Desconhecido';

        if (!msg.key.fromMe) {
            console.log(`[Mensagem] ${pushName} (${jid.split('@')[0]})`);
        }

        // BLOQUEIO DE STATUS E GRUPOS (OPCIONAL)
        if (jid === 'status@broadcast' || jid.includes('@g.us')) return;

        jid = await getCanonicalJid(jid, instanceId);

        //  INTERCEPTA MENSAGEM APAGADA ("Apagar para Todos") 
        if (msg.message?.protocolMessage?.type === 0 || msg.message?.protocolMessage?.type === 'REVOKE') {
            const keyToRevoke = msg.message.protocolMessage.key;
            if (keyToRevoke && keyToRevoke.id) {
                await prisma.message.deleteMany({ where: { instanceId, msgId: keyToRevoke.id } });
                io.emit('message_deleted', { instanceId, msgId: keyToRevoke.id });
            }
            return; // Interrompe aqui, não processa IA
        }

        let text = msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption ||
            msg.message?.documentMessage?.caption || '';

        // TRANSCRICAO DE AUDIO (Lily ou Clientes)
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
                }
            } catch (err) {
                console.error('[Audio Error]', err.message);
                text = "[Audio (Erro na transcricao)]";
            }
        }

        const isMedia = !!(msg.message?.imageMessage ||
            msg.message?.videoMessage ||
            msg.message?.audioMessage ||
            msg.message?.documentMessage ||
            msg.message?.viewOnceMessageV2 ||
            msg.message?.viewOnceMessage);

        if (!text && isMedia) {
            // console.log("[DEBUG MEDIA] Mensagem de midia detectada. Estrutura:", JSON.stringify(msg.message, null, 2));
        }

        if (text || isMedia) {
            // Se for midia sem texto, define um placeholder para o banco de dados
            if (!text && isMedia) {
                if (msg.message?.imageMessage) text = "[Imagem]";
                else if (msg.message?.videoMessage) text = "[Video]";
                else if (msg.message?.audioMessage) text = "[Audio]";
                else if (msg.message?.documentMessage) text = "[Documento]";
            }


            try {
                const isGroup = jid.endsWith('@g.us');
                let chat;
                try {
                    chat = await prisma.chat.upsert({
                        where: { jid_instanceId: { jid, instanceId } },
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
                } catch (upsertErr) {
                    if (upsertErr.code === 'P2002') {
                        // Fallback em caso de concorrencia simultanea
                        chat = await prisma.chat.update({
                            where: { jid_instanceId: { jid, instanceId } },
                            data: {
                                lastMsg: text,
                                lastMsgTime: new Date(msg.messageTimestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                                unreadCount: { increment: msg.key.fromMe ? 0 : 1 },
                                updatedAt: new Date(),
                                isGroup: isGroup,
                                ...((!isGroup && msg.pushName) ? { name: msg.pushName } : {})
                            }
                        }).catch(() => null);
                    } else {
                        throw upsertErr;
                    }
                }

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

                let messageRecord;
                try {
                    messageRecord = await prisma.message.upsert({
                        where: { msgId: msg.key.id },
                        update: data,
                        create: data
                    });
                } catch (upsertErr) {
                    if (upsertErr.code === 'P2002') {
                        messageRecord = await prisma.message.update({
                            where: { msgId: msg.key.id },
                            data: data
                        }).catch(() => null);
                    } else {
                        throw upsertErr;
                    }
                }

                //  COMANDOS DE ADMINISTRADOR (MANAGER) 
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

                    // Chama o agente especifico para o administrador passando imagens se houver
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
                            where: { jid_instanceId: { jid, instanceId } }
                        });

                        // Agrupa todos os textos e imagens do buffer logo no inicio
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

                        // Juntamos o texto para o motor de fluxos (usando o combinedText já calculado)
                        const textForFlow = combinedText;
                        const instanceData = await getCachedInstance(instanceId);
                        const userId = instanceData?.userId;

                        let flowHandled = false;
                        if (!msg.key.fromMe && currentChat?.aiEnabled) {
                            flowHandled = await handleFlows(sock, instanceId, jid, textForFlow, messagesToProcess[messagesToProcess.length - 1].msg, buildLilyPrompt, getOpenAI, executeChamarGerente, settings, msg.pushName, combinedImages, userId);
                        }
                        if (flowHandled) return;

                        if (!msg.key.fromMe && currentChat?.aiEnabled) {
                            // COMMAND AGENT (Experimental)
                            if (text.toLowerCase().includes('crie um story')) {
                                const storyText = text.replace(/crie um story/i, '').trim();
                                if (storyText) {
                                    await sock.sendMessage('status@broadcast', { text: storyText });
                                    await sendRichMessage(sock, jid, "Comando executado! Acabei de publicar seu Story.");
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

                                // Formata o historico como texto para injetar no final do prompt do sistema
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
                                            description: "Avisa o dono/gerente da loja que existe uma duvida que a IA nao sabe responder ou um pedido especial.",
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
                                            description: "Calcula o valor da entrega baseado no endereco do cliente usando Google Maps e as regras da loja.",
                                            parameters: {
                                                type: "object",
                                                properties: {
                                                    address: { type: "string", description: "Endereco completo do cliente" }
                                                },
                                                required: ["address"]
                                            }
                                        }
                                    },
                                    {
                                        type: "function",
                                        function: {
                                            name: "check_availability",
                                            description: "Verifica se ha horarios disponiveis para agendamento em uma data e hora especifica.",
                                            parameters: {
                                                type: "object",
                                                properties: {
                                                    date: { type: "string", description: "A data no formato YYYY-MM-DD" },
                                                    time: { type: "string", description: "O horário no formato HH:MM" },
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
                                            description: "Cria um novo pedido. REGRAS CRITICAS: 1. NUNCA crie pedidos duplicados se o cliente estiver apenas corrigindo algo ou tentando de novo apos um erro; use 'update_order' nesses casos. 2. Se o cliente mudar de ideia no meio do atendimento, atualize o pedido existente.",
                                            parameters: {
                                                type: "object",
                                                properties: {
                                                    productId: { type: "string", description: "ID do produto (ex: cmo...) encontrado entre [ID:...] no catálogo." },
                                                    product: { type: "string", description: "Nome do produto" },
                                                    variation: { type: "string", description: "Nome da variacao EXACTA (ex: 'P', 'M', 'Mini'). Nao coloque sabores aqui." },
                                                    quantity: { type: "string", description: "Peso do bolo (ex: 2kg) ou Quantidade" },
                                                    scheduledDate: { type: "string", description: "Data do agendamento YYYY-MM-DD" },
                                                    scheduledTime: { type: "string", description: "Horário do agendamento HH:MM" },
                                                    clientName: { type: "string", description: "Nome do cliente" },
                                                    paymentMethod: { type: "string", description: "Forma de pagamento (ex: Pix e Cartão com link de pagamento e Dinheiro em alguns casos)" },
                                                    type: { type: "string", enum: ["order", "delivery"], description: "OBRIGATORIO: Use 'delivery' para pedidos imediatos (hoje/agora) com entrega. Use 'order' para agendamentos futuros, encomendas de bolos ou retiradas programadas." },
                                                    deliveryAddress: { type: "string", description: "Endereco se for delivery" },
                                                    deliveryFee: { type: "number", description: "Valor da entrega calculado por get_delivery_fee" },
                                                    massa: { type: "string", description: "Sabor da massa escolhida" },
                                                    recheio: { type: "string", description: "Sabor do recheio escolhido" },
                                                    topo: { type: "string", description: "Informações sobre o topo do bolo" },
                                                    carrinho_itens_extras: { type: "array", items: { type: "string" }, description: "Produtos ADICIONAIS. IMPORTANTE: Para Kits/Combos, NAO coloque aqui os itens que ja fazem parte do kit, senao o cliente sera cobrado em dobro. Use apenas para itens extras comprados a parte." },
                                                    notes: { type: "string", description: "Outras observações gerais" }
                                                },
                                                required: ["product", "paymentMethod"],
                                            },
                                        },
                                    },
                                    {
                                        type: "function",
                                        function: {
                                            name: "update_order",
                                            description: "Atualiza informacoes de um pedido ou agendamento ja existente. So use se o cliente pedir para corrigir algo.",
                                            parameters: {
                                                type: "object",
                                                properties: {
                                                    orderId: { type: "string", description: "Codigo de referencia curto do pedido (ex: FJBIR)" },
                                                    product: { type: "string", description: "Novo produto (opcional)" },
                                                    quantity: { type: "string", description: "Novo peso ou quantidade (opcional)" },
                                                    scheduledDate: { type: "string", description: "Nova data YYYY-MM-DD (opcional)" },
                                                    scheduledTime: { type: "string", description: "Novo horário HH:MM (opcional)" },
                                                    notes: { type: "string", description: "Novas observacoes ou mudancas nos sabores (opcional)" },
                                                    carrinho_itens_extras: { type: "array", items: { type: "string" }, description: "Nova lista completa de produtos extras." },
                                                    totalValue: { type: "number", description: "Novo valor total do pedido apos as alteracoes (opcional)" }
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
                                            description: "Retorna o endereco fisico da loja e o link do Google Maps para retirada.",
                                            parameters: { type: "object", properties: {} }
                                        }
                                    },
                                    {
                                        type: "function",
                                        function: {
                                            name: "get_delivery_catalog",
                                            description: "OBRIGATORIO: Chame SEMPRE que o cliente perguntar o que tem para hoje, pronta entrega, ou pedir opcoes imediatas. Proibido listar produtos manualmente, quando estiver fechado e o cliente pedir informacoes \"sobre o que tem hoje\".",
                                            parameters: { type: "object", properties: {} }
                                        }
                                    },
                                    {
                                        type: "function",
                                        function: {
                                            name: "get_order_catalog",
                                            description: "OBRIGATORIO: Chame SEMPRE que o cliente pedir cardapio de encomendas, bolos de festa, personalizados ou agendamentos futuros. Proibido listar produtos manualmente.",
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
                                            description: "Busca na biblioteca de marketing imagens de produtos ou promoções para mostrar ao cliente.",
                                            parameters: {
                                                type: "object",
                                                properties: {
                                                    search: { type: "string", description: "Termo de busca (ex: 'vulcao', 'promocao'). Deixe vazio para listar todos." }
                                                }
                                            }
                                        }
                                    },
                                    {
                                        type: "function",
                                        function: {
                                            name: "send_marketing_media",
                                            description: "Envia uma imagem especifica da biblioteca de marketing para o cliente.",
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
                                let pendingCatalogCTA = null; // 3a mensagem: CTA da Lily apos o catalogo
                                try {
                                    // Detecta se o usuario esta pedindo o cardapio e forca a ferramenta correta
                                    const lastUserMsgObj = messages.filter(m => m.role === 'user').pop();
                                    const lastUserMsgContent = Array.isArray(lastUserMsgObj?.content)
                                        ? lastUserMsgObj.content.map(c => c.text || '').join(' ')
                                        : (lastUserMsgObj?.content || '');
                                    const lastUserMsg = lastUserMsgContent.toLowerCase();

                                    const isDeliveryRequest = /card[aá]pio|o que tem|pronta entrega|o que voc[eê] tem|tem hoje|tem pra hoje|disponivel|preco|o que vende|possibilidades|opções|opcoes/i.test(lastUserMsg);
                                    const isOrderRequest = /encomenda|bolo de festa|personalizado|encomendar|quero encomendar/i.test(lastUserMsg);

                                    let forcedToolChoice = "auto";

                                    if (statusLoja.includes("FECHADA")) {
                                        // Detecta se e um "SIM" generico ou se ja e o nome de um produto
                                        const isGenericAcceptance = /^(sim|quero|pode|manda|veja|ve|ok|agendar|amanha|pode ser|com certeza|claro|uhum)$/i.test(lastUserMsg.trim());
                                        const isAskingOptions = /o que tem|opções|cardapio|catalogo|ve ai/i.test(combinedText);

                                        if (isGenericAcceptance || isAskingOptions) {
                                            forcedToolChoice = { type: "function", function: { name: "get_delivery_catalog" } };
                                        } else {
                                            // Se ele já falou o nome de um produto (ex: "quero um vulcão"), deixa o fluxo seguir normal
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

                                    // Interceptador de Memoria de Imagem
                                    if (initialAIText && initialAIText.includes('[ANALISE:')) {
                                        const match = initialAIText.match(/\[ANALISE: (.*?)\]/s);
                                        if (match) {
                                            const analysisContent = match[1];
                                            console.log(`[AI Memory] Salvando analise tecnica no banco...`);
                                            await prisma.chat.update({
                                                where: { jid_instanceId: { jid, instanceId } },
                                                data: { lastPixAnalysis: analysisContent }
                                            }).catch(e => console.error("Erro ao salvar memoria AI:", e));

                                            // Remove o bloco tecnico do texto que o cliente vera
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
                                                const prods = await prisma.product.findMany();

                                                let deliveryStr = '';
                                                prods.filter(p => {
                                                    const vars = typeof p.variations === 'string' ? JSON.parse(p.variations || '[]') : (p.variations || []);
                                                    return (p.type === 'delivery' || p.type === 'combo_delivery') && hasAvailableProductStock(p, vars);
                                                }).forEach(p => {
                                                    const vars = typeof p.variations === 'string' ? JSON.parse(p.variations || '[]') : (p.variations || []);
                                                    deliveryStr += formatProduct(p, vars, false) + '\n\n';
                                                });

                                                const catalogText = deliveryStr.trim() || 'Nenhum item de pronta entrega no momento.';
                                                pendingCatalogMessage = catalogText;
                                                result = "CATALOGO ENVIADO PARA MEMORIA. Responda ao cliente usando o formato: [Intro] --- [CTA].";
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
                                                    catalogText += '\n\nâœ¨ *ADICIONAIS & EXTRAS:*\n' + addonStr.trim();
                                                }
                                                pendingCatalogMessage = catalogText;
                                                result = "CATALOGO DE ENCOMENDAS ENVIADO PARA MEMORIA. Responda ao cliente usando o formato: [Intro] --- [CTA].";
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

                                                    // PERSISTENCIA: Salva no cadastro do cliente para evitar re-calculo caro
                                                    await prisma.customer.update({
                                                        where: { jid },
                                                        data: { address: args.address, lastDeliveryFee: feeValue }
                                                    }).catch(() => { });

                                                    const feeLabel = feeRes.type === 'fixed' ? 'VALOR DO FRETE' : 'VALOR DO FRETE (ESTIMADO)';

                                                    result = `${feeLabel}: R$ ${feeValue.toFixed(2)}. ${canCash ? 'DINHEIRO LIBERADO' : 'APENAS PIX/CARTAO (Link)'}`;
                                                }
                                            }
                                            else if (functionName === "create_order") {
                                                // Notes are now kept clean, cake details passed as separate fields
                                                let finalNotes = args.notes || '';

                                                try {
                                                    // TRAVA DE SEGURANCA: Evita duplicatas em curto espaco de tempo
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
                                                            error: `BLOQUEIO: ja existe o pedido #${recentOrder.id.slice(-5).toUpperCase()} em aberto. Use 'update_order' com este codigo para adicionar mais produtos ou atualizar o valor total. NAO CRIE OUTRO PEDIDO.`
                                                        };
                                                    } else {
                                                        const internalBase = `http://127.0.0.1:${process.env.PORT || 3001}`;
                                                        const res = await axios.post(`${internalBase}/orders`, {
                                                            ...args,
                                                            deliveryFee: args.deliveryFee || lastDeliveryFee, // FALLBACK: Usa o ultimo frete calculado
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
                                                            result.message = "Pedido criado. SILENCIO ABSOLUTO NO PROXIMO TURNO. NAO GERE NENHUM TEXTO, O SISTEMA ENVIARA O LINK.";
                                                        } else {
                                                            result.message = "Pedido criado. Informe que recebemos o pedido (Pagamento em Dinheiro) e que ele esta agora aguardando a aprovacao da nossa equipe. Peca para o cliente aguardar a confirmacao oficial.";
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

                                                        const internalBase = `http://127.0.0.1:${process.env.PORT || 3001}`;
                                                        const res = await axios.patch(`${internalBase}/orders/${targetOrder.id}`, updateData, {
                                                            headers: {
                                                                'x-internal-token': process.env.INTERNAL_TOKEN || 'hotwhats-internal-bypass-key',
                                                                'x-user-id': settings.userId
                                                            }
                                                        });

                                                        result = { success: true, message: "Pedido atualizado com sucesso." };

                                                        if (res.data.paymentLink) {
                                                            pendingPaymentLink = res.data.paymentLink;
                                                            result.message = "Pedido atualizado e novo link gerado. SILENCIO ABSOLUTO NO PROXIMO TURNO. NAO GERE NENHUM TEXTO, O SISTEMA ENVIARA O LINK.";
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
                                                        status: order.status === "ready" ? "PRONTO" : "EM PRODUCAO",
                                                        product: order.product,
                                                        canOfferLocation: order.status === "ready"
                                                    };
                                                } else {
                                                    result = { error: "Nenhum pedido ativo encontrado para este numero." };
                                                }
                                            }
                                            else if (functionName === "get_store_location") {
                                                result = {
                                                    address: settings?.businessAddress || "Endereco nao configurado.",
                                                                                                        locationLink: (() => {
                                                        const raw = settings?.businessLocation;
                                                        if (!raw) return "Link não disponível.";
                                                        if (typeof raw === 'object') {
                                                            return raw.mapsUrl || raw.locationLink || "Link não disponível.";
                                                        }
                                                        try {
                                                            const parsed = JSON.parse(raw);
                                                            return parsed?.mapsUrl || parsed?.locationLink || raw;
                                                        } catch (error) {
                                                            return raw;
                                                        }
                                                    })()
                                                };
                                            }
                                            else if (functionName === "solicitar_cancelamento") {
                                                const { reason } = args;
                                                const clientName = currentChat?.name || jid.split('@')[0];
                                                const alertMsg = `🚩 *SOLICITACAO DE CANCELAMENTO* 🚩\n\n👤 *Cliente:* ${clientName}\n📞 *WhatsApp:* ${jid.split('@')[0]}\n🧾 *Motivo:* ${reason}\n\nLily ja avisou o cliente que o gerente foi notificado. Por favor, verifique o pedido no painel.`;

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
                                                const prods = allProducts.filter(p => {
                                                    const vars = typeof p.variations === 'string' ? JSON.parse(p.variations || '[]') : (p.variations || []);
                                                    return p.type === 'delivery' && hasAvailableProductStock(p, vars);
                                                });
                                                let deliveryStr = '';
                                                prods.forEach(p => {
                                                    const vars = typeof p.variations === 'string' ? JSON.parse(p.variations || '[]') : (p.variations || []);
                                                    deliveryStr += formatProduct(p, vars, false) + '\n\n';
                                                });
                                                pendingCatalogMessage = deliveryStr.trim() || 'Nenhum item de pronta entrega no momento.';
                                                result = { success: true, message: "Catalogo de pronta entrega preparado. O sistema enviara o catalogo agora. SILENCIO ABSOLUTO." };
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
                                                result = { success: true, message: "Catalogo de encomendas preparado. O sistema enviara o catalogo agora. SILENCIO ABSOLUTO." };
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

                                        //  SEQUESTRAR O FLUXO: SE GEROU LINK OU CATALOGO, A IA SE CALA E O SISTEMA ASSUME
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

                                            // Balao 3: Confirmacao
                                            await sock.sendPresenceUpdate('composing', jid);
                                            await new Promise(r => setTimeout(r, 1000));
                                            await sock.sendPresenceUpdate('paused', jid);
                                            await sendRichMessage(sock, jid, 'O pedido sera confirmado apos o pagamento.');

                                            return; // FIM IMEDIATO: a IA não fala mais nada.
                                        }

                                        if (pendingCatalogMessage) {
                                            const isDelivery = pendingCatalogMessage.includes('pronta entrega') || !pendingCatalogMessage.includes('Bolo');

                                            // Balão 1: Intro
                                            await sock.sendPresenceUpdate('composing', jid);
                                            await new Promise(r => setTimeout(r, 1000));
                                            await sock.sendPresenceUpdate('paused', jid);
                                            await sock.sendMessage(jid, { text: isDelivery ? 'Hoje teremos os seguintes produtos de pronta entrega:' : 'Vou te mostrar nossas opcoes maravilhosas de bolos de encomenda:' });

                                            // Balão 2: Catálogo
                                            await sock.sendPresenceUpdate('composing', jid);
                                            await new Promise(r => setTimeout(r, Math.min(pendingCatalogMessage.length * 5, 3000)));
                                            await sock.sendPresenceUpdate('paused', jid);
                                            await sock.sendMessage(jid, { text: pendingCatalogMessage });

                                            // Balão 3: CTA
                                            await sock.sendPresenceUpdate('composing', jid);
                                            await new Promise(r => setTimeout(r, 1200));
                                            await sock.sendPresenceUpdate('paused', jid);
                                            await sock.sendMessage(jid, { text: isDelivery ? 'Qual desses posso separar para voce?' : 'Qual destes mais te encantou? Posso te ajudar a escolher o tamanho ideal para sua festa?' });

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
                                            let introText = "Temos essas delicias:";
                                            let ctaText = "Qual desses posso separar para voce?";

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
                                    // LIMPEZA AGRESSIVA DE FORMATACAO
                                    replyText = replyText.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$2'); // links markdown -> URL pura
                                    replyText = replyText.replace(/\*/g, ''); // Remove negrito/itálico
                                    replyText = replyText.replace(/#/g, '');  // Remove hashtags
                                    replyText = replyText.replace(/çª¶ï½¢/g, '-'); // Troca bullet por traco
                                    replyText = replyText.replace(/[•‣·]/g, '-'); // Troca bullets por traco
                                    replyText = replyText.replace(/_/g, '');  // Remove underlines
                                    replyText = replyText.replace(/`/g, '');  // Remove backticks
                                    replyText = replyText.trim();

                                    // TRAVA DE SEGURANCA: Se o catalogo vai ser enviado em seguida,
                                    // forca o replyText a ser APENAS a primeira frase da IA (a introducao).
                                    if (pendingCatalogMessage) {
                                        const firstSentence = replyText.split(/[\n!?]/)[0].trim();
                                        replyText = firstSentence || replyText;
                                    }
                                }

                                // 1a MENSAGEM: INTRODUCAO DA LILY
                                if (currentToken.cancelled) return;
                                const typingSpeed = 50;
                                const introDelay = Math.min(Math.max(replyText.length * typingSpeed, 2000), 10000);

                                await sock.sendPresenceUpdate('composing', jid);
                                await new Promise(resolve => setTimeout(resolve, introDelay));
                                await sock.sendPresenceUpdate('paused', jid);

                                await sendRichMessage(sock, jid, replyText);



                                // 2a MENSAGEM: CARDAPIO (SISTEMA)
                                if (pendingCatalogMessage) {
                                    // Pausa minima para respiro
                                    await new Promise(resolve => setTimeout(resolve, 500));

                                    // Digitacao rapida para o catalogo
                                    const catalogDelay = Math.min(Math.max(pendingCatalogMessage.length * 5, 800), 3000);
                                    await sock.sendPresenceUpdate('composing', jid);
                                    await new Promise(resolve => setTimeout(resolve, catalogDelay));
                                    await sock.sendPresenceUpdate('paused', jid);

                                    await sock.sendMessage(jid, { text: pendingCatalogMessage });

                                // 3a MENSAGEM: CTA DA LILY (DINAMICO)
                                    if (pendingCatalogCTA) {
                                        // Pausa minima para o CTA
                                        await new Promise(resolve => setTimeout(resolve, 800));

                                        const ctaPrompt = pendingCatalogCTA === "delivery"
                                            ? "O cardapio de hoje foi enviado. Agora, como Lily, envie UM CTA final (1 frase) perfeito para fechar a venda. Seja natural e direta, sem formalidades. Ex: 'Dê uma olhadinha nas opcoes e me diz qual dessas posso separar para voce?'"
                                            : "O cardapio de encomendas foi enviado. Agora, como Lily, envie UM CTA final (1 frase) humano e simpatico para entender o desejo do cliente. Ex: 'Qual dessas combina mais com o que voce esta imaginando?'";
                                        try {
                                            const ctaResponse = await ai.chat.completions.create({
                                                model: MODEL_MAP[settings?.activeModel] || 'gpt-4o',
                                                messages: [...messages, { role: 'user', content: ctaPrompt }],
                                                max_tokens: 60
                                            });
                                            let ctaText = ctaResponse.choices[0].message.content?.trim();
                                            if (ctaText) {
                                                ctaText = ctaText.replace(/\*/g, '').replace(/#/g, '').replace(/_/g, '').trim();

                                                // Digitacao rapida para o CTA
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
                                // PONTE ROBUSTA: Busca o fluxo tentando bater o numero (prefixo) se o JID exato falhar
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
                                console.warn(`[AI] Agente está ligado para ${jid}, mas a OpenAI API Key não está configurada.`);
                            }
                        }
                    } catch (errDbnc) {
                        console.error('[AI Debounce Error]', errDbnc);
                    }
                }, 4000); // 4 SEGUNDOS DE ESPERA (Otimizado para UX humana)
            } catch (e) {
                console.error('Erro na persistencia/AI:', e.message);
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
            // Conexao bem-sucedida e reseta o contador de tentativas
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
                // Backoff exponencial: evita loop de reconexão rápida
                const attempts = reconnectAttempts[instanceId] || 0;
                const delay = Math.min(1000 * Math.pow(2, attempts), 60000); // max 60s
                reconnectAttempts[instanceId] = attempts + 1;
                console.log(`[Baileys] Instância ${instanceId} reconectando em ${delay / 1000}s (tentativa ${attempts + 1})...`);
                setTimeout(() => initInstance(instanceId), delay);
            } else {
                // Deslogado ou remocao manual e limpa contador de tentativas
                delete reconnectAttempts[instanceId];
                if (manualRemoval) {
                    console.log(`[Baileys] Instância ${instanceId} removida manualmente. Ignorando auto-reconexão.`);
                } else {
                    console.log(`[Baileys] Instância ${instanceId} deslogada. Não haverá reconexão automática.`);
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
        if (!ai) return res.status(400).json({ error: 'OpenAI não configurada' });

        const kb = JSON.parse(knowledge || '[]');
        const kbContext = kb.length > 0
            ? "\n\nUse as seguintes informacoes especificas da empresa para responder se relevante:\n" +
            kb.map(k => `Pergunta: ${k.q}\nResposta: ${k.a}`).join('\n---\n')
            : "";

        const messages = [
            { role: 'system', content: (botPrompt || 'Voce e um assistente prestativo.') + kbContext },
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
    if (!config) config = await prisma.setting.create({ data: { id: req.user.id, userId: req.user.id, activeModel: 'openai' } });
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
        businessCategory: config.businessCategory,
        prepTime: config.prepTime,
        businessAddress: config.businessAddress,
        businessPlaceId: config.businessPlaceId,
        businessLat: config.businessLat,
        businessLng: config.businessLng,
        businessMapsUrl: config.businessMapsUrl,
        businessLocation: config.businessLocation,
        logoUrl: config.logoUrl,
        faviconUrl: config.faviconUrl,
        accentColor: config.accentColor,
        buttonColor: config.buttonColor,
        accentColorOrders: config.accentColorOrders,
        buttonColorOrders: config.buttonColorOrders,
        buttonTextColor: config.buttonTextColor,
        backgroundColor: config.backgroundColor,
        textColor: config.textColor,
        seoDescription: config.seoDescription,
        pixelId: config.pixelId,
        googleAnalyticsId: config.googleAnalyticsId,
        microsoftClarityId: config.microsoftClarityId,
        acceptOrders: config.acceptOrders,
        dailyMaxOrders: config.dailyMaxOrders,
        managerJid: config.managerJid,
        deliveryJid: config.deliveryJid,
        reportEnabled: config.reportEnabled,
        reportHour: config.reportHour,
        googleApiKey: process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_KEY || process.env.GOOGLE_API_KEY || config.googleApiKey || '',
        deliveryRules: config.deliveryRules,
        dailyDeliveryItems: config.dailyDeliveryItems,
        gcalRefreshToken: config.gcalRefreshToken,
        mercadopagoPublicKey: config.mercadopagoPublicKey,
        mercadopagoToken: config.mercadopagoToken,
        pixReceiverName: config.pixReceiverName,
        pixReceiverKey: config.pixReceiverKey,
        maxDeliveryKm: config.maxDeliveryKm,
        freeDeliveryEnabled: config.freeDeliveryEnabled,
        freeDeliveryKm: config.freeDeliveryKm,
        deliveryMode: config.deliveryMode,
        allowCashOnDelivery: config.allowCashOnDelivery
    });
});

app.post('/config/keys', authenticate, async (req, res) => {
    const {
        slug, openai, claude, activeModel, gcalSyncHour,
        businessName, businessCategory, prepTime, businessAddress, businessPlaceId, businessLat, businessLng, businessMapsUrl, businessLocation,
        dailyMaxOrders, dailyDeliveryItems, managerJid,
        deliveryJid, reportEnabled, reportHour,
        googleApiKey, deliveryRules, gcalCalendarId,
        mercadopagoToken, mercadopagoPublicKey,
        pixReceiverName, pixReceiverKey,
        maxDeliveryKm, deliveryMode, allowCashOnDelivery,
        freeDeliveryEnabled, freeDeliveryKm,
        logoUrl, faviconUrl, accentColor, buttonColor,
        accentColorOrders, buttonColorOrders,
        buttonTextColor, backgroundColor, textColor,
        seoDescription, pixelId, googleAnalyticsId, microsoftClarityId,
        acceptOrders, active
    } = req.body;

    if (slug) {
        const existing = await prisma.user.findFirst({
            where: { slug, NOT: { id: req.user.id } }
        });
        if (existing) {
            return res.status(400).json({ error: 'Este slug já está em uso.' });
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
        dailyMaxOrders: parseInt(dailyMaxOrders || 10),
        managerJid,
        deliveryJid,
        reportEnabled: !!reportEnabled,
        reportHour: reportHour ?? (currentConfig?.reportHour || 7),
        deliveryRules: typeof deliveryRules === 'string' ? deliveryRules : JSON.stringify(deliveryRules || []),
        gcalCalendarId: gcalCalendarId || "",
        pixReceiverName,
        pixReceiverKey,
        dailyDeliveryItems: typeof dailyDeliveryItems === 'string' ? dailyDeliveryItems : JSON.stringify(dailyDeliveryItems || [])
    };

    const storeProfileData = {
        businessName,
        businessCategory,
        prepTime,
        businessAddress,
        businessPlaceId,
        businessLat,
        businessLng,
        businessMapsUrl,
        businessLocation,
        logoUrl,
        faviconUrl,
        accentColor,
        buttonColor,
        accentColorOrders,
        buttonColorOrders,
        buttonTextColor,
        backgroundColor,
        textColor,
        seoDescription,
        pixelId,
        googleAnalyticsId,
        microsoftClarityId,
        acceptOrders,
        active,
        maxDeliveryKm,
        freeDeliveryEnabled,
        freeDeliveryKm,
        deliveryMode,
        allowCashOnDelivery
    };

    console.log(`[Config Save] Salvando configuracoes do usuario ${req.user.id}...`);

    const [settingConfig, storeConfig] = await Promise.all([
        prisma.setting.upsert({
            where: { userId: req.user.id },
            update: updateData,
            create: { id: req.user.id, userId: req.user.id, ...updateData, gcalEnabled: false }
        }),
        upsertStoreProfile(req.user.id, storeProfileData)
    ]);

    openaiInstance = null;
    invalidateSettingsCache(req.user.id);
    const merged = await getSettings(req.user.id);
    res.json(merged || { ...settingConfig, ...storeConfig });
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
    if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

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
        if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

        console.log(`[Restart] Reiniciando instância ${id} solicitada por ${req.user.id}`);

        const sock = sessions.get(id);
        if (sock) {
            // Remove do mapa ANTES de fechar para evitar que o evento 'close' dispare auto-reconnect
            sessions.delete(id);
            try { sock.end(); } catch (e) { }
        }

        // Reseta contador de tentativas
        delete reconnectAttempts[id];

        // Inicia em background para não travar a resposta HTTP
        initInstance(id).catch(err => console.error(`[Restart Error] Falha ao iniciar ${id}:`, err));

        res.json({ success: true, message: 'Reinicializacao iniciada' });
    } catch (err) {
        console.error('[Instance Restart Error]', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/instances/:id', authenticate, async (req, res) => {
    const { id } = req.params;

    // Verifica propriedade
    const instance = await prisma.instance.findUnique({ where: { id, userId: req.user.id } });
    if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

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
    } catch (e) { console.error('Erro ao deletar filhos da instância:', e.message) }

    await prisma.instance.delete({ where: { id } });
    res.json({ success: true });
});

app.get('/instances/:id/chats', authenticate, async (req, res) => {
    // Verifica propriedade
    const instance = await prisma.instance.findUnique({ where: { id: req.params.id, userId: req.user.id } });
    if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

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

app.patch('/instances/:id/chats/:jid', authenticate, async (req, res) => {
    let { id, jid } = req.params;
    jid = await getCanonicalJid(jid, id);
    const { aiEnabled } = req.body;

    // Verifica propriedade
    const instance = await prisma.instance.findUnique({ where: { id, userId: req.user.id } });
    if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

    const chat = await prisma.chat.update({
        where: { jid_instanceId: { jid, instanceId: id } },
        data: { aiEnabled }
    });
    res.json(chat);
});

app.get('/instances/:id/messages/:jid', authenticate, async (req, res) => {
    let { id, jid } = req.params;
    jid = await getCanonicalJid(jid, id);

    // Verifica propriedade
    const instance = await prisma.instance.findUnique({ where: { id, userId: req.user.id } });
    if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

    // Carrega apenas as ultimas 20 mensagens para manter o carregamento instantaneo
    let messages = await prisma.message.findMany({
        where: { instanceId: id, jid },
        orderBy: { timestamp: 'desc' },
        take: 20
    });

    // Inverte o array para a ordem cronologica correta no frontend (antigas em cima, novas embaixo)
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
        let { id, jid } = req.params;
        jid = await getCanonicalJid(jid, id);

        // Verifica propriedade
        const instance = await prisma.instance.findUnique({ where: { id, userId: req.user.id } });
        if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

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
app.post('/instances/:id/messages/delete', authenticate, async (req, res) => {
    const { id } = req.params;
    let { jid, msgId, fromMe, forEveryone } = req.body;
    jid = await getCanonicalJid(jid, id);

    // Verifica propriedade
    const instance = await prisma.instance.findUnique({ where: { id, userId: req.user.id } });
    if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

    const sock = sessions.get(id);
    if (!sock) return res.status(404).json({ error: 'Instância não conectada' });

    try {
        if (forEveryone && fromMe) {
            // Apaga para todos no WhatsApp
            await sock.sendMessage(jid, { delete: { remoteJid: jid, fromMe: true, id: msgId } });
        }

        // Remove do banco local em todos os casos (assim o historico da IA e da tela limpam na hora)
        await prisma.message.deleteMany({ where: { instanceId: id, msgId } });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Marcar conversa como lida (Visto)
app.post('/instances/:id/chats/read', authenticate, async (req, res) => {
    const { id } = req.params;
    let { jid, msgId } = req.body;
    jid = await getCanonicalJid(jid, id);

    // Verifica propriedade
    const instance = await prisma.instance.findUnique({ where: { id, userId: req.user.id } });
    if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

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
app.patch('/instances/:id/chats/:jid/unread', authenticate, async (req, res) => {
    let { id, jid } = req.params;
    jid = await getCanonicalJid(jid, id);
    try {
        // Verifica propriedade
        const instance = await prisma.instance.findUnique({ where: { id, userId: req.user.id } });
        if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

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
    let { id, jid } = req.params;
    jid = await getCanonicalJid(jid, id);
    try {
        // Verifica propriedade
        const instance = await prisma.instance.findUnique({ where: { id, userId: req.user.id } });
        if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

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
        if (!instance) return res.status(404).json({ error: 'Instância não encontrada' });

        let { jid, text } = req.body;
        const sock = sessions.get(id);
        if (!sock) return res.status(404).json({ error: 'Sessão do WhatsApp não inicializada' });
        if (!sock.user) return res.status(400).json({ error: 'WhatsApp desconectado ou aguardando leitura do QR Code' });

        if (!jid || typeof jid !== 'string' || !text) {
            return res.status(400).json({ error: 'JID (string) e texto são obrigatórios' });
        }

        // Clean and fix JID
        let finalJid = jid.trim();
        if (!finalJid.includes('@')) {
            finalJid = finalJid.includes(':') ? finalJid.split(':')[0] + '@s.whatsapp.net' : finalJid + '@s.whatsapp.net';
        }
        if (finalJid.endsWith('@s.whatsapp.net')) {
            const phonePart = finalJid.split('@')[0].replace(/\D/g, '');
            finalJid = `${phonePart}@s.whatsapp.net`;
        } else if (finalJid.endsWith('@lid')) {
            const phonePart = finalJid.split('@')[0].replace(/\D/g, '');
            finalJid = `${phonePart}@lid`;
        }

        // Verify and resolve JID against WhatsApp's servers to handle the 9th digit and correct JID types
        if (finalJid.endsWith('@s.whatsapp.net') || finalJid.endsWith('@lid')) {
            try {
                if (sock.onWhatsApp) {
                    const result = await sock.onWhatsApp(finalJid);
                    if (result && result.length > 0 && result[0].exists) {
                        finalJid = result[0].jid;
                    }
                }
            } catch (err) {
                console.warn(`Erro ao verificar JID no WhatsApp:`, err.message);
            }
        }

        finalJid = await getCanonicalJid(finalJid, id);

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
            where: { jid_instanceId: { jid: finalJid, instanceId: id } },
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
        const imageUrl = `https://files.hotwhats.com.br/products/${req.file.filename}`;
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
        if (!sock.user) return res.status(400).json({ error: 'WhatsApp desconectado ou aguardando leitura do QR Code' });
        if (!jid || !req.file) return res.status(400).json({ error: 'JID e arquivo de áudio são obrigatórios' });

        let finalJid = jid.trim();
        if (!finalJid.includes('@')) {
            finalJid = finalJid.includes(':') ? finalJid.split(':')[0] + '@s.whatsapp.net' : finalJid + '@s.whatsapp.net';
        }
        if (finalJid.endsWith('@s.whatsapp.net')) {
            const phonePart = finalJid.split('@')[0].replace(/\D/g, '');
            finalJid = `${phonePart}@s.whatsapp.net`;
        } else if (finalJid.endsWith('@lid')) {
            const phonePart = finalJid.split('@')[0].replace(/\D/g, '');
            finalJid = `${phonePart}@lid`;
        }

        // Verify and resolve JID against WhatsApp's servers to handle the 9th digit and correct JID types
        if (finalJid.endsWith('@s.whatsapp.net') || finalJid.endsWith('@lid')) {
            try {
                if (sock.onWhatsApp) {
                    const result = await sock.onWhatsApp(finalJid);
                    if (result && result.length > 0 && result[0].exists) {
                        finalJid = result[0].jid;
                    }
                }
            } catch (err) {
                console.warn(`Erro ao verificar JID no WhatsApp:`, err.message);
            }
        }

        finalJid = await getCanonicalJid(finalJid, id);

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
                text: '[Audio]',
                fromMe: true,
                timestamp: new Date(),
                status: 'sent'
            }
        });

        // Update Chat
        await prisma.chat.upsert({
            where: { jid_instanceId: { jid: finalJid, instanceId: id } },
            update: {
                lastMsg: '[Audio]',
                lastMsgTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                updatedAt: new Date(),
            },
            create: {
                instanceId: id,
                jid: finalJid,
                lastMsg: '[Audio]',
                lastMsgTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            }
        });

        // Clean up temp file
        fs.unlink(audioPath, (err) => {
            if (err) console.error('Erro ao apagar áudio temporário:', err);
        });

        res.json(result);
    } catch (err) {
        console.error('ERRO AO ENVIAR AUDIO:', err);
        res.status(500).json({ error: 'Erro ao enviar áudio: ' + err.message });
    }
});


//  ROTAS E FLUXOS (FLOW BUILDER)

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
        if (!flow) return res.status(404).json({ error: 'Flow não encontrado' });
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
app.get(['/', '/:slug'], async (req, res) => {
    try {
        let slug = req.params.slug;

        // Se nao tem slug ou e expressamente 'home', serve a PV (Pagina de Vendas)
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

            // --- SSR: Renderizacao do Conteudo no Servidor ---
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
            const description = settings.seoDescription || `Confira o cardapio digital de ${settings.businessName || 'nossa loja'} e faca seu pedido online.`;
            const image = settings.logoUrl || 'https://hotwhats.com.br/default-logo.png';

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

