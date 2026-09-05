import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, CreditCard, ShieldCheck, ShoppingBag } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext';

const cardStyle = {
  backgroundColor: 'var(--bg-secondary)',
  border: '1px solid var(--border-color)',
  borderRadius: '18px',
  padding: '24px',
  boxShadow: 'var(--card-shadow)',
};

const AccountHome = () => {
  const { user } = useAuth();
  const [billing, setBilling] = useState(null);

  useEffect(() => {
    api.get('/billing/me').then(({ data }) => setBilling(data)).catch(() => setBilling(null));
  }, []);

  const subscription = billing?.subscription;
  const plan = billing?.plan;
  const status = subscription?.status === 'active' || subscription?.status === 'trialing'
    ? 'Ativa'
    : billing?.trial?.active ? 'Período de teste' : 'Sem assinatura';

  return (
    <main style={{ minHeight: '100vh', padding: '32px', backgroundColor: 'var(--bg-primary)' }}>
      <div style={{ maxWidth: '1180px', margin: '0 auto' }}>
        <div style={{ marginBottom: '28px' }}>
          <p style={{ color: 'var(--accent-primary)', fontSize: '13px', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px' }}>Minha conta</p>
          <h1 style={{ fontSize: '34px', marginBottom: '8px' }}>Bem-vindo ao Menzzu</h1>
          <p style={{ color: 'var(--text-secondary)', maxWidth: '720px', lineHeight: 1.6 }}>Gerencie sua assinatura e acompanhe o acesso à plataforma.</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '18px', marginBottom: '22px' }}>
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}><ShieldCheck size={20} color="var(--success)" /><span style={{ color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Acesso</span></div>
            <div style={{ fontSize: '22px', fontWeight: 800, marginBottom: '6px' }}>{status}</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>{user?.email || 'Conta Menzzu'}</div>
          </div>
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}><CreditCard size={20} color="var(--accent-primary)" /><span style={{ color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Plano</span></div>
            <div style={{ fontSize: '22px', fontWeight: 800, marginBottom: '6px' }}>{plan?.name || 'Escolha um plano'}</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>{subscription ? 'Assinatura recorrente' : 'Comece seu período de teste'}</div>
          </div>
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}><CheckCircle2 size={20} color="var(--warning)" /><span style={{ color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Benefícios</span></div>
            <div style={{ fontSize: '22px', fontWeight: 800, marginBottom: '6px' }}>Tudo pronto</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Recursos conforme seu plano</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '18px' }}>
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
              <div style={{ width: '46px', height: '46px', borderRadius: '14px', backgroundColor: 'var(--accent-glow)', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><ShoppingBag size={22} /></div>
              <div>
                <h3 style={{ fontSize: '18px', marginBottom: '8px' }}>Planos Menzzu</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.6, marginBottom: '16px' }}>Escolha o plano ideal para sua operação e ative os recursos da plataforma.</p>
                <Link to="/comprar" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: 'var(--accent-primary)', fontWeight: 800, textDecoration: 'none' }}>Ver planos <ArrowRight size={16} /></Link>
              </div>
            </div>
          </div>
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
              <div style={{ width: '46px', height: '46px', borderRadius: '14px', backgroundColor: 'var(--accent-glow)', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><ShieldCheck size={22} /></div>
              <div>
                <h3 style={{ fontSize: '18px', marginBottom: '8px' }}>Dados da conta</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.6 }}>Conta cadastrada com o e-mail {user?.email || '-'}.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
};

export default AccountHome;
