import axios from 'axios';
import { io } from 'socket.io-client';

// Detecta o host atual. Se for localhost, usa 3001. Se for IP, usa o mesmo IP na porta 3001.
const getBaseUrl = () => {
  // Força o painel local a se conectar ao backend na DigitalOcean
  return 'http://157.230.239.80:3001';
};


export const API_URL = getBaseUrl();

export const api = axios.create({
  baseURL: API_URL
});

export const socket = io(API_URL);
