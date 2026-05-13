import axios from 'axios';
import { io } from 'socket.io-client';

// Detecta o host atual. Se for localhost, usa 3001. Se for IP, usa o mesmo IP na porta 3001.
const getBaseUrl = () => {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'http://localhost:3001';
    }
    // Em produção, usa o subdomínio da API
    return 'https://api.digizap.com.br';
  }
  return 'http://localhost:3001';
};


export const API_URL = getBaseUrl();

export const api = axios.create({
  baseURL: API_URL
});

export const socket = io(API_URL);
