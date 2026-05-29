const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const nodemailer = require('nodemailer');
const prisma = require('../lib/prisma');
const { getSettings } = require('../lib/cache');
const { authenticate, requireRole, normalizeRole } = require('../middleware/auth');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'zapfly-secret-key-super-safe';
const APP_NAME = 'DigiZap';
const maskEmail = (email = '') => {
  const value = String(email || '').trim().toLowerCase();
  if (!value.includes('@')) return value;
  const [name, domain] = value.split('@');
  const safeName = name.length <= 2 ? `${name[0] || '*'}*` : `${name.slice(0, 2)}***`;
  return `${safeName}@${domain}`;
};

const authLog = (level, step, message, extra = {}) => {
  const payload = Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : '';
  const line = `[AUTH:${level}] ${step} - ${message}${payload}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

// ─── Mailer map (userId -> transporter)
let mailerInstances = {};

const getMailer = async (userId) => {
  console.log(`[AUTH-DEBUG] 🔍 Iniciando getMailer para o usuário: ${userId}`);

  const envHost = process.env.SMTP_HOST;
  const envPort = process.env.SMTP_PORT;
  const envUser = process.env.SMTP_USER;
  // Remove aspas simples/duplas ao redor da senha se o .env tiver colocado
  const envPass = (process.env.SMTP_PASS || '').replace(/^['"]+|['"]+$/g, '');

  console.log(`[AUTH-DEBUG] 🚀 FINAL: Host=${envHost}, Port=${envPort}, User=${envUser}, Secure=${envPort === 465}`);

  if (!envHost || !envUser || !envPass) {
    console.log('[AUTH-DEBUG] ❌ Erro: Faltam dados de SMTP.');
    return null;
  }

  try {
    const portNum = parseInt(envPort || '587');
    const transporter = nodemailer.createTransport({
      host: envHost,
      port: portNum,
      secure: portNum === 465,       // true só para 465 (SSL direto)
      requireTLS: portNum === 587,   // true para 587 (STARTTLS)
      auth: {
        user: envUser,
        pass: envPass
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
    });
    console.log(`[AUTH-DEBUG] Transporter criado com sucesso (${portNum === 465 ? 'SSL' : 'STARTTLS'})`);
    return transporter;
  } catch (e) {
    console.error('[AUTH-DEBUG] ❌ Erro ao criar o transporter:', e.message);
    return null;
  }
};

const sendOtpEmail = async (userId, toEmail, code, userName) => {
  try {
    const mailer = await getMailer(userId);

    // Agora usamos apenas o e-mail definido no BACKEND (.env)
    const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
    const settings = await getSettings(userId);
    const businessName = settings?.businessName || APP_NAME;

    if (!mailer) {
      console.log(`[AUTH-DEBUG] ⚠️ Abortando: Mailer não pôde ser criado para ${toEmail}`);
      return;
    }

    console.log(`[AUTH-DEBUG] 📧 Tentando disparar e-mail para ${toEmail}...`);

    const info = await mailer.sendMail({
      from: `"${businessName}" <${fromEmail}>`,
      to: toEmail,
      subject: `🔐 Seu código de acesso ${APP_NAME}: ${code}`,
      html: `
        <div style="font-family:Inter,sans-serif;background:#09090b;color:#f4f4f5;padding:40px;max-width:480px;margin:auto;border-radius:16px">
          <h2 style="color:#3b82f6;margin-bottom:8px">${APP_NAME}</h2>
          <p style="color:#a1a1aa;margin-bottom:32px">Verificação em 2 etapas</p>
          <p>Olá, <strong>${userName}</strong>!</p>
          <p style="color:#a1a1aa">Seu código de verificação é:</p>
          <div style="background:#18181b;border:1px solid #27272a;border-radius:12px;padding:24px;text-align:center;margin:24px 0">
            <span style="font-size:40px;font-weight:800;letter-spacing:12px;color:#3b82f6">${code}</span>
          </div>
          <p style="color:#71717a;font-size:13px">Este código expira em <strong>10 minutos</strong>. Se não foi você, ignore este email.</p>
        </div>
      `,
    });

    console.log(`[AUTH-DEBUG] ✅ SUCESSO: E-mail enviado para ${toEmail}. Resposta: ${info.response}`);
  } catch (err) {
    console.error(`[AUTH-DEBUG] ❌ ERRO NO SMTP: Falha ao enviar para ${toEmail}`);
    console.error(`[AUTH-DEBUG] Motivo: ${err.message}`);
    if (err.code) console.error(`[AUTH-DEBUG] Código do Erro: ${err.code}`);
    if (err.command) console.error(`[AUTH-DEBUG] Comando SMTP: ${err.command}`);
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const makeToken = (payload, expiresIn = '10m') =>
  jwt.sign(payload, JWT_SECRET, { expiresIn });

const generateRandomPassword = (length = 12) => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i += 1) {
    result += alphabet[bytes[i] % alphabet.length];
  }
  return result;
};

const slugifyText = (value) => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

const generateUniqueUserSlug = async (baseValue) => {
  const base = slugifyText(baseValue) || 'user';
  let candidate = base;
  let counter = 1;
  while (await prisma.user.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  return candidate;
};

const USER_ROLES = new Set(['user', 'admin', 'superadmin']);

const normalizeRequestedRole = (role) => {
  const normalized = normalizeRole(role);
  return USER_ROLES.has(normalized) ? normalized : 'user';
};

const sendCredentialsEmail = async ({ userId, toEmail, userName, loginEmail, tempPassword, role }) => {
  const mailer = await getMailer(userId);
  if (!mailer) return { sent: false, reason: 'mailer_unavailable' };

  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
  const settings = await getSettings(userId);
  const businessName = settings?.businessName || APP_NAME;

  const info = await mailer.sendMail({
    from: `"${businessName}" <${fromEmail}>`,
    to: toEmail,
    subject: `Credenciais de acesso - ${APP_NAME}`,
    html: `
      <div style="font-family:Inter,Arial,sans-serif;background:#09090b;color:#f4f4f5;padding:32px;max-width:560px;margin:auto;border-radius:16px">
        <h2 style="margin:0 0 8px;color:#22c55e">${businessName}</h2>
        <p style="margin:0 0 24px;color:#a1a1aa">Sua conta foi criada com sucesso.</p>
        <p>Olá, <strong>${userName}</strong>.</p>
        <p style="color:#d4d4d8">Aqui estão suas credenciais de acesso:</p>
        <div style="background:#18181b;border:1px solid #27272a;border-radius:12px;padding:20px;margin:20px 0">
          <p style="margin:0 0 10px"><strong>E-mail:</strong> ${loginEmail}</p>
          <p style="margin:0 0 10px"><strong>Senha provisória:</strong> ${tempPassword}</p>
          <p style="margin:0"><strong>Nível:</strong> ${role}</p>
        </div>
        <p style="color:#a1a1aa">No primeiro acesso, a senha será alterada e as configurações de acesso serão concluídas.</p>
        <p style="margin-top:24px"><a href="https://dash.digizap.com.br/login" style="display:inline-block;background:#22c55e;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">Acessar painel</a></p>
      </div>
    `,
  });

  return { sent: true, response: info?.response || '' };
};

const createProvisionedUser = async ({
  createdByUserId,
  name,
  email,
  role = 'user',
  password,
}) => {
  const cleanName = String(name || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const requestedRole = normalizeRole(role) || 'user';
  const creator = await prisma.user.findUnique({ where: { id: createdByUserId }, select: { role: true } });
  const creatorRole = normalizeRole(creator?.role);

  if (!cleanName || !cleanEmail) {
    const err = new Error('Nome e e-mail sao obrigatorios.');
    err.statusCode = 400;
    throw err;
  }

  if (!['admin', 'superadmin'].includes(creatorRole)) {
    const err = new Error('Acesso restrito.');
    err.statusCode = 403;
    throw err;
  }

  const finalRole = creatorRole === 'superadmin' && USER_ROLES.has(requestedRole)
    ? requestedRole
    : 'user';

  if (creatorRole === 'admin' && requestedRole !== 'user') {
    const err = new Error('Admin pode criar apenas usuarios.');
    err.statusCode = 403;
    throw err;
  }

  const exists = await prisma.user.findUnique({ where: { email: cleanEmail } });
  if (exists) {
    const err = new Error('Ja existe um usuario com este e-mail.');
    err.statusCode = 409;
    throw err;
  }

  const tempPassword = String(password || '').trim() || generateRandomPassword(12);
  const hashedPassword = await bcrypt.hash(tempPassword, 10);
  const hasManualPassword = Boolean(String(password || '').trim());
  const slug = await generateUniqueUserSlug(cleanName || cleanEmail.split('@')[0]);

  const user = await prisma.user.create({
    data: {
      name: cleanName,
      email: cleanEmail,
      slug,
      role: finalRole,
      password: hashedPassword,
      active: true,
      mustChangePassword: !hasManualPassword,
      twoFactorMethod: 'none',
      twoFactorVerified: false,
      twoFactorEnabled: false,
      isFirstLogin: !hasManualPassword,
    },
  });

  let emailResult = { sent: false, reason: 'not_sent' };
  try {
    emailResult = await sendCredentialsEmail({
      userId: createdByUserId,
      toEmail: cleanEmail,
      userName: cleanName,
      loginEmail: cleanEmail,
      tempPassword,
      role: finalRole,
    });
  } catch (err) {
    emailResult = { sent: false, reason: err.message };
  }

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      slug: user.slug,
      active: user.active,
    },
    tempPassword,
    emailResult,
  };
};

router.post('/users', authenticate, requireRole('admin', 'superadmin'), async (req, res) => {
  try {
    const { name, email, role, password } = req.body || {};
    const result = await createProvisionedUser({
      createdByUserId: req.user.id,
      name,
      email,
      role,
      password,
    });

    res.status(201).json({
      message: 'Usuario criado com sucesso.',
      ...result,
    });
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message || 'Falha ao criar usuario.' });
  }
});

router.get('/users', authenticate, requireRole('superadmin'), async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: [
        { role: 'desc' },
        { createdAt: 'desc' },
      ],
      select: {
        id: true,
        name: true,
        email: true,
        slug: true,
        role: true,
        active: true,
        mustChangePassword: true,
        twoFactorMethod: true,
        twoFactorVerified: true,
        twoFactorEnabled: true,
        isFirstLogin: true,
        createdAt: true,
        updatedAt: true,
        storeProfile: {
          select: {
            businessName: true,
            businessCategory: true,
            businessAddress: true,
            acceptOrders: true,
            active: true,
          },
        },
        _count: {
          select: {
            products: true,
            orders: true,
            reviews: true,
          },
        },
      },
    });

    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Falha ao listar usuarios.' });
  }
});

router.patch('/users/:id', authenticate, requireRole('superadmin'), async (req, res) => {
  try {
    const userId = req.params.id;
    const current = await prisma.user.findUnique({ where: { id: userId } });
    if (!current) return res.status(404).json({ error: 'Usuario nao encontrado.' });

    const {
      name,
      email,
      role,
      active,
      mustChangePassword,
      resetPassword,
      password,
    } = req.body || {};

    const data = {};
    if (typeof name === 'string') {
      const cleanName = name.trim();
      if (!cleanName) return res.status(400).json({ error: 'Nome nao pode ser vazio.' });
      data.name = cleanName;
    }
    if (typeof email === 'string') {
      const cleanEmail = email.trim().toLowerCase();
      if (!cleanEmail) return res.status(400).json({ error: 'Email nao pode ser vazio.' });
      const emailOwner = await prisma.user.findFirst({
        where: { email: cleanEmail, NOT: { id: userId } },
        select: { id: true },
      });
      if (emailOwner) return res.status(409).json({ error: 'Este e-mail já está em uso.' });
      data.email = cleanEmail;
    }
    if (typeof active === 'boolean') data.active = active;
    if (typeof mustChangePassword === 'boolean') data.mustChangePassword = mustChangePassword;

    if (role !== undefined) {
      data.role = normalizeRequestedRole(role);
    }

  let tempPassword = null;
  const providedPassword = String(password || '').trim();
    if (resetPassword || providedPassword) {
      tempPassword = providedPassword || generateRandomPassword(12);
      data.password = await bcrypt.hash(tempPassword, 10);
      data.mustChangePassword = !providedPassword;
      data.twoFactorVerified = false;
      data.twoFactorMethod = 'none';
      data.twoFactorEnabled = false;
      if (providedPassword) {
        data.isFirstLogin = false;
      }
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        slug: true,
        role: true,
        active: true,
        mustChangePassword: true,
        twoFactorMethod: true,
        twoFactorVerified: true,
        twoFactorEnabled: true,
        isFirstLogin: true,
        createdAt: true,
        updatedAt: true,
        storeProfile: {
          select: {
            businessName: true,
            businessCategory: true,
            businessAddress: true,
            acceptOrders: true,
            active: true,
          },
        },
        _count: {
          select: {
            products: true,
            orders: true,
            reviews: true,
          },
        },
      },
    });

    if (resetPassword) {
      try {
        await sendCredentialsEmail({
          userId: req.user.id,
          toEmail: updated.email,
          userName: updated.name,
          loginEmail: updated.email,
          tempPassword,
          role: updated.role,
        });
      } catch (err) {
        console.warn('[AUTH users] Falha ao reenviar credenciais:', err.message);
      }
    }

    res.json({
      message: 'Usuario atualizado com sucesso.',
      user: updated,
      tempPassword,
    });
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message || 'Falha ao atualizar usuario.' });
  }
});

router.delete('/users/:id', authenticate, requireRole('superadmin'), async (req, res) => {
  try {
    const userId = req.params.id;
    if (req.user.id === userId) {
      return res.status(400).json({ error: 'Voce nao pode excluir seu proprio usuario.' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true } });
    if (!user) return res.status(404).json({ error: 'Usuario nao encontrado.' });

    await prisma.user.delete({ where: { id: userId } });
    res.json({ message: 'Usuario excluido com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Falha ao excluir usuario.' });
  }
});

// ─── POST /auth/login ─────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    authLog('info', 'login:start', 'Login iniciado', { email: maskEmail(email) });
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      authLog('warn', 'login:user-not-found', 'Usuario nao encontrado', { email: maskEmail(email) });
      return res.status(401).json({ error: 'Credenciais inválidas ou usuário inativo.' });
    }
    if (!user.active) {
      authLog('warn', 'login:user-inactive', 'Usuario inativo', { userId: user.id, email: maskEmail(user.email) });
      return res.status(401).json({ error: 'Credenciais inválidas ou usuário inativo.' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      authLog('warn', 'login:bad-password', 'Senha incorreta', { userId: user.id, email: maskEmail(user.email) });
      return res.status(401).json({ error: 'Senha incorreta.' });
    }

    // Primeiro login: precisa trocar a senha
    if (user.mustChangePassword) {
      authLog('info', 'login:setup-password', 'Usuario precisa trocar senha', { userId: user.id, email: maskEmail(user.email) });
      const setupToken = makeToken({ id: user.id, setupStep: 'change_password' }, '30m');
      return res.json({ requiresSetup: true, step: 'change_password', setupToken });
    }

    // Conta provisionada manualmente: senha definida no admin e sem 2FA inicial.
    if (user.twoFactorMethod === 'none' && !user.twoFactorVerified && !user.isFirstLogin) {
      authLog('info', 'login:direct-access', 'Acesso direto liberado para conta provisionada manualmente', { userId: user.id, email: maskEmail(user.email) });
      const finalToken = makeToken({ id: user.id, role: user.role, slug: user.slug }, '7d');
      return res.json({
        token: finalToken,
        user: { id: user.id, name: user.name, email: user.email, role: user.role, slug: user.slug },
      });
    }

    // Ainda não configurou 2FA
    if (!user.twoFactorVerified) {
      authLog('info', 'login:setup-2fa', 'Usuario precisa configurar 2FA', { userId: user.id, email: maskEmail(user.email) });
      const setupToken = makeToken({ id: user.id, setupStep: 'setup_2fa' }, '30m');
      return res.json({ requiresSetup: true, step: 'setup_2fa', setupToken });
    }

    // Fluxo normal: envia 2FA pelo método do usuário
    if (user.twoFactorMethod === 'email') {
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      authLog('info', 'login:otp-email', 'Gerando OTP por email', { userId: user.id, email: maskEmail(user.email) });
      await prisma.user.update({ where: { id: user.id }, data: { otpSecret: code } });
      await sendOtpEmail(user.id, user.email, code, user.name);
      authLog('info', 'login:otp-email-sent', 'OTP por email disparado', { userId: user.id, email: maskEmail(user.email) });
    }
    // Para TOTP (Google Auth), não precisa enviar nada, o usuário abre o app

    const tempToken = makeToken({ id: user.id, twoFactorMethod: user.twoFactorMethod, pendingOTP: true });
    authLog('info', 'login:otp-pending', 'Login aguardando verificacao OTP', { userId: user.id, email: maskEmail(user.email), method: user.twoFactorMethod });
    res.json({ tempToken, twoFactorMethod: user.twoFactorMethod });
  } catch (err) {
    authLog('error', 'login:exception', err.message, { stack: err.stack?.split('\n')?.[0] || '' });
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /auth/setup-password ────────────────────────────────────────────────
router.post('/setup-password', async (req, res) => {
  const { setupToken, newPassword } = req.body;
  try {
    const decoded = jwt.verify(setupToken, JWT_SECRET);
    if (decoded.setupStep !== 'change_password')
      return res.status(400).json({ error: 'Token inválido para esta etapa.' });

    if (!newPassword || newPassword.length < 8)
      return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres.' });

    const hash = await bcrypt.hash(newPassword, 10);
    const user = await prisma.user.update({
      where: { id: decoded.id },
      data: { password: hash, mustChangePassword: false },
    });

    // Se ainda não configurou 2FA, manda para esse setup
    if (!user.twoFactorVerified) {
      const setupToken2fa = makeToken({ id: user.id, setupStep: 'setup_2fa' }, '30m');
      return res.json({ requiresSetup: true, step: 'setup_2fa', setupToken: setupToken2fa });
    }

    // Já tem 2FA configurado (improvável no primeiro login, mas cobre edge cases)
    const tempToken = makeToken({ id: user.id, twoFactorMethod: user.twoFactorMethod, pendingOTP: true });
    res.json({ tempToken, twoFactorMethod: user.twoFactorMethod });
  } catch (err) {
    res.status(401).json({ error: 'Token expirado ou inválido.' });
  }
});

// ─── POST /auth/setup-2fa ─────────────────────────────────────────────────────
// Inicia o setup: gera secret TOTP ou envia email OTP
router.post('/setup-2fa', async (req, res) => {
  const { setupToken, method } = req.body;
  try {
    const decoded = jwt.verify(setupToken, JWT_SECRET);
    if (decoded.setupStep !== 'setup_2fa')
      return res.status(400).json({ error: 'Token inválido para esta etapa.' });

    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    if (method === 'totp') {
      const secret = speakeasy.generateSecret({ name: `${APP_NAME} (${user.email})`, length: 20 });
      await prisma.user.update({ where: { id: user.id }, data: { otpSecret: secret.base32 } });
      const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
      return res.json({ method: 'totp', secret: secret.base32, qrCodeUrl });
    }

    if (method === 'email') {
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      console.log(`[AUTH-DEBUG] Gerado código ${code} para ${user.email}`);
      await prisma.user.update({ where: { id: user.id }, data: { otpSecret: code } });

      console.log('[AUTH-DEBUG] Disparando sendOtpEmail...');
      sendOtpEmail(user.id, user.email, code, user.name).catch(e => {
        console.error('[AUTH-ERROR] ❌ Erro fatal no envio:', e.message);
        console.error(e);
      });

      return res.json({ method: 'email' });
    }

    console.log(`[AUTH-DEBUG] ❌ Método inválido recebido: ${method}`);
    res.status(400).json({ error: 'Método inválido. Use "email" ou "totp".' });
  } catch (err) {
    console.error('[AUTH-ERROR] ❌ Erro no catch do setup-2fa:', err.message);
    res.status(401).json({ error: 'Token expirado ou inválido.' });
  }
});

// ─── POST /auth/setup-2fa/verify ─────────────────────────────────────────────
// Verifica o código e marca o 2FA como configurado
router.post('/setup-2fa/verify', async (req, res) => {
  const { setupToken, method, code } = req.body;
  console.log(`[2FA-VERIFY] Recebido: method=${method}, code=${code}`);
  try {
    const decoded = jwt.verify(setupToken, JWT_SECRET);
    console.log(`[2FA-VERIFY] Token decodificado: setupStep=${decoded.setupStep}, userId=${decoded.id}`);
    if (decoded.setupStep !== 'setup_2fa')
      return res.status(400).json({ error: 'Token inválido para esta etapa.' });

    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    console.log(`[2FA-VERIFY] User encontrado: ${user.email}, otpSecret=${user.otpSecret ? 'existe' : 'VAZIO'}`);

    let valid = false;
    if (method === 'totp') {
      valid = speakeasy.totp.verify({
        secret: user.otpSecret,
        encoding: 'base32',
        token: code,
        window: 2,
      });
      console.log(`[2FA-VERIFY] Resultado TOTP: ${valid ? '✅ VÁLIDO' : '❌ INVÁLIDO'}`);
    } else if (method === 'email') {
      valid = user.otpSecret === code;
      console.log(`[2FA-VERIFY] Resultado EMAIL: esperado=${user.otpSecret}, recebido=${code}, match=${valid}`);
    }

    if (!valid) return res.status(401).json({ error: 'Código inválido. Tente novamente.' });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorMethod: method,
        twoFactorVerified: true,
        otpSecret: method === 'email' ? null : user.otpSecret,
      },
    });

    console.log(`[2FA-VERIFY] ✅ 2FA configurado com sucesso para ${user.email}`);
    const finalToken = makeToken({ id: user.id, role: user.role, slug: user.slug }, '7d');
    res.json({
      token: finalToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, slug: user.slug },
    });
  } catch (err) {
    res.status(401).json({ error: 'Token expirado ou inválido.' });
  }
});

// ─── POST /auth/verify ────────────────────────────────────────────────────────
// Verifica o 2FA no login normal
router.post('/verify', async (req, res) => {
  const { tempToken, code } = req.body;
  try {
    authLog('info', 'verify:start', 'Verificacao OTP iniciada');
    if (!tempToken) {
      authLog('warn', 'verify:missing-temp-token', 'TempToken ausente no request');
      return res.status(400).json({ error: 'Sessão de verificação ausente. Faça login novamente.' });
    }
    const decoded = jwt.verify(tempToken, JWT_SECRET);
    if (!decoded.pendingOTP) {
      authLog('warn', 'verify:invalid-token', 'Token sem pendingOTP');
      return res.status(400).json({ error: 'Token inválido.' });
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) {
      authLog('warn', 'verify:user-not-found', 'Usuario nao encontrado', { userId: decoded.id });
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    let valid = false;
    if (user.twoFactorMethod === 'totp') {
      authLog('info', 'verify:method-totp', 'Validando TOTP', { userId: user.id, email: maskEmail(user.email) });
      valid = speakeasy.totp.verify({
        secret: user.otpSecret,
        encoding: 'base32',
        token: code,
        window: 2,
      });
    } else {
      authLog('info', 'verify:method-email', 'Validando OTP por email', { userId: user.id, email: maskEmail(user.email) });
      valid = user.otpSecret === code;
      if (valid) {
        await prisma.user.update({ where: { id: user.id }, data: { otpSecret: null } });
      }
    }

    if (!valid) {
      authLog('warn', 'verify:invalid-code', 'Codigo invalido ou expirado', { userId: user.id, email: maskEmail(user.email) });
      return res.status(401).json({ error: 'Código inválido ou expirado.' });
    }

    const finalToken = makeToken({ id: user.id, role: user.role, slug: user.slug }, '7d');
    authLog('info', 'verify:success', 'Login confirmado', { userId: user.id, email: maskEmail(user.email), role: user.role });
    res.json({
      token: finalToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, slug: user.slug },
    });
  } catch (err) {
    authLog('error', 'verify:exception', err.message);
    res.status(401).json({ error: 'Token expirado ou inválido.' });
  }
});

// ─── POST /auth/resend-otp ────────────────────────────────────────────────────
router.post('/resend-otp', async (req, res) => {
  const { tempToken } = req.body;
  try {
    const decoded = jwt.verify(tempToken, JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user || user.twoFactorMethod !== 'email')
      return res.status(400).json({ error: 'Reenvio disponível apenas para o método de email.' });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await prisma.user.update({ where: { id: user.id }, data: { otpSecret: code } });
    await sendOtpEmail(user.id, user.email, code, user.name);
    res.json({ message: 'Código reenviado.' });
  } catch (err) {
    res.status(401).json({ error: 'Token expirado ou inválido.' });
  }
});

// ─── POST /auth/test-email ────────────────────────────────────────────────────
router.post('/test-email', async (req, res) => {
  const { to } = req.body;
  // This one is tricky since it's used BEFORE login sometimes, or for testing.
  // We should ideally require auth here.
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Auth required for testing email.' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.id;
    if (!to) return res.status(400).json({ error: 'Destinatário não informado.' });

    const mailer = await getMailer(userId);
    if (!mailer) return res.status(400).json({ error: 'SMTP global não configurado no servidor (.env).' });

    const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
    const settings = await getSettings(userId);

    await mailer.sendMail({
      from: `"${settings?.businessName || APP_NAME}" <${fromEmail}>`,
      to,
      subject: '✅ Teste de Email - DigiZap',
      html: `<div style="font-family:sans-serif;padding:30px;background:#09090b;color:#f4f4f5;border-radius:12px"><h2 style="color:#10b981">Funcionou! 🎉</h2><p>Seu servidor SMTP global está configurado corretamente.</p></div>`,
    });
    res.json({ message: 'Email de teste enviado com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.invalidateMailer = (userId) => {
  if (userId) delete mailerInstances[userId];
  else mailerInstances = {};
};
