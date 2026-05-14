import axios from 'axios';
import { io } from 'socket.io-client';

const getBaseUrl = () => {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'http://localhost:3001';
    }
    return 'https://api.digizap.com.br';
  }
  return 'http://localhost:3001';
};

export const API_URL = getBaseUrl();

export const api = axios.create({
  baseURL: API_URL,
});

export const socket = io(API_URL);

// Interceptor para adicionar o token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}, (error) => {
  return Promise.reject(error);
});

// Interceptor para 401
api.interceptors.response.use((response) => {
  return response;
}, (error) => {
  if (error.response && error.response.status === 401) {
    localStorage.removeItem('token');
    window.location.href = '/login';
  }
  return Promise.reject(error);
});
