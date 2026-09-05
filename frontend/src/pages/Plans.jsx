import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api';

const formatPrice = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
const cycleLabels = { monthly: 'Mensal', semiannual: 'Semestral', annual: 'Anual' };

export default function Plans() {
  const [plans, setPlans] = useState([]);
  const [trial, setTrial] = useState({ enabled: true, days: 7 });
  const [cycle, setCycle] = useState('monthly');
  const [loading, setLoading] = useState(true);
  const [checkoutPlan, setCheckoutPlan] = useState('');

  useEffect(() => {
    api.get('/billing/plans').then(({ data }) => { setPlans(data.plans || []); setTrial(data.trial || { enabled: true, days: 7 }); }).catch(() => toast.error('Não foi possível carregar os planos.')).finally(() => setLoading(false));
  }, []);

  const checkout = async (planKey) => {
    setCheckoutPlan(planKey);
    try {
      const { data } = await api.post('/billing/checkout', { planKey, cycle });
      if (!data?.url) throw new Error('Checkout sem URL.');
      window.location.assign(data.url);
    } catch (error) { toast.error(error?.response?.data?.error || 'Não foi possível iniciar o pagamento.'); setCheckoutPlan(''); }
  };

  return <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', padding: 32 }}><div style={{ maxWidth: 1180, margin: '0 auto' }}><Link to="/conta" style={{ color: 'var(--accent-primary)', textDecoration: 'none', fontWeight: 700, display: 'inline-flex', gap: 8, alignItems: 'center' }}><ArrowLeft size={17} /> Minha conta</Link><div style={{ margin: '30px 0' }}><p style={{ color: 'var(--accent-primary)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em' }}>Planos Menzzu</p><h1 style={{ fontSize: 38, margin: '8px 0' }}>Escolha o ritmo da sua operação</h1><p style={{ color: 'var(--text-secondary)' }}>Venda sem limite. Os planos variam pela estrutura que você precisa administrar.</p><div style={{ display: 'inline-flex', gap: 6, marginTop: 18, padding: 5, borderRadius: 12, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>{Object.entries(cycleLabels).map(([key, label]) => <button key={key} onClick={() => setCycle(key)} style={{ border: 0, borderRadius: 9, padding: '9px 14px', background: cycle === key ? 'var(--accent-primary)' : 'transparent', color: cycle === key ? '#fff' : 'var(--text-secondary)', fontWeight: 800, cursor: 'pointer' }}>{label}</button>)}</div></div>{loading ? <Loader2 className="spin" /> : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 18 }}>{plans.map((plan, index) => { const selected = plan.cycles?.find((item) => item.key === cycle); return <div key={plan.key} style={{ background: 'var(--bg-secondary)', border: `1px solid ${index === 1 ? 'var(--accent-primary)' : 'var(--border-color)'}`, borderRadius: 20, padding: 24, boxShadow: 'var(--card-shadow)' }}><h2 style={{ margin: 0 }}>{plan.name}</h2><div style={{ fontSize: 34, fontWeight: 900, margin: '20px 0 4px' }}>{formatPrice(selected?.price ?? plan.price)}<small style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>/{cycle === 'monthly' ? 'mês' : cycle === 'semiannual' ? 'semestre' : 'ano'}</small></div>{trial.enabled && <p style={{ color: 'var(--accent-primary)', fontWeight: 800 }}>{trial.days} dias grátis sem cartão</p>}<div style={{ color: 'var(--text-secondary)', lineHeight: 1.9, minHeight: 150 }}><div><Check size={16} /> {plan.productLimit || 'Produtos ilimitados'} produtos</div><div><Check size={16} /> {plan.flowLimit || 'Fluxos ilimitados'} automação(ões)</div><div><Check size={16} /> Vendas, pedidos e clientes sem limite</div><div><Check size={16} /> {plan.calendar ? 'Google Calendar incluso' : 'Google Calendar não incluso'}</div></div><button onClick={() => checkout(plan.key)} disabled={Boolean(checkoutPlan)} style={{ width: '100%', padding: 14, border: 0, borderRadius: 12, background: 'var(--accent-primary)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>{checkoutPlan === plan.key ? 'Abrindo pagamento...' : 'Assinar plano'}</button></div>; })}</div>}<p style={{ marginTop: 22, color: 'var(--text-muted)', fontSize: 13 }}>Pagamento recorrente via cartão processado pela Abacate Pay.</p></div></div>;
}
