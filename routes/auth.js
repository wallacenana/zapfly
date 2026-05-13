const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const nodemailer = require('nodemailer');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'zapfly-secret-key-super-safe';
const APP_NAME = 'ZapFly';

// ─── Mailer map (userId -> transporter)
let mailerInstances = {};

const getMailer = async (userId) => {
  if (mailerInstances[userId]) return mailerInstances[userId];
  
  const settings = await prisma.setting.findUnique({ where: { userId } });
  
  // Tenta pegar do Banco, se não tiver, tenta do .env
  const host = settings?.smtpHost || process.env.SMTP_HOST;
  const port = settings?.smtpPort || parseInt(process.env.SMTP_PORT || '587');
  const user = settings?.smtpUser || process.env.SMTP_USER;
  const pass = settings?.smtpPass || process.env.SMTP_PASS;

  if (!host || !user || !pass) return null;
  
  mailerInstances[userId] = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  return mailerInstances[userId];
};

const sendOtpEmail = async (userId, toEmail, code, userName) => {
  const mailer = await getMailer(userId);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!mailer) {
    console.log(`[AUTH] OTP para ${toEmail}: ${code}`);
    return;
  }
  const settings = await prisma.setting.findUnique({ where: { userId } });
  await mailer.sendMail({
    from: `"${settings?.businessName || APP_NAME}" <${settings.smtpUser}>`,
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
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const makeToken = (payload, expiresIn = '10m') =>
  jwt.sign(payload, JWT_SECRET, { expiresIn });

// ─── POST /auth/login ─────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.active)
      return res.status(401).json({ error: 'Credenciais inválidas ou usuário inativo.' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Senha incorreta.' });

    // Primeiro login: precisa trocar a senha
    if (user.mustChangePassword) {
      const setupToken = makeToken({ id: user.id, setupStep: 'change_password' }, '30m');
      return res.json({ requiresSetup: true, step: 'change_password', setupToken });
    }

    // Ainda não configurou 2FA
    if (!user.twoFactorVerified) {
      const setupToken = makeToken({ id: user.id, setupStep: 'setup_2fa' }, '30m');
      return res.json({ requiresSetup: true, step: 'setup_2fa', setupToken });
    }

    // Fluxo normal: envia 2FA pelo método do usuário
    if (user.twoFactorMethod === 'email') {
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      await prisma.user.update({ where: { id: user.id }, data: { otpSecret: code } });
      await sendOtpEmail(user.id, user.email, code, user.name);
    }
    // Para TOTP (Google Auth), não precisa enviar nada, o usuário abre o app

    const tempToken = makeToken({ id: user.id, twoFactorMethod: user.twoFactorMethod, pendingOTP: true });
    res.json({ tempToken, twoFactorMethod: user.twoFactorMethod });
  } catch (err) {
    console.error('[AUTH login]', err);
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
      await prisma.user.update({ where: { id: user.id }, data: { otpSecret: code } });
      await sendOtpEmail(user.id, user.email, code, user.name);
      return res.json({ method: 'email' });
    }

    res.status(400).json({ error: 'Método inválido. Use "email" ou "totp".' });
  } catch (err) {
    res.status(401).json({ error: 'Token expirado ou inválido.' });
  }
});

// ─── POST /auth/setup-2fa/verify ─────────────────────────────────────────────
// Verifica o código e marca o 2FA como configurado
router.post('/setup-2fa/verify', async (req, res) => {
  const { setupToken, method, code } = req.body;
  try {
    const decoded = jwt.verify(setupToken, JWT_SECRET);
    if (decoded.setupStep !== 'setup_2fa')
      return res.status(400).json({ error: 'Token inválido para esta etapa.' });

    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    let valid = false;
    if (method === 'totp') {
      valid = speakeasy.totp.verify({
        secret: user.otpSecret,
        encoding: 'base32',
        token: code,
        window: 2,
      });
    } else if (method === 'email') {
      valid = user.otpSecret === code;
    }

    if (!valid) return res.status(401).json({ error: 'Código inválido. Tente novamente.' });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorMethod: method,
        twoFactorVerified: true,
        // Para TOTP, mantém o secret permanentemente; para email, limpa
        otpSecret: method === 'email' ? null : user.otpSecret,
      },
    });

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
    const decoded = jwt.verify(tempToken, JWT_SECRET);
    if (!decoded.pendingOTP) return res.status(400).json({ error: 'Token inválido.' });

    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    let valid = false;
    if (user.twoFactorMethod === 'totp') {
      valid = speakeasy.totp.verify({
        secret: user.otpSecret,
        encoding: 'base32',
        token: code,
        window: 2,
      });
    } else {
      valid = user.otpSecret === code;
      if (valid) {
        await prisma.user.update({ where: { id: user.id }, data: { otpSecret: null } });
      }
    }

    if (!valid) return res.status(401).json({ error: 'Código inválido ou expirado.' });

    const finalToken = makeToken({ id: user.id, role: user.role, slug: user.slug }, '7d');
    res.json({
      token: finalToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, slug: user.slug },
    });
  } catch (err) {
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
    if (!mailer) return res.status(400).json({ error: 'SMTP não configurado. Salve as configurações primeiro.' });
    const settings = await prisma.setting.findUnique({ where: { userId } });
    
    await mailer.sendMail({
      from: `"${settings?.businessName || APP_NAME}" <${settings.smtpUser}>`,
      to,
      subject: '✅ Teste de Email - ZapFly',
      html: `<div style="font-family:sans-serif;padding:30px;background:#09090b;color:#f4f4f5;border-radius:12px"><h2 style="color:#10b981">Funcionou! 🎉</h2><p>Seu servidor SMTP está configurado corretamente no ZapFly.</p></div>`,
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
