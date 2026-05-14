const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'zapfly-secret-key-super-safe';

const authenticate = (req, res, next) => {
  // Bypassa autenticação para chamadas internas da IA se o token conferir
  const internalToken = req.headers['x-internal-token'];
  const internalSecret = process.env.INTERNAL_TOKEN || 'zapfly-internal-bypass-key';
  
  if (internalToken && internalToken === internalSecret) {
    const userId = req.headers['x-user-id'];
    if (userId) {
      req.user = { id: userId, internal: true };
      return next();
    }
  }

  let token = null;

  // 1. Tenta pegar do Header Authorization
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  // 2. Se não tem no header, tenta pegar do query parameter 'token'
  if (!token && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    console.warn('[Auth Middleware] Token não fornecido para rota:', req.originalUrl);
    return res.status(401).json({ error: 'Token não fornecido' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    console.error('[Auth Middleware] Token inválido ou expirado:', err.message);
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'ADMIN') {
    next();
  } else {
    return res.status(403).json({ error: 'Acesso restrito a administradores.' });
  }
};

module.exports = { authenticate, requireAdmin };
