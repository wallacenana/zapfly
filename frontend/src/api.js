import axios from 'axios';
import { io } from 'socket.io-client';

export const TOKEN_KEY = 'hotwhats_token';
export const USER_KEY = 'hotwhats_user';

const PUBLIC_AUTH_PATHS = new Set([
  '/auth/login',
  '/auth/verify',
  '/auth/resend-otp',
  '/auth/setup-password',
  '/auth/setup-2fa',
  '/auth/setup-2fa/verify'
]);

const getBaseUrl = () => {
  const configuredUrl = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/$/, '');
  if (configuredUrl) return configuredUrl;

  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'http://localhost:3001';
    }
    return 'https://api.menzzu.com';
  }
  return 'http://localhost:3001';
};

const getRequestPath = (url = '') => String(url).split('?')[0];

const base64UrlDecode = (input) => {
  if (!input || typeof input !== 'string') return null;
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');

  try {
    if (typeof window !== 'undefined' && typeof window.atob === 'function') {
      return window.atob(padded);
    }
    if (typeof globalThis !== 'undefined' && typeof globalThis.atob === 'function') {
      return globalThis.atob(padded);
    }
  } catch (err) {
    return null;
  }

  return null;
};

export const decodeJwtPayload = (token) => {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;

  const decoded = base64UrlDecode(parts[1]);
  if (!decoded) return null;

  try {
    return JSON.parse(decoded);
  } catch (err) {
    return null;
  }
};

export const getTokenExpiryMs = (token) => {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== 'number') return null;
  return payload.exp * 1000;
};

export const isTokenExpired = (token, bufferMs = 0) => {
  const expiryMs = getTokenExpiryMs(token);
  if (!expiryMs) return true;
  return Date.now() >= (expiryMs - bufferMs);
};

export const isPublicAuthRequest = (url = '') => PUBLIC_AUTH_PATHS.has(getRequestPath(url));

export const emitAuthExpired = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('hotwhats:auth-expired'));
};

export const API_URL = getBaseUrl();
export const PUBLIC_SITE_URL = String(import.meta.env.VITE_PUBLIC_SITE_URL || 'https://menzzu.com')
  .trim()
  .replace(/\/$/, '');
export const FILES_URL = String(import.meta.env.VITE_FILES_URL || 'https://files.menzzu.com')
  .trim()
  .replace(/\/$/, '');

export const api = axios.create({
  baseURL: API_URL,
});

export const socket = io(API_URL);

export const clearStoredAuth = () => {
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch (err) {}
  }

  if (api.defaults.headers.common) {
    delete api.defaults.headers.common.Authorization;
    delete api.defaults.headers.common.authorization;
  }
};

const redirectToLogin = () => {
  if (typeof window === 'undefined') return;
  if (window.location.pathname === '/login') return;
  window.location.assign('/login');
};

const getStoredToken = () => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch (err) {
    return null;
  }
};

api.interceptors.request.use((config) => {
  const token = getStoredToken();
  const isPublicAuth = isPublicAuthRequest(config?.url);

  if (!token) return config;

  if (isTokenExpired(token)) {
    clearStoredAuth();
    emitAuthExpired();

    if (!isPublicAuth) {
      redirectToLogin();
      const authError = new Error('SessÃ£o expirada.');
      authError.code = 'AUTH_EXPIRED';
      return Promise.reject(authError);
    }

    return config;
  }

  if (isPublicAuth) return config;

  config.headers = config.headers || {};
  config.headers.Authorization = `Bearer ${token}`;
  return config;
}, (error) => Promise.reject(error));

api.interceptors.response.use((response) => response, (error) => {
  const status = error?.response?.status;
  const hasAuthHeader = Boolean(
    error?.config?.headers?.Authorization || error?.config?.headers?.authorization
  );

  if (status === 401 && hasAuthHeader) {
    clearStoredAuth();
    emitAuthExpired();
    redirectToLogin();
  }

  return Promise.reject(error);
});

