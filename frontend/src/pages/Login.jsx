import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Lock, Mail, UserRound, Loader2, ShieldCheck } from 'lucide-react';
import { api, API_URL, decodeJwtPayload } from '../api';
import { useAuth } from '../contexts/AuthContext';
import FirstLoginSetup from './FirstLoginSetup';

const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '14px 14px 14px 42px', borderRadius: '12px', border: '1px solid #d9e5d2', background: '#fff', color: '#10251a', outline: 'none', fontSize: '14px' };
const buttonStyle = { width: '100%', padding: '14px', border: 0, borderRadius: '12px', background: 'linear-gradient(135deg,#5db72c,#3f8f19)', color: '#fff', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 };
const linkStyle = { border: 0, background: 'transparent', color: '#3f8f19', fontWeight: 800, cursor: 'pointer', padding: 0 };

function Field({ icon: Icon, label, value, onChange, ...props }) {
  return <label style={{ display: 'block', marginBottom: 16, fontSize: 12, fontWeight: 800, color: '#53665a' }}>{label}<span style={{ display: 'block', position: 'relative', marginTop: 7 }}><Icon size={16} color="#779080" style={{ position: 'absolute', left: 14, top: 14 }} /><input required value={value} onChange={(event) => onChange(event.target.value)} style={inputStyle} {...props} /></span></label>;
}

export default function Login() {
  const { login } = useAuth();
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [tempToken, setTempToken] = useState('');
  const [twoFactorMethod, setTwoFactorMethod] = useState('');
  const [setupData, setSetupData] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('google_token');
    const payload = decodeJwtPayload(token);
    if (!token || !payload?.id) return;
    login(token, { id: payload.id, name: payload.name, email: payload.email, role: payload.role, slug: payload.slug });
    window.history.replaceState({}, document.title, '/login');
    window.location.replace('/get-started');
  }, [login]);

  const loginWithGoogle = () => window.location.assign(`${API_URL}/auth/google/login`);

  const submit = async (event) => {
    event.preventDefault(); setError(''); setMessage(''); setLoading(true);
    try {
      if (mode === 'register') {
        const { data } = await api.post('/auth/register', { name, email, password });
        login(data.token, data.user); window.location.replace('/get-started'); return;
      }
      if (mode === 'forgot') {
        const { data } = await api.post('/auth/forgot-password', { email });
        setMessage(data.message || 'Se o e-mail existir, enviaremos as instruções.'); return;
      }
      const { data } = await api.post('/auth/login', { email, password });
      if (data.requiresSetup) { setSetupData({ setupToken: data.setupToken, step: data.step }); return; }
      if (data.token) { login(data.token, data.user); window.location.replace('/get-started'); return; }
      setTempToken(data.tempToken); setTwoFactorMethod(data.twoFactorMethod); setMode('otp');
    } catch (err) { setError(err?.response?.data?.error || 'Não foi possível concluir a solicitação.'); } finally { setLoading(false); }
  };

  const verifyOtp = async (event) => {
    event.preventDefault(); setError(''); setLoading(true);
    try { const { data } = await api.post('/auth/verify', { tempToken, code: otp }); login(data.token, data.user); window.location.replace('/get-started'); }
    catch (err) { setError(err?.response?.data?.error || 'Código inválido.'); } finally { setLoading(false); }
  };

  if (setupData) return <FirstLoginSetup setupToken={setupData.setupToken} startStep={setupData.step} />;
  const title = mode === 'register' ? 'Crie sua conta' : mode === 'forgot' ? 'Recupere seu acesso' : mode === 'otp' ? 'Verificação de segurança' : 'Entre na sua conta';
  const subtitle = mode === 'register' ? 'Comece seu trial e organize seu cardápio.' : mode === 'forgot' ? 'Enviaremos um link para redefinir sua senha.' : mode === 'otp' ? `Digite o código enviado por ${twoFactorMethod === 'email' ? 'e-mail' : 'seu autenticador'}.` : 'Cardápio digital com automação no WhatsApp.';
  return <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'radial-gradient(circle at 15% 10%, #e9f8df 0, transparent 35%), linear-gradient(135deg,#f7faf5 0%,#eef5ea 100%)', color: '#10251a', fontFamily: "'Inter', sans-serif" }}><section style={{ width: '100%', maxWidth: 430 }}><div style={{ textAlign: 'center', marginBottom: 24 }}><div style={{ display: 'inline-flex', width: 62, height: 62, borderRadius: 18, background: '#fff', alignItems: 'center', justifyContent: 'center', boxShadow: '0 12px 30px rgba(49,100,35,.12)' }}><img src="/logo%20HotWhats.png" alt="Menzzu" style={{ width: 40, height: 40, objectFit: 'contain' }} /></div><h1 style={{ margin: '16px 0 6px', fontSize: 30, fontFamily: "'Outfit', sans-serif" }}>Menzzu</h1><p style={{ margin: 0, color: '#607066', fontSize: 14 }}>{subtitle}</p></div><div style={{ background: 'rgba(255,255,255,.92)', border: '1px solid #d9e5d2', borderRadius: 22, padding: 30, boxShadow: '0 20px 50px rgba(34,75,30,.10)' }}><h2 style={{ margin: '0 0 22px', fontSize: 22, fontFamily: "'Outfit', sans-serif" }}>{title}</h2>{mode === 'login' && <button type="button" onClick={loginWithGoogle} style={{ ...buttonStyle, background: '#fff', color: '#23402a', border: '1px solid #d9e5d2', boxShadow: 'none', marginBottom: 18 }}><span style={{ color: '#4285f4', fontSize: 18, fontWeight: 900 }}>G</span> Entrar com Google</button>}{message ? <div style={{ textAlign: 'center', color: '#3f8f19', lineHeight: 1.6 }}><CheckCircle2 size={38} /><p>{message}</p></div> : <form onSubmit={mode === 'otp' ? verifyOtp : submit}>{mode === 'register' && <Field icon={UserRound} label="Nome" value={name} onChange={setName} placeholder="Como podemos te chamar?" autoComplete="name" />}{mode !== 'otp' && <Field icon={Mail} label="E-mail" value={email} onChange={setEmail} placeholder="seu@email.com" autoComplete="email" type="email" />}{(mode === 'login' || mode === 'register') && <Field icon={Lock} label="Senha" value={password} onChange={setPassword} placeholder={mode === 'register' ? 'Mínimo de 8 caracteres' : 'Digite sua senha'} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} type="password" minLength={mode === 'register' ? 8 : 1} />}{mode === 'otp' && <Field icon={ShieldCheck} label="Código" value={otp} onChange={setOtp} placeholder="Código de 6 dígitos" inputMode="numeric" maxLength={6} />}{error && <div style={{ margin: '14px 0', padding: 12, borderRadius: 10, background: '#fff0ef', border: '1px solid #f5c4bf', color: '#b42318', fontSize: 13 }}>{error}</div>}<button type="submit" disabled={loading} style={{ ...buttonStyle, marginTop: 8 }}>{loading ? <Loader2 size={18} /> : <>{mode === 'login' ? 'Entrar' : mode === 'register' ? 'Criar conta' : mode === 'forgot' ? 'Enviar link' : 'Confirmar'} <ArrowRight size={17} /></>}</button></form>}<div style={{ marginTop: 20, textAlign: 'center', fontSize: 13, color: '#607066' }}>{mode === 'login' && <><button type="button" onClick={() => setMode('forgot')} style={linkStyle}>Esqueci minha senha</button><span style={{ margin: '0 8px' }}>•</span><button type="button" onClick={() => setMode('register')} style={linkStyle}>Criar conta</button></>}{mode === 'register' && <button type="button" onClick={() => setMode('login')} style={linkStyle}>Já tenho uma conta</button>}{(mode === 'forgot' || mode === 'otp') && <button type="button" onClick={() => setMode('login')} style={linkStyle}>Voltar para o login</button>}</div></div><p style={{ textAlign: 'center', color: '#7a8a7d', fontSize: 12, marginTop: 20 }}>Cardápio digital com automação no WhatsApp</p></section></main>;
}
