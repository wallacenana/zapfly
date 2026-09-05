import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ShoppingBag, Clock3, Ticket, ShieldCheck, ArrowRight, CreditCard, ReceiptText } from 'lucide-react';
import TrialBanner from '../components/TrialBanner';

const cardStyle = {
  backgroundColor: 'var(--bg-secondary)',
  border: '1px solid var(--border-color)',
  borderRadius: '18px',
  padding: '24px',
  boxShadow: 'var(--card-shadow)',
};

const ActionCard = ({ icon: Icon, title, description, href, label = 'Abrir' }) => (
  <div style={cardStyle}>
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
        <div style={{
          width: '46px',
          height: '46px',
          borderRadius: '14px',
          backgroundColor: 'var(--accent-glow)',
          color: 'var(--accent-primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Icon size={22} />
        </div>
        <div>
          <h3 style={{ fontSize: '18px', marginBottom: '8px' }}>{title}</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.6 }}>{description}</p>
        </div>
      </div>
      {href ? (
        <Link
          to={href}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 14px',
            borderRadius: '12px',
            backgroundColor: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
            color: 'var(--text-primary)',
            textDecoration: 'none',
            fontSize: '14px',
            fontWeight: 700,
            whiteSpace: 'nowrap',
          }}
        >
          {label}
          <ArrowRight size={16} />
        </Link>
      ) : (
        <span className="badge badge-success" style={{ alignSelf: 'flex-start' }}>Em breve</span>
      )}
    </div>
  </div>
);

const AccountHome = () => {
  const { user } = useAuth();

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg-primary)', padding: '32px' }}>
      <TrialBanner />
      <div style={{ maxWidth: '1180px', margin: '0 auto' }}>
        <div style={{ marginBottom: '28px' }}>
          <p style={{ color: 'var(--accent-primary)', fontSize: '13px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px' }}>
            Minha conta
          </p>
          <h1 style={{ fontSize: '34px', marginBottom: '8px' }}>Bem-vindo, {user?.name || 'usuário'}</h1>
          <p style={{ color: 'var(--text-secondary)', maxWidth: '720px', lineHeight: 1.6 }}>
            Aqui você acompanha sua assinatura, acessa compras e resolve o básico sem entrar no painel interno da operação.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '18px', marginBottom: '22px' }}>
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
              <ShieldCheck size={20} color="var(--success)" />
              <span style={{ color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Acesso</span>
            </div>
            <div style={{ fontSize: '22px', fontWeight: 800, marginBottom: '6px' }}>{String(user?.role || 'user').toUpperCase()}</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Conta ativa para compra e acompanhamento.</div>
          </div>

          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
              <CreditCard size={20} color="var(--accent-primary)" />
              <span style={{ color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Plano</span>
            </div>
            <div style={{ fontSize: '22px', fontWeight: 800, marginBottom: '6px' }}>Assinatura</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Pronto para integrar com cobrança recorrente.</div>
          </div>

          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
              <ReceiptText size={20} color="var(--warning)" />
              <span style={{ color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Histórico</span>
            </div>
            <div style={{ fontSize: '22px', fontWeight: 800, marginBottom: '6px' }}>Pedidos</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Central para ver compras e assinaturas.</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '18px', marginBottom: '18px' }}>
          <ActionCard
            icon={ShoppingBag}
            title="Comprar plano"
            description="Escolha um plano, conclua o pagamento e receba o acesso automaticamente."
            href="/comprar/"
            label="Ir para compra"
          />
          <ActionCard
            icon={Clock3}
            title="Meus pedidos"
            description="Veja o que já foi solicitado e acompanhe o status das suas compras."
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '18px' }}>
          <ActionCard
            icon={Ticket}
            title="Assinatura e renovação"
            description="Área preparada para cobrança recorrente, renovações e cancelamentos."
          />
          <ActionCard
            icon={ShieldCheck}
            title="Dados da conta"
            description={`Email de acesso: ${user?.email || '-'} • Atualize seus dados e senha quando precisar.`}
          />
        </div>
      </div>
    </div>
  );
};

export default AccountHome;
