import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';
import FirstLoginSetup from './FirstLoginSetup';
import { Loader2, Zap, Lock, Mail, ShieldCheck, ArrowRight, RefreshCw } from 'lucide-react';

const STEP = { LOGIN: 'LOGIN', OTP: 'OTP' };

export default function Login() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(STEP.LOGIN);
  const [setupData, setSetupData] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tempToken, setTempToken] = useState('');
  const [twoFactorMethod, setTwoFactorMethod] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);
  const otpRefs = useRef([]);

  // Redireciona para o dashboard assim que o login for concluído
  useEffect(() => {
    if (user) navigate('/dashboard', { replace: true });
  }, [user, navigate]);

  // Countdown para reenvio de OTP
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  // Auto-focus no primeiro campo de OTP ao entrar no step
  useEffect(() => {
    if (step === STEP.OTP) {
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    }
  }, [step]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { email, password });
      // First-login setup flow
      if (res.data.requiresSetup) {
        setSetupData({ setupToken: res.data.setupToken, step: res.data.step });
        return;
      }
      setTempToken(res.data.tempToken);
      setTwoFactorMethod(res.data.twoFactorMethod);
      setStep(STEP.OTP);
      setCountdown(60);
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao conectar com o servidor.');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (index, value) => {
    if (value.length > 1) {
      // Paste handling
      const digits = value.replace(/\D/g, '').slice(0, 6).split('');
      const newOtp = [...otp];
      digits.forEach((d, i) => { if (index + i < 6) newOtp[index + i] = d; });
      setOtp(newOtp);
      otpRefs.current[Math.min(index + digits.length, 5)]?.focus();
      return;
    }
    if (!/^\d?$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);
    if (value && index < 5) otpRefs.current[index + 1]?.focus();
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    const code = otp.join('');
    if (code.length < 6) { setError('Digite o código completo de 6 dígitos.'); return; }
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/verify', { tempToken, code });
      login(res.data.token, res.data.user);
    } catch (err) {
      setError(err.response?.data?.error || 'Código inválido ou expirado.');
      setOtp(['', '', '', '', '', '']);
      otpRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0) return;
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { email, password });
      setTempToken(res.data.tempToken);
      setOtp(['', '', '', '', '', '']);
      setCountdown(60);
    } catch {
      setError('Erro ao reenviar. Volte e tente logar novamente.');
    } finally {
      setLoading(false);
    }
  };

  // Se precisar de setup (primeiro login ou sem 2FA), mostra o fluxo guiado
  if (setupData) {
    return <FirstLoginSetup setupToken={setupData.setupToken} startStep={setupData.step} />;
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(ellipse at top left, rgba(59, 130, 246, 0.12) 0%, #09090b 50%, rgba(16, 185, 129, 0.06) 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      fontFamily: "'Inter', sans-serif"
    }}>
      {/* Background grid effect */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0,
        backgroundImage: 'linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)',
        backgroundSize: '50px 50px',
        pointerEvents: 'none'
      }} />

      <div style={{
        position: 'relative', zIndex: 1,
        width: '100%', maxWidth: '420px',
      }}>
        {/* Logo / Brand */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '64px', height: '64px', borderRadius: '18px',
            background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
            boxShadow: '0 0 40px rgba(59, 130, 246, 0.4)',
            marginBottom: '20px'
          }}>
            <Zap size={32} color="#fff" />
          </div>
          <h1 style={{ fontSize: '28px', fontWeight: 800, color: '#f4f4f5', fontFamily: "'Outfit', sans-serif", marginBottom: '6px' }}>
            DigiZap
          </h1>
          <p style={{ color: '#71717a', fontSize: '14px' }}>
            {step === STEP.LOGIN ? 'Entre na sua conta para continuar' : 'Verificação de segurança'}
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: 'rgba(18, 18, 20, 0.8)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: '24px',
          padding: '36px',
          boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
        }}>
          {step === STEP.LOGIN ? (
            <form onSubmit={handleLogin}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {/* Email */}
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#71717a', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    E-mail
                  </label>
                  <div style={{ position: 'relative' }}>
                    <Mail size={16} color="#71717a" style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)' }} />
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                      placeholder="seu@email.com"
                      style={{
                        width: '100%', padding: '13px 14px 13px 40px',
                        borderRadius: '12px', fontSize: '14px',
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        color: '#f4f4f5', outline: 'none',
                        transition: 'border-color 0.2s',
                      }}
                      onFocus={e => e.target.style.borderColor = '#3b82f6'}
                      onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'}
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#71717a', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Senha
                  </label>
                  <div style={{ position: 'relative' }}>
                    <Lock size={16} color="#71717a" style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)' }} />
                    <input
                      type="password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      placeholder="••••••••"
                      style={{
                        width: '100%', padding: '13px 14px 13px 40px',
                        borderRadius: '12px', fontSize: '14px',
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        color: '#f4f4f5', outline: 'none',
                        transition: 'border-color 0.2s',
                      }}
                      onFocus={e => e.target.style.borderColor = '#3b82f6'}
                      onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'}
                    />
                  </div>
                </div>

                {error && (
                  <div style={{
                    padding: '12px 16px', borderRadius: '10px',
                    background: 'rgba(239, 68, 68, 0.08)',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                    color: '#f87171', fontSize: '13px'
                  }}>
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    width: '100%', padding: '14px',
                    borderRadius: '12px', fontSize: '15px', fontWeight: 700,
                    background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                    color: '#fff', border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    boxShadow: '0 4px 20px rgba(59,130,246,0.4)',
                    opacity: loading ? 0.7 : 1,
                    transition: 'all 0.2s',
                  }}
                >
                  {loading ? <Loader2 size={18} className="animate-spin" /> : <>Entrar <ArrowRight size={16} /></>}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp}>
              <div style={{ textAlign: 'center', marginBottom: '28px' }}>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: '52px', height: '52px', borderRadius: '14px',
                  background: 'rgba(16, 185, 129, 0.1)',
                  border: '1px solid rgba(16, 185, 129, 0.2)',
                  marginBottom: '16px'
                }}>
                  <ShieldCheck size={26} color="#10b981" />
                </div>
                <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#f4f4f5', marginBottom: '6px', fontFamily: "'Outfit', sans-serif" }}>
                  Verificação de Segurança
                </h3>
                <p style={{ fontSize: '13px', color: '#71717a', lineHeight: 1.6 }}>
                  {twoFactorMethod === 'totp' ? (
                    'Digite o código de 6 dígitos gerado pelo seu aplicativo autenticador.'
                  ) : (
                    'Enviamos um código de verificação de 6 dígitos para o seu e-mail cadastrado.'
                  )}
                </p>
              </div>

              {/* OTP boxes */}
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginBottom: '24px' }}>
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={el => otpRefs.current[i] = el}
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={digit}
                    onChange={e => handleOtpChange(i, e.target.value)}
                    onKeyDown={e => handleOtpKeyDown(i, e)}
                    style={{
                      width: '48px', height: '58px',
                      textAlign: 'center', fontSize: '22px', fontWeight: 700,
                      borderRadius: '12px',
                      background: digit ? 'rgba(59, 130, 246, 0.1)' : 'rgba(255,255,255,0.04)',
                      border: `2px solid ${digit ? '#3b82f6' : 'rgba(255,255,255,0.08)'}`,
                      color: '#f4f4f5', outline: 'none',
                      transition: 'all 0.2s',
                    }}
                    onFocus={e => e.target.style.borderColor = '#3b82f6'}
                    onBlur={e => { if (!digit) e.target.style.borderColor = 'rgba(255,255,255,0.08)'; }}
                  />
                ))}
              </div>

              {error && (
                <div style={{
                  padding: '12px 16px', borderRadius: '10px', marginBottom: '16px',
                  background: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  color: '#f87171', fontSize: '13px', textAlign: 'center'
                }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || otp.join('').length < 6}
                style={{
                  width: '100%', padding: '14px',
                  borderRadius: '12px', fontSize: '15px', fontWeight: 700,
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: '#fff', border: 'none',
                  cursor: (loading || otp.join('').length < 6) ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  boxShadow: '0 4px 20px rgba(16,185,129,0.3)',
                  opacity: (loading || otp.join('').length < 6) ? 0.6 : 1,
                  transition: 'all 0.2s',
                  marginBottom: '16px'
                }}
              >
                {loading ? <Loader2 size={18} className="animate-spin" /> : <><ShieldCheck size={16} /> Verificar Código</>}
              </button>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <button
                  type="button"
                  onClick={() => { setStep(STEP.LOGIN); setError(''); setOtp(['','','','','','']); }}
                  style={{ background: 'none', border: 'none', color: '#71717a', fontSize: '13px', cursor: 'pointer' }}
                >
                  ← Voltar
                </button>
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={countdown > 0 || loading}
                  style={{
                    background: 'none', border: 'none', cursor: countdown > 0 ? 'not-allowed' : 'pointer',
                    color: countdown > 0 ? '#3f3f46' : '#3b82f6',
                    fontSize: '13px', fontWeight: 600,
                    display: 'flex', alignItems: 'center', gap: '5px',
                    transition: 'color 0.2s'
                  }}
                >
                  <RefreshCw size={13} />
                  {countdown > 0 ? `Reenviar em ${countdown}s` : 'Reenviar código'}
                </button>
              </div>
            </form>
          )}
        </div>

        <p style={{ textAlign: 'center', color: '#3f3f46', fontSize: '12px', marginTop: '24px' }}>
          DigiZap © {new Date().getFullYear()} — Plataforma de automação WhatsApp
        </p>
      </div>
    </div>
  );
}
