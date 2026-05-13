const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'zapfly-secret-key-super-safe';

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.active) {
      return res.status(401).json({ error: 'Credenciais inválidas ou usuário inativo.' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    // Gerar código OTP de 6 dígitos
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Salvar OTP no banco com validade de 10 min
    await prisma.user.update({
      where: { id: user.id },
      data: { otpSecret: otpCode } // Simplificado para usar como código temporário
    });

    // Aqui você integraria o disparo via WhatsApp do próprio painel (se houver instância ativa)
    // ou usaria um provedor externo como Twilio/Z-API para disparar o OTP pro número do admin.
    console.log(`[AUTH] OTP para ${email}: ${otpCode}`); // Para debug local
    
    // Retorna token provisório (só serve pro verify)
    const tempToken = jwt.sign({ id: user.id, pendingOTP: true }, JWT_SECRET, { expiresIn: '10m' });

    res.json({ message: 'OTP enviado.', tempToken });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/verify', async (req, res) => {
  const { tempToken, code } = req.body;
  try {
    const decoded = jwt.verify(tempToken, JWT_SECRET);
    if (!decoded.pendingOTP) return res.status(400).json({ error: 'Token inválido para verificação.' });

    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user || user.otpSecret !== code) {
      return res.status(401).json({ error: 'Código OTP inválido.' });
    }

    // OTP Válido. Limpa o código e gera Token definitivo
    await prisma.user.update({
      where: { id: user.id },
      data: { otpSecret: null }
    });

    const finalToken = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    
    res.json({ 
      token: finalToken, 
      user: { id: user.id, name: user.name, email: user.email, role: user.role } 
    });
  } catch (err) {
    res.status(401).json({ error: 'Token expirado ou inválido.' });
  }
});

module.exports = router;
