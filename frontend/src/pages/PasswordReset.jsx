import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Lock, Mail, Loader2 } from 'lucide-react';
import { api } from '../api';

const brandLogo = '/logo%20HotWhats.png';
const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '13px 14px 13px 40px', borderRadius: '12px', border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.06)', color: '#fff', outline: 'none', fontSize: '14px' };

export default function PasswordReset() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const isReset = Boolean(token);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (isReset && password !== confirmation) return setError('As senhas nao coincidem.');
    setLoading(true);
    try {
      const response = isReset
        ? await api.post('/auth/reset-password', { token, newPassword: password })
        : await api.post('/auth/forgot-password', { email });
      setMessage(response.data.message);
      if (isReset) setTimeout(() => { window.location.href = '/login'; }, 1800);
    } catch (err) {
      setError(err.response?.data?.error || 'Nao foi possivel concluir a solicitacao.');
    } finally { setLoading(false); }
  };

  return <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', background: 'radial-gradient(ellipse at top left, rgba(93,183,44,.14), #09271b 52%, #080b0a 100%)', color: '#fff', fontFamily: "'Inter', sans-serif" }}>
    <section style={{ width: '100%', maxWidth: '420px' }}>
      <div style={{ textAlign: 'center', marginBottom: '32px' }}><img src={brandLogo} alt="Menzzu" style={{ width: '64px', height: '64px', objectFit: 'contain', background: '#fff', borderRadius: '18px', padding: '10px', boxSizing: 'border-box' }} /><h1 style={{ fontSize: '28px', margin: '18px 0 6px', fontFamily: "'Outfit', sans-serif" }}>Menzzu</h1><p style={{ color: '#d4d4d8', fontSize: '14px', margin: 0 }}>{isReset ? 'Crie uma nova senha para sua conta' : 'Recupere o acesso a sua conta'}</p></div>
      <div style={{ background: 'rgba(18,18,20,.88)', border: '1px solid rgba(255,255,255,.08)', borderRadius: '24px', padding: '32px' }}>
        {message ? <div style={{ textAlign: 'center', color: '#bbf7d0', lineHeight: 1.6 }}><CheckCircle2 size={34} color="#5db72c" /><p>{message}</p></div> : <form onSubmit={submit}>
          {!isReset && <div style={{ position: 'relative', marginBottom: '18px' }}><Mail size={16} style={{ position: 'absolute', left: 14, top: 14 }} color="#d4d4d8" /><input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com" autoComplete="email" style={inputStyle} /></div>}
          {isReset && <><div style={{ position: 'relative', marginBottom: '14px' }}><Lock size={16} style={{ position: 'absolute', left: 14, top: 14 }} color="#d4d4d8" /><input required minLength={8} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Nova senha (minimo 8 caracteres)" autoComplete="new-password" style={inputStyle} /></div><div style={{ position: 'relative', marginBottom: '18px' }}><Lock size={16} style={{ position: 'absolute', left: 14, top: 14 }} color="#d4d4d8" /><input required minLength={8} type="password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder="Confirme a nova senha" autoComplete="new-password" style={inputStyle} /></div></>}
          {error && <p style={{ color: '#f87171', fontSize: '13px', lineHeight: 1.5 }}>{error}</p>}
          <button type="submit" disabled={loading} style={{ width: '100%', padding: '14px', border: 0, borderRadius: '12px', background: 'linear-gradient(135deg,#5db72c,#3f8f19)', color: '#fff', fontWeight: 700, cursor: loading ? 'wait' : 'pointer' }}>{loading ? <Loader2 size={18} className="animate-spin" /> : <>{isReset ? 'Salvar nova senha' : 'Enviar link de redefinicao'} <ArrowRight size={16} /></>}</button>
        </form>}
        <Link to="/login" style={{ display: 'block', marginTop: '22px', textAlign: 'center', color: '#bbf7d0', fontSize: '13px' }}>Voltar para o login</Link>
      </div>
      <p style={{ textAlign: 'center', color: '#d4d4d8', fontSize: '12px', marginTop: '24px' }}>Cardapio digital com automacao no WhatsApp</p>
    </section>
  </main>;
}
