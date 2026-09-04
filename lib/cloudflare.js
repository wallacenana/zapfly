const crypto = require('crypto');

const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';

function getCloudflareConfig() {
  return {
    token: String(process.env.CLOUDFLARE_API_TOKEN || '').trim(),
    zoneId: String(process.env.CLOUDFLARE_ZONE_ID || '').trim(),
    target: String(process.env.CLOUDFLARE_SAAS_TARGET || 'customers.menzzu.com').trim()
  };
}

function normalizeDomain(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
}

function assertValidDomain(domain) {
  if (!domain || domain.length > 253 || domain.includes('..') || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)) {
    throw new Error('Informe um domínio válido, como www.minhaloja.com.br.');
  }
}

function ensureConfigured() {
  const config = getCloudflareConfig();
  if (!config.token || !config.zoneId) {
    const error = new Error('Integração Cloudflare não configurada no servidor.');
    error.code = 'CLOUDFLARE_NOT_CONFIGURED';
    throw error;
  }
  return config;
}

async function cloudflareRequest(path, options = {}) {
  const config = ensureConfigured();
  const method = String(options.method || 'GET').toUpperCase();
  const response = await fetch(`${CLOUDFLARE_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  const diagnostics = {
    method,
    path,
    httpStatus: response.status,
    success: data.success,
    zoneId: config.zoneId ? `${config.zoneId.slice(0, 6)}...${config.zoneId.slice(-4)}` : null,
    tokenConfigured: Boolean(config.token),
    tokenLength: config.token.length,
    tokenFingerprint: config.token ? crypto.createHash('sha256').update(config.token).digest('hex').slice(0, 12) : null,
    errors: Array.isArray(data.errors) ? data.errors.map((error) => ({ code: error.code, message: error.message })) : []
  };
  console.log('[Cloudflare API] Diagnóstico:', JSON.stringify(diagnostics));
  if (!response.ok || data.success === false) {
    const message = data.errors?.map((item) => item.message).filter(Boolean).join('; ')
      || `Cloudflare retornou HTTP ${response.status}.`;
    const error = new Error(message);
    error.status = response.status;
    error.cloudflare = data;
    throw error;
  }
  return data.result;
}

function mapValidationRecords(result) {
  return (result?.validation_records || []).map((record) => ({
    type: record.txt_name ? 'TXT' : (record.http_url ? 'HTTP' : 'DNS'),
    name: record.txt_name || record.http_url || '',
    value: record.txt_record || record.http_body || '',
    status: record.status || 'pending'
  }));
}

async function findCustomHostname(domain) {
  const config = ensureConfigured();
  const query = new URLSearchParams({ hostname: domain, page: '1', per_page: '20' });
  const result = await cloudflareRequest(`/zones/${encodeURIComponent(config.zoneId)}/custom_hostnames?${query}`);
  return result?.find((hostname) => hostname.hostname === domain) || null;
}

async function createOrGetCustomHostname(domain) {
  const config = ensureConfigured();
  const existing = await findCustomHostname(domain);
  if (existing) return existing;

  return cloudflareRequest(`/zones/${encodeURIComponent(config.zoneId)}/custom_hostnames`, {
    method: 'POST',
    body: JSON.stringify({
      hostname: domain,
      ssl: {
        method: 'http',
        type: 'dv',
        settings: { min_tls_version: '1.2' }
      }
    })
  });
}

async function getCustomHostname(hostnameId) {
  const config = ensureConfigured();
  return cloudflareRequest(`/zones/${encodeURIComponent(config.zoneId)}/custom_hostnames/${encodeURIComponent(hostnameId)}`);
}

async function deleteCustomHostname(hostnameId) {
  const config = ensureConfigured();
  return cloudflareRequest(`/zones/${encodeURIComponent(config.zoneId)}/custom_hostnames/${encodeURIComponent(hostnameId)}`, { method: 'DELETE' });
}

module.exports = {
  getCloudflareConfig,
  normalizeDomain,
  assertValidDomain,
  mapValidationRecords,
  createOrGetCustomHostname,
  getCustomHostname,
  deleteCustomHostname
};
