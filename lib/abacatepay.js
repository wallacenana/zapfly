const axios = require('axios');

const API_URL = 'https://api.abacatepay.com/v2';

const getProductId = (planKey) => {
  return String(process.env[`ABACATEPAY_${String(planKey).toUpperCase()}_PRODUCT_ID`] || '').trim();
};

const abacateRequest = async (method, pathname, data) => {
  const token = String(process.env.ABACATEPAY_API_KEY || '').trim();
  if (!token) {
    const error = new Error('ABACATEPAY_API_KEY não configurada.');
    error.code = 'ABACATEPAY_NOT_CONFIGURED';
    throw error;
  }
  const response = await axios({
    method,
    url: `${API_URL}${pathname}`,
    data,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    timeout: 15000,
  });
  if (response.data?.success === false) {
    const error = new Error(response.data?.error || 'Erro na Abacate Pay.');
    error.status = response.status;
    throw error;
  }
  return response.data?.data || response.data;
};

const createSubscriptionCheckout = ({ planKey, externalId, metadata, customerId }) => {
  const productId = getProductId(planKey);
  if (!productId) {
    const error = new Error(`Produto Abacate Pay não configurado para o plano ${planKey}.`);
    error.code = 'ABACATEPAY_PRODUCT_NOT_CONFIGURED';
    throw error;
  }
  const payload = {
    items: [{ id: productId, quantity: 1 }],
    methods: ['CARD'],
    externalId,
    metadata,
    returnUrl: `${String(process.env.FRONTEND_URL || 'https://app.menzzu.com').replace(/\/$/, '')}/conta`,
    completionUrl: `${String(process.env.FRONTEND_URL || 'https://app.menzzu.com').replace(/\/$/, '')}/conta?payment=success`,
  };
  if (customerId) payload.customerId = customerId;
  return abacateRequest('POST', '/subscriptions/create', payload);
};

module.exports = { abacateRequest, createSubscriptionCheckout };
