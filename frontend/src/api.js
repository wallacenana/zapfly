import axios from 'axios';
import { io } from 'socket.io-client';

// Detecta o host atual. Se for localhost, usa 3001. Se for IP, usa o mesmo IP na porta 3001.
const getBaseUrl = () => {
  const { hostname } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:3001';
  }
  // Se estiver no servidor, usa o IP/Domínio atual mas mantém a porta 3001 (ou ajuste se usar proxy)
  return `http://${hostname}:3001`;
};

export const API_URL = getBaseUrl();

export const api = axios.create({
  baseURL: API_URL
});

export const socket = io(API_URL);
