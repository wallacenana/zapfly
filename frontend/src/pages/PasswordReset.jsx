import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Lock, Mail, Loader2 } from 'lucide-react';
import { api } from '../api';

const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '14px 14px 14px 42px', borderRadius: 12, border: '1px solid #d9e5d2', background: '#fff', color: '#10251a', outline: 'none', fontSize: 14 };

export default function PasswordReset() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const isReset = Boolean(token);
  const submit = async (event) => {
    event.preventDefault(); setError(''); setMessage('');
    if (isReset && password !== confirmation) return setError('As senhas não coincidem.');
    setLoading(true);
    try { const { data } = isReset ? await api.post('/auth/reset-password', { token, newPassword: password }) : await api.post('/auth/forgot-password', { email }); setMessage(data.message || 'Solicitação concluída.'); if (isReset) setTimeout(() => { window.location.href = '/login'; }, 1800); }
    catch (err) { setError(err?.response?.data?.error || 'Não foi possível concluir a solicitação.'); } finally { setLoading(false); }
  };
  return <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'radial-gradient(circle at 15% 10%, #e9f8df 0, transparent 35%), linear-gradient(135deg,#f7faf5 0%,#eef5ea 100%)', color: '#10251a', fontFamily: "'Inter', sans-serif" }}><section style={{ width: '100%', maxWidth: 430 }}><div style={{ textAlign: 'center', marginBottom: 24 }}><img src="/favicon.svg" alt="Menzzu" style={{ width: 62, height: 62, objectFit: 'contain', background: '#fff', borderRadius: 18, padding: 10, boxSizing: 'border-box', boxShadow: '0 12px 30px rgba(49,100,35,.12)' }} /><h1 style={{ margin: '16px 0 6px', fontSize: 30, fontFamily: "'Outfit', sans-serif" }}>Menzzu</h1><p style={{ margin: 0, color: '#607066', fontSize: 14 }}>{isReset ? 'Crie uma nova senha para sua conta.' : 'Recupere o acesso à sua conta.'}</p></div><div style={{ background: 'rgba(255,255,255,.92)', border: '1px solid #d9e5d2', borderRadius: 22, padding: 30, boxShadow: '0 20px 50px rgba(34,75,30,.10)' }}>{message ? <div style={{ textAlign: 'center', color: '#3f8f19', lineHeight: 1.6 }}><CheckCircle2 size={38} /><p>{message}</p></div> : <form onSubmit={submit}>{!isReset && <Field icon={Mail} label="E-mail" value={email} onChange={setEmail} placeholder="seu@email.com" type="email" autoComplete="email" />}{isReset && <><Field icon={Lock} label="Nova senha" value={password} onChange={setPassword} placeholder="Mínimo de 8 caracteres" type="password" minLength={8} autoComplete="new-password" /><Field icon={Lock} label="Confirmar senha" value={confirmation} onChange={setConfirmation} placeholder="Repita a nova senha" type="password" minLength={8} autoComplete="new-password" /></>}{error && <div style={{ margin: '14px 0', padding: 12, borderRadius: 10, background: '#fff0ef', border: '1px solid #f5c4bf', color: '#b42318', fontSize: 13 }}>{error}</div>}<button type="submit" disabled={loading} style={{ width: '100%', padding: 14, border: 0, borderRadius: 12, background: 'linear-gradient(135deg,#5db72c,#3f8f19)', color: '#fff', fontWeight: 800, cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>{loading ? <Loader2 size={18} /> : <>{isReset ? 'Salvar nova senha' : 'Enviar link'} <ArrowRight size={17} /></>}</button></form>}<Link to="/login" style={{ display: 'block', marginTop: 20, textAlign: 'center', color: '#3f8f19', fontSize: 13, fontWeight: 800 }}>Voltar para o login</Link></div><p style={{ textAlign: 'center', color: '#7a8a7d', fontSize: 12, marginTop: 20 }}>Cardápio digital com automação no WhatsApp</p></section></main>;
}

function Field({ icon: Icon, label, value, onChange, ...props }) { return <label style={{ display: 'block', marginBottom: 16, fontSize: 12, fontWeight: 800, color: '#53665a' }}>{label}<span style={{ display: 'block', position: 'relative', marginTop: 7 }}><Icon size={16} color="#779080" style={{ position: 'absolute', left: 14, top: 14 }} /><input required value={value} onChange={(event) => onChange(event.target.value)} style={inputStyle} {...props} /></span></label>; }
