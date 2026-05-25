const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function phonesMatch(a, b) {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return true;
  if (na === nb) return true;
  const stripBr = (value) => (value.startsWith('55') ? value.slice(2) : value);
  return stripBr(na) === stripBr(nb);
}

function toReviewPayload(review) {
  if (!review) return null;
  return {
    id: review.id,
    orderId: review.orderId || null,
    clientName: review.clientName || '',
    clientPhone: review.clientPhone || '',
    rating: Number(review.rating || 0),
    comment: review.comment || '',
    createdAt: review.createdAt,
    product: review.order?.product || '',
    variation: review.order?.variation || ''
  };
}

async function getReviewSnapshot(userId, limit = 6) {
  const [summary, reviews] = await Promise.all([
    prisma.storeReview.aggregate({
      where: { userId },
      _avg: { rating: true },
      _count: { _all: true }
    }),
    prisma.storeReview.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        orderId: true,
        clientName: true,
        clientPhone: true,
        rating: true,
        comment: true,
        createdAt: true,
        order: {
          select: {
            product: true,
            variation: true
          }
        }
      }
    })
  ]);

  return {
    summary: {
      averageRating: summary._avg.rating !== null && summary._avg.rating !== undefined
        ? Number(summary._avg.rating)
        : null,
      reviewCount: Number(summary._count._all || 0)
    },
    recentReviews: reviews.map(toReviewPayload)
  };
}

router.get('/public/:slug', async (req, res) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase().trim();
    if (!slug) {
      return res.status(400).json({ error: 'Slug obrigatÃ³rio.' });
    }

    const store = await prisma.user.findUnique({
      where: { slug },
      select: { id: true, slug: true, name: true }
    });

    if (!store) {
      return res.status(404).json({ error: 'Loja nÃ£o encontrada.' });
    }

    const snapshot = await getReviewSnapshot(store.id);
    res.json({
      slug: store.slug,
      businessName: store.name,
      ...snapshot
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/public/:slug', async (req, res) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase().trim();
    const { orderId, rating, comment, clientName, clientPhone } = req.body || {};

    if (!slug) {
      return res.status(400).json({ error: 'Slug obrigatÃ³rio.' });
    }

    const normalizedRating = Math.max(1, Math.min(5, parseInt(rating, 10) || 0));
    if (!normalizedRating) {
      return res.status(400).json({ error: 'Selecione uma nota de 1 a 5.' });
    }

    const store = await prisma.user.findUnique({
      where: { slug },
      select: { id: true, slug: true, name: true }
    });

    if (!store) {
      return res.status(404).json({ error: 'Loja nÃ£o encontrada.' });
    }

    const order = await prisma.order.findUnique({
      where: { id: String(orderId || '') },
      select: {
        id: true,
        userId: true,
        product: true,
        variation: true,
        clientName: true,
        clientPhone: true,
        clientJid: true,
        status: true
      }
    });

    if (!order || order.userId !== store.id) {
      return res.status(404).json({ error: 'Pedido nÃ£o encontrado para esta loja.' });
    }

    const reviewableStatuses = new Set(['accepted', 'production', 'ready', 'completed']);
    if (!reviewableStatuses.has(String(order.status || '').toLowerCase())) {
      return res.status(400).json({ error: 'Este pedido ainda não está liberado para avaliação.' });
    }

    if (['cancelled', 'canceled'].includes(String(order.status || '').toLowerCase())) {
      return res.status(400).json({ error: 'Pedidos cancelados não podem ser avaliados.' });
    }

    const phoneFromBody = normalizePhone(clientPhone);
    const phoneFromOrder = normalizePhone(order.clientPhone || order.clientJid || '');
    if (phoneFromBody && phoneFromOrder && !phonesMatch(phoneFromBody, phoneFromOrder)) {
      return res.status(403).json({ error: 'Telefone nÃ£o confere com o pedido.' });
    }

    const existingReview = await prisma.storeReview.findUnique({
      where: { orderId: order.id }
    });

    if (existingReview) {
      return res.status(409).json({ error: 'Este pedido jÃ¡ foi avaliado.' });
    }

    const review = await prisma.storeReview.create({
      data: {
        userId: store.id,
        orderId: order.id,
        clientName: String(clientName || order.clientName || 'Cliente').trim().slice(0, 120) || 'Cliente',
        clientPhone: phoneFromBody || phoneFromOrder || null,
        rating: normalizedRating,
        comment: String(comment || '').trim().slice(0, 500) || null
      },
      select: {
        id: true,
        orderId: true,
        clientName: true,
        clientPhone: true,
        rating: true,
        comment: true,
        createdAt: true,
        order: {
          select: {
            product: true,
            variation: true
          }
        }
      }
    });

    const snapshot = await getReviewSnapshot(store.id);
    res.json({
      review: toReviewPayload(review),
      ...snapshot
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
