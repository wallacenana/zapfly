import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { Loader2, Lock, ShieldCheck, Smartphone, Mail, Eye, EyeOff, CheckCircle2, Copy, Check } from 'lucide-react';

const STEP = {
  CHANGE_PASSWORD: 'must_change_password',
  CHOOSE_METHOD: 'setup_2fa',
  SETUP_EMAIL: 'setup_email',
  SETUP_TOTP: 'setup_totp',
  DONE: 'done',
};

const cardStyle = {
  background: 'rgba(18,18,20,0.85)',
  backdropFilter: 'blur(20px)',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: '24px',
  padding: '40px',
  boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
  width: '100%',
  maxWidth: '440px',
};

const inputStyle = {
  width: '100%', padding: '13px 14px 13px 42px',
  borderRadius: '12px', fontSize: '14px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  color: '#f4f4f5', outline: 'none',
};

const labelStyle = {
  display: 'block', fontSize: '11px', fontWeight: 700,
  color: '#71717a', marginBottom: '8px',
  textTransform: 'uppercase', letterSpacing: '0.08em',
};

const btnPrimary = (extra = {}) => ({
  width: '100%', padding: '14px', borderRadius: '12px',
  fontSize: '15px', fontWeight: 700, border: 'none', cursor: 'pointer',
  background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
  color: '#fff', display: 'flex', alignItems: 'center',
  justifyContent: 'center', gap: '8px',
  boxShadow: '0 4px 20px rgba(59,130,246,0.35)',
  transition: 'all 0.2s',
  ...extra,
});

export default function FirstLoginSetup({ setupToken: initialToken, startStep }) {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(startStep || STEP.CHANGE_PASSWORD);
  const [setupToken, setSetupToken] = useState(initialToken || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Password step
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);

  // 2FA setup
  const [qrCode, setQrCode] = useState('');
  const [totpSecret, setTotpSecret] = useState('');
  const [copied, setCopied] = useState(false);
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [countdown, setCountdown] = useState(0);

  const err = (msg) => setError(msg);

  // ── Step 1: Change password ──────────────────────────────────────────────
  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (password.length < 8) return err('Mínimo 8 caracteres.');
    if (password !== confirm) return err('As senhas não coincidem.');
    setError(''); setLoading(true);
    try {
      const res = await api.post('/auth/setup-password', { setupToken, newPassword: password });
      setSetupToken(res.data.setupToken);
      setStep(STEP.CHOOSE_METHOD);
    } catch (e) { err(e.response?.data?.error || 'Erro.'); }
    finally { setLoading(false); }
  };

  // ── Step 2: Choose method ────────────────────────────────────────────────
  const handleChooseMethod = async (method) => {
    setError(''); setLoading(true);
    try {
      const res = await api.post('/auth/setup-2fa', { setupToken, method });
      if (method === 'totp') {
        setQrCode(res.data.qrCodeUrl);
        setTotpSecret(res.data.secret);
        setStep(STEP.SETUP_TOTP);
      } else {
        setCountdown(60);
        const t = setInterval(() => setCountdown(c => { if (c <= 1) { clearInterval(t); return 0; } return c - 1; }), 1000);
        setStep(STEP.SETUP_EMAIL);
      }
    } catch (e) { err(e.response?.data?.error || 'Erro.'); }
    finally { setLoading(false); }
  };

  // ── Step 3: Verify code ──────────────────────────────────────────────────
  const handleVerify = async (method) => {
    const code = otp.join('');
    if (code.length < 6) return err('Digite os 6 dígitos.');
    setError(''); setLoading(true);
    try {
      const res = await api.post('/auth/setup-2fa/verify', { setupToken, method, code });
      login(res.data.token, res.data.user);
      navigate('/dashboard', { replace: true });
    } catch (e) {
      err(e.response?.data?.error || 'Código inválido.');
      setOtp(['', '', '', '', '', '']);
    } finally { setLoading(false); }
  };

  const handleOtpChange = (i, val) => {
    if (val.length > 1) {
      const digits = val.replace(/\D/g, '').slice(0, 6).split('');
      const n = [...otp];
      digits.forEach((d, j) => { if (i + j < 6) n[i + j] = d; });
      setOtp(n);
      return;
    }
    if (!/^\d?$/.test(val)) return;
    const n = [...otp]; n[i] = val; setOtp(n);
  };

  const copySecret = () => {
    navigator.clipboard.writeText(totpSecret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const BG = (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0,
      backgroundImage: 'linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg,rgba(255,255,255,0.02) 1px,transparent 1px)',
      backgroundSize: '50px 50px', pointerEvents: 'none'
    }} />
  );

  const wrap = (children) => (
    <div style={{ minHeight: '100vh', background: 'radial-gradient(ellipse at top, rgba(59,130,246,0.1) 0%, #09090b 60%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', fontFamily: "'Inter',sans-serif" }}>
      {BG}
      <div style={{ position: 'relative', zIndex: 1, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '52px', height: '52px', borderRadius: '14px', background: 'linear-gradient(135deg,#3b82f6,#2563eb)', boxShadow: '0 0 30px rgba(59,130,246,0.4)', marginBottom: '14px' }}>
            <ShieldCheck size={26} color="#fff" />
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: 800, color: '#f4f4f5', fontFamily: "'Outfit',sans-serif" }}>Configuração de Segurança</h1>
          <p style={{ color: '#71717a', fontSize: '13px', marginTop: '4px' }}>Complete o setup para acessar o sistema</p>
        </div>
        {/* Step indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {['Senha', '2FA', 'Verificar'].map((label, idx) => {
            const stepIdx = step === STEP.CHANGE_PASSWORD ? 0 : (step === STEP.CHOOSE_METHOD ? 1 : 2);
            const active = idx === stepIdx;
            const done = idx < stepIdx;
            return (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '26px', height: '26px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, background: done ? '#10b981' : active ? '#3b82f6' : 'rgba(255,255,255,0.05)', color: (done || active) ? '#fff' : '#71717a', border: `1px solid ${done ? '#10b981' : active ? '#3b82f6' : 'rgba(255,255,255,0.08)'}` }}>
                    {done ? <CheckCircle2 size={14} /> : idx + 1}
                  </div>
                  <span style={{ fontSize: '12px', color: active ? '#f4f4f5' : '#71717a', fontWeight: active ? 700 : 400 }}>{label}</span>
                </div>
                {idx < 2 && <div style={{ width: '24px', height: '1px', background: 'rgba(255,255,255,0.1)' }} />}
              </div>
            );
          })}
        </div>
        {children}
      </div>
    </div>
  );

  // ── STEP: Change password ────────────────────────────────────────────────
  if (step === STEP.CHANGE_PASSWORD) return wrap(
    <div style={cardStyle}>
      <div style={{ marginBottom: '28px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#f4f4f5', fontFamily: "'Outfit',sans-serif", marginBottom: '6px' }}>Crie sua senha</h2>
        <p style={{ fontSize: '13px', color: '#71717a' }}>Esta é sua primeira vez. Escolha uma senha forte.</p>
      </div>
      <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
        {[{ label: 'Nova Senha', val: password, set: setPassword }, { label: 'Confirmar Senha', val: confirm, set: setConfirm }].map(({ label, val, set }) => (
          <div key={label}>
            <label style={labelStyle}>{label}</label>
            <div style={{ position: 'relative' }}>
              <Lock size={15} color="#71717a" style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)' }} />
              <input type={showPw ? 'text' : 'password'} value={val} onChange={e => set(e.target.value)} required placeholder="••••••••" style={{ ...inputStyle, paddingRight: '42px' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'} />
              <button type="button" onClick={() => setShowPw(p => !p)} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#71717a', cursor: 'pointer' }}>
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
        ))}
        {/* Strength bar */}
        {password.length > 0 && (
          <div>
            <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
              {[8, 12, 16].map(n => (
                <div key={n} style={{ flex: 1, height: '3px', borderRadius: '2px', background: password.length >= n ? (n === 8 ? '#f59e0b' : n === 12 ? '#3b82f6' : '#10b981') : 'rgba(255,255,255,0.06)' }} />
              ))}
            </div>
            <p style={{ fontSize: '11px', color: '#71717a' }}>{password.length < 8 ? 'Muito curta' : password.length < 12 ? 'Boa — adicione mais caracteres' : 'Senha forte! 🔒'}</p>
          </div>
        )}
        {error && <div style={{ padding: '10px 14px', borderRadius: '10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', fontSize: '13px' }}>{error}</div>}
        <button type="submit" disabled={loading} style={btnPrimary({ opacity: loading ? 0.7 : 1 })}>
          {loading ? <Loader2 size={17} className="animate-spin" /> : 'Definir Senha e Continuar →'}
        </button>
      </form>
    </div>
  );

  // ── STEP: Choose 2FA method ──────────────────────────────────────────────
  if (step === STEP.CHOOSE_METHOD) return wrap(
    <div style={cardStyle}>
      <div style={{ marginBottom: '28px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#f4f4f5', fontFamily: "'Outfit',sans-serif", marginBottom: '6px' }}>Verificação em 2 Etapas</h2>
        <p style={{ fontSize: '13px', color: '#71717a' }}>Escolha como deseja receber seus códigos de acesso. Esta configuração é <strong style={{ color: '#f4f4f5' }}>obrigatória</strong>.</p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {[
          { method: 'totp', icon: <Smartphone size={22} />, title: 'Google Authenticator (Recomendado)', desc: 'Use um app de autenticação (Google Auth, Authy). Funciona sem internet.', color: '#10b981', glow: 'rgba(16,185,129,0.2)' },
          { method: 'email', icon: <Mail size={22} />, title: 'Código por E-mail', desc: 'Receba um código de 6 dígitos no seu email a cada login.', color: '#3b82f6', glow: 'rgba(59,130,246,0.2)' },
        ].map(({ method, icon, title, desc, color, glow }) => (
          <button key={method} onClick={() => handleChooseMethod(method)} disabled={loading} style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', padding: '20px', borderRadius: '14px', background: 'rgba(255,255,255,0.03)', border: `1px solid rgba(255,255,255,0.07)`, cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s', width: '100%' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = color; e.currentTarget.style.background = `rgba(${color === '#10b981' ? '16,185,129' : '59,130,246'},0.05)`; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'; e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}>
            <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: `rgba(${color === '#10b981' ? '16,185,129' : '59,130,246'},0.1)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color, flexShrink: 0 }}>{icon}</div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#f4f4f5', marginBottom: '4px' }}>{title}</div>
              <div style={{ fontSize: '12px', color: '#71717a', lineHeight: 1.5 }}>{desc}</div>
            </div>
          </button>
        ))}
      </div>
      {error && <div style={{ marginTop: '14px', padding: '10px 14px', borderRadius: '10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', fontSize: '13px' }}>{error}</div>}
    </div>
  );

  // ── STEP: Setup TOTP ─────────────────────────────────────────────────────
  if (step === STEP.SETUP_TOTP) return wrap(
    <div style={{ ...cardStyle, maxWidth: '480px' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#f4f4f5', fontFamily: "'Outfit',sans-serif", marginBottom: '6px' }}>Configure o Google Authenticator</h2>
      <p style={{ fontSize: '13px', color: '#71717a', marginBottom: '24px' }}>Escaneie o QR Code com seu app autenticador, depois confirme com o código gerado.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* QR Code */}
        {qrCode && (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{ padding: '16px', background: '#fff', borderRadius: '16px', display: 'inline-block' }}>
              <img src={qrCode} alt="QR Code" style={{ width: '180px', height: '180px', display: 'block' }} />
            </div>
          </div>
        )}
        {/* Manual code */}
        <div style={{ padding: '14px', borderRadius: '12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <p style={{ fontSize: '11px', color: '#71717a', marginBottom: '8px', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>Ou copie o código manualmente:</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <code style={{ flex: 1, fontSize: '13px', color: '#a78bfa', wordBreak: 'break-all', fontFamily: 'monospace' }}>{totpSecret}</code>
            <button onClick={copySecret} style={{ background: 'none', border: 'none', cursor: 'pointer', color: copied ? '#10b981' : '#71717a', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap' }}>
              {copied ? <><Check size={14} /> Copiado!</> : <><Copy size={14} /> Copiar</>}
            </button>
          </div>
        </div>
        {/* OTP input */}
        <div>
          <label style={{ ...labelStyle, marginBottom: '12px' }}>Código do Autenticador (6 dígitos)</label>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
            {otp.map((d, i) => (
              <input key={i} type="text" inputMode="numeric" maxLength={6} value={d}
                onChange={e => handleOtpChange(i, e.target.value)}
                onKeyDown={e => { if (e.key === 'Backspace' && !d && i > 0) document.querySelectorAll('.otp-box')[i - 1]?.focus(); }}
                className="otp-box"
                style={{ width: '46px', height: '54px', textAlign: 'center', fontSize: '20px', fontWeight: 700, borderRadius: '10px', background: d ? 'rgba(167,139,250,0.1)' : 'rgba(255,255,255,0.04)', border: `2px solid ${d ? '#a78bfa' : 'rgba(255,255,255,0.08)'}`, color: '#f4f4f5', outline: 'none' }}
                onFocus={e => e.target.style.borderColor = '#a78bfa'}
                onBlur={e => { if (!d) e.target.style.borderColor = 'rgba(255,255,255,0.08)'; }}
                ref={el => { if (el) { const inputs = document.querySelectorAll('.otp-box'); if (otp[i] && i < 5) inputs[i + 1]?.focus(); } }}
              />
            ))}
          </div>
        </div>
        {error && <div style={{ padding: '10px 14px', borderRadius: '10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', fontSize: '13px' }}>{error}</div>}
        <button onClick={() => handleVerify('totp')} disabled={loading || otp.join('').length < 6} style={btnPrimary({ background: 'linear-gradient(135deg,#a78bfa,#7c3aed)', boxShadow: '0 4px 20px rgba(167,139,250,0.3)', opacity: (loading || otp.join('').length < 6) ? 0.6 : 1 })}>
          {loading ? <Loader2 size={17} className="animate-spin" /> : <><ShieldCheck size={16} /> Verificar e Ativar 2FA</>}
        </button>
        <button onClick={() => { setStep(STEP.CHOOSE_METHOD); setOtp(['','','','','','']); setError(''); }} style={{ background: 'none', border: 'none', color: '#71717a', fontSize: '13px', cursor: 'pointer' }}>← Escolher outro método</button>
      </div>
    </div>
  );

  // ── STEP: Setup Email OTP ────────────────────────────────────────────────
  if (step === STEP.SETUP_EMAIL) return wrap(
    <div style={cardStyle}>
      <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#f4f4f5', fontFamily: "'Outfit',sans-serif", marginBottom: '6px' }}>Confirme seu Email</h2>
      <p style={{ fontSize: '13px', color: '#71717a', marginBottom: '24px' }}>Enviamos um código de verificação para o seu email. Insira-o abaixo para ativar.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
          {otp.map((d, i) => (
            <input key={i} type="text" inputMode="numeric" maxLength={6} value={d}
              onChange={e => handleOtpChange(i, e.target.value)}
              onKeyDown={e => { if (e.key === 'Backspace' && !d && i > 0) document.querySelectorAll('.otp-email-box')[i - 1]?.focus(); }}
              className="otp-email-box"
              style={{ width: '46px', height: '54px', textAlign: 'center', fontSize: '20px', fontWeight: 700, borderRadius: '10px', background: d ? 'rgba(59,130,246,0.1)' : 'rgba(255,255,255,0.04)', border: `2px solid ${d ? '#3b82f6' : 'rgba(255,255,255,0.08)'}`, color: '#f4f4f5', outline: 'none' }}
            />
          ))}
        </div>
        {error && <div style={{ padding: '10px 14px', borderRadius: '10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', fontSize: '13px' }}>{error}</div>}
        <button onClick={() => handleVerify('email')} disabled={loading || otp.join('').length < 6} style={btnPrimary({ opacity: (loading || otp.join('').length < 6) ? 0.6 : 1 })}>
          {loading ? <Loader2 size={17} className="animate-spin" /> : <><ShieldCheck size={16} /> Verificar e Ativar</>}
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={() => { setStep(STEP.CHOOSE_METHOD); setOtp(['','','','','','']); setError(''); }} style={{ background: 'none', border: 'none', color: '#71717a', fontSize: '13px', cursor: 'pointer' }}>← Outro método</button>
          <button onClick={() => handleChooseMethod('email')} disabled={countdown > 0} style={{ background: 'none', border: 'none', color: countdown > 0 ? '#3f3f46' : '#3b82f6', fontSize: '13px', fontWeight: 600, cursor: countdown > 0 ? 'default' : 'pointer' }}>
            {countdown > 0 ? `Reenviar em ${countdown}s` : 'Reenviar código'}
          </button>
        </div>
      </div>
    </div>
  );

  return null;
}
